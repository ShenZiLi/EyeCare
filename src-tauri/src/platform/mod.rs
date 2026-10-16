//! `app/main/platform/index.ts` 的 Rust 移植。
//!
//! 职责：把平台原生观测整理成一次 `PlatformSample`，并维护能力探测报告。
//! 与 TS 版一致，能力报告是「最近一次采样」的结论，而不是启动时的静态快照。

#[cfg(target_os = "macos")]
pub mod macos;

use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::contracts::{
    Capabilities, Capability, CapabilityState, DisplayBounds, DisplayInfo, LockState, PlatformSample,
    Theme,
};

/// 活动来源选择，对应 TS 的 `activitySource`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivitySource {
    /// 合并全部输入事件。
    Combined,
    /// 仅鼠标来源。
    Mouse,
}

/// 原生采样的最小接口，对应 TS 的 `NativeProvider`。
///
/// 所有方法都返回 `Result`：失败由适配层翻译成 `error` / `unsupported` 能力状态，
/// 而不是把异常抛给上层编排。
pub trait NativeProvider: Send {
    /// 平台单调时钟毫秒数，必须包含睡眠时长。
    fn now_ms(&self) -> Result<f64, String>;
    /// 合并会话输入空闲时间。
    fn combined_idle_ms(&self) -> Result<f64, String>;
    /// 鼠标来源空闲时间；`None` 表示该平台未提供经验证的鼠标来源。
    fn mouse_idle_ms(&self) -> Result<Option<f64>, String>;
    /// 鼠标来源的能力说明文案。
    fn mouse_reason(&self) -> &'static str;
    /// 当前会话锁屏状态。
    fn lock_state(&self) -> LockState;
}

/// 校验平台返回的空闲时间。
pub(super) fn finite_idle(value: f64) -> Result<f64, String> {
    if value.is_finite() && value >= 0.0 { Ok(value) } else { Err("系统返回了无效的空闲时间".into()) }
}

/// 构造单项能力报告。
fn status(state: CapabilityState, reason: impl Into<String>) -> Capability {
    Capability { state, reason: reason.into() }
}

/// 平台适配层：把原生采样 + 系统事件整理为引擎可消费的样本。
pub struct PlatformAdapter {
    /// 原生提供者；缺失时整条链路降级为 `clockTrusted = false`。
    native: Option<Box<dyn NativeProvider>>,
    sequence: u64,
    /// 系统睡眠标记，Phase 4 接入电源事件后由事件驱动更新。
    sleeping: bool,
    /// 由系统事件观测到的锁屏状态，取值为 `locked` 时覆盖原生观测。
    observed_lock: LockState,
    /// 原生能力初始化或时钟故障的原因；非空即视为不可信。
    fault: String,
    reports: Capabilities,
    last_now: f64,
    fallback_at: Instant,
}

impl PlatformAdapter {
    /// 探测平台原生能力并创建适配层。
    pub fn new() -> Self {
        let reports = Capabilities {
            input: status(CapabilityState::Unknown, "正在检测当前会话输入"),
            mouse: status(CapabilityState::Unknown, "正在检测鼠标来源"),
            lock: status(CapabilityState::Unknown, "正在确认锁屏状态"),
            overlay: status(CapabilityState::Available, "原生桌面窗口；多屏和虚拟桌面需实机验收"),
            notification: status(
                CapabilityState::Available,
                "系统通知接口可用；送达由权限和打包状态决定",
            ),
            tray: status(CapabilityState::Available, "系统托盘接口可用"),
            launch_at_login: status(CapabilityState::Available, "系统登录启动项"),
        };
        let (native, fault) = Self::create_native();
        let now = Instant::now();
        Self {
            native,
            sequence: 0,
            sleeping: false,
            observed_lock: LockState::Unknown,
            fault,
            reports,
            last_now: 0.0,
            fallback_at: now,
        }
    }

    #[cfg(target_os = "macos")]
    fn create_native() -> (Option<Box<dyn NativeProvider>>, String) {
        match macos::MacProvider::create() {
            Ok(provider) => (Some(Box::new(provider)), String::new()),
            Err(error) => (None, error),
        }
    }

    /// 非 macOS 平台尚未提供经验证的全局输入与连续时钟桥接，按清单约定先整体降级。
    #[cfg(not(target_os = "macos"))]
    fn create_native() -> (Option<Box<dyn NativeProvider>>, String) {
        (None, "当前桌面未提供经过验证的全局输入和连续时钟桥接".into())
    }

    /// 当前能力报告。
    pub fn capabilities(&self) -> Capabilities {
        self.reports.clone()
    }

    /// 连续时钟；原生读数缺失或倒退时退化为进程内单调计时并标注故障。
    fn clock(&mut self) -> f64 {
        let observed = self.native.as_ref().map(|native| native.now_ms());
        if let Some(Ok(now)) = observed
            && now.is_finite()
            && now >= self.last_now
        {
            self.last_now = now;
            self.fallback_at = Instant::now();
            return now;
        }
        if observed.is_some() {
            self.fault = "连续时钟异常，无法确认离开时长；计时和提醒已暂停".into();
        }
        let at = Instant::now();
        self.last_now += at.duration_since(self.fallback_at).as_secs_f64() * 1000.0;
        self.fallback_at = at;
        self.last_now
    }

