//! `tests/unit/timer-engine.test.ts` 的移植：同一组输入向量，作为 Rust 实现的正确性判据。

use super::*;
use crate::contracts::{
    default_settings, Capability, CapabilityState, Channel, ChannelResult, DisplayBounds, DisplayInfo, EngineEffect,
    LockState, RuntimeSnapshot, SettingsV2, Theme, TimerMode, VisualMode,
};

fn available_caps() -> Capabilities {
    let ok = Capability { state: CapabilityState::Available, reason: String::new() };
    Capabilities {
        input: ok.clone(),
        mouse: ok.clone(),
        lock: ok.clone(),
        overlay: ok.clone(),
        notification: ok.clone(),
        tray: ok.clone(),
        launch_at_login: ok,
    }
}

fn display() -> DisplayInfo {
    DisplayInfo {
        id: "primary".into(),
        label: "Primary".into(),
        primary: true,
        bounds: DisplayBounds { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0 },
        scale_factor: 1.0,
    }
}

/// 与测试文件 `sample()` 的默认值一致的采样模板。
fn template() -> PlatformSample {
    PlatformSample {
        sequence: 0,
        now_ms: 0,
        clock_trusted: true,
        combined_idle_ms: Some(0.0),
        selected_source_idle_ms: Some(0.0),
        lock_state: LockState::Unlocked,
        sleeping: false,
        displays: vec![display()],
        capabilities: available_caps(),
        system_theme: Theme::Light,
        reduce_motion: false,
        reduce_transparency: false,
    }
}

/// 与测试文件 `harness()` 等价的驱动壳。
struct Harness {
    engine: TimerEngine,
    sequence: u64,
    now: i64,
    template: PlatformSample,
}

impl Harness {
    fn new(settings: SettingsV2) -> Self {
        let template = template();
        let mut engine = TimerEngine::new(settings, 0, 0);
        engine.accept_sample(template.clone());
        Self { engine, sequence: 1, now: 0, template }
    }

    /// 推进 `ms` 并叠加本次采样的差异项。
    fn advance(&mut self, ms: i64, mutate: impl Fn(&mut PlatformSample)) -> EngineUpdate {
        self.now += ms;
        let mut sample = self.template.clone();
        sample.sequence = self.sequence;
        sample.now_ms = self.now;
        mutate(&mut sample);
        self.sequence += 1;
        self.engine.accept_sample(sample)
    }

    fn advance_plain(&mut self, ms: i64) -> EngineUpdate {
        self.advance(ms, |_| {})
    }

    /// 连续 `seconds` 秒的 1 秒采样。
    fn run(&mut self, seconds: u32, mutate: impl Fn(&mut PlatformSample)) -> RuntimeSnapshot {
        let mut snapshot = self.engine.get_snapshot();
        for _ in 0..seconds {
            snapshot = self.advance(1000, &mutate).snapshot;
        }
        snapshot
    }
}

fn minute_settings(mode: TimerMode) -> SettingsV2 {
    let mut settings = default_settings();
    settings.timer.interval_minutes = 1.0;
    settings.timer.mode = mode;
    settings
}

/// 断言更新中出现了 `present` 副作用。
fn assert_presents(update: &EngineUpdate) -> ReminderEvent {
    match update.effects.first() {
        Some(EngineEffect::Present { reminder }) => reminder.clone(),
        other => panic!("期望 present 副作用，实际为 {other:?}"),
    }
}

#[test]
fn defaults_to_conservative_startup_without_effects() {
    let mut engine = TimerEngine::new(default_settings(), 0, 0);
    assert_eq!(engine.get_snapshot().settings, default_settings());
    assert!(engine.remind_now(None).effects.is_empty());
    assert_eq!(engine.get_snapshot().status, RuntimeStatus::Starting);
}

