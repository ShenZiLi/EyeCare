//! `app/main/engine/timer-engine.ts` 的 Rust 移植。
//!
//! 纯状态拥有者：不依赖任何 GUI 或平台 API，`now_ms` 必须是包含睡眠时长的
//! 平台单调时钟。语义与 TS 版本逐行对齐，`tests/unit/timer-engine.test.ts`
//! 的输入向量是本实现正确性的唯一判据。

use crate::contracts::{
    resolve_settings, AppError, Capabilities, Channel, ChannelResult, EngineEffect, EngineUpdate,
    PlatformSample, ReminderAction, ReminderEvent, ReminderKind, ReminderOutcome, ReminderResult,
    RuntimeSnapshot, RuntimeStatus, SettingsV2, Theme, TimerMode, VisualMode,
};
use uuid::Uuid;

/// 单次采样间隔超过该值即视为观测缺失，未知时段不计入活动。
const SAMPLE_GAP_WARNING_MS: i64 = 5_000;

/// 采样值必须为有限且非负的毫秒数。
fn valid_idle(idle: Option<f64>) -> bool {
    matches!(idle, Some(value) if value.is_finite() && value >= 0.0)
}

/// 把分钟设置换算为毫秒周期。
fn interval_ms(settings: &SettingsV2) -> i64 {
    (settings.timer.interval_minutes * 60_000.0).round() as i64
}

/// 长空闲阈值（毫秒）。
fn long_idle_ms(settings: &SettingsV2) -> f64 {
    settings.timer.long_idle_minutes * 60_000.0
}

pub struct TimerEngine {
    settings: SettingsV2,
    cycle_settings: SettingsV2,
    revision: i64,
    sample: Option<PlatformSample>,
    now: i64,
    sequence: u64,
    elapsed: i64,
    deadline: i64,
    manually_paused: bool,
    reminder: Option<ReminderEvent>,
    reminder_channels: Vec<ChannelResult>,
    generation: u64,
    last_result: Option<ReminderResult>,
    rest_count: u64,
    warnings: Vec<String>,
    absence_since: Option<i64>,
    restart_on_recovery: bool,
    pending_timer_reset: bool,
}

impl TimerEngine {
    /// 以指定设置、设置版本号与起始时钟创建引擎。
    pub fn new(settings: SettingsV2, revision: i64, now_ms: i64) -> Self {
        let deadline = now_ms + interval_ms(&settings);
        Self {
            settings: settings.clone(),
            cycle_settings: settings,
            revision,
            sample: None,
            now: now_ms,
            sequence: 0,
            elapsed: 0,
            deadline,
            manually_paused: false,
            reminder: None,
            reminder_channels: Vec::new(),
            generation: 0,
            last_result: None,
            rest_count: 0,
            warnings: Vec::new(),
            absence_since: None,
            restart_on_recovery: false,
            pending_timer_reset: false,
        }
    }

    /// 当前周期长度。
    fn interval(&self) -> i64 {
        interval_ms(&self.cycle_settings)
    }

    /// 当前是否处于长空闲。
    fn long_idle(&self) -> bool {
        matches!(&self.sample, Some(sample) if valid_idle(sample.combined_idle_ms) && sample.combined_idle_ms.unwrap_or(f64::NEG_INFINITY) >= long_idle_ms(&self.cycle_settings))
    }

    /// 能力缺失导致的故障原因；无故障时返回 `None`。
    fn fault(&self) -> Option<String> {
        let sample = match &self.sample {
            None => return Some("等待系统状态".into()),
            Some(sample) => sample,
        };
        if !sample.clock_trusted {
            return Some("连续时钟不可用，无法确认离开时长；计时和提醒已暂停".into());
        }
        if sample.lock_state == crate::contracts::LockState::Unknown
            || sample.capabilities.lock.state != crate::contracts::CapabilityState::Available
        {
            return Some(non_empty(&sample.capabilities.lock.reason, "锁屏状态未知"));
        }
        if sample.capabilities.input.state != crate::contracts::CapabilityState::Available
            || !valid_idle(sample.combined_idle_ms)
        {
            return Some(non_empty(&sample.capabilities.input.reason, "输入活动检测不可用"));
        }
        None
    }

