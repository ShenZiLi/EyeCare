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
pub mod tray;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{
    App, AppHandle, CloseRequestApi, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use autostart::{AutostartContext, file_exists, prepare_login_change, system_backend};
use contracts::{
    AppError, Capability, CapabilityState, CommandResult, EngineEffect, EngineUpdate, OverlayState, ReminderEvent,
    ReminderKind, RuntimeSnapshot, RuntimeStatus, SettingsV2, EffectiveTheme, VisualMode, resolve_settings,
};
use engine::TimerEngine;
use platform::{ActivitySource, PlatformAdapter};
use reminders::{ReminderCoordinator, Settlement};
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

/// Dock 图标两次可见性切换的最小间隔。
///
/// 对齐 `app/main/index.ts#L81-L83`：系统会忽略紧接着 `Dock.show` 的 `Dock.hide`，
/// 隐藏动作必须等到 `Dock.show` 的原生过渡结束后再执行。
const DOCK_TRANSITION_COOLDOWN: Duration = Duration::from_millis(1100);

/// 应用级共享状态。
///
/// Phase 3 容纳定时引擎与平台适配层；Phase 5 补入设置仓库；Phase 6 补入
/// 命令层所需的协调器骨架、命令门控与预览态；Phase 4 补入托盘与窗口生命周期。
pub struct AppState {
    /// 定时引擎；采样循环与命令共用同一把锁。
    engine: Mutex<TimerEngine>,
    /// 平台适配层；采样循环独占，命令侧只读取能力报告。
    adapter: Mutex<PlatformAdapter>,
    /// 设置仓库；`save_settings` 命令经由 `save_with_login` 串行落盘。
    store: Mutex<SettingsStore>,
    /// 提醒协调器；自带内部互斥锁，调用方无需再套一层。
    coordinator: ReminderCoordinator,
    /// 托盘呈现层；只在主线程读写，见 `tray.rs` 的线程约束说明。
    tray: Mutex<tray::TrayPresenter>,
    /// 托盘创建是否成功；采样与快照组装只读这一个原子标记，避免与主线程互等。
    tray_available: AtomicBool,
    /// 上一次同步给覆盖层的外观三元组（主题:减少动效:降低透明度）。
    appearance_key: Mutex<String>,
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
    /// 退出标记；置位后关闭窗口不再拦截，托盘也随进程结束释放。
    quitting: AtomicBool,
    /// 主窗口是否「被期望可见」；隐藏去抖与 Dock 图标隐藏都依赖它。
    main_window_wanted: AtomicBool,
    /// 主窗口可见性世代号；异步回调靠它判断请求是否已被后来的操作取代。
    main_visibility_generation: AtomicU64,
    /// macOS 上 Dock 图标当前是否已隐藏。
    dock_hidden: AtomicBool,
    /// 最近一次 Dock 可见性切换的毫秒时间戳（相对 `dock_epoch`）。
    last_dock_transition_ms: AtomicU64,
    /// 进程内单调时钟起点，等价于 `performance.now()` 的零点。
    dock_epoch: Instant,
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
            coordinator: ReminderCoordinator::new(),
            tray: Mutex::new(tray::TrayPresenter::new()),
            tray_available: AtomicBool::new(false),
            appearance_key: Mutex::new(String::new()),
            command_gate: Mutex::new(()),
            startup_warnings: Mutex::new(startup_warnings),
            settings_requested: AtomicBool::new(false),
            preview_sequence: AtomicU64::new(0),
            current_preview_id: Mutex::new(None),
            latest_preview_result: Mutex::new(None),
            quitting: AtomicBool::new(false),
            main_window_wanted: AtomicBool::new(false),
            main_visibility_generation: AtomicU64::new(0),
            dock_hidden: AtomicBool::new(false),
            last_dock_transition_ms: AtomicU64::new(0),
            dock_epoch: Instant::now(),
        }
    }

    /// 相对 `dock_epoch` 的毫秒时间戳，等价于 Electron 的 `performance.now()`。
    fn elapsed_ms(&self) -> u64 {
        self.dock_epoch.elapsed().as_millis() as u64
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
/// （预览序号偏移 + 预览标识与结果 + 引擎告警 + 启动期告警 + 托盘能力降级）。
fn presented_snapshot(state: &AppState, snapshot: &RuntimeSnapshot) -> RuntimeSnapshot {
    let mut presented = snapshot.clone();
    presented.sequence = snapshot.sequence + state.preview_sequence.load(Ordering::SeqCst);
    presented.current_preview_id = lock(&state.current_preview_id).clone();
    presented.latest_preview_result = lock(&state.latest_preview_result).clone();
    presented.warnings.extend(lock(&state.startup_warnings).iter().cloned());
    if !state.tray_available.load(Ordering::SeqCst) {
        // 对齐 `app/main/index.ts#L39`：没有托盘时主窗口必须保持可访问。
        presented.capabilities.tray = Capability {
            state: CapabilityState::Unsupported,
            reason: "当前桌面未提供可用托盘，主窗口保持可访问".into(),
        };
    }
    presented
}

/// 推送引擎更新：快照、托盘、外观同步、引擎副作用与受限状态下的预览撤销，
/// 对应 Electron 的 `publish`（`app/main/index.ts#L42-L56`）。
///
/// 托盘刷新必须回到主线程：tauri 的托盘 setter 会阻塞等待主线程执行，
/// 若在采样线程直接调用，会与主线程上的托盘菜单回调互相等待。`on_main_thread`
/// 在主线程上调用时同步执行，因此这里不需要区分调用来源。
fn publish(handle: &AppHandle, state: &AppState, update: &EngineUpdate) {
    let presented = presented_snapshot(state, &update.snapshot);
    // 对齐 Electron：快照只发给主窗口，覆盖层通过自己的状态通道接收。
    if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
        let _ = window.emit(SNAPSHOT_EVENT, &presented);
    }
    let tray_handle = handle.clone();
    let tray_snapshot = presented.clone();
    let _ = handle.run_on_main_thread(move || {
        let tray_state = tray_handle.state::<AppState>();
        lock(&tray_state.tray).update(&tray_handle, &tray_snapshot);
    });
    // 外观三元组变化时让覆盖层跟随系统主题与无障碍偏好。
    let appearance = format!(
        "{}:{}:{}",
        theme_key(presented.theme),
        presented.reduce_motion,
        presented.reduce_transparency
    );
    let changed = {
        let mut key = lock(&state.appearance_key);
        let changed = *key != appearance;
        *key = appearance;
        changed
    };
    if changed {
        state.coordinator.sync_appearance(handle);
    }
    for effect in &update.effects {
        match effect {
            EngineEffect::Cancel { id, .. } => state.coordinator.cancel(handle, Some(id)),
            EngineEffect::Present { reminder } => {
                // 预览被新的提醒取代时先撤销预览，对应 TS 的 `coordinator.cancel()`。
                if state.coordinator.current_kind() == Some(ReminderKind::Preview) {
                    state.coordinator.cancel(handle, None);
                }
                if let Err(error) = state.coordinator.present(handle, reminder.clone()) {
                    log::warn!("提醒呈现失败：{}（{}）", error.message, error.code);
                }
            }
            EngineEffect::RestConfirmed { .. } => {}
        }
    }
    // 预览在受限状态下立即撤销，对应 `app/main/index.ts#L55`。
    let blocked = matches!(
        presented.status,
        RuntimeStatus::Locked | RuntimeStatus::Sleeping | RuntimeStatus::CapabilityError | RuntimeStatus::LongIdle
    );
    if blocked && state.coordinator.current_kind() == Some(ReminderKind::Preview) {
        state.coordinator.cancel(handle, None);
    }
}

