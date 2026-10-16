//! `tests/integration/settings-store.test.ts` 与 `tests/unit/settings-validation.test.ts` 的移植。
//!
//! 与 TS 版共用同一组输入向量，作为 Rust 侧设置持久化正确性的判据。

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::migrate_legacy_directory;
use super::save::{SettingsWriter, save_with_login};
use super::store::{SettingsStore, Stored};
use super::validation::{validate_legacy_settings, validate_settings};
use crate::autostart::LoginChange;
use crate::contracts::{
    AppError, AppearanceSettings, CommandResult, GeneralSettings, ReminderSettings, SettingsV2, ThemePreference,
    TimerMode, TimerSettings, VisualMode, default_settings, resolve_settings,
};

/// 每个用例独立的临时目录，离开作用域即清理。
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let name = format!("eyecare-settings-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
        let path = std::env::temp_dir().join(name);
        fs::create_dir_all(&path).expect("创建临时目录");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// 一份自定义过的 V1 设置，字段取值与 TS 测试的 `legacy()` 一致。
fn legacy_value() -> Value {
    json!({
        "schemaVersion": 1,
        "timer": { "mode": "fixed", "intervalMinutes": 42, "longIdleMinutes": 3, "activeWindowSeconds": 120, "activitySource": "mouse" },
        "reminder": {
            "visual": "mask", "soundEnabled": true, "soundId": "bell", "volumePercent": 77,
            "flashOpacityPercent": 60, "flashColor": "#aabbcc", "fadeInMs": 200, "holdMs": 1000,
            "fadeOutMs": 300, "snoozeMinutes": 2, "screenScope": "selected", "screenIds": ["external"],
            "message": "A customized legacy message"
        },
        "appearance": { "theme": "dark", "showTrayCountdown": false, "reduceMotion": "on", "reduceTransparency": "on" },
        "general": { "launchAtLogin": false }
    })
}

/// 与 `legacy()` 对应的 V2 迁移结果。
fn migrated_legacy() -> SettingsV2 {
    SettingsV2 {
        schema_version: 2,
        timer: TimerSettings { mode: TimerMode::Fixed, interval_minutes: 42.0, long_idle_minutes: 3.0 },
        reminder: ReminderSettings { visual: VisualMode::Mask, sound_enabled: true },
        appearance: AppearanceSettings { theme: ThemePreference::Dark, show_tray_countdown: false },
        general: GeneralSettings { launch_at_login: false },
    }
}

fn default_value() -> Value {
    serde_json::to_value(default_settings()).expect("序列化默认设置")
}

fn write(path: &Path, contents: &str) {
    fs::write(path, contents).expect("写入测试文件");
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).expect("读取测试文件")
}

#[test]
fn atomically_saves_settings_and_persists_revisions() {
    let dir = TempDir::new();
    let mut store = SettingsStore::new(dir.path());
    assert_eq!(store.load().settings, default_settings());

    let mut settings = default_settings();
    settings.appearance.theme = ThemePreference::Dark;
    let saved = store.save(0, &serde_json::to_value(&settings).unwrap());
    assert!(saved.ok);
    assert_eq!(saved.value.unwrap().revision, 1);

    let mut reopened = SettingsStore::new(dir.path());
    let loaded = reopened.load();
    assert_eq!(loaded.settings.appearance.theme, ThemePreference::Dark);
    assert_eq!(loaded.revision, 1);

    // 信封字段的磁盘顺序与 TS 写出的 `{ settings, revision }` 一致，
    // Electron 侧 `JSON.parse` 后仍是 `['settings', 'revision']`。
    let raw = read(&dir.path().join("settings.json"));
    assert!(raw.find("\"settings\"").unwrap() < raw.find("\"revision\"").unwrap());
    let stored: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(stored["revision"], json!(1));
}

