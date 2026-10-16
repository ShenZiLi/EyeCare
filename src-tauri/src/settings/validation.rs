//! `app/shared/settings-validation.ts` 与 `app/main/settings/legacy-validation.ts` 的 Rust 移植。
//!
//! 两个校验器都是「信任边界」：前端自动保存、预览与磁盘读取共用同一套规则。
//! 未知字段、类型不符、越界取值都会被逐项标注在 `AppError.fields` 里，
//! 而不是被静默纠正或截断。

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::contracts::{AppError, CommandResult, SettingsV1, SettingsV2};

/// V2 顶层字段白名单。
const V2_TOP_KEYS: [&str; 5] = ["schemaVersion", "timer", "reminder", "appearance", "general"];

/// V2 分组字段白名单，顺序与 TS 的 `shape` 一致。
const V2_SHAPE: [(&str, &[&str]); 4] = [
    ("timer", &["mode", "intervalMinutes", "longIdleMinutes"]),
    ("reminder", &["visual", "soundEnabled"]),
    ("appearance", &["theme", "showTrayCountdown"]),
    ("general", &["launchAtLogin"]),
];

/// V1 分组字段白名单，顺序与 TS 的 `shape` 一致。
const V1_SHAPE: [(&str, &[&str]); 4] = [
    ("timer", &["mode", "intervalMinutes", "activitySource", "activeWindowSeconds", "longIdleMinutes"]),
    (
        "reminder",
        &[
            "visual",
            "soundEnabled",
            "soundId",
            "volumePercent",
            "flashOpacityPercent",
            "flashColor",
            "fadeInMs",
            "holdMs",
            "fadeOutMs",
            "snoozeMinutes",
            "screenScope",
            "screenIds",
            "message",
        ],
    ),
    ("appearance", &["theme", "showTrayCountdown", "reduceMotion", "reduceTransparency"]),
    ("general", &["launchAtLogin"]),
];

/// 定时模式候选值。
const MODES: [&str; 2] = ["active", "fixed"];
/// 视觉提醒候选值。
const VISUALS: [&str; 4] = ["flash", "mask", "notification", "none"];
/// 主题候选值。
const THEMES: [&str; 3] = ["system", "light", "dark"];

/// 构造 V2 校验失败结果。
fn fail_v2(fields: BTreeMap<String, String>, code: &str) -> CommandResult<SettingsV2> {
    CommandResult::failure(AppError {
        code: code.into(),
        message: "请检查设置中的标记项".into(),
        fields: Some(fields),
        current_revision: None,
    })
}

/// 构造 V1 校验失败结果。
fn fail_v1(fields: BTreeMap<String, String>, code: &str) -> CommandResult<SettingsV1> {
    CommandResult::failure(AppError {
        code: code.into(),
        message: "请检查设置中的标记项".into(),
        fields: Some(fields),
        current_revision: None,
    })
}

/// 取嵌套分组的某个字段；分组缺失或不是对象时返回 `None`。
fn group_value<'a>(object: &'a Map<String, Value>, section: &str, key: &str) -> Option<&'a Value> {
    object.get(section).and_then(Value::as_object).and_then(|group| group.get(key))
}

/// 枚举型字段校验，对应 TS 的 `member`。
fn member(fields: &mut BTreeMap<String, String>, path: &str, candidate: Option<&Value>, choices: &[&str]) {
    let valid = candidate.and_then(Value::as_str).is_some_and(|value| choices.contains(&value));
    if !valid {
        fields.insert(path.into(), "请选择有效选项".into());
    }
}

/// 开关型字段校验，对应 TS 的 `boolean`。
fn boolean(fields: &mut BTreeMap<String, String>, path: &str, candidate: Option<&Value>) {
    if !matches!(candidate, Some(Value::Bool(_))) {
        fields.insert(path.into(), "必须为开关值".into());
    }
}

/// 是否为闭区间内的整数；对齐 JS `Number.isInteger`，因此 `30.0` 也是合法整数。
fn is_integer_in_range(candidate: Option<&Value>, min: i64, max: i64) -> bool {
    candidate.and_then(Value::as_f64).is_some_and(|value| {
        value.is_finite() && value.fract() == 0.0 && value >= min as f64 && value <= max as f64
    })
}

/// V2 整数校验：文案固定为 `1–max`。
fn integer_v2(fields: &mut BTreeMap<String, String>, path: &str, candidate: Option<&Value>, max: i64) {
    if !is_integer_in_range(candidate, 1, max) {
        fields.insert(path.into(), format!("请输入 1–{max} 范围内的整数"));
    }
}

/// V1 整数校验：文案带上下界。
fn integer_v1(fields: &mut BTreeMap<String, String>, path: &str, candidate: Option<&Value>, min: i64, max: i64) {
    if !is_integer_in_range(candidate, min, max) {
        fields.insert(path.into(), format!("请输入 {min}–{max} 范围内的整数"));
    }
}

