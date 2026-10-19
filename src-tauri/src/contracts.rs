//! `app/shared/contracts.ts` 的 Rust 镜像。
//!
//! 字段命名与序列化格式必须与 TypeScript 侧逐字对齐，因为同一套契约同时服务于
//! WebView（`invoke`/事件通道）与磁盘上的设置文件。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 能力探测结果的状态枚举。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityState {
    Available,
    Unsupported,
    PermissionRequired,
    Error,
    Unknown,
}

/// 单项能力的状态与解释文案。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capability {
    pub state: CapabilityState,
    pub reason: String,
}

/// 全部能力探测项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub input: Capability,
    pub mouse: Capability,
    pub lock: Capability,
    pub overlay: Capability,
    pub notification: Capability,
    pub tray: Capability,
    pub launch_at_login: Capability,
}

impl Capabilities {
    /// 启动初期尚未完成探测时的占位值。
    pub fn unknown() -> Self {
        let pending = Capability { state: CapabilityState::Unknown, reason: "等待系统检测".into() };
        Self {
            input: pending.clone(),
            mouse: pending.clone(),
            lock: pending.clone(),
            overlay: pending.clone(),
            notification: pending.clone(),
            tray: pending.clone(),
            launch_at_login: pending,
        }
    }
}

/// 显示器逻辑边界。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DisplayBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 单台显示器的描述信息。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: String,
    pub label: String,
    pub primary: bool,
    pub bounds: DisplayBounds,
    pub scale_factor: f64,
}

/// 明暗主题。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    Light,
    Dark,
}

/// Effective application appearance, distinct from OS-observed light/dark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectiveTheme {
    Light,
    Dark,
    Handdrawn,
}

impl From<Theme> for EffectiveTheme {
    fn from(theme: Theme) -> Self {
        match theme { Theme::Light => Self::Light, Theme::Dark => Self::Dark }
    }
}

/// 锁屏状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockState {
    Locked,
    Unlocked,
    Unknown,
}

/// 平台适配层每次采样的结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSample {
    pub sequence: u64,
    pub now_ms: i64,
    pub clock_trusted: bool,
    pub combined_idle_ms: Option<f64>,
    pub selected_source_idle_ms: Option<f64>,
    pub lock_state: LockState,
    pub sleeping: bool,
    pub displays: Vec<DisplayInfo>,
    pub capabilities: Capabilities,
    pub system_theme: Theme,
    pub reduce_motion: bool,
    pub reduce_transparency: bool,
}

/// 运行态标签，取值与 TS 联合类型一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStatus {
    Starting,
    Counting,
    ShortIdle,
    LongIdle,
    Locked,
    Sleeping,
    Paused,
    Reminding,
    CapabilityError,
}

/// 运行态中文标签，与 `app/shared/contracts.ts#L91` 的 `statusLabels` 逐项一致。
///
/// 托盘标题、提示文案与菜单标题都复用同一份文案，避免与前端展示不一致。
pub fn status_label(status: RuntimeStatus) -> &'static str {
    match status {
        RuntimeStatus::Starting => "正在检测系统状态",
        RuntimeStatus::Counting => "正在计时",
        RuntimeStatus::ShortIdle => "空闲暂停",
        RuntimeStatus::LongIdle => "等待活动",
        RuntimeStatus::Locked => "屏幕已锁定",
        RuntimeStatus::Sleeping => "系统正在睡眠",
        RuntimeStatus::Paused => "已暂停",
        RuntimeStatus::Reminding => "等待提醒结束",
        RuntimeStatus::CapabilityError => "检测能力异常",
    }
}

/// 定时模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerMode {
    Active,
    Fixed,
}

/// 提醒的视觉通道类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisualMode {
    Flash,
    Mask,
    Notification,
    None,
}

/// 主题偏好。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemePreference {
    System,
    Light,
    Dark,
    Handdrawn,
}

/// 定时相关设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSettings {
    pub mode: TimerMode,
    pub interval_minutes: f64,
    pub long_idle_minutes: f64,
}

/// 提醒相关设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSettings {
    pub visual: VisualMode,
    pub sound_enabled: bool,
}

/// 外观相关设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: ThemePreference,
    pub show_tray_countdown: bool,
}

/// 通用设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub launch_at_login: bool,
}

/// 可编辑、可持久化的八项核心设置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsV2 {
    pub schema_version: u32,
    pub timer: TimerSettings,
    pub reminder: ReminderSettings,
    pub appearance: AppearanceSettings,
    pub general: GeneralSettings,
}

