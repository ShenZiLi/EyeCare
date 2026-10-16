//! EyeCare Rust 核心入口。
//!
//! 模块划分与 Electron 主进程一一对应，详见 `docs/tauri-migration-checklist.md`。

pub mod contracts;
pub mod engine;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

use contracts::{default_settings, RuntimeSnapshot};
use engine::TimerEngine;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

/// 主窗口标签，与 `capabilities/default.json` 的 `windows` 项必须一致。
const MAIN_WINDOW: &str = "main";

/// 应用级共享状态。
///
/// Phase 1 只容纳定时引擎，Phase 3 起会逐步补入平台桥、提醒协调器、托盘等部件。
pub struct AppState {
    /// 定时引擎；命令与采样循环共用同一把锁。
    engine: Mutex<TimerEngine>,
    /// 「打开设置页」的一次性请求标记，由托盘或第二次启动置位。
    settings_requested: AtomicBool,
}

impl AppState {
    /// 以出厂默认设置创建状态。
    fn new(now_ms: i64) -> Self {
        Self {
            engine: Mutex::new(TimerEngine::new(default_settings(), 0, now_ms)),
            settings_requested: AtomicBool::new(false),
        }
    }
}

/// 当前墙钟毫秒数。
///
/// 仅作为 Phase 1 的占位时钟；Phase 3 会换成跨睡眠连续的平台单调时钟，
/// 定时引擎对时钟连续性的要求见 `engine.rs` 的 `SAMPLE_GAP_WARNING_MS`。
fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or(0)
}

/// 读取当前运行态快照，对应 `EyeCareBridge.getSnapshot`。
#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> RuntimeSnapshot {
    state.engine.lock().expect("定时引擎状态被污染").get_snapshot()
}

/// 消费「打开设置页」请求，对应 `EyeCareBridge.subscribeOpenSettings` 的初始拉取。
#[tauri::command]
fn settings_requested(state: State<'_, AppState>) -> bool {
    state.settings_requested.swap(false, Ordering::SeqCst)
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
            app.manage(AppState::new(now_ms()));
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