/// 逐层校验顶层与分组字段，返回结构性问题清单。
fn check_shape(value: &Value, top_keys: &[&str], shape: &[(&str, &[&str])], expected_version: f64) -> BTreeMap<String, String> {
    let mut fields = BTreeMap::new();
    let Some(object) = value.as_object() else {
        // 非对象没有可标注的字段，直接返回空的清单交由调用方判定失败。
        return fields;
    };
    for key in object.keys() {
        if !top_keys.contains(&key.as_str()) {
            fields.insert(key.clone(), "不支持的设置字段".into());
        }
    }
    if object.get("schemaVersion").and_then(Value::as_f64) != Some(expected_version) {
        fields.insert("schemaVersion".into(), format!("设置版本必须为 {}", expected_version as i64));
    }
    for &(section, keys) in shape {
        match object.get(section).and_then(Value::as_object) {
            None => {
                fields.insert(section.into(), "设置分组无效".into());
            }
            Some(group) => {
                for key in group.keys() {
                    if !keys.contains(&key.as_str()) {
                        fields.insert(format!("{section}.{key}"), "不支持的设置字段".into());
                    }
                }
                for key in keys.iter().copied() {
                    if !group.contains_key(key) {
                        fields.insert(format!("{section}.{key}"), "此项必填".into());
                    }
                }
            }
        }
    }
    fields
}

/// 校验一份 V2 设置，对应 TS 的 `validateSettings`。
pub fn validate_settings(value: &Value) -> CommandResult<SettingsV2> {
    let mut fields = check_shape(value, &V2_TOP_KEYS, &V2_SHAPE, 2.0);
    let Some(object) = value.as_object() else {
        return fail_v2(fields, "INVALID_SETTINGS");
    };
    if !fields.is_empty() {
        return fail_v2(fields, "INVALID_SETTINGS");
    }

    member(&mut fields, "timer.mode", group_value(object, "timer", "mode"), &MODES);
    integer_v2(&mut fields, "timer.intervalMinutes", group_value(object, "timer", "intervalMinutes"), 240);
    integer_v2(&mut fields, "timer.longIdleMinutes", group_value(object, "timer", "longIdleMinutes"), 120);
    member(&mut fields, "reminder.visual", group_value(object, "reminder", "visual"), &VISUALS);
    boolean(&mut fields, "reminder.soundEnabled", group_value(object, "reminder", "soundEnabled"));
    member(&mut fields, "appearance.theme", group_value(object, "appearance", "theme"), &THEMES);
    boolean(&mut fields, "appearance.showTrayCountdown", group_value(object, "appearance", "showTrayCountdown"));
    boolean(&mut fields, "general.launchAtLogin", group_value(object, "general", "launchAtLogin"));
    if !fields.is_empty() {
        return fail_v2(fields, "INVALID_SETTINGS");
    }

    let visual = group_value(object, "reminder", "visual").and_then(Value::as_str).unwrap_or_default();
    let sound = group_value(object, "reminder", "soundEnabled").and_then(Value::as_bool).unwrap_or(false);
    if visual == "none" && !sound {
        fields.insert("reminder.soundEnabled".into(), "至少启用一种提醒方式".into());
        return fail_v2(fields, "NO_REMINDER_CHANNEL");
    }

    match serde_json::from_value::<SettingsV2>(value.clone()) {
        Ok(settings) => CommandResult::success(settings),
        Err(_) => fail_v2(BTreeMap::new(), "INVALID_SETTINGS"),
    }
}

/// 六位十六进制颜色或主题派生值。
fn valid_flash_color(value: &str) -> bool {
    value == "theme-derived"
        || (value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit()))
}

/// 屏幕标识必须是非空、去重且不超过 256 个 UTF-16 单元的字符串数组。
fn valid_screen_ids(value: Option<&Value>) -> bool {
    let Some(items) = value.and_then(Value::as_array) else {
        return false;
    };
    let mut seen = std::collections::BTreeSet::new();
    items.iter().all(|item| {
        let Some(id) = item.as_str() else {
            return false;
        };
        !id.trim().is_empty() && id.encode_utf16().count() <= 256 && seen.insert(id)
    })
}

/// 提醒文案：去空白后非空、最多 200 个 UTF-16 单元、不含控制字符。
fn valid_message(value: Option<&Value>) -> bool {
    let Some(message) = value.and_then(Value::as_str) else {
        return false;
    };
    !message.trim().is_empty()
        && message.encode_utf16().count() <= 200
        && !message.chars().any(|character| matches!(character, '\u{0000}'..='\u{001f}' | '\u{007f}'))
}