#[test]
fn rejects_a_stale_revision_after_a_successful_save() {
    let dir = TempDir::new();
    let mut store = SettingsStore::new(dir.path());
    store.load();
    let settings = default_value();
    assert!(store.save(0, &settings).ok);
    let conflict = store.save(0, &settings);
    assert!(!conflict.ok);
    let error = conflict.error.unwrap();
    assert_eq!(error.code, "SETTINGS_CONFLICT");
    assert_eq!(error.current_revision, Some(1));
}

#[test]
fn never_writes_malformed_settings_or_moves_the_effective_revision() {
    let dir = TempDir::new();
    let mut store = SettingsStore::new(dir.path());
    store.load();
    let settings = default_value();
    store.save(0, &settings);
    let path = dir.path().join("settings.json");
    let before = read(&path);

    let mut invalid = default_value();
    invalid["schemaVersion"] = json!(3);
    assert!(!store.save(1, &invalid).ok);
    assert_eq!(read(&path), before);
    assert_eq!(store.save(1, &settings).value.unwrap().revision, 2);
}

#[test]
fn recovers_last_good_settings_then_falls_back_to_defaults() {
    let dir = TempDir::new();
    let mut store = SettingsStore::new(dir.path());
    store.load();

    let mut first = default_settings();
    first.appearance.theme = ThemePreference::Dark;
    store.save(0, &serde_json::to_value(&first).unwrap());
    let mut second = default_settings();
    second.timer.interval_minutes = 12.0;
    store.save(1, &serde_json::to_value(&second).unwrap());

    write(&dir.path().join("settings.json"), "{ broken");
    let mut recovered = SettingsStore::new(dir.path());
    let loaded = recovered.load();
    assert_eq!(loaded.settings.appearance.theme, ThemePreference::Dark);
    assert_eq!(loaded.revision, 1);
    assert!(!loaded.warnings.is_empty());

    write(&dir.path().join("settings.last-good.json"), "bad");
    let mut reset = SettingsStore::new(dir.path());
    let reset_loaded = reset.load();
    assert_eq!(reset_loaded.settings, default_settings());
    assert!(!reset_loaded.warnings.is_empty());
}

#[test]
fn retains_effective_state_after_a_real_write_failure_and_allows_retry() {
    let dir = TempDir::new();
    let blocked = dir.path().join("not-a-directory");
    write(&blocked, "file");
    let mut store = SettingsStore::new(blocked);
    store.load();
    let settings = default_value();
    assert_eq!(store.save(0, &settings).error.unwrap().code, "SETTINGS_WRITE_FAILED");
    assert_eq!(store.save(0, &settings).error.unwrap().code, "SETTINGS_WRITE_FAILED");
}

#[test]
fn upgrades_customized_v1_and_retains_exact_original_backup_bytes() {
    let dir = TempDir::new();
    let original = format!("{}\n", serde_json::to_string_pretty(&json!({ "revision": 17, "settings": legacy_value() })).unwrap());
    write(&dir.path().join("settings.json"), &original);

    let mut store = SettingsStore::new(dir.path());
    let loaded = store.load();
    assert!(loaded.warnings.is_empty());
    assert_eq!(loaded.revision, 17);
    assert_eq!(loaded.settings, migrated_legacy());
    assert_eq!(read(&dir.path().join("settings.v1-backup.json")), original);

    let stored: Value = serde_json::from_str(&read(&dir.path().join("settings.json"))).unwrap();
    assert_eq!(stored["revision"], json!(17));
    assert_eq!(stored["settings"], serde_json::to_value(&loaded.settings).unwrap());

    let resolved = resolve_settings(&loaded.settings);
    assert_eq!(resolved.reminder.volume_percent, 50.0);
    assert_eq!(resolved.reminder.sound_id, "gentle");
    assert_eq!(resolved.reminder.screen_scope, "all");
    assert_eq!(resolved.reminder.message, "该让眼睛休息一下了");

    let mut reopened = SettingsStore::new(dir.path());
    reopened.load();
    reopened.save(17, &default_value());
    assert_eq!(read(&dir.path().join("settings.v1-backup.json")), original);
}

