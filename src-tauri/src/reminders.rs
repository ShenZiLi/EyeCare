//! `app/main/reminders/coordinator.ts` 的 Rust 移植。
//!
//! 与 TS 版只有两处结构差异，都是平台约束导致的：
//! - TS 用 `webContents.id` 区分覆盖层窗口，这里用窗口标签 `overlay-*`；
//! - 覆盖层窗口只能在主线程创建与销毁，因此窗口操作统一经 [`crate::on_main_thread`]
//!   投递（主线程调用时同步执行，其它线程阻塞等待）。
//!
//! 线程约束：会话状态放在内部互斥锁里，且**任何**窗口操作、定时器回调与对外结论
//! 都在释放锁之后执行。否则覆盖层窗口的 `Destroyed` 回调会与持锁方在同一线程上
//! 互等，直接死锁。

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;

use crate::contracts::{
    AppError, Channel, ChannelResult, DisplayBounds, DisplayInfo, OverlayState, PreviewResult, ReminderAction,
    ReminderEvent, ReminderKind, ReminderOutcome, ReminderResult, ResolvedReminderSettings, VisualMode,
};

/// 覆盖层窗口标签前缀；与 `capabilities/default.json` 的 `windows` 通配必须一致。
pub(crate) const OVERLAY_PREFIX: &str = "overlay-";

/// 覆盖层状态推送事件名，与 `app/renderer/bridge.ts` 的订阅名一致。
const OVERLAY_UPDATED_EVENT: &str = "eyecare:overlay-updated";

/// 提醒窗口就绪保护时长，对齐 TS 的 12000ms。
const WINDOW_READY_TIMEOUT_MS: u64 = 12_000;

/// 取得锁；即使上一次持有者 panic 也继续使用内部状态。
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 会话结束（或预览状态变化）后必须在锁外执行的收尾动作。
#[derive(Default)]
struct Completion {
    /// 需要销毁的覆盖层窗口；调用方保证它们已从会话登记中摘除。
    windows: Vec<WebviewWindow>,
    /// 需要交回编排层的结论。
    settlement: Option<Settlement>,
}

/// 交回编排层的结论，对应 TS 构造器注入的 `finished` 与 `previewChanged`。
pub(crate) enum Settlement {
    /// 真实提醒收尾：把通道结果交回定时引擎。
    Finished { event: Box<ReminderEvent>, results: Vec<ChannelResult> },
    /// 预览开始：清空预览标识与结果。
    PreviewStarted { id: String },
    /// 预览收尾：记录最终结果。
    PreviewSettled { result: PreviewResult },
}

/// 单个覆盖层窗口的会话状态。
struct OverlayWindow {
    window: WebviewWindow,
    state: OverlayState,
    /// `None` 表示隐藏的声音宿主窗口。
    display_id: Option<String>,
    ready: bool,
    visual_result: Option<ChannelResult>,
}

/// 一次提醒（或预览）的完整会话。
struct Session {
    /// 会话代号；定时器与异步回调靠它判断是否仍属于当前会话。
    key: u64,
    event: ReminderEvent,
    windows: BTreeMap<String, OverlayWindow>,
    channels: Vec<ChannelResult>,
    /// 初始建窗或热插拔对账期间为真，此时不判定会话完成。
    creating: bool,
    /// 负责播放声音的窗口标签。
    sound_owner: Option<String>,
    notification_submitted: bool,
}

/// 定时器到期后的动作；到期时若会话已经结束则静默返回。
#[derive(Clone)]
enum TimerAction {
    /// 12 秒保护到期时仍有窗口未就绪。
    WindowsNotReady,
    /// 单个窗口的播放与声音超时。
    Playback { label: String },
}

/// 提醒协调器：会话状态、覆盖层窗口与系统通知的编排者。
#[derive(Default)]
pub struct ReminderCoordinator {
    /// 当前会话；`None` 表示空闲。
    session: Mutex<Option<Session>>,
    /// 最近一次会话的最终结果（按会话代号），`present` 用它判断本次呈现的成败。
    outcomes: Mutex<Option<(u64, ReminderResult)>>,
    next_key: AtomicU64,
    next_window: AtomicU64,
}

impl ReminderCoordinator {
    /// 创建空闲协调器。
    pub fn new() -> Self {
        Self::default()
    }

    /// 当前会话的事件类型。
    pub fn current_kind(&self) -> Option<ReminderKind> {
        lock(&self.session).as_ref().map(|session| session.event.kind)
    }

    /// 是否已有会话在进行中，对应 Electron 的 `coordinator.current` 判定。
    pub fn is_busy(&self) -> bool {
        lock(&self.session).is_some()
    }

    /// 已登记的通道结果；覆盖层命令把它回写进定时引擎。
    pub fn channels(&self) -> Vec<ChannelResult> {
        lock(&self.session).as_ref().map(|session| session.channels.clone()).unwrap_or_default()
    }

    /// 事件标识与代号是否仍是当前会话。
    pub fn matches(&self, id: &str, generation: u64) -> bool {
        lock(&self.session)
            .as_ref()
            .is_some_and(|session| session.event.id == id && session.event.generation == generation)
    }