#[test]
fn restarted_engine_restores_preferences_and_starts_a_full_cycle() {
    let settings = minute_settings(TimerMode::Active);
    let mut original = Harness::new(settings.clone());
    original.run(50, |_| {});

    let mut restarted = TimerEngine::new(settings, 7, 0);
    let mut sample = template();
    sample.sequence = 1;
    sample.now_ms = 1_000_000;
    let result = restarted.accept_sample(sample);
    assert_eq!(result.snapshot.settings_revision, 7);
    assert_eq!(result.snapshot.elapsed_active_ms, 0);
    assert_eq!(result.snapshot.remaining_ms, Some(60_000));
    assert!(result.effects.is_empty());
}

#[test]
fn integrates_fractional_intersection_at_the_activity_boundary() {
    let mut harness = Harness::new(default_settings());
    let mut idle = 4_000;
    while idle <= 56_000 {
        harness.advance(4_000, |sample| sample.combined_idle_ms = Some(idle as f64));
        idle += 4_000;
    }
    harness.advance(4_000, |sample| sample.combined_idle_ms = Some(60_000.0));
    let result = harness.advance(4_000, |sample| sample.combined_idle_ms = Some(64_000.0));
    assert_eq!(result.snapshot.elapsed_active_ms, 60_000);
    assert_eq!(result.snapshot.status, RuntimeStatus::ShortIdle);
}

#[test]
fn credits_the_union_when_new_input_lands_inside_a_sampling_interval() {
    let mut harness = Harness::new(default_settings());
    let mut idle = 5_000;
    while idle <= 60_000 {
        harness.advance(5_000, |sample| sample.combined_idle_ms = Some(idle as f64));
        idle += 5_000;
    }
    harness.advance(4_000, |sample| sample.combined_idle_ms = Some(64_000.0));
    let result = harness.advance(4_000, |sample| sample.combined_idle_ms = Some(1_000.0));
    assert_eq!(result.snapshot.elapsed_active_ms, 61_000);
}

#[test]
fn produces_exactly_one_reminder_and_ignores_duplicate_observations() {
    let mut harness = Harness::new(minute_settings(TimerMode::Active));
    assert!(harness.run(59, |_| {}).current_reminder_id.is_none());
    let due = harness.advance_plain(1_000);
    assert_eq!(due.effects.iter().filter(|effect| matches!(effect, EngineEffect::Present { .. })).count(), 1);

    let mut duplicate = template();
    duplicate.sequence = 60;
    duplicate.now_ms = 60_000;
    assert!(harness.engine.accept_sample(duplicate).effects.is_empty());
    assert!(harness.advance_plain(1_000).effects.is_empty());
    assert_eq!(harness.engine.get_snapshot().elapsed_active_ms, 60_000);
}

#[test]
fn ignores_missing_intervals_over_five_seconds_and_rejects_clock_reversal() {
    let mut harness = Harness::new(minute_settings(TimerMode::Active));
    assert_eq!(harness.advance_plain(1_000).snapshot.elapsed_active_ms, 1_000);
    assert_eq!(harness.advance_plain(5_001).snapshot.elapsed_active_ms, 1_000);
    assert_eq!(harness.advance_plain(1_000).snapshot.elapsed_active_ms, 2_000);

    let mut rewind = template();
    rewind.sequence = 100;
    rewind.now_ms = 0;
    assert_eq!(harness.engine.accept_sample(rewind).snapshot.elapsed_active_ms, 2_000);
}

#[test]
fn clears_progress_at_the_long_idle_threshold_even_while_paused() {
    let mut harness = Harness::new(default_settings());
    assert_eq!(harness.run(25 * 60, |_| {}).elapsed_active_ms, 25 * 60_000);
    harness.engine.pause();
    let mut idle = 1_000;
    while idle <= 599_000 {
        harness.advance(1_000, |sample| {
            sample.combined_idle_ms = Some(idle as f64);
            sample.selected_source_idle_ms = Some(idle as f64);
        });
        idle += 1_000;
    }
    assert_eq!(harness.engine.get_snapshot().elapsed_active_ms, 25 * 60_000);
    let cleared = harness.advance(1_000, |sample| {
        sample.combined_idle_ms = Some(600_000.0);
        sample.selected_source_idle_ms = Some(600_000.0);
    });
    assert_eq!(cleared.snapshot.elapsed_active_ms, 0);

    harness.engine.resume(None);
    harness.advance_plain(1_000);
    assert!(harness.run(29 * 60, |_| {}).current_reminder_id.is_none());
}

