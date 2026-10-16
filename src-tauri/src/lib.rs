//! EyeCare Rust 核心入口。
//!
//! 模块划分与 Electron 主进程一一对应，详见 `docs/tauri-migration-checklist.md`。

pub mod autostart;
pub mod contracts;
pub mod engine;
pub mod ipc;
pub mod platform;
pub mod reminders;
pub mod settings;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde_json::Value;
use tauri::{App, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

use autostart::{AutostartContext, file_exists, prepare_login_change, system_backend};
use contracts::{
    AppError, CommandResult, EngineUpdate, OverlayState, ReminderEvent, ReminderKind, RuntimeSnapshot, RuntimeStatus,
    SettingsV2, VisualMode, resolve_settings,
};
use engine::TimerEngine;
use platform::{ActivitySource, PlatformAdapter};
use reminders::ReminderCoordinator;
use settings::validation::validate_settings;
use settings::{SettingsStore, save_with_login};

/// 主窗口标签，与 `capabilities/default.json` 的 `windows` 项必须一致。
pub(crate) const MAIN_WINDOW: &str = "main";

/// 快照推送事件名，与 `app/renderer/bridge.ts` 的订阅名一致。
const SNAPSHOT_EVENT: &str = "eyecare:snapshot-updated";

/// 「打开设置页」事件名，与 `app/renderer/bridge.ts` 的订阅名一致。
const OPEN_SETTINGS_EVENT: &str = "eyecare:open-settings";

/// 采样周期，对齐 `app/main/index.ts#L245` 的 1 秒 `setInterval`。
const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

/// 应用级共享状态。
///
/// Phase 3 容纳定时引擎与平台适配层；Phase 5 补入设置仓库；Phase 6 补入
/// 命令层所需的协调器骨架、命令门控与预览态；Phase 4 起会补入托盘等部件。
pub struct AppState {
    /// 定时引擎；采样循环与命令共用同一把锁。
    engine: Mutex<TimerEngine>,
    /// 平台适配层；采样循环独占，命令侧只读取能力报告。
    adapter: Mutex<PlatformAdapter>,
    /// 设置仓库；`save_settings` 命令经由 `save_with_login` 串行落盘。
    store: Mutex<SettingsStore>,
    /// 提醒协调器；覆盖层窗口与通知在 Phase 4 补入。
    coordinator: Mutex<ReminderCoordinator>,
    /// 命令门控；对齐 Electron 的 `commandQueue`，同一时刻只执行一条 IPC 命令。
    command_gate: Mutex<()>,
    /// 启动期告警（目录迁移、设置恢复），随每份快照下发给前端。
    startup_warnings: Mutex<Vec<String>>,
    /// 「打开设置页」的一次性请求标记，由托盘或第二次启动置位。
    settings_requested: AtomicBool,
    /// 预览引起的序号偏移，与引擎序号相加后对外呈现。
    preview_sequence: AtomicU64,
    /// 当前预览的事件标识。
    current_preview_id: Mutex<Option<String>>,
    /// 最近一次预览的最终结果。
    latest_preview_result: Mutex<Option<contracts::PreviewResult>>,
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
            coordinator: Mutex::new(ReminderCoordinator::new()),
            command_gate: Mutex::new(()),
            startup_warnings: Mutex::new(startup_warnings),
            settings_requested: AtomicBool::new(false),
            preview_sequence: AtomicU64::new(0),
            current_preview_id: Mutex::new(None),
            latest_preview_result: Mutex::new(None),
        }
    }
}

/// 取得锁；即使上一次持有者 panic 也继续使用内部状态，避免一次采样异常拖垮整个应用。
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 进入命令临界区；返回的门控在所有命令执行期间持有。
fn gate(state: &AppState) -> MutexGuard<'_, ()> {
    lock(&state.command_gate)
}

/// 组装对外快照，对应 Electron 的 `presentedSnapshot`
/// （预览序号偏移 + 预览标识与结果 + 引擎告警 + 启动期告警）。
fn presented_snapshot(state: &AppState, snapshot: &RuntimeSnapshot) -> RuntimeSnapshot {
    let mut presented = snapshot.clone();
    presented.sequence = snapshot.sequence + state.preview_sequence.load(Ordering::SeqCst);
    presented.current_preview_id = lock(&state.current_preview_id).clone();
    presented.latest_preview_result = lock(&state.latest_preview_result).clone();
    presented.warnings.extend(lock(&state.startup_warnings).iter().cloned());
    presented
}