#[test]
fn preserves_the_first_legacy_backup_and_upgrades_last_good_v1() {
    let dir = TempDir::new();
    let first = serde_json::to_string(&json!({ "settings": legacy_value(), "revision": 7 })).unwrap();
    write(&dir.path().join("settings.json"), &first);
    SettingsStore::new(dir.path()).load();

    let mut last_good = legacy_value();
    last_good["timer"]["intervalMinutes"] = json!(21);
    write(&dir.path().join("settings.json"), "broken");
    write(
        &dir.path().join("settings.last-good.json"),
        &serde_json::to_string(&json!({ "settings": last_good, "revision": 8 })).unwrap(),
    );

    let mut store = SettingsStore::new(dir.path());
    let recovered = store.load();
    assert_eq!(recovered.settings.timer.interval_minutes, 21.0);
    assert_eq!(recovered.revision, 8);
    assert!(recovered.warnings.iter().any(|warning| warning == "已恢复最后有效设置备份"));
    assert_eq!(read(&dir.path().join("settings.v1-backup.json")), first);
    assert_eq!(SettingsStore::new(dir.path()).load().settings.schema_version, 2);
}

#[test]
fn preserves_the_original_when_the_migration_backup_cannot_be_published() {
    for retry in ["save", "restart"] {
        let dir = TempDir::new();
        let original = serde_json::to_string(&json!({ "settings": legacy_value(), "revision": 3 })).unwrap();
        let path = dir.path().join("settings.json");
        let backup = dir.path().join("settings.v1-backup.json");
        write(&path, &original);
        fs::create_dir_all(&backup).unwrap();

        let mut store = SettingsStore::new(dir.path());
        let loaded = store.load();
        assert_eq!(loaded.settings.schema_version, 2);
        assert!(loaded.warnings.iter().any(|warning| warning.contains("升级未能写入")));
        assert_eq!(read(&path), original);
        assert_eq!(store.save(3, &default_value()).error.unwrap().code, "SETTINGS_WRITE_FAILED");
        assert_eq!(read(&path), original);

        fs::remove_dir_all(&backup).unwrap();
        if retry == "save" {
            assert_eq!(store.save(3, &default_value()).value.unwrap().revision, 4);
        } else {
            assert!(SettingsStore::new(dir.path()).load().warnings.is_empty());
        }
        assert_eq!(read(&backup), original);
        let stored: Value = serde_json::from_str(&read(&path)).unwrap();
        assert_eq!(stored["settings"]["schemaVersion"], json!(2));
    }
}

#[test]
fn preserves_the_original_when_atomic_replacement_fails_after_the_backup_was_published() {
    let dir = TempDir::new();
    let original = serde_json::to_string(&json!({ "settings": legacy_value(), "revision": 6 })).unwrap();
    let path = dir.path().join("settings.json");
    let backup = dir.path().join("settings.v1-backup.json");
    write(&path, &original);
    fs::create_dir_all(dir.path().join("settings.json.tmp")).unwrap();

    let mut store = SettingsStore::new(dir.path());
    let loaded = store.load();
    assert_eq!(loaded.settings.schema_version, 2);
    assert!(loaded.warnings.iter().any(|warning| warning.contains("升级未能写入")));
    assert_eq!(read(&path), original);
    assert_eq!(read(&backup), original);

    fs::remove_dir_all(dir.path().join("settings.json.tmp")).unwrap();
    let saved = store.save(6, &serde_json::to_value(&loaded.settings).unwrap());
    assert!(saved.ok);
    assert_eq!(saved.value.unwrap().revision, 7);
    assert_eq!(read(&backup), original);
    assert_eq!(SettingsStore::new(dir.path()).load().settings, loaded.settings);
}