    /// 采样一次系统状态。
    pub fn sample(&mut self, app: &AppHandle, source: ActivitySource) -> PlatformSample {
        let now_ms = self.clock();
        let mut combined_idle_ms = None;
        let mut mouse_idle_ms = None;
        let mut lock_state = LockState::Unknown;
        // 先一次性取完原生观测，再回写能力报告，避免同时借用与修改 `self`。
        let observation = if self.fault.is_empty() {
            self.native.as_ref().map(|native| {
                (native.mouse_reason(), native.combined_idle_ms(), native.mouse_idle_ms(), native.lock_state())
            })
        } else {
            None
        };
        if let Some((mouse_reason, input, mouse, native_lock)) = observation {
            match input {
                Ok(value) => {
                    combined_idle_ms = Some(value);
                    self.reports.input = status(CapabilityState::Available, "当前交互会话合并输入空闲时间");
                }
                Err(_) => self.reports.input = status(CapabilityState::Error, "当前会话输入检测失败"),
            }
            match mouse {
                Ok(value) => {
                    mouse_idle_ms = value;
                    self.reports.mouse = status(CapabilityState::Available, mouse_reason);
                }
                Err(_) => self.reports.mouse = status(CapabilityState::Error, mouse_reason),
            }
            lock_state = native_lock;
            // 锁屏事件在状态切换期间立即抑制副作用；解锁事件不能覆盖新的原生观测，
            // 因为会话身份与控制台归属可能已经改变。
            if self.observed_lock == LockState::Locked {
                lock_state = LockState::Locked;
            }
        } else {
            self.reports.input = status(CapabilityState::Unsupported, self.fault.clone());
            self.reports.mouse = status(CapabilityState::Unsupported, self.fault.clone());
        }
        let lock_reason = if !self.fault.is_empty() {
            self.fault.clone()
        } else if lock_state == LockState::Unknown {
            "未能确认真实锁屏状态；提醒已暂停".into()
        } else {
            "原生当前会话锁屏状态".into()
        };
        self.reports.lock = status(
            if lock_state == LockState::Unknown { CapabilityState::Unknown } else { CapabilityState::Available },
            lock_reason,
        );
        self.sequence += 1;
        PlatformSample {
            sequence: self.sequence,
            now_ms: now_ms as i64,
            clock_trusted: self.native.is_some() && self.fault.is_empty(),
            combined_idle_ms,
            selected_source_idle_ms: match source {
                ActivitySource::Combined => combined_idle_ms,
                ActivitySource::Mouse => mouse_idle_ms,
            },
            lock_state,
            sleeping: self.sleeping,
            displays: Self::displays(app),
            capabilities: self.capabilities(),
            system_theme: Self::system_theme(app),
            // 减少动效与降低透明度偏好属于「外观/系统事件」，Phase 4 接入原生查询。
            reduce_motion: false,
            reduce_transparency: false,
        }
    }

    /// 当前显示器列表；Electron 的 `bounds` 是逻辑点，因此把物理像素除以缩放因子。
    fn displays(app: &AppHandle) -> Vec<DisplayInfo> {
        display_list(app)
    }

    /// 系统明暗主题；窗口不可用时回退为浅色。
    fn system_theme(app: &AppHandle) -> Theme {
        app.get_webview_window(crate::MAIN_WINDOW)
            .and_then(|window| window.theme().ok())
            .map(|theme| if matches!(theme, tauri::Theme::Dark) { Theme::Dark } else { Theme::Light })
            .unwrap_or(Theme::Light)
    }
}

impl Default for PlatformAdapter {
    fn default() -> Self {
        Self::new()
    }
}

/// 把原生显示器映射成契约描述；`index` 用于生成稳定的标识。
fn describe(index: usize, monitor: &tauri::Monitor, primary: Option<&tauri::Monitor>) -> DisplayInfo {
    let scale = if monitor.scale_factor() > 0.0 { monitor.scale_factor() } else { 1.0 };
    let position = monitor.position();
    let size = monitor.size();
    let label = monitor
        .name()
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| format!("显示器 {}", index + 1));
    DisplayInfo {
        id: format!("display-{index}"),
        label,
        primary: primary.is_some_and(|item| item.position() == position && item.size() == size),
        bounds: DisplayBounds {
            x: position.x as f64 / scale,
            y: position.y as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
        },
        scale_factor: scale,
    }
}

/// 当前显示器列表；Electron 的 `bounds` 是逻辑点，因此把物理像素除以缩放因子。
///
/// 覆盖层按屏幕逐块铺开，因此这里对协调器公开。
pub(crate) fn display_list(app: &AppHandle) -> Vec<DisplayInfo> {
    let primary = app.primary_monitor().ok().flatten();
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(index, monitor)| describe(index, monitor, primary.as_ref()))
        .collect()
}

/// 主显示器描述；系统未提供主显示器时返回 `None`。
pub(crate) fn primary_display(app: &AppHandle) -> Option<DisplayInfo> {
    let primary = app.primary_monitor().ok().flatten()?;
    let index = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .position(|monitor| monitor.position() == primary.position() && monitor.size() == primary.size())?;
    Some(describe(index, &primary, Some(&primary)))
}