/// 只推快照、不处理副作用；对应 Electron 里不带 `update` 的 `publish()`。
fn emit_snapshot(handle: &AppHandle, state: &AppState, snapshot: &RuntimeSnapshot) {
    publish(handle, state, &EngineUpdate { snapshot: snapshot.clone(), effects: Vec::new() });
}

/// 推送引擎更新并返回对外快照，对应 Electron 的 `apply`。
fn apply(handle: &AppHandle, state: &AppState, update: &EngineUpdate) -> CommandResult<RuntimeSnapshot> {
    publish(handle, state, update);
    CommandResult::success(presented_snapshot(state, &update.snapshot))
}

/// 外观三元组里的主题取值，与 TS 的 `snapshot.theme` 字面量一致。
fn theme_key(theme: EffectiveTheme) -> &'static str {
    match theme {
        EffectiveTheme::Dark => "dark",
        EffectiveTheme::Light => "light",
        EffectiveTheme::Handdrawn => "handdrawn",
    }
}

/// 在主线程上执行任务并等待结果。
///
/// tauri 的 `run_on_main_thread` 在**主线程上调用时会同步执行**（`tauri-runtime-wry`
/// 的 `send_user_message` 直接调用处理函数），因此同一条路径既能承载命令侧的同步
/// 调用，也能承载采样线程的跨线程投递。窗口创建与销毁必须走这里。
pub(crate) fn on_main_thread<T, F>(handle: &AppHandle, task: F) -> Option<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let (sender, receiver) = std::sync::mpsc::channel();
    if let Err(error) = handle.run_on_main_thread(move || {
        let _ = sender.send(task());
    }) {
        log::warn!("主线程任务投递失败：{error}");
        return None;
    }
    receiver.recv().ok()
}