#[test]
fn strictly_rejects_malformed_legacy_customization_and_unknown_envelope_fields() {
    let dir = TempDir::new();
    let path = dir.path().join("settings.json");
    let backup = dir.path().join("settings.v1-backup.json");

    let mut malformed = legacy_value();
    malformed["reminder"]["flashColor"] = json!("javascript:bad");
    write(&path, &serde_json::to_string(&json!({ "settings": malformed, "revision": 2 })).unwrap());
    assert_eq!(SettingsStore::new(dir.path()).load().settings, default_settings());

    write(&path, &serde_json::to_string(&json!({ "settings": legacy_value(), "revision": 2, "unknown": true })).unwrap());
    assert_eq!(SettingsStore::new(dir.path()).load().settings, default_settings());
    assert!(!backup.exists());
}

#[test]
fn accepts_the_documented_defaults_and_rejects_malformed_v2_payloads() {
    let result = validate_settings(&default_value());
    assert!(result.ok);
    assert_eq!(result.value.unwrap(), default_settings());

    for value in [json!(null), json!([]), json!({}), json!({ "schemaVersion": 3, "timer": {}, "reminder": {}, "appearance": {}, "general": {} })] {
        assert!(!validate_settings(&value).ok, "应拒绝：{value}");
    }
}

#[test]
fn rejects_fractional_out_of_range_and_stringified_timer_values() {
    for interval in [json!(0), json!(241), json!(1.5), json!("30")] {
        let mut settings = default_value();
        settings["timer"]["intervalMinutes"] = interval.clone();
        assert!(!validate_settings(&settings).ok, "应拒绝：{interval}");
    }
    for idle in [json!(0), json!(121), json!(1.5), json!("10")] {
        let mut settings = default_value();
        settings["timer"]["longIdleMinutes"] = idle.clone();
        assert!(!validate_settings(&settings).ok, "应拒绝：{idle}");
    }
}

#[test]
fn requires_a_sound_channel_when_the_visual_is_none() {
    let mut settings = default_settings();
    settings.timer.long_idle_minutes = 1.0;
    assert!(validate_settings(&serde_json::to_value(&settings).unwrap()).ok);

    settings.reminder.visual = VisualMode::None;
    let result = validate_settings(&serde_json::to_value(&settings).unwrap());
    assert!(!result.ok);
    assert_eq!(result.error.unwrap().code, "NO_REMINDER_CHANNEL");

    settings.reminder.sound_enabled = true;
    assert!(validate_settings(&serde_json::to_value(&settings).unwrap()).ok);
}

#[test]
fn legacy_validation_reports_cross_field_violations() {
    let mut too_short = legacy_value();
    too_short["timer"]["longIdleMinutes"] = json!(1);
    too_short["timer"]["activeWindowSeconds"] = json!(300);
    assert_eq!(validate_legacy_settings(&too_short).error.unwrap().code, "INVALID_IDLE_WINDOW");

    let mut silent = legacy_value();
    silent["reminder"]["visual"] = json!("none");
    silent["reminder"]["soundEnabled"] = json!(false);
    assert_eq!(validate_legacy_settings(&silent).error.unwrap().code, "NO_REMINDER_CHANNEL");

    let mut empty_selection = legacy_value();
    empty_selection["reminder"]["screenScope"] = json!("selected");
    empty_selection["reminder"]["screenIds"] = json!([]);
    assert_eq!(validate_legacy_settings(&empty_selection).error.unwrap().code, "INVALID_SCREEN_SELECTION");

    let mut bad_color = legacy_value();
    bad_color["reminder"]["flashColor"] = json!("theme-derived-1");
    assert!(!validate_legacy_settings(&bad_color).ok);

    let mut control_characters = legacy_value();
    control_characters["reminder"]["message"] = json!("bad\u{0007}message");
    assert!(!validate_legacy_settings(&control_characters).ok);
}