    /// 指定覆盖层窗口订阅到的状态。
    pub fn overlay_state(&self, label: &str) -> Option<OverlayState> {
        lock(&self.session).as_ref().and_then(|session| session.windows.get(label)).map(|item| item.state.clone())
    }

    /// 呈现一次提醒，对应 TS 的 `present`。
    ///
    /// 返回值与 TS 一致：成功时返回事件标识，失败时给出明确错误码与文案。
    pub fn present(&self, handle: &AppHandle, event: ReminderEvent) -> Result<String, AppError> {
        let key = self.next_key.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut slot = lock(&self.session);
            if slot.is_some() {
                return Err(AppError::new("REMINDER_BUSY", "已有提醒或预览正在呈现"));
            }
            *slot = Some(Session {
                key,
                event: event.clone(),
                windows: BTreeMap::new(),
                channels: Vec::new(),
                creating: true,
                sound_owner: None,
                notification_submitted: false,
            });
        }
        // 系统状态在准备期间可能变化，这里再确认一次；失败时按「视觉通道失败」结算。
        if !crate::coordinator_can_present(handle, &event) {
            let completion = self.complete_locked(&mut lock(&self.session), key, vec![ChannelResult {
                channel: Channel::Visual,
                success: false,
                message: "当前系统状态禁止提醒".into(),
            }]);
            self.run_completion(handle, completion);
            return Err(AppError::new("REMINDER_SUPPRESSED", "当前系统状态禁止提醒"));
        }
        if !self.is_current(key) {
            return Err(AppError::new("REMINDER_SUPPRESSED", "提醒在准备期间已取消"));
        }
        if event.kind == ReminderKind::Preview {
            crate::apply_settlement(handle, Settlement::PreviewStarted { id: event.id.clone() });
        }
        self.later(handle, key, WINDOW_READY_TIMEOUT_MS, TimerAction::WindowsNotReady);
        let snapshot = crate::coordinator_snapshot(handle);
        let visual = event.settings.reminder.visual;
        let overlay_available = snapshot.capabilities.overlay.state == crate::contracts::CapabilityState::Available;
        if matches!(visual, VisualMode::Flash | VisualMode::Mask) && !overlay_available {
            let reason = snapshot.capabilities.overlay.reason.clone();
            let completion = self.record_locked(&mut lock(&self.session), key, ChannelResult {
                channel: Channel::Visual,
                success: false,
                message: if reason.is_empty() { "全屏覆盖不可用".into() } else { reason },
            });
            self.run_completion(handle, completion);
        } else if visual == VisualMode::Notification && !event.settings.reminder.sound_enabled {
            // 启用声音时先等声音确认或声音超时再提交通知，与 TS 的触发点一致。
            self.submit_notification(handle, key);
        }
        let needs_overlay = matches!(visual, VisualMode::Flash | VisualMode::Mask);
        if needs_overlay && overlay_available {
            self.create_visual_windows(handle, key);
        } else if event.settings.reminder.sound_enabled {
            self.create_window(handle, key, None);
        }
        // `creating` 复位后才做对账与聚合，避免准备期间的结果被当成最终结论。
        {
            let mut slot = lock(&self.session);
            if let Some(session) = slot.as_mut().filter(|session| session.key == key) {
                session.creating = false;
            }
        }
        // 对账在初始页面加载期间到达的热插拔事件。
        if self.is_current(key) && needs_overlay && overlay_available {
            self.refresh_displays(handle);
        }
        self.aggregate_visual(handle, key);
        // 对齐 TS：聚合没有产生新结果时也要再判一次收尾（例如覆盖不可用的失败结果）。
        self.maybe_complete(handle, key);
        match self.outcome(key) {
            Some(ReminderOutcome::Failed) => {
                Err(AppError::new("REMINDER_DELIVERY_FAILED", self.failure_message(key)))
            }
            Some(ReminderOutcome::Cancelled) => Err(AppError::new("REMINDER_SUPPRESSED", "提醒在准备期间已取消")),
            _ => Ok(event.id),
        }
    }

    /// 取消会话；`id` 非空时只取消对应事件，对应 TS 的 `cancel`。
    pub fn cancel(&self, handle: &AppHandle, id: Option<&str>) {
        let mut slot = lock(&self.session);
        let Some(key) = slot.as_ref().map(|session| session.key) else {
            return;
        };
        let completion = self.cancel_locked(&mut slot, key, id);
        drop(slot);
        self.run_completion(handle, completion);
    }

    /// 只取消进行中的预览，对应 Electron 的 `cancelPreview`。
    pub fn cancel_preview(&self, handle: &AppHandle) {
        if self.current_kind() == Some(ReminderKind::Preview) {
            self.cancel(handle, None);
        }
    }

    /// 覆盖层窗口就绪，对应 TS 的 `ready`。
    pub fn ready(&self, handle: &AppHandle, label: &str, id: &str, generation: u64) -> bool {
        let Some((key, event, display_id, already_ready)) = ({
            let slot = lock(&self.session);
            slot.as_ref()
                .filter(|session| {
                    session.event.id == id
                        && session.event.generation == generation
                        && session.windows.contains_key(label)
                })
                .and_then(|session| {
                    session
                        .windows
                        .get(label)
                        .map(|item| (session.key, session.event.clone(), item.display_id.clone(), item.ready))
                })
        }) else {
            return false;
        };
        if !crate::coordinator_can_present(handle, &event) {
            return false;
        }
        if already_ready {
            return true;
        }
        {
            let mut slot = lock(&self.session);
            let Some(session) = slot.as_mut().filter(|session| session.key == key) else {
                return false;
            };
            let Some(item) = session.windows.get_mut(label) else {
                return false;
            };
            item.ready = true;
        }
        let Some(window) = self.window_of(key, label) else {
            return false;
        };
        let visual = event.settings.reminder.visual;
        if display_id.is_some() && matches!(visual, VisualMode::Flash | VisualMode::Mask) {
            // Tauri 没有 `showInactive`；闪屏窗口不可聚焦，因此 `show` 不会抢走键盘焦点。
            let _ = window.show();
            if visual == VisualMode::Mask {
                // 蒙版需要接收 Tab/Esc，必须拿到键盘焦点。
                let _ = window.set_focus();
            }
        }
        if display_id.is_some() && visual == VisualMode::Mask {
            let mut slot = lock(&self.session);
            if let Some(item) = slot.as_mut().and_then(|session| session.windows.get_mut(label)) {
                item.visual_result = Some(ChannelResult {
                    channel: Channel::Visual,
                    success: true,
                    message: "确认蒙版已显示".into(),
                });
            }
        }
        self.later(handle, key, playback_timeout_ms(&event.settings.reminder), TimerAction::Playback {
            label: label.to_string(),
        });
        self.aggregate_visual(handle, key);
        true
    }

    /// 覆盖层窗口报告声音已开始播放，对应 TS 的 `soundStarted`。
    pub fn sound_started(&self, handle: &AppHandle, label: &str, id: &str, generation: u64) -> bool {
        let key = {
            let slot = lock(&self.session);
            let Some(session) = slot
                .as_ref()
                .filter(|session| session.event.id == id && session.event.generation == generation)
            else {
                return false;
            };
            let sound_ready = session.windows.get(label).is_some_and(|item| item.ready)
                && session.sound_owner.as_deref() == Some(label)
                && session.event.settings.reminder.sound_enabled;
            if !sound_ready {
                return false;
            }
            session.key
        };
        self.submit_notification(handle, key);
        true
    }

    /// 覆盖层窗口上报通道结果，对应 TS 的 `report`。
    pub fn report(&self, handle: &AppHandle, label: &str, id: &str, generation: u64, results: &[ChannelResult]) -> bool {
        let key = {
            let slot = lock(&self.session);
            let Some(session) = slot
                .as_ref()
                .filter(|session| session.event.id == id && session.event.generation == generation)
            else {
                return false;
            };
            let Some(item) = session.windows.get(label) else {
                return false;
            };
            if !item.ready {
                return false;
            }
            let visual = session.event.settings.reminder.visual;
            let sound_enabled = session.event.settings.reminder.sound_enabled;
            // 声音只能由宿主窗口上报，闪屏结果只能来自屏幕窗口：与 TS 的校验一致。
            let invalid = results.iter().any(|result| match result.channel {
                Channel::Sound => session.sound_owner.as_deref() != Some(label) || !sound_enabled,
                Channel::Visual => item.display_id.is_none() || visual != VisualMode::Flash,
            });
            if invalid {
                return false;
            }
            session.key
        };
        for result in results {
            match result.channel {
                Channel::Visual => {
                    let mut slot = lock(&self.session);
                    if let Some(item) = slot.as_mut().and_then(|session| session.windows.get_mut(label))
                        && item.visual_result.is_none()
                    {
                        item.visual_result = Some(result.clone());
                    }
                    drop(slot);
                    self.aggregate_visual(handle, key);
                }
                Channel::Sound => {
                    self.record(handle, key, result.clone());
                    self.submit_notification(handle, key);
                }
            }
        }
        true
    }

    /// 遮罩型预览的用户动作，对应 TS 的 `resolvePreview`。
    pub fn resolve_preview(&self, handle: &AppHandle, id: &str, generation: u64, action: ReminderAction) -> bool {
        let outcome = match action {
            ReminderAction::Acknowledge => ReminderOutcome::Acknowledge,
            ReminderAction::Skip => ReminderOutcome::Skip,
        };
        let mut slot = lock(&self.session);
        let Some((key, channels)) = slot
            .as_ref()
            .filter(|session| {
                session.event.id == id
                    && session.event.generation == generation
                    && session.event.kind == ReminderKind::Preview
            })
            .map(|session| (session.key, session.channels.clone()))
        else {
            return false;
        };
        let completion = self.close_locked(&mut slot, key, channels, outcome, false);
        drop(slot);
        self.run_completion(handle, completion);
        true
    }

    /// 外观变化后同步覆盖层，对应 TS 的 `syncAppearance`。
    pub fn sync_appearance(&self, handle: &AppHandle) {
        let snapshot = crate::coordinator_snapshot(handle);
        let mut outgoing: Vec<(WebviewWindow, OverlayState)> = Vec::new();
        {
            let mut slot = lock(&self.session);
            let Some(session) = slot.as_mut() else {
                return;
            };
            for item in session.windows.values_mut() {
                item.state.theme = snapshot.theme;
                item.state.reduce_motion = snapshot.reduce_motion;
                item.state.reduce_transparency = snapshot.reduce_transparency;
                outgoing.push((item.window.clone(), item.state.clone()));
            }
        }
        for (window, state) in outgoing {
            let _ = window.emit(OVERLAY_UPDATED_EVENT, &state);
        }
    }

    /// 与最新显示器列表对账，对应 TS 的 `refreshDisplays`。
    pub fn refresh_displays(&self, handle: &AppHandle) {
        let Some(key) = self.enter_refresh() else {
            return;
        };
        let targets = display_targets(handle);
        // 仍存在的屏幕就地调整，消失的屏幕摘除登记并销毁。
        let mut resized: Vec<(WebviewWindow, DisplayBounds)> = Vec::new();
        let mut destroyed: Vec<WebviewWindow> = Vec::new();
        let mut sound_failure: Option<ChannelResult> = None;
        let mut slot = lock(&self.session);
        {
            let Some(session) = slot.as_mut().filter(|session| session.key == key) else {
                return;
            };
            let placements: Vec<(String, String)> = session
                .windows
                .iter()
                .filter_map(|(label, item)| item.display_id.clone().map(|display_id| (label.clone(), display_id)))
                .collect();
            for (label, display_id) in placements {
                match targets.iter().find(|display| display.id == display_id) {
                    Some(display) => {
                        if let Some(item) = session.windows.get(&label) {
                            resized.push((item.window.clone(), display.bounds));
                        }
                    }
                    None => {
                        if let Some(item) = session.windows.remove(&label) {
                            let owns_sound = session.sound_owner.as_deref() == Some(label.as_str());
                            let sound_enabled = session.event.settings.reminder.sound_enabled;
                            if owns_sound
                                && sound_enabled
                                && !session.channels.iter().any(|result| result.channel == Channel::Sound)
                            {
                                sound_failure = Some(ChannelResult {
                                    channel: Channel::Sound,
                                    success: false,
                                    message: "声音所在屏幕已移除，播放已停止".into(),
                                });
                            }
                            destroyed.push(item.window);
                        }
                    }
                }
            }
        }
        let completion = match sound_failure {
            Some(result) => self.record_locked(&mut slot, key, result),
            None => None,
        };
        drop(slot);
        self.run_completion(handle, completion);
        for (window, bounds) in resized {
            let _ = crate::on_main_thread(handle, move || {
                let _ = window.set_position(tauri::LogicalPosition::new(bounds.x, bounds.y));
                let _ = window.set_size(tauri::LogicalSize::new(bounds.width, bounds.height));
            });
        }
        for window in destroyed {
            let _ = window.destroy();
        }
        // 补开新接入的屏幕；每开一屏前确认会话仍然有效。
        for display in targets {
            if !self.is_current(key) {
                break;
            }
            let covered = {
                let slot = lock(&self.session);
                slot.as_ref()
                    .filter(|session| session.key == key)
                    .is_some_and(|session| {
                        session.windows.values().any(|item| item.display_id.as_deref() == Some(display.id.as_str()))
                    })
            };
            if covered {
                continue;
            }
            // 新屏幕接入后旧的成功结果不再代表全部屏幕，先清掉视觉结果。
            {
                let mut slot = lock(&self.session);
                if let Some(session) = slot.as_mut().filter(|session| session.key == key) {
                    session.channels.retain(|result| result.channel != Channel::Visual);
                }
            }
            self.later(handle, key, WINDOW_READY_TIMEOUT_MS, TimerAction::WindowsNotReady);
            self.create_window(handle, key, Some(display));
        }
        // 对账结束：恢复正常判定并重新聚合。
        {
            let mut slot = lock(&self.session);
            if let Some(session) = slot.as_mut().filter(|session| session.key == key) {
                session.creating = false;
            }
        }
        self.aggregate_visual(handle, key);
        self.maybe_complete(handle, key);
    }

    /// 覆盖层窗口被销毁：非我方收尾的销毁视为「提醒窗口意外关闭」。
    pub fn window_destroyed(&self, handle: &AppHandle, key: u64, label: &str) {
        let completion = {
            let mut slot = lock(&self.session);
            let stopped = slot
                .as_ref()
                .filter(|session| session.key == key)
                .is_some_and(|session| session.windows.contains_key(label));
            if stopped {
                self.fail_locked(&mut slot, key, "提醒窗口意外关闭")
            } else {
                None
            }
        };
        self.run_completion(handle, completion);
    }

    /// 定时器到期回调；会话已结束则静默返回。
    fn fire_timer(&self, handle: &AppHandle, key: u64, action: TimerAction) {
        match action {
            TimerAction::WindowsNotReady => {
                let pending = {
                    let slot = lock(&self.session);
                    slot.as_ref().filter(|session| session.key == key).is_some_and(|session| {
                        session.creating || session.windows.values().any(|item| !item.ready)
                    })
                };
                if pending {
                    self.fail(handle, key, "提醒窗口未就绪，已安全关闭");
                }
            }
            TimerAction::Playback { label } => self.playback_timeout(handle, key, &label),
        }
    }

    /// 单屏播放与声音超时，对应 TS 在 `ready` 中挂的保护定时器。
    fn playback_timeout(&self, handle: &AppHandle, key: u64, label: &str) {
        /// 超时后需要执行的动作。
        enum Action {
            Fail,
            Record(ChannelResult),
            None,
        }
        let action = {
            let slot = lock(&self.session);
            let Some(session) = slot.as_ref().filter(|session| session.key == key) else {
                return;
            };
            let Some(item) = session.windows.get(label) else {
                return;
            };
            let visual = session.event.settings.reminder.visual;
            let sound_enabled = session.event.settings.reminder.sound_enabled;
            if item.display_id.is_some() && visual == VisualMode::Flash && item.visual_result.is_none() {
                Action::Fail
            } else if session.sound_owner.as_deref() == Some(label)
                && sound_enabled
                && !session.channels.iter().any(|result| result.channel == Channel::Sound)
            {
                Action::Record(ChannelResult {
                    channel: Channel::Sound,
                    success: false,
                    message: "声音播放超时".into(),
                })
            } else {
                Action::None
            }
        };
        match action {
            Action::Fail => self.fail(handle, key, "提醒播放超时，已关闭"),
            Action::Record(result) => {
                self.record(handle, key, result);
                self.submit_notification(handle, key);
            }
            Action::None => {}
        }
    }

    /// 提交系统通知，对应 TS 的 `submitNotification`。
    ///
    /// 与 TS 的差异：Tauri 的通知插件只回报「已派发」，无法回报系统层面的送达失败，
    /// 因此这里不挂「8 秒未确认」保护，`show` 成功即视为提交成功。
    fn submit_notification(&self, handle: &AppHandle, key: u64) {
        let event = {
            let slot = lock(&self.session);
            let Some(session) = slot.as_ref().filter(|session| session.key == key) else {
                return;
            };
            if session.event.settings.reminder.visual != VisualMode::Notification || session.notification_submitted {
                return;
            }
            session.event.clone()
        };
        // 提交前再确认一次系统状态，对齐 TS。
        if !crate::coordinator_can_present(handle, &event) {
            self.fail(handle, key, "当前系统状态禁止通知");
            return;
        }
        if !self.is_current(key) {
            return;
        }
        {
            let mut slot = lock(&self.session);
            let Some(session) = slot.as_mut().filter(|session| session.key == key) else {
                return;
            };
            session.notification_submitted = true;
        }
        let result = match handle
            .notification()
            .builder()
            .title("EyeCare · 休息提醒")
            .body(event.settings.reminder.message.clone())
            .show()
        {
            Ok(()) => ChannelResult { channel: Channel::Visual, success: true, message: "系统通知已提交".into() },
            Err(error) => ChannelResult {
                channel: Channel::Visual,
                success: false,
                message: notification_failure_message(&error.to_string()),
            },
        };
        self.record(handle, key, result);
    }

    /// 为每块显示器创建覆盖层窗口，对应 TS 的 `createVisualWindows`。
    fn create_visual_windows(&self, handle: &AppHandle, key: u64) {
        for display in display_targets(handle) {
            if !self.is_current(key) {
                return;
            }
            self.create_window(handle, key, Some(display));
        }
    }

    /// 创建单个覆盖层窗口；`display` 为 `None` 时是隐藏的声音宿主。
    fn create_window(&self, handle: &AppHandle, key: u64, display: Option<DisplayInfo>) {
        let Some(event) = self.session_event(key) else {
            return;
        };
        if !crate::coordinator_can_present(handle, &event) {
            self.fail(handle, key, "当前系统状态禁止提醒");
            return;
        }
        if !self.is_current(key) {
            return;
        }
        let label = format!("{OVERLAY_PREFIX}{}", self.next_window.fetch_add(1, Ordering::SeqCst) + 1);
        // 声音由第一个创建的窗口负责播放，对应 TS 的 `soundOwner` 判定。
        let owns_sound = {
            let mut slot = lock(&self.session);
            match slot.as_mut().filter(|session| session.key == key) {
                Some(session) if session.sound_owner.is_none() => {
                    session.sound_owner = Some(label.clone());
                    true
                }
                Some(_) => false,
                None => return,
            }
        };
        let snapshot = crate::coordinator_snapshot(handle);
        let mask = display.is_some() && event.settings.reminder.visual == VisualMode::Mask;
        let mut state = OverlayState {
            event: event.clone(),
            theme: snapshot.theme,
            reduce_motion: snapshot.reduce_motion,
            reduce_transparency: snapshot.reduce_transparency,
        };
        if !owns_sound {
            state.event.settings.reminder.sound_enabled = false;
        }
        if display.is_none() {
            // 隐藏宿主只负责播放声音，绝不能带上视觉或交互意图。
            state.event.settings.reminder.visual = VisualMode::None;
        }
        let bounds = display.as_ref().map(|display| display.bounds);
        let created = {
            let window_handle = handle.clone();
            let window_label = label.clone();
            crate::on_main_thread(handle, move || build_overlay(&window_handle, &window_label, bounds, mask))
        };
        let Some(Ok(window)) = created else {
            // 对齐 TS：创建或加载失败即结束会话并给出明确原因。
            self.fail(handle, key, "提醒窗口创建失败");
            return;
        };
        let registered = {
            let mut slot = lock(&self.session);
            match slot.as_mut().filter(|session| session.key == key) {
                Some(session) => {
                    session.windows.insert(label.clone(), OverlayWindow {
                        window: window.clone(),
                        state,
                        display_id: display.as_ref().map(|display| display.id.clone()),
                        ready: false,
                        visual_result: None,
                    });
                    true
                }
                None => false,
            }
        };
        if !registered {
            // 会话在创建期间已经结束：新窗口没有归属，立即销毁。
            let _ = window.destroy();
            return;
        }
        // 非我方收尾的销毁视为意外关闭；自己的收尾会先摘除登记，因此不会误判。
        let window_handle = handle.clone();
        let window_label = label.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                let state = window_handle.state::<crate::AppState>();
                state.coordinator.window_destroyed(&window_handle, key, &window_label);
            }
        });
    }

    /// 进入对账临界区；返回会话代号，条件不满足时返回 `None`。
    fn enter_refresh(&self) -> Option<u64> {
        let mut slot = lock(&self.session);
        let session = slot.as_mut()?;
        if session.creating || !matches!(session.event.settings.reminder.visual, VisualMode::Flash | VisualMode::Mask) {
            return None;
        }
        session.creating = true;
        Some(session.key)
    }

    /// 追加通道结果；同通道只记一次，随后尝试判定会话完成。
    fn record(&self, handle: &AppHandle, key: u64, result: ChannelResult) {
        let completion = self.record_locked(&mut lock(&self.session), key, result);
        self.run_completion(handle, completion);
    }

    /// 以「当前通道失败」结束会话，对应 TS 的 `fail`。
    fn fail(&self, handle: &AppHandle, key: u64, message: &str) {
        let completion = self.fail_locked(&mut lock(&self.session), key, message);
        self.run_completion(handle, completion);
    }

    /// 再判一次会话能否收尾，对应 TS 中显式调用的 `maybeComplete`。
    fn maybe_complete(&self, handle: &AppHandle, key: u64) {
        let completion = self.maybe_complete_locked(&mut lock(&self.session), key);
        self.run_completion(handle, completion);
    }

    /// 聚合各屏视觉结果，对应 TS 的 `aggregateVisual`。
    fn aggregate_visual(&self, handle: &AppHandle, key: u64) {
        let mut slot = lock(&self.session);
        let Some(result) = self.aggregate_locked(&slot, key) else {
            return;
        };
        let completion = self.record_locked(&mut slot, key, result);
        drop(slot);
        self.run_completion(handle, completion);
    }

    /// 在持有会话锁的前提下追加通道结果。
    fn record_locked(&self, slot: &mut Option<Session>, key: u64, result: ChannelResult) -> Option<Completion> {
        {
            let session = slot.as_mut().filter(|session| session.key == key)?;
            if session.channels.iter().any(|recorded| recorded.channel == result.channel) {
                return None;
            }
            session.channels.push(result);
        }
        self.maybe_complete_locked(slot, key)
    }

    /// 在持有会话锁的前提下判定会话是否可以收尾。
    fn maybe_complete_locked(&self, slot: &mut Option<Session>, key: u64) -> Option<Completion> {
        let (visual, creating, sound_enabled, channels) = {
            let session = slot.as_ref().filter(|session| session.key == key)?;
            (
                session.event.settings.reminder.visual,
                session.creating,
                session.event.settings.reminder.sound_enabled,
                session.channels.clone(),
            )
        };
        if creating {
            return None;
        }
        let visual_result = channels.iter().find(|result| result.channel == Channel::Visual);
        let sound_result = channels.iter().find(|result| result.channel == Channel::Sound);
        // 蒙版必须由用户确认，只有失败才自动收尾。
        if visual == VisualMode::Mask && visual_result.is_none_or(|result| result.success) {
            return None;
        }
        // 各通道的就绪判定与 TS 的三段式条件一一对应。
        let visual_ready = visual != VisualMode::None && visual_result.is_some_and(|result| result.success);
        let sound_ready = visual == VisualMode::None && sound_result.is_some();
        let fallback_ready = visual_result.is_some() && (!sound_enabled || sound_result.is_some());
        if !(visual_ready || sound_ready || fallback_ready) {
            return None;
        }
        self.complete_locked(slot, key, channels)
    }

    /// 以「通道失败」结束会话；失败结果里补齐缺失的通道说明。
    fn fail_locked(&self, slot: &mut Option<Session>, key: u64, message: &str) -> Option<Completion> {
        let (visual, sound_enabled, mut results) = {
            let session = slot.as_ref().filter(|session| session.key == key)?;
            let visual = session.event.settings.reminder.visual;
            let channel = if visual == VisualMode::None { Channel::Sound } else { Channel::Visual };
            let results: Vec<ChannelResult> = session
                .channels
                .iter()
                .filter(|result| result.channel != channel)
                .cloned()
                .collect();
            (visual, session.event.settings.reminder.sound_enabled, results)
        };
        let channel = if visual == VisualMode::None { Channel::Sound } else { Channel::Visual };
        results.push(ChannelResult { channel, success: false, message: message.to_string() });
        if sound_enabled && !results.iter().any(|result| result.channel == Channel::Sound) {
            results.push(ChannelResult {
                channel: Channel::Sound,
                success: false,
                message: "提醒已关闭，音效停止".into(),
            });
        }
        self.complete_locked(slot, key, results)
    }

    /// 按通道结果结束会话；全部失败时结论为失败，否则为自动完成。
    fn complete_locked(&self, slot: &mut Option<Session>, key: u64, results: Vec<ChannelResult>) -> Option<Completion> {
        let outcome = if results.iter().any(|result| result.success) {
            ReminderOutcome::Automatic
        } else {
            ReminderOutcome::Failed
        };
        self.close_locked(slot, key, results, outcome, true)
    }

    /// 取消会话；真实提醒不在此处结算，由引擎自身的指令收尾。
    fn cancel_locked(&self, slot: &mut Option<Session>, key: u64, id: Option<&str>) -> Option<Completion> {
        let channels = {
            let session = slot.as_ref().filter(|session| session.key == key)?;
            if id.is_some_and(|id| session.event.id != id) {
                return None;
            }
            session.channels.clone()
        };
        self.close_locked(slot, key, channels, ReminderOutcome::Cancelled, false)
    }

    /// 结束会话：摘除窗口登记、记录结论，并按需生成交回编排层的信号。
    ///
    /// `settled` 为真表示把通道结果交回定时引擎（仅 `complete` 路径需要）；
    /// 预览无论在哪个路径结束都会收到 `previewChanged`。
    fn close_locked(
        &self,
        slot: &mut Option<Session>,
        key: u64,
        channels: Vec<ChannelResult>,
        outcome: ReminderOutcome,
        settled: bool,
    ) -> Option<Completion> {
        let (event, result) = {
            let session = slot.as_ref().filter(|session| session.key == key)?;
            let result = ReminderResult { id: session.event.id.clone(), outcome, channels: channels.clone() };
            (session.event.clone(), result)
        };
        *lock(&self.outcomes) = Some((key, result.clone()));
        let windows = match slot.take() {
            Some(session) => session.windows.into_values().map(|item| item.window).collect(),
            None => Vec::new(),
        };
        let settlement = match (event.kind, settled) {
            (ReminderKind::Real, true) => Some(Settlement::Finished { event: Box::new(event), results: channels }),
            (ReminderKind::Real, false) => None,
            (ReminderKind::Preview, _) => Some(Settlement::PreviewSettled { result }),
        };
        Some(Completion { windows, settlement })
    }

    /// 各屏视觉结果汇总；尚未收敛时返回 `None`。
    fn aggregate_locked(&self, slot: &Option<Session>, key: u64) -> Option<ChannelResult> {
        let session = slot.as_ref().filter(|session| session.key == key)?;
        if session.creating {
            return None;
        }
        let screens: Vec<&OverlayWindow> = session.windows.values().filter(|item| item.display_id.is_some()).collect();
        if screens.is_empty() || screens.iter().any(|item| item.visual_result.is_none()) {
            return None;
        }
        if let Some(failure) = screens.iter().find_map(|item| {
            item.visual_result.as_ref().filter(|result| !result.success)
        }) {
            return Some(failure.clone());
        }
        Some(ChannelResult {
            channel: Channel::Visual,
            success: true,
            message: if session.event.settings.reminder.visual == VisualMode::Mask {
                "所有屏幕蒙版已显示".into()
            } else {
                "所有屏幕闪屏已结束".into()
            },
        })
    }

    /// 执行锁外收尾；销毁窗口在前，交回结论在后。
    fn run_completion(&self, handle: &AppHandle, completion: Option<Completion>) {
        let Some(completion) = completion else {
            return;
        };
        for window in &completion.windows {
            let _ = window.destroy();
        }
        if let Some(settlement) = completion.settlement {
            crate::apply_settlement(handle, settlement);
        }
    }

    /// 挂一个带会话保护的定时器，对应 TS 的 `later`。
    fn later(&self, handle: &AppHandle, key: u64, ms: u64, action: TimerAction) {
        let timer_handle = handle.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(ms));
            let state = timer_handle.state::<crate::AppState>();
            state.coordinator.fire_timer(&timer_handle, key, action);
        });
    }

    /// 当前会话的事件快照。
    fn session_event(&self, key: u64) -> Option<ReminderEvent> {
        lock(&self.session)
            .as_ref()
            .filter(|session| session.key == key)
            .map(|session| session.event.clone())
    }

    /// 指定窗口句柄；会话已结束或窗口已摘除时返回 `None`。
    fn window_of(&self, key: u64, label: &str) -> Option<WebviewWindow> {
        lock(&self.session)
            .as_ref()
            .filter(|session| session.key == key)
            .and_then(|session| session.windows.get(label))
            .map(|item| item.window.clone())
    }

    /// 指定代号是否仍是当前会话。
    fn is_current(&self, key: u64) -> bool {
        lock(&self.session).as_ref().map(|session| session.key) == Some(key)
    }

    /// 指定会话的结论。
    fn outcome(&self, key: u64) -> Option<ReminderOutcome> {
        lock(&self.outcomes).as_ref().filter(|(stored, _)| *stored == key).map(|(_, result)| result.outcome)
    }

    /// 指定会话失败通道的合并文案。
    fn failure_message(&self, key: u64) -> String {
        let messages: Vec<String> = lock(&self.outcomes)
            .as_ref()
            .filter(|(stored, _)| *stored == key)
            .map(|(_, result)| {
                result
                    .channels
                    .iter()
                    .filter(|channel| !channel.success)
                    .map(|channel| channel.message.clone())
                    .collect()
            })
            .unwrap_or_default();
        if messages.is_empty() {
            "预览未能呈现".into()
        } else {
            messages.join("；")
        }
    }
}