/// 供协调器读取对外快照，对应注入给 TS 协调器的 `snapshot`。
pub(crate) fn coordinator_snapshot(handle: &AppHandle) -> RuntimeSnapshot {
    let state = handle.state::<AppState>();
    let snapshot = lock(&state.engine).get_snapshot();
    presented_snapshot(state.inner(), &snapshot)
}

/// 协调器在创建窗口或提交通知前重新确认系统状态，对应注入的 `canPresent`。
pub(crate) fn coordinator_can_present(handle: &AppHandle, event: &ReminderEvent) -> bool {
    let snapshot = coordinator_snapshot(handle);
    let safe = !matches!(
        snapshot.status,
        RuntimeStatus::Locked
            | RuntimeStatus::Sleeping
            | RuntimeStatus::CapabilityError
            | RuntimeStatus::Starting
            | RuntimeStatus::LongIdle
    );
    if !safe {
        return false;
    }
    event.kind == ReminderKind::Preview || snapshot.current_reminder_id.as_deref() == Some(event.id.as_str())
}

/// 把协调器的会话结论交回编排层，对应注入的 `finished` 与 `previewChanged`。
pub(crate) fn apply_settlement(handle: &AppHandle, settlement: Settlement) {
    let state = handle.state::<AppState>();
    match settlement {
        Settlement::Finished { event, results } => {
            // 对齐 `app/main/index.ts#L232-L233`：真实提醒先采样，再让引擎结算。
            tick(handle);
            let update = lock(&state.engine).settle_reminder(&event.id, event.generation, &results, None);
            let _ = apply(handle, state.inner(), &update);
        }
        Settlement::PreviewStarted { id } => {
            *lock(&state.current_preview_id) = Some(id);
            *lock(&state.latest_preview_result) = None;
            state.preview_sequence.fetch_add(1, Ordering::SeqCst);
            let update = {
                let snapshot = lock(&state.engine).get_snapshot();
                EngineUpdate { snapshot, effects: Vec::new() }
            };
            publish(handle, state.inner(), &update);
        }
        Settlement::PreviewSettled { result } => {
            *lock(&state.current_preview_id) = None;
            *lock(&state.latest_preview_result) = Some(result);
            state.preview_sequence.fetch_add(1, Ordering::SeqCst);
            let update = {
                let snapshot = lock(&state.engine).get_snapshot();
                EngineUpdate { snapshot, effects: Vec::new() }
            };
            publish(handle, state.inner(), &update);
        }
    }
}

/// 失败但仍需以统一错误结构返回的辅助函数。
fn failure<T>(code: &str, message: &str) -> CommandResult<T> {
    CommandResult::failure(AppError::new(code, message))
}

/// 托盘是否真的可用：既创建成功，最近一次采样的能力报告也确认托盘可用。
///
/// 对齐 `app/main/index.ts#L41` 的 `hasConfirmedTray`。
fn has_confirmed_tray(state: &AppState) -> bool {
    if !state.tray_available.load(Ordering::SeqCst) {
        return false;
    }
    lock(&state.engine).get_snapshot().capabilities.tray.state == CapabilityState::Available
}

/// 创建主窗口并注册关闭拦截，对齐 `app/main/index.ts#L92-L114` 的窗口配置。
fn create_main_window(handle: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(handle, MAIN_WINDOW, WebviewUrl::App("index.html?surface=main".into()))
        .title("EyeCare")
        .inner_size(600.0, 620.0)
        .min_inner_size(600.0, 520.0)
        .visible(false)
        .build()?;
    let close_handle = handle.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            on_main_close_requested(&close_handle, api);
        }
    });
    Ok(window)
}