#[test]
fn uses_combined_input_regardless_of_source_specific_age() {
    let mut harness = Harness::new(default_settings());
    for index in 1..=120u64 {
        harness.advance(1_000, |sample| {
            sample.combined_idle_ms = Some(0.0);
            sample.selected_source_idle_ms = Some(index as f64 * 1_000.0);
        });
    }
    assert_eq!(harness.engine.get_snapshot().elapsed_active_ms, 120_000);
    assert_eq!(harness.engine.get_snapshot().status, RuntimeStatus::Counting);
}

#[test]
fn fixed_mode_skips_suppressed_beats_and_never_replays_missed_periods() {
    let mut harness = Harness::new(minute_settings(TimerMode::Fixed));
    let due = harness.advance(60_000, |sample| {
        sample.combined_idle_ms = Some(70_000.0);
        sample.selected_source_idle_ms = Some(70_000.0);
    });
    assert!(due.effects.is_empty());
    assert_eq!(due.snapshot.remaining_ms, Some(60_000));

    let idle = |sample: &mut PlatformSample| {
        sample.combined_idle_ms = Some(70_000.0);
        sample.selected_source_idle_ms = Some(70_000.0);
    };
    harness.run(59, idle);
    let live = harness.advance(1_000, idle);
    assert!(matches!(live.effects.first(), Some(EngineEffect::Present { .. })));
}

#[test]
fn fixed_mode_advances_to_the_next_future_beat_after_locked_periods() {
    let mut harness = Harness::new(minute_settings(TimerMode::Fixed));
    harness.advance(1_000, |sample| sample.lock_state = LockState::Locked);
    harness.advance(179_000, |sample| sample.lock_state = LockState::Locked);
    let restored = harness.advance_plain(1_000);
    assert!(restored.effects.is_empty());
    assert_eq!(restored.snapshot.remaining_ms, Some(59_000));
    assert!(harness.run(58, |_| {}).current_reminder_id.is_none());
    assert!(matches!(harness.advance_plain(1_000).effects.first(), Some(EngineEffect::Present { .. })));
}

#[test]
fn fixed_recovery_exactly_on_a_suppressed_beat_keeps_the_next_future_phase() {
    for suppressed in [true, false] {
        let mut harness = Harness::new(minute_settings(TimerMode::Fixed));
        let changes = |sample: &mut PlatformSample| {
            if suppressed {
                sample.lock_state = LockState::Locked;
            } else {
                sample.combined_idle_ms = Some(600_000.0);
            }
        };
        harness.run(59, changes);
        let recovered = harness.advance_plain(1_000);
        assert!(recovered.effects.is_empty());
        assert_eq!(recovered.snapshot.remaining_ms, Some(60_000));
        harness.run(59, |_| {});
        assert!(matches!(harness.advance_plain(1_000).effects.first(), Some(EngineEffect::Present { .. })));
    }
}

#[test]
fn short_lock_preserves_progress_while_long_sleep_clears_it() {
    let mut harness = Harness::new(default_settings());
    harness.run(20, |_| {});
    harness.advance(1_000, |sample| sample.lock_state = LockState::Locked);
    harness.advance(4_000, |sample| sample.lock_state = LockState::Locked);
    assert_eq!(harness.advance_plain(1_000).snapshot.elapsed_active_ms, 20_000);
    harness.advance(1_000, |sample| sample.sleeping = true);
    harness.advance(600_000, |sample| sample.sleeping = true);
    assert_eq!(harness.advance_plain(1_000).snapshot.elapsed_active_ms, 0);
}