/// 创建覆盖层窗口；必须在主线程执行。
///
/// 窗口的可视状态由协调器持有，页面挂载后通过 `get_overlay` 命令自行拉取。
fn build_overlay(
    handle: &AppHandle,
    label: &str,
    bounds: Option<DisplayBounds>,
    mask: bool,
) -> tauri::Result<WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(handle, label, WebviewUrl::App("index.html?surface=overlay".into()))
        .title("EyeCare")
        .decorations(false)
        .transparent(true)
        .visible(false)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        // 只有蒙版需要键盘焦点；闪屏窗口不可聚焦，避免抢走用户输入。
        .focusable(mask)
        .always_on_top(bounds.is_some())
        .visible_on_all_workspaces(bounds.is_some());
    match bounds {
        Some(bounds) => {
            builder = builder.position(bounds.x, bounds.y).inner_size(bounds.width, bounds.height);
        }
        None => {
            // 声音宿主：1×1 隐藏窗口，只用来播放音效。
            builder = builder.inner_size(1.0, 1.0);
        }
    }
    let window = builder.build()?;
    if !mask {
        let _ = window.set_ignore_cursor_events(true);
    }
    Ok(window)
}

/// 覆盖窗口的显示器列表；为空时回退到主显示器，对应 Electron 的 `screen` 用法。
fn display_targets(handle: &AppHandle) -> Vec<DisplayInfo> {
    let mut targets = crate::platform::display_list(handle);
    if targets.is_empty() {
        targets.extend(crate::platform::primary_display(handle));
    }
    targets
}