/// 主窗口关闭请求：托盘可用时改为隐藏窗口，否则放行关闭并让应用退出。
fn on_main_close_requested(handle: &AppHandle, api: &CloseRequestApi) {
    let state = handle.state::<AppState>();
    if state.quitting.load(Ordering::SeqCst) || !has_confirmed_tray(&state) {
        return;
    }
    api.prevent_close();
    let close_generation = state.main_visibility_generation.fetch_add(1, Ordering::SeqCst) + 1;
    hide_main_after_close(handle, close_generation);
}

/// 关闭请求被拦下后隐藏主窗口；任何前置条件失效都直接放弃。
fn hide_main_after_close(handle: &AppHandle, close_generation: u64) {
    let state = handle.state::<AppState>();
    if state.quitting.load(Ordering::SeqCst) {
        return;
    }
    if close_generation != state.main_visibility_generation.load(Ordering::SeqCst) {
        return;
    }
    if !has_confirmed_tray(&state) {
        return;
    }
    let Some(window) = handle.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    state.main_window_wanted.store(false, Ordering::SeqCst);
    let _ = window.hide();
    hide_main_dock(handle);
}

/// 切换 macOS Dock 图标显隐。
///
/// `set_dock_visibility` 只在 macOS 存在，这里用平台分支包一层，
/// 让窗口生命周期逻辑保持单一代码路径。
#[cfg(target_os = "macos")]
fn set_dock_visible(handle: &AppHandle, visible: bool) {
    if let Err(error) = handle.set_dock_visibility(visible) {
        log::warn!("Dock 图标显隐切换失败：{error}");
    }
}

/// 非 macOS 平台没有 Dock 图标，显隐请求直接忽略。
#[cfg(not(target_os = "macos"))]
fn set_dock_visible(_handle: &AppHandle, _visible: bool) {}

/// macOS 主窗口隐藏后同步隐藏 Dock 图标，对应 `app/main/index.ts#L75-L85`。
///
/// Electron 会忽略紧接着 `Dock.show` 的 `Dock.hide`，这里保持同样的 1100ms 冷却；
/// 到点后重新校验窗口状态，因此重新打开窗口会自然取消这次隐藏（等价于 TS 的
/// `cancelDockHide` 定时器）。
///
/// 整个判定统一回到主线程执行：窗口可见性与托盘状态只在主线程读取才准确，
/// 从其它线程调用时会排在隐藏消息之后，避免读到过期的可见性。
fn hide_main_dock(handle: &AppHandle) {
    let main_handle = handle.clone();
    let _ = handle.run_on_main_thread(move || hide_main_dock_on_main(&main_handle));
}

/// [`hide_main_dock`] 的主线程实现。
fn hide_main_dock_on_main(handle: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let state = handle.state::<AppState>();
    if state.quitting.load(Ordering::SeqCst) || state.main_window_wanted.load(Ordering::SeqCst) {
        return;
    }
    if !has_confirmed_tray(&state) {
        return;
    }
    let Some(window) = handle.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    let elapsed = state.elapsed_ms();
    let last = state.last_dock_transition_ms.load(Ordering::SeqCst);
    let cooldown = DOCK_TRANSITION_COOLDOWN.as_millis() as u64;
    if elapsed < last + cooldown {
        let wait = last + cooldown - elapsed;
        let delayed_handle = handle.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(wait));
            let main_handle = delayed_handle.clone();
            let _ = delayed_handle.run_on_main_thread(move || hide_main_dock(&main_handle));
        });
        return;
    }
    if state.dock_hidden.swap(true, Ordering::SeqCst) {
        return;
    }
    set_dock_visible(handle, false);
    state.last_dock_transition_ms.store(state.elapsed_ms(), Ordering::SeqCst);
}

/// 显示并聚焦主窗口，对应 `app/main/index.ts#L86-L125` 的 `showMain`。
fn show_main(handle: &AppHandle, settings: bool) {
    let state = handle.state::<AppState>();
    if state.quitting.load(Ordering::SeqCst) {
        return;
    }
    let generation = state.main_visibility_generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.main_window_wanted.store(true, Ordering::SeqCst);
    if settings {
        state.settings_requested.store(true, Ordering::SeqCst);
    }
    let window = match handle.get_webview_window(MAIN_WINDOW) {
        Some(window) => window,
        None => match create_main_window(handle) {
            Ok(window) => window,
            Err(error) => {
                log::warn!("主窗口创建失败：{error}");
                return;
            }
        },
    };
    if state.dock_hidden.swap(false, Ordering::SeqCst) {
        set_dock_visible(handle, true);
        state.last_dock_transition_ms.store(state.elapsed_ms(), Ordering::SeqCst);
    }
    if generation != state.main_visibility_generation.load(Ordering::SeqCst) {
        hide_main_dock(handle);
        return;
    }
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    if settings {
        let _ = window.emit(OPEN_SETTINGS_EVENT, ());
    }
}