/// 把一份快照推送给所有窗口。
fn emit_snapshot(handle: &AppHandle, state: &AppState, snapshot: &RuntimeSnapshot) {
    let _ = handle.emit(SNAPSHOT_EVENT, presented_snapshot(state, snapshot));
}

/// 推送引擎更新并返回对外快照，对应 Electron 的 `apply`。
fn apply(handle: &AppHandle, state: &AppState, update: &EngineUpdate) -> CommandResult<RuntimeSnapshot> {
    emit_snapshot(handle, state, &update.snapshot);
    CommandResult::success(presented_snapshot(state, &update.snapshot))
}

/// 失败但仍需以统一错误结构返回的辅助函数。
fn failure<T>(code: &str, message: &str) -> CommandResult<T> {
    CommandResult::failure(AppError::new(code, message))
}

/// 读取当前运行态快照，对应 `EyeCareBridge.getSnapshot`。
#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> RuntimeSnapshot {
    let _gate = gate(&state);
    let snapshot = lock(&state.engine).get_snapshot();
    presented_snapshot(state.inner(), &snapshot)
}

/// 消费「打开设置页」请求，对应 `EyeCareBridge.subscribeOpenSettings` 的初始拉取。
#[tauri::command]
fn settings_requested(state: State<'_, AppState>) -> bool {
    let _gate = gate(&state);
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
    emit_snapshot(handle, state.inner(), &update.snapshot);
}

/// 采样并判定是否允许呈现新提醒，对应 Electron 的 `checkEligible`。
fn check_eligible(handle: &AppHandle, state: &AppState, preview: bool) -> Result<(), AppError> {
    tick(handle);
    let snapshot = {
        let current = lock(&state.engine).get_snapshot();
        presented_snapshot(state, &current)
    };
    if lock(&state.coordinator).current().is_some() || snapshot.current_reminder_id.is_some() {
        return Err(AppError::new("REMINDER_BUSY", "已有提醒，请先完成当前提醒"));
    }
    let blocked = if preview {
        [RuntimeStatus::Starting, RuntimeStatus::Locked, RuntimeStatus::Sleeping, RuntimeStatus::CapabilityError].as_slice()
    } else {
        [
            RuntimeStatus::Starting,
            RuntimeStatus::Locked,
            RuntimeStatus::Sleeping,
            RuntimeStatus::CapabilityError,
            RuntimeStatus::Paused,
            RuntimeStatus::LongIdle,
        ]
        .as_slice()
    };
    if blocked.contains(&snapshot.status) {
        let reason = if snapshot.status_reason.is_empty() { "当前状态不允许提醒" } else { snapshot.status_reason.as_str() };
        return Err(AppError::new("REMINDER_SUPPRESSED", reason));
    }
    Ok(())
}

/// 保存设置并应用，对应 `EyeCareBridge.saveSettings`。
#[tauri::command]
fn save_settings(
    handle: AppHandle,
    state: State<'_, AppState>,
    expected_revision: Option<Value>,
    settings: Option<Value>,
) -> CommandResult<RuntimeSnapshot> {
    let _gate = gate(&state);
    let Some(revision) = ipc::safe_revision(&expected_revision) else {
        return failure("INVALID_COMMAND", "配置版本无效");
    };
    let incoming = match ipc::required(&settings, "操作参数不匹配") {
        Ok(value) => value,
        Err(error) => return CommandResult::failure(error),
    };
    tick(&handle);
    let snapshot = {
        let current = lock(&state.engine).get_snapshot();
        presented_snapshot(state.inner(), &current)
    };
    let validation = validate_settings(incoming);
    let Some(new_settings) = validation.value else {
        return CommandResult::failure(validation.error.unwrap_or_else(|| AppError::new("INVALID_SETTINGS", "请检查设置中的标记项")));
    };
    if revision != snapshot.settings_revision {
        return CommandResult::failure(AppError {
            code: "SETTINGS_CONFLICT".into(),
            message: "设置已在其他窗口更新，请保留输入并重新应用".into(),
            fields: None,
            current_revision: Some(snapshot.settings_revision),
        });
    }
    let old_login = snapshot.settings.general.launch_at_login;
    let result = {
        let mut store = lock(&state.store);
        save_with_login(&mut *store, revision, &new_settings, old_login, |enabled| {
            let context = AutostartContext::current();
            let backend = system_backend(&context)?;
            let exists = file_exists();
            prepare_login_change(enabled, &context, backend, &exists)
        })
    };
    let Some(stored) = result.value else {
        return CommandResult::failure(result.error.unwrap_or_else(|| AppError::new("COMMAND_FAILED", "操作失败，请重试")));
    };
    let update = lock(&state.engine).update_settings(stored.settings, stored.revision, None);
    apply(&handle, state.inner(), &update)
}