    /// 当前是否应抑制计时与提醒。
    fn suppressed(&self) -> bool {
        match &self.sample {
            None => true,
            Some(sample) => {
                sample.sleeping
                    || sample.lock_state != crate::contracts::LockState::Unlocked
                    || self.fault().is_some()
                    || self.manually_paused
                    || self.long_idle()
            }
        }
    }

    /// 运行态标签与解释文案。
    fn status(&self) -> (RuntimeStatus, String) {
        let sample = match &self.sample {
            None => return (RuntimeStatus::Starting, "等待系统状态".into()),
            Some(sample) => sample,
        };
        if sample.sleeping {
            return (RuntimeStatus::Sleeping, "系统正在睡眠".into());
        }
        if sample.lock_state == crate::contracts::LockState::Locked {
            return (RuntimeStatus::Locked, "屏幕已锁定".into());
        }
        if let Some(fault) = self.fault() {
            return (RuntimeStatus::CapabilityError, fault);
        }
        if self.manually_paused {
            return (RuntimeStatus::Paused, "已暂停提醒".into());
        }
        if self.long_idle() {
            return (RuntimeStatus::LongIdle, "长时间没有输入，累计已清零".into());
        }
        if self.reminder.is_some() {
            let reason = if self.pending_timer_reset {
                "当前提醒保持原配置，新计时参数将在下一周期生效"
            } else {
                "等待提醒结束"
            };
            return (RuntimeStatus::Reminding, reason.into());
        }
        if self.cycle_settings.timer.mode == TimerMode::Active
            && sample.combined_idle_ms.unwrap_or(f64::INFINITY) > 60_000.0
        {
            return (RuntimeStatus::ShortIdle, "空闲暂停累计".into());
        }
        (RuntimeStatus::Counting, "正在计时".into())
    }

    /// 组装对外快照。
    pub fn get_snapshot(&self) -> RuntimeSnapshot {
        let (status, status_reason) = self.status();
        let remaining_ms = if self.cycle_settings.timer.mode == TimerMode::Active {
            Some((self.interval() - self.elapsed).max(0))
        } else {
            Some((self.deadline - self.now).max(0))
        };
        RuntimeSnapshot {
            settings_revision: self.revision,
            settings: self.settings.clone(),
            sequence: self.sequence,
            status,
            status_reason,
            elapsed_active_ms: self.elapsed,
            remaining_ms,
            current_reminder_id: self.reminder.as_ref().map(|reminder| reminder.id.clone()),
            current_preview_id: None,
            latest_preview_result: None,
            theme: match self.settings.appearance.theme {
                crate::contracts::ThemePreference::System => {
                    self.sample.as_ref().map(|sample| sample.system_theme).unwrap_or(Theme::Light)
                }
                crate::contracts::ThemePreference::Light => Theme::Light,
                crate::contracts::ThemePreference::Dark => Theme::Dark,
            },
            reduce_motion: self.sample.as_ref().is_some_and(|sample| sample.reduce_motion),
            reduce_transparency: self.sample.as_ref().is_some_and(|sample| sample.reduce_transparency),
            capabilities: self.sample.as_ref().map(|sample| sample.capabilities.clone()).unwrap_or_else(Capabilities::unknown),
            displays: self.sample.as_ref().map(|sample| sample.displays.clone()).unwrap_or_default(),
            latest_reminder_result: self.last_result.clone(),
            rest_confirmed_count: self.rest_count,
            warnings: self.warnings.clone(),
        }
    }

    /// 生成一次返回值，可携带副作用。
    fn update(&self, effects: Vec<EngineEffect>) -> EngineUpdate {
        EngineUpdate { snapshot: self.get_snapshot(), effects }
    }