#[test]
fn copies_legacy_settings_files_without_overwriting_the_new_directory() {
    let legacy = TempDir::new();
    let root = TempDir::new();
    let target = root.path().join("org.eyecare.desktop");
    write(&legacy.path().join("settings.json"), "{ }");
    write(&legacy.path().join("settings.last-good.json"), "{ }");

    assert!(migrate_legacy_directory(Some(legacy.path()), &target).is_empty());
    assert_eq!(read(&target.join("settings.json")), "{ }");
    assert!(target.join("settings.last-good.json").is_file());
    assert!(!target.join("settings.v1-backup.json").exists());

    write(&target.join("settings.json"), "new");
    assert!(migrate_legacy_directory(Some(legacy.path()), &target).is_empty());
    assert_eq!(read(&target.join("settings.json")), "new");
    assert!(migrate_legacy_directory(None, &target).is_empty());
}

// ——— 保存设置时的登录启动事务（`tests/integration/save-with-login.test.ts` 的移植）———

/// 可脚本化的设置落盘替身；脚本耗尽视为测试自身的问题。
struct FakeWriter {
    results: VecDeque<CommandResult<Stored>>,
    calls: usize,
}

impl FakeWriter {
    fn new(results: Vec<CommandResult<Stored>>) -> Self {
        Self { results: results.into(), calls: 0 }
    }
}

impl SettingsWriter for FakeWriter {
    fn save(&mut self, _expected_revision: i64, _value: &Value) -> CommandResult<Stored> {
        self.calls += 1;
        self.results.pop_front().expect("落盘脚本已耗尽")
    }
}

/// 登录启动事务两个动作的调用记录。
#[derive(Default)]
struct LoginLog {
    applied: usize,
    rolled_back: usize,
}

/// 构造可观测的登录启动事务：`apply` 写入目标状态，`rollback` 恢复捕获到的状态。
fn fake_change(
    actual: Arc<Mutex<bool>>,
    log: Arc<Mutex<LoginLog>>,
    apply_error: Option<String>,
    rollback_error: Option<String>,
    target: bool,
) -> LoginChange {
    let captured = *actual.lock().expect("读取系统状态");
    let (apply_state, rollback_state) = (Arc::clone(&actual), actual);
    let (apply_log, rollback_log) = (Arc::clone(&log), log);
    LoginChange::new(
        move || {
            if let Some(error) = &apply_error {
                return Err(error.clone());
            }
            apply_log.lock().expect("记录应用").applied += 1;
            *apply_state.lock().expect("写入系统状态") = target;
            Ok(())
        },
        move || {
            if let Some(error) = &rollback_error {
                return Err(error.clone());
            }
            rollback_log.lock().expect("记录回滚").rolled_back += 1;
            *rollback_state.lock().expect("恢复系统状态") = captured;
            Ok(())
        },
    )
}

fn stored(settings: SettingsV2) -> CommandResult<Stored> {
    CommandResult::success(Stored { settings, revision: 1 })
}

fn write_failed() -> CommandResult<Stored> {
    CommandResult::failure(AppError::new("SETTINGS_WRITE_FAILED", "disk full"))
}

#[test]
fn refuses_to_touch_disk_or_system_when_the_login_snapshot_is_unavailable() {
    let mut settings = default_settings();
    settings.general.launch_at_login = true;
    let mut store = FakeWriter::new(Vec::new());
    let result = save_with_login(&mut store, 0, &settings, false, |_| Err("read denied".into()));
    assert_eq!(result.error.expect("应有错误").code, "LOGIN_READ_FAILED");
    assert_eq!(store.calls, 0, "读取系统状态失败时不应落盘");
}