/// 退出应用，对应 `app/main/index.ts#L126` 与 `before-quit` 的清理动作。
fn quit_app(handle: &AppHandle) {
    let state = handle.state::<AppState>();
    state.quitting.store(true, Ordering::SeqCst);
    state.coordinator.cancel(handle, None);
    tray::TrayPresenter::dispose(handle);
    handle.exit(0);
}

/// 托盘菜单事件分发，对应 `app/main/index.ts#L237` 传给 `TrayPresenter` 的回调集合。
pub(crate) fn handle_tray_menu(handle: &AppHandle, id: &str) {
    match id {
        tray::MENU_SHOW_MAIN => show_main(handle, false),
        tray::MENU_SETTINGS => show_main(handle, true),
        // Electron 的托盘回调不经过命令队列，这里同样直接执行。
        tray::MENU_PAUSE => {
            pause_action(handle);
        }
        tray::MENU_RESUME => {
            resume_action(handle);
        }
        tray::MENU_REMIND_NOW => tray_remind_now(handle),
        tray::MENU_QUIT => quit_app(handle),
        _ => {}
    }
}

/// 托盘「立即提醒」：与 `app/main/index.ts#L237` 一致，被抑制时只推快照不报错。
fn tray_remind_now(handle: &AppHandle) {
    let state = handle.state::<AppState>();
    match check_eligible(handle, state.inner(), false) {
        Ok(()) => {
            let update = lock(&state.engine).remind_now(None);
            let _ = apply(handle, state.inner(), &update);
        }
        Err(_) => {
            let snapshot = lock(&state.engine).get_snapshot();
            emit_snapshot(handle, state.inner(), &snapshot);
        }
    }
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
    let mut sample = lock(&state.adapter).sample(handle, ActivitySource::Combined);
    if !state.tray_available.load(Ordering::SeqCst) {
        // 对齐 `app/main/index.ts#L60`：托盘缺失时能力报告随之降级。
        sample.capabilities.tray = Capability {
            state: CapabilityState::Unsupported,
            reason: "未检测到可用系统托盘".into(),
        };
    }
    let update = lock(&state.engine).accept_sample(sample);
    // 引擎副作用（呈现/取消提醒）在这里真正派发，覆盖层与通知随之创建或销毁。
    publish(handle, state.inner(), &update);
}