#[test]
fn measures_lock_absence_from_the_first_locked_observation() {
    let mut harness = Harness::new(default_settings());
    harness.run(20, |_| {});
    harness.advance(4_000, |sample| sample.lock_state = LockState::Locked);
    harness.advance(599_000, |sample| sample.lock_state = LockState::Locked);
    assert_eq!(harness.engine.get_snapshot().elapsed_active_ms, 20_000);
    let recovered = harness.advance_plain(1_000);
    assert_eq!(recovered.snapshot.elapsed_active_ms, 0);
    assert!(recovered.effects.is_empty());
}

#[test]
fn untrusted_clock_clears_absence_immediately_and_suppresses_effects() {
    let mut harness = Harness::new(default_settings());
    harness.run(20, |_| {});
    harness.advance(1_000, |sample| sample.sleeping = true);
    let fault = harness.advance(1_000, |sample| sample.clock_trusted = false);
    assert_eq!(fault.snapshot.elapsed_active_ms, 0);
    assert_eq!(fault.snapshot.status, RuntimeStatus::CapabilityError);
    assert!(fault.snapshot.warnings.iter().any(|warning| warning.contains("保守清零")));
    assert!(harness.engine.remind_now(None).effects.is_empty());
    assert_eq!(harness.advance_plain(1_000).snapshot.elapsed_active_ms, 0);
    assert_eq!(harness.advance_plain(1_000).snapshot.elapsed_active_ms, 1_000);
}

#[test]
fn manual_pause_remains_paused_beyond_an_hour_until_explicit_resume() {
    for mode in [TimerMode::Active, TimerMode::Fixed] {
        let mut harness = Harness::new(minute_settings(mode));
        harness.run(10, |_| {});
        let paused = harness.engine.pause();
        assert_eq!(paused.snapshot.status, RuntimeStatus::Paused);
        assert_eq!(harness.run(61 * 60, |_| {}).status, RuntimeStatus::Paused);
        assert_eq!(harness.engine.get_snapshot().elapsed_active_ms, if mode == TimerMode::Active { 10_000 } else { 0 });
        assert!(harness.engine.remind_now(None).effects.is_empty());
        let resumed = harness.engine.resume(None);
        assert_eq!(resumed.snapshot.status, RuntimeStatus::Counting);
        assert_eq!(harness.advance_plain(1_000).snapshot.elapsed_active_ms, if mode == TimerMode::Active { 11_000 } else { 0 });
        if mode == TimerMode::Fixed {
            assert_eq!(resumed.snapshot.remaining_ms, Some(60_000));
        }
    }
}

#[test]
fn short_lock_preserves_paused_progress_and_long_idle_clears_it_without_resuming() {
    let mut harness = Harness::new(default_settings());
    harness.run(20, |_| {});
    harness.engine.pause();
    harness.advance(1_000, |sample| sample.lock_state = LockState::Locked);
    harness.advance(4_000, |sample| sample.lock_state = LockState::Locked);
    let unlocked = harness.advance_plain(1_000);
    assert_eq!(unlocked.snapshot.status, RuntimeStatus::Paused);
    assert_eq!(unlocked.snapshot.elapsed_active_ms, 20_000);
    let idle = harness.advance(1_000, |sample| sample.combined_idle_ms = Some(600_000.0));
    assert_eq!(idle.snapshot.status, RuntimeStatus::Paused);
    assert_eq!(idle.snapshot.elapsed_active_ms, 0);
    assert_eq!(harness.advance_plain(1_000).snapshot.status, RuntimeStatus::Paused);
    harness.engine.resume(None);
    assert_eq!(harness.advance_plain(1_000).snapshot.elapsed_active_ms, 1_000);
}

