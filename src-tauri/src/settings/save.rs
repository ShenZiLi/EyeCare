//! `app/main/settings/save-with-login.ts` 的 Rust 移植。
//!
//! 串行命令层完成校验与版本检查后调用这里：把登录启动开关当作一次系统事务，
//! 先读系统真实状态、再应用、再落盘；落盘失败时回滚系统状态。
//! 回滚失败必须如实上报，绝不能谎称已恢复。

use serde_json::Value;

use crate::autostart::LoginChange;
use crate::contracts::{AppError, CommandResult, SettingsV2};

use super::store::{SettingsStore, Stored};

/// 设置落盘的最小接口，方便测试替身与真实仓库共用同一条编排。
pub trait SettingsWriter {
    /// 以乐观并发写入设置。
    fn save(&mut self, expected_revision: i64, value: &Value) -> CommandResult<Stored>;
}

impl SettingsWriter for SettingsStore {
    fn save(&mut self, expected_revision: i64, value: &Value) -> CommandResult<Stored> {
        SettingsStore::save(self, expected_revision, value)
    }
}

/// 保存设置，并把登录启动开关作为一次系统事务处理。
///
/// `prepare_login` 接收目标开关状态，返回已捕获系统真实状态的事务；
/// 只有当新旧开关不同才会调用它。
pub fn save_with_login<W, P>(
    store: &mut W,
    expected_revision: i64,
    settings: &SettingsV2,
    old_login: bool,
    prepare_login: P,
) -> CommandResult<Stored>
where
    W: SettingsWriter,
    P: FnOnce(bool) -> Result<LoginChange, String>,
{
    let new_login = settings.general.launch_at_login;
    let mut change = None;
    if old_login != new_login {
        // 读不到系统真实状态时不能假装设置已生效，也不该动磁盘。
        change = match prepare_login(new_login) {
            Ok(change) => Some(change),
            Err(_) => {
                return CommandResult::failure(AppError::new(
                    "LOGIN_READ_FAILED",
                    "无法读取当前系统登录启动项，设置未生效，请检查系统登录项后重试",
                ));
            }
        };
        if let Err(error) = change.as_mut().expect("刚赋值的登录启动事务").apply() {
            return rollback(&mut change, CommandResult::failure(AppError::new("LOGIN_WRITE_FAILED", error)));
        }
    }
    let value = match serde_json::to_value(settings) {
        Ok(value) => value,
        Err(_) => {
            return rollback(
                &mut change,
                CommandResult::failure(AppError::new("SETTINGS_WRITE_FAILED", "无法保存设置，当前有效设置已保留")),
            );
        }
    };
    let result = store.save(expected_revision, &value);
    if result.ok { result } else { rollback(&mut change, result) }
}

/// 回滚系统登录启动项；回滚失败时以 `LOGIN_ROLLBACK_FAILED` 如实上报。
fn rollback(change: &mut Option<LoginChange>, result: CommandResult<Stored>) -> CommandResult<Stored> {
    let Some(change) = change.as_mut() else {
        return result;
    };
    match change.rollback() {
        Ok(()) => result,
        Err(_) => CommandResult::failure(AppError::new(
            "LOGIN_ROLLBACK_FAILED",
            "设置未生效，且系统登录启动项未能恢复，请检查系统登录项后重试",
        )),
    }
}