#[test]
fn restores_captured_state_when_the_system_rejects_the_change() {
    let mut settings = default_settings();
    settings.general.launch_at_login = true;
    let actual = Arc::new(Mutex::new(false));
    let log = Arc::new(Mutex::new(LoginLog::default()));
    let mut store = FakeWriter::new(Vec::new());
    let (state, record) = (Arc::clone(&actual), Arc::clone(&log));
    let result = save_with_login(&mut store, 0, &settings, false, move |enabled| {
        Ok(fake_change(state, record, Some("OS rejected".into()), None, enabled))
    });
    let error = result.error.expect("应有错误");
    assert_eq!(error.code, "LOGIN_WRITE_FAILED");
    assert_eq!(error.message, "OS rejected");
    assert_eq!(store.calls, 0, "系统拒绝后不应落盘");
    assert_eq!(log.lock().expect("读取记录").rolled_back, 1);
    assert!(!*actual.lock().expect("读取系统状态"), "应恢复捕获到的系统状态");
}

#[test]
fn restores_the_actual_disabled_state_when_the_disk_write_fails() {
    let settings = default_settings();
    let actual = Arc::new(Mutex::new(false));
    let log = Arc::new(Mutex::new(LoginLog::default()));
    let mut store = FakeWriter::new(vec![write_failed()]);
    let (state, record) = (Arc::clone(&actual), Arc::clone(&log));
    let result = save_with_login(&mut store, 0, &settings, true, move |enabled| {
        Ok(fake_change(state, record, None, None, enabled))
    });
    assert_eq!(result.error.expect("应有错误").code, "SETTINGS_WRITE_FAILED");
    assert!(!*actual.lock().expect("读取系统状态"), "应恢复系统真实状态");
}

#[test]
fn rolls_back_and_allows_the_same_revision_to_retry() {
    let mut settings = default_settings();
    settings.general.launch_at_login = true;
    let actual = Arc::new(Mutex::new(false));
    let log = Arc::new(Mutex::new(LoginLog::default()));
    let mut store = FakeWriter::new(vec![write_failed(), stored(settings.clone())]);
    let (state, record) = (Arc::clone(&actual), Arc::clone(&log));
    let first = save_with_login(&mut store, 0, &settings, false, move |enabled| {
        Ok(fake_change(state, record, None, None, enabled))
    });
    assert_eq!(first.error.expect("应有错误").code, "SETTINGS_WRITE_FAILED");
    let (state, record) = (Arc::clone(&actual), Arc::clone(&log));
    let retry = save_with_login(&mut store, 0, &settings, false, move |enabled| {
        Ok(fake_change(state, record, None, None, enabled))
    });
    assert!(retry.ok, "同一版本号重试应成功");
    let log = log.lock().expect("读取记录");
    assert_eq!(log.applied, 2, "两次尝试都应应用");
    assert_eq!(log.rolled_back, 1, "只有失败的那次需要回滚");
}

#[test]
fn reports_a_failed_rollback_instead_of_claiming_restoration() {
    let mut settings = default_settings();
    settings.general.launch_at_login = true;
    let actual = Arc::new(Mutex::new(false));
    let log = Arc::new(Mutex::new(LoginLog::default()));
    let mut store = FakeWriter::new(vec![write_failed()]);
    let (state, record) = (Arc::clone(&actual), Arc::clone(&log));
    let result = save_with_login(&mut store, 0, &settings, false, move |enabled| {
        Ok(fake_change(state, record, None, Some("rollback refused".into()), enabled))
    });
    assert_eq!(result.error.expect("应有错误").code, "LOGIN_ROLLBACK_FAILED");
}

#[test]
fn leaves_the_login_registration_untouched_for_unrelated_saves() {
    let mut settings = default_settings();
    settings.appearance.theme = ThemePreference::Dark;
    settings.appearance.show_tray_countdown = false;
    let mut store = FakeWriter::new(vec![stored(settings.clone())]);
    let prepares = Arc::new(Mutex::new(0usize));
    let counter = Arc::clone(&prepares);
    let result = save_with_login(&mut store, 0, &settings, false, move |_| {
        *counter.lock().expect("记录调用") += 1;
        Err("不应被调用".into())
    });
    assert!(result.ok, "无关设置应正常落盘");
    assert_eq!(*prepares.lock().expect("读取调用次数"), 0);
}