/// 与 V1 磁盘结构兼容的完整定时设置（仅用于迁移读取）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyTimerSettings {
    pub mode: TimerMode,
    pub interval_minutes: f64,
    pub activity_source: String,
    pub active_window_seconds: f64,
    pub long_idle_minutes: f64,
}

/// 与 V1 磁盘结构兼容的完整提醒设置（仅用于迁移读取）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyReminderSettings {
    pub visual: VisualMode,
    pub sound_enabled: bool,
    pub sound_id: String,
    pub volume_percent: f64,
    pub flash_opacity_percent: f64,
    pub flash_color: String,
    pub fade_in_ms: f64,
    pub hold_ms: f64,
    pub fade_out_ms: f64,
    pub snooze_minutes: f64,
    pub screen_scope: String,
    pub screen_ids: Vec<String>,
    pub message: String,
}

/// 与 V1 磁盘结构兼容的外观设置（仅用于迁移读取）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyAppearanceSettings {
    pub theme: ThemePreference,
    pub show_tray_countdown: bool,
    pub reduce_motion: String,
    pub reduce_transparency: String,
}

/// 磁盘上的历史设置结构，仅由显式 V1 迁移读取，永不进入 IPC。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsV1 {
    pub schema_version: u32,
    pub timer: LegacyTimerSettings,
    pub reminder: LegacyReminderSettings,
    pub appearance: LegacyAppearanceSettings,
    pub general: GeneralSettings,
}

/// 产品固有默认值，用户不可编辑。
#[derive(Debug, Clone, Copy)]
pub struct ProductDefaults;

impl ProductDefaults {
    pub const ACTIVE_WINDOW_SECONDS: f64 = 60.0;
    pub const ACTIVITY_SOURCE: &'static str = "combined";
    pub const SOUND_ID: &'static str = "gentle";
    pub const VOLUME_PERCENT: f64 = 50.0;
    pub const FLASH_OPACITY_PERCENT: f64 = 90.0;
    pub const FLASH_COLOR: &'static str = "#000000";
    pub const FADE_IN_MS: f64 = 600.0;
    pub const HOLD_MS: f64 = 800.0;
    pub const FADE_OUT_MS: f64 = 600.0;
    pub const SCREEN_SCOPE: &'static str = "all";
    pub const MESSAGE: &'static str = "该让眼睛休息一下了";
}

/// 出厂默认设置。
pub fn default_settings() -> SettingsV2 {
    SettingsV2 {
        schema_version: 2,
        timer: TimerSettings { mode: TimerMode::Active, interval_minutes: 30.0, long_idle_minutes: 10.0 },
        reminder: ReminderSettings { visual: VisualMode::Flash, sound_enabled: false },
        appearance: AppearanceSettings { theme: ThemePreference::System, show_tray_countdown: true },
        general: GeneralSettings { launch_at_login: false },
    }
}

/// 定时设置 + 产品固有项，创建事件时一次性固化。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTimerSettings {
    pub mode: TimerMode,
    pub interval_minutes: f64,
    pub long_idle_minutes: f64,
    pub activity_source: String,
    pub active_window_seconds: f64,
}

/// 提醒设置 + 产品固有项。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedReminderSettings {
    pub visual: VisualMode,
    pub sound_enabled: bool,
    pub sound_id: String,
    pub volume_percent: f64,
    pub flash_opacity_percent: f64,
    pub flash_color: String,
    pub fade_in_ms: f64,
    pub hold_ms: f64,
    pub fade_out_ms: f64,
    pub screen_scope: String,
    pub screen_ids: Vec<String>,
    pub message: String,
}

/// 外观设置 + 产品固有项。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAppearanceSettings {
    pub theme: ThemePreference,
    pub show_tray_countdown: bool,
    pub reduce_motion: String,
    pub reduce_transparency: String,
}

/// 事件级不可变设置快照。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSettings {
    pub schema_version: u32,
    pub timer: ResolvedTimerSettings,
    pub reminder: ResolvedReminderSettings,
    pub appearance: ResolvedAppearanceSettings,
    pub general: GeneralSettings,
}

