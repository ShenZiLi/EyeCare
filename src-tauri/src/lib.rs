//! EyeCare Rust 核心入口。
//!
//! 模块划分与 Electron 主进程一一对应，详见 `docs/tauri-migration-checklist.md`。

pub mod autostart;
pub mod contracts;
pub mod engine;
pub mod platform;
pub mod settings;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::{App, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use contracts::{RuntimeSnapshot, SettingsV2};
use engine::TimerEngine;
use platform::{ActivitySource, PlatformAdapter};
use settings::SettingsStore;

/// 主窗口标签，与 `capabilities/default.json` 的 `windows` 项必须一致。
pub(crate) const MAIN_WINDOW: &str = "main";

/// 快照推送事件名，与 `app/renderer/bridge.ts` 的订阅名一致。
const SNAPSHOT_EVENT: &str = "eyecare:snapshot-updated";

/// 采样周期，对齐 `app/main/index.ts#L245` 的 1 秒 `setInterval`。
const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

/// 应用级共享状态。
///
/// Phase 3 容纳定时引擎与平台适配层；Phase 5 补入设置仓库；Phase 4 起会补入协调器、托盘等部件。
pub struct AppState {
    /// 定时引擎；采样循环与命令共用同一把锁。
    engine: Mutex<TimerEngine>,
    /// 平台适配层；采样循环独占，命令侧只读取能力报告。
    adapter: Mutex<PlatformAdapter>,
    /// 设置仓库；Phase 6 的 `save_settings` 命令将从此处串行落盘。
    #[allow(dead_code, reason = "Phase 6 命令层从这里读写设置")]
    store: Mutex<SettingsStore>,
    /// 启动期告警（目录迁移、设置恢复），随每份快照下发给前端。
    startup_warnings: Mutex<Vec<String>>,
    /// 「打开设置页」的一次性请求标记，由托盘或第二次启动置位。
    settings_requested: AtomicBool,
}

impl AppState {
    /// 以已加载的设置、设置版本与启动期告警创建状态。
    fn new(store: SettingsStore, startup_warnings: Vec<String>, settings: SettingsV2, revision: i64) -> Self {
        Self {
            // 与 `app/main/index.ts#L226` 一致：`new TimerEngine(settings, revision)` 不传 `nowMs`（即 0），
            // 首个采样会同时校准 `now` 与 `deadline`。
            engine: Mutex::new(TimerEngine::new(settings, revision, 0)),
            adapter: Mutex::new(PlatformAdapter::new()),
            store: Mutex::new(store),
            startup_warnings: Mutex::new(startup_warnings),
            settings_requested: AtomicBool::new(false),
        }
    }
}

/// 取得锁；即使上一次持有者 panic 也继续使用内部状态，避免一次采样异常拖垮整个应用。
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 组装对外快照，对应 Electron 的 `presentedSnapshot`（引擎告警 + 启动期告警）。
fn presented_snapshot(state: &AppState, snapshot: &RuntimeSnapshot) -> RuntimeSnapshot {
    let mut presented = snapshot.clone();
    presented.warnings.extend(lock(&state.startup_warnings).iter().cloned());
    presented
}

/// 读取当前运行态快照，对应 `EyeCareBridge.getSnapshot`。
#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> RuntimeSnapshot {
    let snapshot = lock(&state.engine).get_snapshot();
    presented_snapshot(state.inner(), &snapshot)
}

/// 消费「打开设置页」请求，对应 `EyeCareBridge.subscribeOpenSettings` 的初始拉取。
#[tauri::command]
fn settings_requested(state: State<'_, AppState>) -> bool {
    state.settings_requested.swap(false, Ordering::SeqCst)
}

/// 采样一次并推进引擎，随后把快照推送给所有窗口。
fn tick(handle: &AppHandle) {
    let state = handle.state::<AppState>();
    let sample = lock(&state.adapter).sample(handle, ActivitySource::Combined);
    let update = lock(&state.engine).accept_sample(sample);
    if !update.effects.is_empty() {
        // 覆盖层与通知尚未迁移（Phase 4），先记录以免副作用被静默丢弃。
        log::info!("定时引擎产生副作用，等待 Phase 4 处理：{:?}", update.effects);
    }
    let _ = handle.emit(SNAPSHOT_EVENT, presented_snapshot(&state, &update.snapshot));
}

/// 常驻采样循环；随进程退出而终止，无需显式停止。
fn spawn_sampler(handle: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(SAMPLE_INTERVAL);
            tick(&handle);
        }
    });
}

/// 启动 Tauri 应用。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 第二次启动时沿用 Electron 的语义：把已有实例的主窗口带到前台。
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![get_snapshot, settings_requested])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }
            app.manage(load_state(app));
            // 尺寸与标题对齐 `app/main/index.ts#L93` 的 BrowserWindow 配置。
            // URL 带 `?surface=main`，与 `app/renderer/main.tsx#L7` 的读取约定一致。
            WebviewWindowBuilder::new(
                app,
                MAIN_WINDOW,
                WebviewUrl::App("index.html?surface=main".into()),
            )
            .title("EyeCare")
            .inner_size(600.0, 500.0)
            .min_inner_size(600.0, 500.0)
            .build()?;
            spawn_sampler(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

/// 解析数据目录、加载设置并组装应用状态。
///
/// Electron 的 `app.getPath('userData')` 是 `~/Library/Application Support/EyeCare`，
/// 而 Tauri 的 `app_data_dir()` 以 bundle identifier 结尾；两者的差异由
/// `settings::migrate_legacy_directory` 做一次性补齐，源文件始终保留。
fn load_state(app: &App) -> AppState {
    let mut warnings: Vec<String> = Vec::new();
    let (target, legacy) = {
        let resolver = app.path();
        let target = resolver
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join(settings::LEGACY_DIRECTORY_NAME));
        // Linux 上 Electron 的 userData 落在 XDG config 目录，其余平台落在 data 目录。
        let root = if cfg!(target_os = "linux") { resolver.config_dir() } else { resolver.data_dir() };
        (target, root.ok().map(|directory| directory.join(settings::LEGACY_DIRECTORY_NAME)))
    };
    warnings.extend(settings::migrate_legacy_directory(legacy.as_deref(), &target));
    let mut store = SettingsStore::new(target);
    let loaded = store.load();
    warnings.extend(loaded.warnings);
    for warning in &warnings {
        log::warn!("{warning}");
    }
    AppState::new(store, warnings, loaded.settings, loaded.revision)
}