    /// 单调推进内部时钟，忽略更早的取值。
    fn time(&mut self, now_ms: Option<i64>) {
        if let Some(value) = now_ms {
            self.now = self.now.max(value);
        }
    }

    /// 以当前设置开启一个全新周期。
    fn reset(&mut self) {
        self.cycle_settings = self.settings.clone();
        self.pending_timer_reset = false;
        self.elapsed = 0;
        self.deadline = self.now + self.interval();
    }

    /// 取消进行中的提醒；`restart_on_recovery` 决定恢复后是否重开周期。
    fn cancel(&mut self, effects: &mut Vec<EngineEffect>, restart_on_recovery: bool) {
        let reminder = match self.reminder.take() {
            None => return,
            Some(reminder) => reminder,
        };
        effects.push(EngineEffect::Cancel { id: reminder.id.clone(), generation: reminder.generation });
        self.last_result = Some(ReminderResult {
            id: reminder.id,
            outcome: ReminderOutcome::Cancelled,
            channels: self.reminder_channels.clone(),
        });
        self.reset();
        self.restart_on_recovery = restart_on_recovery;
    }

    /// 在所有显示器上呈现一次真实提醒。
    fn present(&mut self, effects: &mut Vec<EngineEffect>) {
        if self.suppressed() || self.reminder.is_some() {
            return;
        }
        let screen_ids = self
            .sample
            .as_ref()
            .map(|sample| sample.displays.iter().map(|display| display.id.clone()).collect())
            .unwrap_or_default();
        self.generation += 1;
        let reminder = ReminderEvent {
            id: Uuid::new_v4().to_string(),
            generation: self.generation,
            kind: ReminderKind::Real,
            settings: resolve_settings(&self.settings),
            screen_ids,
            created_at_ms: self.now,
        };
        self.reminder_channels = Vec::new();
        effects.push(EngineEffect::Present { reminder: reminder.clone() });
        self.reminder = Some(reminder);
    }

    /// 记录一条去重后的告警；重复返回 `false`。
    fn warn(&mut self, message: &str) -> bool {
        if self.warnings.iter().any(|existing| existing == message) {
            return false;
        }
        if self.warnings.len() > 7 {
            let excess = self.warnings.len() - 7;
            self.warnings.drain(0..excess);
        }
        self.warnings.push(message.to_string());
        true
    }

    /// 把通道失败转换为告警文案。
    fn report_failures(&mut self, channels: &[ChannelResult]) {
        for channel in channels {
            if channel.success {
                continue;
            }
            let label = match channel.channel {
                Channel::Visual => "视觉",
                Channel::Sound => "声音",
            };
            let message = non_empty(&channel.message, "通道不可用");
            self.warn(&format!("{label}提醒失败：{message}"));
        }
    }