/// 创建真实或预览事件时一次性展开产品默认值。
pub fn resolve_settings(settings: &SettingsV2) -> ResolvedSettings {
    ResolvedSettings {
        schema_version: settings.schema_version,
        timer: ResolvedTimerSettings {
            mode: settings.timer.mode,
            interval_minutes: settings.timer.interval_minutes,
            long_idle_minutes: settings.timer.long_idle_minutes,
            activity_source: ProductDefaults::ACTIVITY_SOURCE.into(),
            active_window_seconds: ProductDefaults::ACTIVE_WINDOW_SECONDS,
        },
        reminder: ResolvedReminderSettings {
            visual: settings.reminder.visual,
            sound_enabled: settings.reminder.sound_enabled,
            sound_id: ProductDefaults::SOUND_ID.into(),
            volume_percent: ProductDefaults::VOLUME_PERCENT,
            flash_opacity_percent: ProductDefaults::FLASH_OPACITY_PERCENT,
            flash_color: ProductDefaults::FLASH_COLOR.into(),
            fade_in_ms: ProductDefaults::FADE_IN_MS,
            hold_ms: ProductDefaults::HOLD_MS,
            fade_out_ms: ProductDefaults::FADE_OUT_MS,
            screen_scope: ProductDefaults::SCREEN_SCOPE.into(),
            screen_ids: Vec::new(),
            message: ProductDefaults::MESSAGE.into(),
        },
        appearance: ResolvedAppearanceSettings {
            theme: settings.appearance.theme,
            show_tray_countdown: settings.appearance.show_tray_countdown,
            reduce_motion: "system".into(),
            reduce_transparency: "system".into(),
        },
        general: settings.general.clone(),
    }
}

/// 提醒事件类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderKind {
    Real,
    Preview,
}

/// 一条等待呈现或被呈现中的提醒。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderEvent {
    pub id: String,
    pub generation: u64,
    pub kind: ReminderKind,
    pub settings: ResolvedSettings,
    pub screen_ids: Vec<String>,
    pub created_at_ms: i64,
}

/// 提醒动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderAction {
    Acknowledge,
    Skip,
}

/// 提醒通道类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    Visual,
    Sound,
}

/// 单通道交付结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelResult {
    pub channel: Channel,
    pub success: bool,
    pub message: String,
}

/// 一轮提醒的收尾方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderOutcome {
    Automatic,
    Acknowledge,
    Skip,
    Cancelled,
    Failed,
}

/// 真实提醒的最终结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReminderResult {
    pub id: String,
    pub outcome: ReminderOutcome,
    pub channels: Vec<ChannelResult>,
}

/// 预览提醒的最终结果。
pub type PreviewResult = ReminderResult;

/// 暴露给所有窗口的运行态快照。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub settings_revision: i64,
    pub settings: SettingsV2,
    pub sequence: u64,
    pub status: RuntimeStatus,
    pub status_reason: String,
    pub elapsed_active_ms: i64,
    pub remaining_ms: Option<i64>,
    pub current_reminder_id: Option<String>,
    pub current_preview_id: Option<String>,
    pub latest_preview_result: Option<PreviewResult>,
    pub theme: EffectiveTheme,
    pub reduce_motion: bool,
    pub reduce_transparency: bool,
    pub capabilities: Capabilities,
    pub displays: Vec<DisplayInfo>,
    pub latest_reminder_result: Option<ReminderResult>,
    pub rest_confirmed_count: u64,
    pub warnings: Vec<String>,
}

/// 引擎向编排层下发的副作用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEffect {
    Present { reminder: ReminderEvent },
    Cancel { id: String, generation: u64 },
    RestConfirmed { id: String },
}

/// 一次引擎调用的返回值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineUpdate {
    pub snapshot: RuntimeSnapshot,
    pub effects: Vec<EngineEffect>,
}

/// 统一错误结构。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub fields: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub current_revision: Option<i64>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), fields: None, current_revision: None }
    }
}

/// `Result<T>` 的 IPC 形态：`{ok:true,value}` / `{ok:false,error}`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandResult<T> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<AppError>,
}

impl<T> CommandResult<T> {
    pub fn success(value: T) -> Self {
        Self { ok: true, value: Some(value), error: None }
    }
    pub fn failure(error: AppError) -> Self {
        Self { ok: false, value: None, error: Some(error) }
    }
}

/// 覆盖层订阅到的事件状态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayState {
    pub event: ReminderEvent,
    pub theme: EffectiveTheme,
    pub reduce_motion: bool,
    pub reduce_transparency: bool,
}

/// 与 `formatTime` 一致的倒计时格式化，托盘标题与前端共用同一规则。
pub fn format_time(ms: Option<i64>) -> String {
    match ms {
        None => "—".into(),
        Some(ms) => {
            let seconds = ((ms.max(0) as f64) / 1000.0).ceil() as i64;
            let minutes = seconds / 60;
            if minutes >= 60 {
                format!("{}:{:02}:{:02}", minutes / 60, minutes % 60, seconds % 60)
            } else {
                format!("{:02}:{:02}", minutes, seconds % 60)
            }
        }
    }
}