/// 暂停提醒，对应 `EyeCareBridge.pause`。
#[tauri::command]
fn pause(handle: AppHandle, state: State<'_, AppState>) -> CommandResult<RuntimeSnapshot> {
    let _gate = gate(&state);
    tick(&handle);
    lock(&state.coordinator).cancel(None);
    let update = lock(&state.engine).pause();
    apply(&handle, state.inner(), &update)
}

/// 恢复提醒，对应 `EyeCareBridge.resume`。
#[tauri::command]
fn resume(handle: AppHandle, state: State<'_, AppState>) -> CommandResult<RuntimeSnapshot> {
    let _gate = gate(&state);
    tick(&handle);
    let update = lock(&state.engine).resume(None);
    apply(&handle, state.inner(), &update)
}

/// 立即提醒，对应 `EyeCareBridge.remindNow`。
#[tauri::command]
fn remind_now(handle: AppHandle, state: State<'_, AppState>) -> CommandResult<RuntimeSnapshot> {
    let _gate = gate(&state);
    if let Err(error) = check_eligible(&handle, state.inner(), false) {
        return CommandResult::failure(error);
    }
    let update = lock(&state.engine).remind_now(None);
    apply(&handle, state.inner(), &update)
}

/// 处理遮罩型提醒的用户动作，对应 `EyeCareBridge.resolveReminder`。
#[tauri::command]
fn resolve_reminder(
    handle: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    id: Option<Value>,
    generation: Option<Value>,
    action: Option<Value>,
) -> CommandResult<RuntimeSnapshot> {
    let _gate = gate(&state);
    let (id, generation) = match ipc::identity(&id, &generation) {
        Ok(value) => value,
        Err(error) => return CommandResult::failure(error),
    };
    let action = match ipc::reminder_action(&action) {
        Ok(value) => value,
        Err(error) => return CommandResult::failure(error),
    };
    let Some(overlay) = lock(&state.coordinator).overlay_state(window.label()) else {
        return failure("STALE_REMINDER", "此提醒已结束");
    };
    if overlay.event.id != id || overlay.event.generation != generation || overlay.event.settings.reminder.visual != VisualMode::Mask {
        return failure("STALE_REMINDER", "此提醒已结束");
    }
    if overlay.event.kind == ReminderKind::Preview {
        lock(&state.coordinator).resolve_preview(&id, generation, action);
        let snapshot = {
            let current = lock(&state.engine).get_snapshot();
            presented_snapshot(state.inner(), &current)
        };
        return CommandResult::success(snapshot);
    }
    tick(&handle);
    let update = lock(&state.engine).resolve_reminder(&id, generation, action, None);
    apply(&handle, state.inner(), &update)
}

/// 呈现一次预览，对应 `EyeCareBridge.preview`。
#[tauri::command]
fn preview(handle: AppHandle, state: State<'_, AppState>, settings: Option<Value>) -> CommandResult<String> {
    let _gate = gate(&state);
    if let Err(error) = check_eligible(&handle, state.inner(), true) {
        return CommandResult::failure(error);
    }
    let snapshot = {
        let current = lock(&state.engine).get_snapshot();
        presented_snapshot(state.inner(), &current)
    };
    let incoming = match ipc::required(&settings, "操作参数不匹配") {
        Ok(value) => value,
        Err(error) => return CommandResult::failure(error),
    };
    let validation = validate_settings(incoming);
    let Some(settings) = validation.value else {
        return CommandResult::failure(validation.error.unwrap_or_else(|| AppError::new("INVALID_SETTINGS", "请检查设置中的标记项")));
    };
    // 对齐 `app/main/index.ts#L180`：预览事件用 `preview-` 前缀的随机标识，且代号固定为 0。
    let event = ReminderEvent {
        id: format!("preview-{}", Uuid::new_v4()),
        generation: 0,
        kind: ReminderKind::Preview,
        settings: resolve_settings(&settings),
        screen_ids: snapshot.displays.iter().map(|display| display.id.clone()).collect(),
        created_at_ms: 0,
    };
    match lock(&state.coordinator).present(event) {
        Ok(id) => CommandResult::success(id),
        Err(error) => CommandResult::failure(error),
    }
}