    /// 接受一次平台采样并推进状态机。
    pub fn accept_sample(&mut self, input: PlatformSample) -> EngineUpdate {
        if let Some(current) = &self.sample {
            if input.sequence <= current.sequence {
                return self.update(Vec::new());
            }
        }
        // 拒绝墙钟回退，而不是移动截止时刻或重放一个周期。
        if input.now_ms < self.now {
            if self.warn("检测到时钟回退，已忽略异常采样") {
                self.sequence += 1;
            }
            return self.update(Vec::new());
        }
        let previous = self.sample.clone();
        let from = self.now;
        let delta = input.now_ms - from;
        let previously_suppressed = self.suppressed();
        let was_occupied = self.reminder.is_some();
        self.now = input.now_ms;
        self.sample = Some(input.clone());
        self.sequence += 1;
        let mut effects: Vec<EngineEffect> = Vec::new();
        if previous.is_none() {
            self.deadline = self.now + self.interval();
        }
        if !input.clock_trusted {
            self.elapsed = 0;
            self.warn("连续时钟异常，无法确认离开时长；累计已保守清零");
        }
        let absent = input.sleeping
            || input.lock_state != crate::contracts::LockState::Unlocked
            || self.fault().is_some();
        if absent && self.absence_since.is_none() {
            self.absence_since = Some(self.now);
        }
        if let Some(since) = self.absence_since {
            if self.now - since >= long_idle_ms(&self.cycle_settings) as i64 {
                self.elapsed = 0;
            }
        }
        if !absent {
            self.absence_since = None;
        }
        if self.long_idle() {
            self.elapsed = 0;
        }
        let blocked = self.suppressed();
        if blocked {
            self.cancel(&mut effects, true);
        }
        if !blocked && self.restart_on_recovery {
            self.reset();
            self.restart_on_recovery = false;
        }
        if delta > SAMPLE_GAP_WARNING_MS && previous.is_some() {
            self.warn("系统采样延迟超过 5 秒，未知时段未计入活动");
        }
        let can_integrate =
            previous.is_some() && !blocked && !previously_suppressed && !was_occupied && self.reminder.is_none() && delta <= SAMPLE_GAP_WARNING_MS;
        if can_integrate && self.cycle_settings.timer.mode == TimerMode::Active {
            let previous_idle = previous.as_ref().and_then(|sample| sample.combined_idle_ms);
            if valid_idle(previous_idle) && valid_idle(input.combined_idle_ms) {
                let start = from;
                let window = 60_000_i64;
                // 对两个观测到的活动窗口取并集，再与采样区间求交。
                let old_input = from - previous_idle.unwrap_or(0.0) as i64;
                let new_input = self.now - input.combined_idle_ms.unwrap_or(0.0) as i64;
                let old_end = self.now.min(old_input + window);
                let old_credit = (old_end - start).max(0);
                let new_start = start.max(new_input).max(old_end);
                let new_credit = (self.now.min(new_input + window) - new_start).max(0);
                self.elapsed = self.interval().min(self.elapsed + old_credit + new_credit);
            }
        }
        if self.cycle_settings.timer.mode == TimerMode::Fixed && self.now >= self.deadline {
            // 迟到的观测会跳过所有错过的节拍，并建立下一个未来节拍。
            let due = self.deadline;
            self.deadline += ((self.now - self.deadline) / self.interval() + 1) * self.interval();
            if !blocked && !previously_suppressed && self.reminder.is_none() && delta <= SAMPLE_GAP_WARNING_MS && self.now - due < self.interval() {
                self.present(&mut effects);
            }
        } else if self.cycle_settings.timer.mode == TimerMode::Active
            && self.elapsed >= self.interval()
            && !blocked
            && self.reminder.is_none()
        {
            self.present(&mut effects);
        }
        self.update(effects)
    }

    /// 手动暂停：取消当前提醒并停止计时。
    pub fn pause(&mut self) -> EngineUpdate {
        let mut effects = Vec::new();
        self.manually_paused = true;
        self.cancel(&mut effects, true);
        self.sequence += 1;
        self.update(effects)
    }

    /// 手动恢复。
    pub fn resume(&mut self, now_ms: Option<i64>) -> EngineUpdate {
        self.time(now_ms);
        if !self.manually_paused {
            return self.update(Vec::new());
        }
        self.manually_paused = false;
        if self.cycle_settings.timer.mode == TimerMode::Fixed {
            self.deadline = self.now + self.interval();
        }
        self.sequence += 1;
        self.update(Vec::new())
    }

    /// 立即触发一次提醒。
    pub fn remind_now(&mut self, now_ms: Option<i64>) -> EngineUpdate {
        self.time(now_ms);
        if self.suppressed() || self.reminder.is_some() {
            return self.update(Vec::new());
        }
        let mut effects = Vec::new();
        self.present(&mut effects);
        self.sequence += 1;
        self.update(effects)
    }