#[test]
fn manual_pause_cancels_a_live_reminder_once_and_never_revives_it() {
    let mut harness = Harness::new(minute_settings(TimerMode::Active));
    let event = assert_presents(&harness.engine.remind_now(None));
    assert_eq!(
        harness.engine.pause().effects,
        vec![EngineEffect::Cancel { id: event.id.clone(), generation: event.generation }]
    );
    assert!(harness.engine.pause().effects.is_empty());
    harness.run(61 * 60, |_| {});
    assert!(harness.engine.get_snapshot().current_reminder_id.is_none());
    assert_eq!(harness.engine.get_snapshot().rest_confirmed_count, 0);
    assert!(harness.engine.resume(None).effects.is_empty());
    assert!(harness.advance_plain(1_000).effects.is_empty());
    let channels = vec![ChannelResult { channel: Channel::Visual, success: true, message: String::new() }];
    assert!(harness.engine.settle_reminder(&event.id, event.generation, &channels, None).effects.is_empty());
}

#[test]
fn lowering_the_long_idle_threshold_applies_immediately_while_paused() {
    let mut harness = Harness::new(default_settings());
    harness.run(10, |_| {});
    harness.engine.pause();
    harness.advance(1_000, |sample| {
        sample.combined_idle_ms = Some(120_000.0);
        sample.selected_source_idle_ms = Some(120_000.0);
    });
    assert_eq!(harness.engine.get_snapshot().elapsed_active_ms, 10_000);
    let mut settings = default_settings();
    settings.timer.long_idle_minutes = 2.0;
    assert_eq!(harness.engine.update_settings(settings, 1, None).snapshot.elapsed_active_ms, 0);
    assert_eq!(harness.engine.get_snapshot().status, RuntimeStatus::Paused);
}

#[test]
fn all_timer_modes_and_channels_share_pause_lock_and_long_idle_eligibility() {
    for visual in [VisualMode::Flash, VisualMode::Mask, VisualMode::Notification, VisualMode::None] {
        for mode in [TimerMode::Active, TimerMode::Fixed] {
            let mut settings = minute_settings(mode);
            settings.reminder.visual = visual;
            settings.reminder.sound_enabled = true;
            let mut harness = Harness::new(settings);
            harness.engine.pause();
            assert!(harness.engine.remind_now(None).effects.is_empty());
            harness.engine.resume(None);
            harness.advance(1_000, |sample| sample.lock_state = LockState::Locked);
            assert!(harness.engine.remind_now(None).effects.is_empty());
            harness.advance(1_000, |sample| sample.combined_idle_ms = Some(600_000.0));
            assert!(harness.engine.remind_now(None).effects.is_empty());
        }
    }
}

#[test]
fn fail_closes_unknown_lock_and_invalid_input() {
    for mode in [TimerMode::Active, TimerMode::Fixed] {
        let mut harness = Harness::new(minute_settings(mode));
        harness.advance(1_000, |sample| sample.lock_state = LockState::Unknown);
        assert!(harness.engine.remind_now(None).effects.is_empty());
        assert_eq!(harness.engine.get_snapshot().status, RuntimeStatus::CapabilityError);
        harness.advance(1_000, |sample| sample.combined_idle_ms = None);
        assert!(harness.engine.remind_now(None).effects.is_empty());
    }
}