/// 校验一份 V1 设置（仅用于迁移读取），对应 TS 的 `validateLegacySettings`。
pub fn validate_legacy_settings(value: &Value) -> CommandResult<SettingsV1> {
    let mut fields = check_shape(value, &V2_TOP_KEYS, &V1_SHAPE, 1.0);
    let Some(object) = value.as_object() else {
        return fail_v1(fields, "INVALID_SETTINGS");
    };
    if !fields.is_empty() {
        return fail_v1(fields, "INVALID_SETTINGS");
    }

    member(&mut fields, "timer.mode", group_value(object, "timer", "mode"), &MODES);
    member(&mut fields, "timer.activitySource", group_value(object, "timer", "activitySource"), &["combined", "mouse"]);
    integer_v1(&mut fields, "timer.intervalMinutes", group_value(object, "timer", "intervalMinutes"), 1, 240);
    integer_v1(&mut fields, "timer.activeWindowSeconds", group_value(object, "timer", "activeWindowSeconds"), 5, 300);
    integer_v1(&mut fields, "timer.longIdleMinutes", group_value(object, "timer", "longIdleMinutes"), 1, 120);
    member(&mut fields, "reminder.visual", group_value(object, "reminder", "visual"), &VISUALS);
    boolean(&mut fields, "reminder.soundEnabled", group_value(object, "reminder", "soundEnabled"));
    member(&mut fields, "reminder.soundId", group_value(object, "reminder", "soundId"), &["gentle", "bell"]);
    integer_v1(&mut fields, "reminder.volumePercent", group_value(object, "reminder", "volumePercent"), 0, 100);
    integer_v1(&mut fields, "reminder.flashOpacityPercent", group_value(object, "reminder", "flashOpacityPercent"), 5, 80);
    let color = group_value(object, "reminder", "flashColor").and_then(Value::as_str).unwrap_or_default();
    if !valid_flash_color(color) {
        fields.insert("reminder.flashColor".into(), "请输入六位十六进制颜色".into());
    }
    integer_v1(&mut fields, "reminder.fadeInMs", group_value(object, "reminder", "fadeInMs"), 100, 5000);
    integer_v1(&mut fields, "reminder.holdMs", group_value(object, "reminder", "holdMs"), 0, 10000);
    integer_v1(&mut fields, "reminder.fadeOutMs", group_value(object, "reminder", "fadeOutMs"), 100, 5000);
    integer_v1(&mut fields, "reminder.snoozeMinutes", group_value(object, "reminder", "snoozeMinutes"), 1, 60);
    member(&mut fields, "reminder.screenScope", group_value(object, "reminder", "screenScope"), &["all", "primary", "selected"]);
    if !valid_screen_ids(group_value(object, "reminder", "screenIds")) {
        fields.insert("reminder.screenIds".into(), "屏幕标识必须有效且不重复".into());
    }
    if !valid_message(group_value(object, "reminder", "message")) {
        fields.insert("reminder.message".into(), "请输入最多 200 字的单行提醒".into());
    }
    member(&mut fields, "appearance.theme", group_value(object, "appearance", "theme"), &THEMES);
    boolean(&mut fields, "appearance.showTrayCountdown", group_value(object, "appearance", "showTrayCountdown"));
    member(&mut fields, "appearance.reduceMotion", group_value(object, "appearance", "reduceMotion"), &["system", "on"]);
    member(&mut fields, "appearance.reduceTransparency", group_value(object, "appearance", "reduceTransparency"), &["system", "on"]);
    boolean(&mut fields, "general.launchAtLogin", group_value(object, "general", "launchAtLogin"));
    if !fields.is_empty() {
        return fail_v1(fields, "INVALID_SETTINGS");
    }

    let number = |section: &str, key: &str| group_value(object, section, key).and_then(Value::as_f64).unwrap_or(0.0);
    if number("timer", "longIdleMinutes") * 60.0 < number("timer", "activeWindowSeconds") {
        fields.insert("timer.longIdleMinutes".into(), "长空闲阈值不能小于活动窗口".into());
        return fail_v1(fields, "INVALID_IDLE_WINDOW");
    }
    let visual = group_value(object, "reminder", "visual").and_then(Value::as_str).unwrap_or_default();
    let sound = group_value(object, "reminder", "soundEnabled").and_then(Value::as_bool).unwrap_or(false);
    if visual == "none" && (!sound || number("reminder", "volumePercent") == 0.0) {
        fields.insert("reminder.soundEnabled".into(), "至少启用一种有效提醒".into());
        return fail_v1(fields, "NO_REMINDER_CHANNEL");
    }
    let scope = group_value(object, "reminder", "screenScope").and_then(Value::as_str).unwrap_or_default();
    let selected = group_value(object, "reminder", "screenIds").and_then(Value::as_array).map_or(0, Vec::len);
    if scope == "selected" && selected == 0 {
        fields.insert("reminder.screenIds".into(), "旧屏幕选择无效".into());
        return fail_v1(fields, "INVALID_SCREEN_SELECTION");
    }

    match serde_json::from_value::<SettingsV1>(value.clone()) {
        Ok(mut settings) => {
            settings.reminder.message = settings.reminder.message.trim().to_string();
            CommandResult::success(settings)
        }
        Err(_) => fail_v1(BTreeMap::new(), "INVALID_SETTINGS"),
    }
}