    /// 处理遮罩型提醒的用户动作。
    pub fn resolve_reminder(&mut self, id: &str, generation: u64, action: ReminderAction, now_ms: Option<i64>) -> EngineUpdate {
        let matched = matches!(&self.reminder, Some(reminder) if reminder.id == id
            && reminder.generation == generation
            && reminder.settings.reminder.visual == VisualMode::Mask);
        if !matched {
            return self.update(Vec::new());
        }
        self.time(now_ms);
        self.reminder = None;
        let mut effects = vec![EngineEffect::Cancel { id: id.to_string(), generation }];
        self.last_result = Some(ReminderResult {
            id: id.to_string(),
            outcome: match action {
                ReminderAction::Acknowledge => ReminderOutcome::Acknowledge,
                ReminderAction::Skip => ReminderOutcome::Skip,
            },
            channels: self.reminder_channels.clone(),
        });
        self.reset();
        if action == ReminderAction::Acknowledge {
            self.rest_count += 1;
            effects.push(EngineEffect::RestConfirmed { id: id.to_string() });
        }
        self.sequence += 1;
        self.update(effects)
    }

    /// 记录遮罩型提醒的交付诊断，不结束其交互生命周期。
    pub fn record_reminder_channels(&mut self, id: &str, generation: u64, channels: &[ChannelResult]) -> EngineUpdate {
        let matched = matches!(&self.reminder, Some(reminder) if reminder.id == id && reminder.generation == generation);
        if !matched {
            return self.update(Vec::new());
        }
        let mut changed = false;
        for channel in channels {
            if !self.reminder_channels.iter().any(|existing| existing.channel == channel.channel) {
                self.reminder_channels.push(channel.clone());
                self.report_failures(std::slice::from_ref(channel));
                changed = true;
            }
        }
        if changed {
            self.sequence += 1;
        }
        self.update(Vec::new())
    }

    /// 非交互提醒（闪光 / 通知 / 无）的收尾。
    pub fn settle_reminder(&mut self, id: &str, generation: u64, channels: &[ChannelResult], now_ms: Option<i64>) -> EngineUpdate {
        let matched = matches!(&self.reminder, Some(reminder) if reminder.id == id && reminder.generation == generation);
        if !matched {
            return self.update(Vec::new());
        }
        self.time(now_ms);
        let failed = !channels.iter().any(|channel| channel.success);
        self.last_result = Some(ReminderResult {
            id: id.to_string(),
            outcome: if failed { ReminderOutcome::Failed } else { ReminderOutcome::Automatic },
            channels: channels.to_vec(),
        });
        self.report_failures(channels);
        if failed {
            self.warn("所有提醒通道均失败，本轮已结束，请检查提醒方式");
        }
        self.reminder = None;
        self.reset();
        self.sequence += 1;
        self.update(vec![EngineEffect::Cancel { id: id.to_string(), generation }])
    }

    /// 应用新的设置与版本号。
    pub fn update_settings(&mut self, settings: SettingsV2, revision: i64, now_ms: Option<i64>) -> EngineUpdate {
        self.time(now_ms);
        let timer_changed = settings.timer != self.settings.timer;
        self.settings = settings.clone();
        self.revision = revision;
        let mut effects = Vec::new();
        if timer_changed && self.reminder.is_some() {
            self.pending_timer_reset = true;
        } else if timer_changed {
            self.cancel(&mut effects, false);
            self.reset();
        } else if self.reminder.is_none() {
            self.cycle_settings = settings;
        }
        if self.long_idle() {
            self.elapsed = 0;
        }
        self.sequence += 1;
        self.update(effects)
    }
}

/// 空字符串按 JS 的 falsy 语义回退到默认文案。
fn non_empty(value: &str, fallback: &str) -> String {
    if value.is_empty() { fallback.to_string() } else { value.to_string() }
}

/// 供上层复用的启动期错误构造。
pub fn not_started() -> AppError {
    AppError::new("NOT_READY", "护眼服务尚未就绪")
}

#[cfg(test)]
mod tests;