/// 单屏播放保护时长：至少 10 秒，且覆盖淡入/停留/淡出与 5 秒余量。
fn playback_timeout_ms(reminder: &ResolvedReminderSettings) -> u64 {
    (reminder.fade_in_ms + reminder.hold_ms + reminder.fade_out_ms + 5_000.0).max(10_000.0) as u64
}

/// 通知失败文案，对齐 `notificationFailureMessage`。
fn notification_failure_message(error: &str) -> String {
    if cfg!(target_os = "macos") && notification_not_allowed(error) {
        return "macOS 未允许 EyeCare 发送通知，请在系统设置 → 通知 → EyeCare 开启允许通知；若无条目请使用已签名应用重试"
            .into();
    }
    format!("通知发送失败：{error}")
}

/// 识别 macOS 的 `UNErrorDomain error 1`（未允许通知）。
fn notification_not_allowed(error: &str) -> bool {
    let Some(tail) = error.split("UNErrorDomain").nth(1) else {
        return false;
    };
    let codes: String = tail.chars().filter(|ch| ch.is_ascii_digit() || *ch == '.').collect();
    codes.trim_end_matches('.').ends_with('1')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::ProductDefaults;

    /// 播放保护时长至少 10 秒，且随淡入/停留/淡出增长。
    #[test]
    fn playback_timeout_follows_the_typescript_bounds() {
        let mut reminder = ResolvedReminderSettings {
            visual: VisualMode::Flash,
            sound_enabled: false,
            sound_id: ProductDefaults::SOUND_ID.into(),
            volume_percent: ProductDefaults::VOLUME_PERCENT,
            flash_opacity_percent: ProductDefaults::FLASH_OPACITY_PERCENT,
            flash_color: ProductDefaults::FLASH_COLOR.into(),
            fade_in_ms: 100.0,
            hold_ms: 100.0,
            fade_out_ms: 100.0,
            screen_scope: ProductDefaults::SCREEN_SCOPE.into(),
            screen_ids: Vec::new(),
            message: ProductDefaults::MESSAGE.into(),
        };
        // 与 TS 的 `Math.max(10000, fadeIn + hold + fadeOut + 5000)` 一致：
        // 产品默认值合计 7000，因此下限 10 秒生效。
        assert_eq!(playback_timeout_ms(&reminder), 10_000);
        reminder.fade_in_ms = 5_000.0;
        reminder.hold_ms = 5_000.0;
        reminder.fade_out_ms = 5_000.0;
        assert_eq!(playback_timeout_ms(&reminder), 20_000);
    }

    /// 只有 macOS 的 UNErrorDomain error 1 被识别为「未允许通知」。
    #[test]
    fn notification_errors_match_the_typescript_detection() {
        assert!(notification_not_allowed("The operation couldn’t be completed. (UNErrorDomain error 1.)"));
        assert!(!notification_not_allowed("The operation couldn’t be completed. (UNErrorDomain error 2.)"));
        assert!(!notification_not_allowed("通知发送失败：permission denied"));
    }

    /// 空闲协调器没有会话、没有通道结果，也不对外提供覆盖层状态。
    #[test]
    fn an_idle_coordinator_presents_nothing() {
        let coordinator = ReminderCoordinator::new();
        assert!(!coordinator.is_busy());
        assert_eq!(coordinator.current_kind(), None);
        assert!(coordinator.channels().is_empty());
        assert!(!coordinator.matches("preview-1", 0));
        assert!(coordinator.overlay_state("overlay-1").is_none());
    }
}
