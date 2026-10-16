//! 设置持久化与自启相关代码的归属模块，对应 `app/main/settings/*`。

pub mod store;
pub mod validation;

#[cfg(test)]
mod tests;

pub use store::{LoadedSettings, SettingsStore, Stored};

use std::fs;
use std::path::Path;

/// 旧 Electron 数据目录名（`app.getPath('userData')` 的最后一段）。
pub const LEGACY_DIRECTORY_NAME: &str = "EyeCare";

/// 需要做兼容迁移的三份设置文件。
pub const SETTINGS_FILENAMES: [&str; 3] = ["settings.json", "settings.last-good.json", "settings.v1-backup.json"];

/// 逐文件把旧 Electron 数据目录里的设置补进新的 Tauri 数据目录。
///
/// Electron 的 `app.getPath('userData')` 是 `~/Library/Application Support/EyeCare`，
/// 而 Tauri 的 `app_data_dir()` 以 bundle identifier 结尾，两者并不相同；
/// 逐文件判断使搬运可重入——中途失败后再次启动会补齐缺失文件，
/// 源文件始终保留，失败只上报 warning，绝不阻塞启动。
pub fn migrate_legacy_directory(legacy: Option<&Path>, target: &Path) -> Vec<String> {
    let mut warnings = Vec::new();
    let Some(legacy) = legacy else {
        return warnings;
    };
    if !legacy.is_dir() {
        return warnings;
    }
    if let Err(error) = fs::create_dir_all(target) {
        warnings.push(format!("无法创建新的设置目录，已沿用原目录：{error}"));
        return warnings;
    }
    for name in SETTINGS_FILENAMES {
        let source = legacy.join(name);
        let destination = target.join(name);
        if !source.is_file() || destination.exists() {
            continue;
        }
        if let Err(error) = fs::copy(&source, &destination) {
            warnings.push(format!("旧设置文件迁移失败，原文件已保留：{name}（{error}）"));
        }
    }
    warnings
}