#[test]
fn mask_acknowledgement_confirms_once_and_stale_generations_are_ignored() {
    let mut settings = minute_settings(TimerMode::Active);
    settings.reminder.visual = VisualMode::Mask;
    let mut harness = Harness::new(settings);
    let event = assert_presents(&harness.engine.remind_now(None));
    let channels = vec![ChannelResult { channel: Channel::Visual, success: true, message: "displayed".into() }];
    harness.engine.record_reminder_channels(&event.id, event.generation, &channels);

    assert!(harness.engine.resolve_reminder(&event.id, event.generation + 1, ReminderAction::Acknowledge, None).effects.is_empty());
    let confirmed = harness.engine.resolve_reminder(&event.id, event.generation, ReminderAction::Acknowledge, None);
    assert_eq!(confirmed.effects.iter().filter(|effect| matches!(effect, EngineEffect::RestConfirmed { .. })).count(), 1);

    harness.run(10, |_| {});
    assert!(harness.engine.resolve_reminder(&event.id, event.generation, ReminderAction::Acknowledge, None).effects.is_empty());
    let snapshot = harness.engine.get_snapshot();
    assert_eq!(snapshot.elapsed_active_ms, 10_000);
    assert_eq!(snapshot.rest_confirmed_count, 1);
    assert!(snapshot.latest_reminder_result.unwrap().channels[0].success);
}

#[test]
fn acknowledgement_and_skip_both_start_a_full_normal_cycle() {
    for action in [ReminderAction::Acknowledge, ReminderAction::Skip] {
        let mut settings = minute_settings(TimerMode::Active);
        settings.reminder.visual = VisualMode::Mask;
        let mut harness = Harness::new(settings);
        harness.run(30, |_| {});
        let event = assert_presents(&harness.engine.remind_now(None));
        let resolved = harness.engine.resolve_reminder(&event.id, event.generation, action, None);
        assert_eq!(resolved.snapshot.elapsed_active_ms, 0);
        assert_eq!(resolved.snapshot.remaining_ms, Some(60_000));
        assert_eq!(resolved.snapshot.rest_confirmed_count, u64::from(action == ReminderAction::Acknowledge));
        assert!(harness.run(59, |_| {}).current_reminder_id.is_none());
        let next = assert_presents(&harness.advance_plain(1_000));
        assert_ne!(next.id, event.id);
        assert!(harness.engine.resolve_reminder(&event.id, event.generation, action, None).effects.is_empty());
    }
}

#[test]
fn new_mask_diagnostics_publish_one_sequence_and_keep_the_mask_interactive() {
    let mut settings = minute_settings(TimerMode::Active);
    settings.reminder.visual = VisualMode::Mask;
    settings.reminder.sound_enabled = true;
    let mut harness = Harness::new(settings);
    let event = assert_presents(&harness.engine.remind_now(None));
    let before = harness.engine.get_snapshot().sequence;
    let channels = vec![
        ChannelResult { channel: Channel::Visual, success: true, message: "shown".into() },
        ChannelResult { channel: Channel::Sound, success: false, message: "audio device unavailable".into() },
    ];
    let recorded = harness.engine.record_reminder_channels(&event.id, event.generation, &channels);
    assert_eq!(recorded.snapshot.sequence, before + 1);
    assert_eq!(recorded.snapshot.current_reminder_id, Some(event.id.clone()));
    assert!(recorded.snapshot.warnings.contains(&"声音提醒失败：audio device unavailable".to_string()));
    assert_eq!(harness.engine.record_reminder_channels(&event.id, event.generation, &channels).snapshot.sequence, before + 1);
    let resolved = harness.engine.resolve_reminder(&event.id, event.generation, ReminderAction::Acknowledge, None);
    assert_eq!(resolved.snapshot.latest_reminder_result.unwrap().channels, channels);
}

#[test]
fn cancels_a_live_reminder_under_every_suppression_cause() {
    for variant in 0..4 {
        let mut harness = Harness::new(minute_settings(TimerMode::Active));
        let event = assert_presents(&harness.engine.remind_now(None));
        let cancelled = harness.advance(1_000, |sample| match variant {
            0 => sample.lock_state = LockState::Locked,
            1 => sample.sleeping = true,
            2 => sample.combined_idle_ms = Some(600_000.0),
            _ => sample.lock_state = LockState::Unknown,
        });
        assert!(matches!(cancelled.effects.first(), Some(EngineEffect::Cancel { .. })));
        assert!(harness.advance_plain(1_000).effects.is_empty());
        let channels = vec![ChannelResult { channel: Channel::Visual, success: true, message: String::new() }];
        assert!(harness.engine.settle_reminder(&event.id, event.generation, &channels, None).effects.is_empty());
        assert_eq!(harness.engine.get_snapshot().rest_confirmed_count, 0);
    }
}

