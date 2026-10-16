//! `app/main/reminders/coordinator.ts` 的初始骨架。
//!
//! Phase 6 先固定 IPC 命令层依赖的会话查询接口；覆盖层窗口、通知与完整的
//! 呈现 / 收尾生命周期属于 Phase 4。当前覆盖层窗口尚未迁移，因此所有需要
//! 创建窗口的动作都以明确失败返回，绝不静默假装已经呈现。

use crate::contracts::{AppError, ChannelResult, OverlayState, ReminderAction, ReminderEvent};

/// 覆盖层会话协调器；Phase 4 在此补入窗口、定时器与通知。
#[derive(Default)]
pub struct ReminderCoordinator;

impl ReminderCoordinator {
    /// 创建协调器。
    pub fn new() -> Self {
        Self
    }

    /// 当前提醒或预览事件；覆盖层窗口迁移前恒为 `None`。
    pub fn current(&self) -> Option<&ReminderEvent> {
        None
    }

    /// 已记录的通道结果；覆盖层窗口迁移前恒为空。
    pub fn channels(&self) -> Vec<ChannelResult> {
        Vec::new()
    }

    /// 事件标识是否与当前会话一致。
    pub fn matches(&self, _id: &str, _generation: u64) -> bool {
        false
    }

    /// 某个覆盖层窗口订阅到的状态。
    pub fn overlay_state(&self, _window: &str) -> Option<OverlayState> {
        None
    }

    /// 呈现一次提醒；覆盖层窗口迁移前直接以明确失败返回。
    pub fn present(&mut self, _event: ReminderEvent) -> Result<String, AppError> {
        Err(AppError::new("REMINDER_DELIVERY_FAILED", "全屏覆盖窗口将在 Phase 4 迁移，暂时无法呈现提醒"))
    }

    /// 取消当前会话（可限定事件标识）。
    pub fn cancel(&mut self, _id: Option<&str>) {}

    /// 覆盖层窗口报告就绪。
    pub fn ready(&mut self, _window: &str, _id: &str, _generation: u64) -> bool {
        false
    }

    /// 覆盖层窗口报告声音已开始播放。
    pub fn sound_started(&mut self, _window: &str, _id: &str, _generation: u64) -> bool {
        false
    }

    /// 覆盖层窗口上报通道结果。
    pub fn report(&mut self, _window: &str, _id: &str, _generation: u64, _results: &[ChannelResult]) -> bool {
        false
    }

    /// 处理预览的遮罩动作。
    pub fn resolve_preview(&mut self, _id: &str, _generation: u64, _action: ReminderAction) -> bool {
        false
    }
}