/// 取消进行中的预览，对应 `EyeCareBridge.cancelPreview`。
#[tauri::command]
fn cancel_preview(state: State<'_, AppState>) -> CommandResult<()> {
    let _gate = gate(&state);
    let mut coordinator = lock(&state.coordinator);
    if coordinator.current().map(|event| event.kind) == Some(ReminderKind::Preview) {
        coordinator.cancel(None);
    }
    CommandResult::success(())
}

/// 覆盖层窗口订阅到的状态，对应 `EyeCareBridge.getOverlay`。
#[tauri::command]
fn get_overlay(state: State<'_, AppState>, window: WebviewWindow) -> Option<OverlayState> {
    let _gate = gate(&state);
    lock(&state.coordinator).overlay_state(window.label())
}

/// 覆盖层窗口就绪，对应 `EyeCareBridge.overlayReady`。
#[tauri::command]
fn overlay_ready(
    handle: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    id: Option<Value>,
    generation: Option<Value>,
) -> CommandResult<()> {
    let _gate = gate(&state);
    let (id, generation) = match ipc::identity(&id, &generation) {
        Ok(value) => value,
        Err(error) => return CommandResult::failure(error),
    };
    tick(&handle);
    if !lock(&state.coordinator).ready(window.label(), &id, generation) {
        return failure("STALE_REMINDER", "提醒已取消");
    }
    if lock(&state.coordinator).current().map(|event| event.kind) == Some(ReminderKind::Real) {
        let channels = lock(&state.coordinator).channels();
        let update = lock(&state.engine).record_reminder_channels(&id, generation, &channels);
        emit_snapshot(&handle, state.inner(), &update.snapshot);
    }
    CommandResult::success(())
}

/// 覆盖层窗口报告声音已开始播放，对应 `EyeCareBridge.overlaySoundStarted`。
#[tauri::command]
fn overlay_sound_started(
    handle: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    id: Option<Value>,
    generation: Option<Value>,
) -> CommandResult<()> {
    let _gate = gate(&state);
    let (id, generation) = match ipc::identity(&id, &generation) {
        Ok(value) => value,
        Err(error) => return CommandResult::failure(error),
    };
    tick(&handle);
    if !lock(&state.coordinator).sound_started(window.label(), &id, generation) {
        return failure("STALE_REMINDER", "声音提醒已取消");
    }
    CommandResult::success(())
}

/// 覆盖层窗口上报通道结果，对应 `EyeCareBridge.overlayFinished`。
#[tauri::command]
fn overlay_finished(
    handle: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    id: Option<Value>,
    generation: Option<Value>,
    results: Option<Value>,
) -> CommandResult<()> {
    let _gate = gate(&state);
    let (id, generation) = match ipc::identity(&id, &generation) {
        Ok(value) => value,
        Err(error) => return CommandResult::failure(error),
    };
    let results = match ipc::channel_results(&results) {
        Ok(value) => value,
        Err(error) => return CommandResult::failure(error),
    };
    tick(&handle);
    let overlay = lock(&state.coordinator).overlay_state(window.label());
    if !lock(&state.coordinator).report(window.label(), &id, generation, &results) {
        return failure("STALE_REMINDER", "提醒已结束");
    }
    let is_real = overlay.as_ref().map(|state| state.event.kind) == Some(ReminderKind::Real);
    if is_real && lock(&state.coordinator).matches(&id, generation) {
        let channels = lock(&state.coordinator).channels();
        let update = lock(&state.engine).record_reminder_channels(&id, generation, &channels);
        emit_snapshot(&handle, state.inner(), &update.snapshot);
    }
    CommandResult::success(())
}

/// 请求打开设置页，对应 `EyeCareBridge.openSettings`。
#[tauri::command]
fn open_settings(handle: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let _gate = gate(&state);
    // Phase 4 负责显示并聚焦主窗口；这里先置位一次性请求标记，并通知已打开的主窗口。
    state.settings_requested.store(true, Ordering::SeqCst);
    if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
        let _ = window.emit(OPEN_SETTINGS_EVENT, ());
    }
    CommandResult::success(())
}

/// 退出应用，对应 `EyeCareBridge.quit`。
#[tauri::command]
fn quit(handle: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let _gate = gate(&state);
    // 对齐 Electron 的 `setImmediate(quit)`：先让本次响应返回，再由独立线程退出进程。
    let handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        handle.exit(0);
    });
    CommandResult::success(())
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
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            settings_requested,
            save_settings,
            pause,
            resume,
            remind_now,
            resolve_reminder,
            preview,
            cancel_preview,
            get_overlay,
            overlay_ready,
            overlay_sound_started,
            overlay_finished,
            open_settings,
            quit
        ])
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
