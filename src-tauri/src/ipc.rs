//! `app/main/ipc-validation.ts` 的 Rust 移植。
//!
//! Tauri 以「具名参数」绑定 IPC 载荷：命令签名里的 `Option<Value>` 表达
//! 「字段必须存在」，任何类型不符的输入都会被收敛为可返回的校验失败，
//! 而不是把异常抛回 WebView。因此 TS 里 `emptyPayload` / `payload` 的白名单
//! 语义，在这里由「参数集合」加下面的显式校验共同表达；嵌套结构
//! （`results` 数组）仍按 TS 的逐字段白名单校验。

use serde_json::Value;

use crate::contracts::{AppError, Channel, ChannelResult, ReminderAction};

/// JS `Number.isSafeInteger` 的上界（2^53 − 1）。
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// 构造统一的操作参数错误。
pub fn invalid(message: &str) -> AppError {
    AppError::new("INVALID_COMMAND", message)
}

/// 取出一个必填的传参字段；缺失即视为载荷不匹配。
pub fn required<'a>(value: &'a Option<Value>, message: &str) -> Result<&'a Value, AppError> {
    value.as_ref().ok_or_else(|| invalid(message))
}

/// 非负的安全整数版本号，对应 JS 的 `Number.isSafeInteger` 判定。
pub fn safe_revision(value: &Option<Value>) -> Option<i64> {
    value
        .as_ref()
        .and_then(Value::as_f64)
        .filter(|revision| {
            revision.is_finite() && revision.fract() == 0.0 && *revision >= 0.0 && *revision <= MAX_SAFE_INTEGER
        })
        .map(|revision| revision as i64)
}

/// 提醒标识：非空、不超过 100 个 UTF-16 单元的字符串 + 非负的安全整数代号。
pub fn identity(id: &Option<Value>, generation: &Option<Value>) -> Result<(String, u64), AppError> {
    let valid_id = id
        .as_ref()
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.encode_utf16().count() <= 100);
    let valid_generation = generation
        .as_ref()
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && value.fract() == 0.0 && *value >= 0.0 && *value <= MAX_SAFE_INTEGER);
    match (valid_id, valid_generation) {
        (Some(id), Some(generation)) => Ok((id.to_string(), generation as u64)),
        _ => Err(invalid("提醒标识无效")),
    }
}

/// 提醒动作：仅接受 `acknowledge` / `skip`。
pub fn reminder_action(value: &Option<Value>) -> Result<ReminderAction, AppError> {
    match value.as_ref().and_then(Value::as_str) {
        Some("acknowledge") => Ok(ReminderAction::Acknowledge),
        Some("skip") => Ok(ReminderAction::Skip),
        _ => Err(invalid("未知的提醒操作")),
    }
}

/// 通道结果数组：长度为 1–2、字段白名单 `channel`/`success`/`message`、通道不重复。
pub fn channel_results(value: &Option<Value>) -> Result<Vec<ChannelResult>, AppError> {
    let items = value
        .as_ref()
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty() && items.len() <= 2)
        .ok_or_else(|| invalid("无效的提醒结果"))?;
    let mut results: Vec<ChannelResult> = Vec::with_capacity(items.len());
    for item in items {
        let object = item.as_object().ok_or_else(|| invalid("无效的通道结果"))?;
        if object.len() != 3 || object.keys().any(|key| !matches!(key.as_str(), "channel" | "success" | "message")) {
            return Err(invalid("无效的通道结果"));
        }
        let channel = match object.get("channel").and_then(Value::as_str) {
            Some("visual") => Channel::Visual,
            Some("sound") => Channel::Sound,
            _ => return Err(invalid("无效的通道结果")),
        };
        let success = object.get("success").and_then(Value::as_bool).ok_or_else(|| invalid("无效的通道结果"))?;
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .filter(|text| text.encode_utf16().count() <= 300)
            .ok_or_else(|| invalid("无效的通道结果"))?;
        if results.iter().any(|result| result.channel == channel) {
            return Err(invalid("提醒通道不能重复"));
        }
        results.push(ChannelResult { channel, success, message: message.to_string() });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identity_accepts_valid_pair() {
        let pair = identity(&Some(json!("id-1")), &Some(json!(3))).unwrap();
        assert_eq!(pair, ("id-1".to_string(), 3));
    }

    #[test]
    fn identity_rejects_empty_or_oversized_id() {
        assert!(identity(&Some(json!("")), &Some(json!(0))).is_err());
        assert!(identity(&Some(json!("x".repeat(101))), &Some(json!(0))).is_err());
    }

    #[test]
    fn identity_rejects_negative_or_fractional_generation() {
        assert!(identity(&Some(json!("id-1")), &Some(json!(-1))).is_err());
        assert!(identity(&Some(json!("id-1")), &Some(json!(1.5))).is_err());
    }

    #[test]
    fn action_accepts_only_known_values() {
        assert_eq!(reminder_action(&Some(json!("acknowledge"))).unwrap(), ReminderAction::Acknowledge);
        assert_eq!(reminder_action(&Some(json!("skip"))).unwrap(), ReminderAction::Skip);
        assert!(reminder_action(&Some(json!("later"))).is_err());
    }

    #[test]
    fn channel_results_enforces_shape_and_uniqueness() {
        let valid = channel_results(&Some(json!([{ "channel": "visual", "success": true, "message": "ok" }]))).unwrap();
        assert_eq!(valid.len(), 1);
        let duplicate = channel_results(&Some(json!([
            { "channel": "visual", "success": true, "message": "ok" },
            { "channel": "visual", "success": false, "message": "no" }
        ])));
        assert!(duplicate.is_err());
        let extra = channel_results(&Some(json!([{ "channel": "visual", "success": true, "message": "ok", "extra": 1 }])));
        assert!(extra.is_err());
        assert!(channel_results(&Some(json!([]))).is_err());
    }

    #[test]
    fn safe_revision_matches_js_safe_integer() {
        assert_eq!(safe_revision(&Some(json!(0))), Some(0));
        assert_eq!(safe_revision(&Some(json!(1.0))), Some(1));
        assert_eq!(safe_revision(&Some(json!(-1))), None);
        assert_eq!(safe_revision(&Some(json!(1.5))), None);
        assert_eq!(safe_revision(&None), None);
    }
}