#[test]
fn failing_channels_settle_one_cycle_and_automatic_flash_never_confirms_rest() {
    let mut harness = Harness::new(minute_settings(TimerMode::Active));
    let event = assert_presents(&harness.engine.remind_now(None));
    let failed = vec![ChannelResult { channel: Channel::Visual, success: false, message: "window unavailable".into() }];
    let settled = harness.engine.settle_reminder(&event.id, event.generation, &failed, None);
    assert_eq!(settled.snapshot.latest_reminder_result.unwrap().outcome, ReminderOutcome::Failed);
    assert!(harness.advance_plain(1_000).effects.is_empty());
    assert_eq!(harness.engine.get_snapshot().rest_confirmed_count, 0);

    let flash = assert_presents(&harness.engine.remind_now(None));
    harness.advance_plain(2_000);
    let ok = vec![ChannelResult { channel: Channel::Visual, success: true, message: String::new() }];
    let settled = harness.engine.settle_reminder(&flash.id, flash.generation, &ok, None);
    assert_eq!(settled.snapshot.latest_reminder_result.unwrap().outcome, ReminderOutcome::Automatic);
    assert_eq!(settled.snapshot.elapsed_active_ms, 0);
    assert_eq!(settled.snapshot.rest_confirmed_count, 0);
}

#[test]
fn notification_and_none_submissions_cannot_acknowledge_a_rest() {
    for visual in [VisualMode::Notification, VisualMode::None] {
        let mut settings = minute_settings(TimerMode::Active);
        settings.reminder.visual = visual;
        settings.reminder.sound_enabled = true;
        let mut harness = Harness::new(settings);
        let event = assert_presents(&harness.engine.remind_now(None));
        assert!(harness.engine.resolve_reminder(&event.id, event.generation, ReminderAction::Acknowledge, None).effects.is_empty());

        let results = vec![
            ChannelResult { channel: Channel::Visual, success: visual == VisualMode::Notification, message: String::new() },
            ChannelResult { channel: Channel::Sound, success: visual == VisualMode::None, message: "sound result".into() },
        ];
        let settled = harness.engine.settle_reminder(&event.id, event.generation, &results, None);
        assert_eq!(settled.snapshot.latest_reminder_result.unwrap().outcome, ReminderOutcome::Automatic);
        assert!(harness.engine.get_snapshot().warnings.iter().any(|warning| warning.contains("提醒失败")));
        harness.run(10, |_| {});
        assert!(harness.engine.settle_reminder(&event.id, event.generation, &results, None).effects.is_empty());
        assert_eq!(harness.engine.get_snapshot().elapsed_active_ms, 10_000);
        assert_eq!(harness.engine.get_snapshot().rest_confirmed_count, 0);
    }
}

#[test]
fn timer_changes_await_immutable_live_reminder_completion_while_theme_applies_immediately() {
    let mut settings = minute_settings(TimerMode::Active);
    settings.reminder.visual = VisualMode::Mask;
    let mut harness = Harness::new(settings.clone());
    harness.run(20, |_| {});

    let mut appearance = settings.clone();
    appearance.appearance.theme = crate::contracts::ThemePreference::Dark;
    appearance.appearance.show_tray_countdown = false;
    assert_eq!(harness.engine.update_settings(appearance.clone(), 1, None).snapshot.elapsed_active_ms, 20_000);

    let event = assert_presents(&harness.engine.remind_now(None));
    let mut next = appearance;
    next.timer.interval_minutes = 2.0;
    next.reminder.visual = VisualMode::Flash;
    assert_eq!(harness.engine.update_settings(next, 2, None).snapshot.current_reminder_id, Some(event.id.clone()));
    assert!(harness.engine.get_snapshot().status_reason.contains("下一周期"));
    assert_eq!(event.settings.reminder.visual, VisualMode::Mask);
    let skipped = harness.engine.resolve_reminder(&event.id, event.generation, ReminderAction::Skip, None);
    assert_eq!(skipped.snapshot.remaining_ms, Some(120_000));
}