/// 采样并判定是否允许呈现新提醒，对应 Electron 的 `checkEligible`。
fn check_eligible(handle: &AppHandle, state: &AppState, preview: bool) -> Result<(), AppError> {
    tick(handle);
    let snapshot = {
        let current = lock(&state.engine).get_snapshot();
        presented_snapshot(state, &current)
    };
    if state.coordinator.is_busy() || snapshot.current_reminder_id.is_some() {
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

/// 暂停提醒的实际动作；IPC 命令与托盘菜单共用，对应 `app/main/index.ts#L163-L165`。
fn pause_action(handle: &AppHandle) -> CommandResult<RuntimeSnapshot> {
    let state = handle.state::<AppState>();
    let _gate = gate(&state);
    tick(handle);
    state.coordinator.cancel(handle, None);
    let update = lock(&state.engine).pause();
    apply(handle, state.inner(), &update)
}

/// 暂停提醒，对应 `EyeCareBridge.pause`。
#[tauri::command]
fn pause(handle: AppHandle) -> CommandResult<RuntimeSnapshot> {
    pause_action(&handle)
}

/// 恢复提醒的实际动作；IPC 命令与托盘菜单共用，对应 `app/main/index.ts#L166`。
fn resume_action(handle: &AppHandle) -> CommandResult<RuntimeSnapshot> {
    let state = handle.state::<AppState>();
    let _gate = gate(&state);
    tick(handle);
    let update = lock(&state.engine).resume(None);
    apply(handle, state.inner(), &update)
}

/// 恢复提醒，对应 `EyeCareBridge.resume`。
#[tauri::command]
fn resume(handle: AppHandle) -> CommandResult<RuntimeSnapshot> {
    resume_action(&handle)
}

/// 立即提醒，对应 `EyeCareBridge.remindNow`。
#[tauri::command]
fn remind_now(handle: AppHandle) -> CommandResult<RuntimeSnapshot> {
    let state = handle.state::<AppState>();
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
    let Some(overlay) = state.coordinator.overlay_state(window.label()) else {
        return failure("STALE_REMINDER", "此提醒已结束");
    };
    if overlay.event.id != id || overlay.event.generation != generation || overlay.event.settings.reminder.visual != VisualMode::Mask {
        return failure("STALE_REMINDER", "此提醒已结束");
    }
    if overlay.event.kind == ReminderKind::Preview {
        state.coordinator.resolve_preview(&handle, &id, generation, action);
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
    match state.coordinator.present(&handle, event) {
        Ok(id) => CommandResult::success(id),
        Err(error) => CommandResult::failure(error),
    }
}

/// 取消进行中的预览，对应 `EyeCareBridge.cancelPreview`。
#[tauri::command]
fn cancel_preview(handle: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let _gate = gate(&state);
    state.coordinator.cancel_preview(&handle);
    CommandResult::success(())
}

/// 覆盖层窗口订阅到的状态，对应 `EyeCareBridge.getOverlay`。
#[tauri::command]
fn get_overlay(state: State<'_, AppState>, window: WebviewWindow) -> Option<OverlayState> {
    let _gate = gate(&state);
    state.coordinator.overlay_state(window.label())
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
    if !state.coordinator.ready(&handle, window.label(), &id, generation) {
        return failure("STALE_REMINDER", "提醒已取消");
    }
    if state.coordinator.current_kind() == Some(ReminderKind::Real) {
        let channels = state.coordinator.channels();
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
    if !state.coordinator.sound_started(&handle, window.label(), &id, generation) {
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
    let overlay = state.coordinator.overlay_state(window.label());
    if !state.coordinator.report(&handle, window.label(), &id, generation, &results) {
        return failure("STALE_REMINDER", "提醒已结束");
    }
    let is_real = overlay.as_ref().map(|state| state.event.kind) == Some(ReminderKind::Real);
    if is_real && state.coordinator.matches(&id, generation) {
        let channels = state.coordinator.channels();
        let update = lock(&state.engine).record_reminder_channels(&id, generation, &channels);
        emit_snapshot(&handle, state.inner(), &update.snapshot);
    }
    CommandResult::success(())
}

/// 请求打开设置页，对应 `EyeCareBridge.openSettings`。
#[tauri::command]
fn open_settings(handle: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let _gate = gate(&state);
    show_main(&handle, true);
    CommandResult::success(())
}

/// 退出应用，对应 `EyeCareBridge.quit`。
#[tauri::command]
fn quit(handle: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let _gate = gate(&state);
    // 对齐 Electron 的 `setImmediate(quit)`：先让本次响应返回，再由独立线程执行退出。
    let quit_handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        quit_app(&quit_handle);
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
            show_main(app, false);
        }))
        // 注册系统原生对话框支持。
        .plugin(tauri_plugin_dialog::init())
        // 通知型提醒；点击通知（tap）后把主窗口带到前台。
        .plugin(tauri_plugin_notification::init())
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
            let handle = app.handle().clone();
            // 对齐 Electron 的 `notice.on('click', openHome)`：点击通知回到主窗口。
            // 回调在后台线程执行，因此窗口动作必须投递回主线程。
            {
                let notify_handle = handle.clone();
                if let Err(error) = handle.notification().on_action(move |action| {
                    if action.action_id() == "tap" {
                        let click_handle = notify_handle.clone();
                        let inner = click_handle.clone();
                        let _ = click_handle.run_on_main_thread(move || show_main(&inner, false));
                    }
                }) {
                    log::warn!("通知点击回调注册失败：{error}");
                }
            }
            let tray_available = tray::TrayPresenter::create(&handle);
            if !tray_available {
                log::warn!("托盘创建失败，主窗口将保持可访问");
            }
            handle.state::<AppState>().tray_available.store(tray_available, Ordering::SeqCst);
            create_main_window(&handle)?;
            // 对齐 `app/main/index.ts#L238-L247`：先采一次样刷新托盘，再显示主窗口。
            tick(&handle);
            show_main(&handle, false);
            spawn_sampler(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| match event {
            // 对齐 `window-all-closed`：只有托盘可用时才留在后台。
            RunEvent::ExitRequested { code: None, api, .. } => {
                if has_confirmed_tray(&handle.state::<AppState>()) {
                    api.prevent_exit();
                }
            }
            // 对齐 `app.on('activate')`：点击 Dock 图标重新显示主窗口。
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main(handle, false),
            _ => {}
        });
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