#[test]
fn system_theme_reacts_immediately_and_manual_override_persists() {
    let mut harness = Harness::new(default_settings());
    harness.run(10, |_| {});
    assert_eq!(harness.advance(1_000, |sample| sample.system_theme = Theme::Dark).snapshot.theme, EffectiveTheme::Dark);

    let mut settings = default_settings();
    settings.appearance.theme = crate::contracts::ThemePreference::Light;
    let manual = harness.engine.update_settings(settings.clone(), 1, None);
    assert_eq!(manual.snapshot.theme, EffectiveTheme::Light);
    assert_eq!(manual.snapshot.elapsed_active_ms, 11_000);
    assert!(!manual.snapshot.reduce_motion);

    let reduced = harness.advance(0, |sample| {
        sample.reduce_motion = true;
        sample.reduce_transparency = true;
    });
    assert!(reduced.snapshot.reduce_motion);
    assert!(reduced.snapshot.reduce_transparency);
    assert_eq!(harness.advance(1_000, |sample| sample.system_theme = Theme::Dark).snapshot.theme, EffectiveTheme::Light);

    settings.appearance.theme = crate::contracts::ThemePreference::System;
    assert_eq!(harness.engine.update_settings(settings, 2, None).snapshot.theme, EffectiveTheme::Dark);
    assert_eq!(harness.engine.get_snapshot().elapsed_active_ms, 12_000);
}

#[test]
fn handdrawn_is_independent_of_os_palette_and_preserves_timer_and_event_identity() {
    let mut settings = minute_settings(TimerMode::Active);
    settings.reminder.visual = VisualMode::Mask;
    let mut harness = Harness::new(settings.clone());
    harness.run(20, |_| {});
    let before = harness.engine.get_snapshot();
    settings.appearance.theme = crate::contracts::ThemePreference::Handdrawn;
    let switched = harness.engine.update_settings(settings.clone(), 1, None);
    assert_eq!(switched.snapshot.theme, EffectiveTheme::Handdrawn);
    assert_eq!(switched.snapshot.remaining_ms, before.remaining_ms);
    assert_eq!(switched.snapshot.elapsed_active_ms, before.elapsed_active_ms);
    assert!(switched.effects.is_empty());
    let sampled = harness.advance(1_000, |sample| sample.system_theme = Theme::Dark);
    assert_eq!(sampled.snapshot.theme, EffectiveTheme::Handdrawn);
    assert_eq!(sampled.snapshot.elapsed_active_ms, 21_000);
    let event = assert_presents(&harness.engine.remind_now(None));
    settings.appearance.theme = crate::contracts::ThemePreference::Light;
    let changed = harness.engine.update_settings(settings.clone(), 2, None);
    assert_eq!(changed.snapshot.current_reminder_id.as_deref(), Some(event.id.as_str()));
    assert!(changed.effects.is_empty());
    assert_eq!(harness.engine.reminder.as_ref().unwrap(), &event);
    assert_eq!(event.settings.appearance.theme, crate::contracts::ThemePreference::Handdrawn);
    settings.appearance.theme = crate::contracts::ThemePreference::Handdrawn;
    let again = harness.engine.update_settings(settings, 3, None);
    assert_eq!(again.snapshot.current_reminder_id.as_deref(), Some(event.id.as_str()));
    assert!(again.effects.is_empty());
    assert_eq!(harness.engine.reminder.as_ref().unwrap().generation, event.generation);
}
