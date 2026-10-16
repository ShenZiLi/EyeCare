//! `app/main/settings/settings-store.ts` 的 Rust 移植。
//!
//! 三份文件的职责与 TS 版一致：`settings.json` 是当前有效设置，
//! `settings.last-good.json` 是上一个有效版本，`settings.v1-backup.json`
//! 是 V1 原始字节的只读留档（写入后永不覆盖）。
//!
//! TS 版用一个内部 promise 队列串行化写入；Rust 侧由调用方持有的
//! `Mutex<SettingsStore>` 提供同样的「同一时刻只有一次写入」保证，
//! 因此 `save` 直接以 `&mut self` 表达该约束。

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::contracts::{
    default_settings, AppearanceSettings, AppError, CommandResult, GeneralSettings, ReminderSettings, SettingsV1,
    SettingsV2, TimerSettings,
};

use super::validation::{validate_legacy_settings, validate_settings};

/// 磁盘信封：设置内容 + 乐观并发版本号。字段顺序与 TS 写出的 JSON 一致。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stored {
    pub settings: SettingsV2,
    pub revision: i64,
}

/// 一次加载的结果。
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedSettings {
    pub settings: SettingsV2,
    pub revision: i64,
    pub warnings: Vec<String>,
}

/// 读取结果：解析后的信封 + V1 原始字节（用于原文备份）。
struct ReadSettings {
    stored: Stored,
    legacy_bytes: Option<Vec<u8>>,
}

/// 读取失败的原因；区分「文件不存在」与「内容不合法」，前者在首启时属于正常情况。
struct ReadFailure {
    not_found: bool,
    message: String,
}

/// 构造「内容不合法」类失败。
fn invalid(message: &str) -> ReadFailure {
    ReadFailure { not_found: false, message: message.into() }
}

/// JS `Number.isSafeInteger` 的上界（2^53 − 1）。
const MAX_SAFE_REVISION: i64 = 9_007_199_254_740_991;

/// 串行化的设置仓库；所有写入都会原子替换目标文件。
pub struct SettingsStore {
    directory: PathBuf,
    path: PathBuf,
    backup: PathBuf,
    legacy_backup: PathBuf,
    current: Stored,
    /// 待留档的 V1 原始字节；发布成功前一直保留，失败可在下次保存或启动时重试。
    pending_legacy: Option<Vec<u8>>,
}

impl SettingsStore {
    /// 以数据目录创建仓库；文件尚未读取前使用出厂默认设置。
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        let directory = directory.into();
        Self {
            path: directory.join("settings.json"),
            backup: directory.join("settings.last-good.json"),
            legacy_backup: directory.join("settings.v1-backup.json"),
            directory,
            current: Stored { settings: default_settings(), revision: 0 },
            pending_legacy: None,
        }
    }

    /// 当前生效的设置与版本号。
    pub fn current(&self) -> &Stored {
        &self.current
    }

    /// 读取并校验一个信封文件。
    fn read(&self, path: &Path) -> Result<ReadSettings, ReadFailure> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) => {
                return Err(ReadFailure {
                    not_found: error.kind() == std::io::ErrorKind::NotFound,
                    message: error.to_string(),
                });
            }
        };
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid settings envelope"))?;
        let Some(object) = value.as_object() else {
            return Err(invalid("Invalid settings envelope"));
        };
        if object.keys().any(|key| !matches!(key.as_str(), "revision" | "settings")) {
            return Err(invalid("Invalid settings envelope"));
        }
        let (Some(revision_value), Some(settings_value)) = (object.get("revision"), object.get("settings")) else {
            return Err(invalid("Invalid settings envelope"));
        };
        let Some(revision) = safe_revision(revision_value) else {
            return Err(invalid("Invalid revision"));
        };
        // V1 判定只在显式迁移时读取；V2 信封即使带着 `schemaVersion` 也走严格校验。
        if settings_value.get("schemaVersion").and_then(Value::as_f64) == Some(1.0) {
            let parsed = validate_legacy_settings(settings_value);
            return match parsed.value {
                Some(legacy) => Ok(ReadSettings {
                    stored: Stored { settings: migrate(&legacy), revision },
                    legacy_bytes: Some(bytes),
                }),
                None => Err(invalid("Invalid legacy settings")),
            };
        }
        let parsed = validate_settings(settings_value);
        match parsed.value {
            Some(settings) => Ok(ReadSettings { stored: Stored { settings, revision }, legacy_bytes: None }),
            None => Err(invalid("Invalid settings")),
        }
    }

    /// 发布 V1 原始字节留档；已存在时只做一致性校验，永不覆盖第一份。
    fn preserve_legacy(&mut self) -> Result<(), String> {
        let Some(bytes) = self.pending_legacy.clone() else {
            return Ok(());
        };
        let temporary = temporary_path(&self.legacy_backup);
        let result = (|| -> Result<(), String> {
            let mut file = open_private(&temporary).map_err(|error| error.to_string())?;
            file.write_all(&bytes).map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            drop(file);
            match fs::hard_link(&temporary, &self.legacy_backup) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let existing = self.read(&self.legacy_backup).map_err(|failure| failure.message)?;
                    if existing.legacy_bytes.is_none() {
                        Err("Original legacy backup is invalid".into())
                    } else {
                        Ok(())
                    }
                }
                Err(error) => Err(error.to_string()),
            }
        })();
        let _ = fs::remove_file(&temporary);
        result
    }

    /// 原子写入：临时文件 + `fsync` + `rename`，权限 `0o600`。
    fn atomic(&self, path: &Path, value: &Stored) -> Result<(), String> {
        let temporary = temporary_path(path);
        let json = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
        let result = (|| -> std::io::Result<()> {
            let mut file = open_private(&temporary)?;
            file.write_all(json.as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(|error| error.to_string())
    }

    /// 加载设置；任何失败都退化为可用状态并只上报 warning，绝不阻塞启动。
    pub fn load(&mut self) -> LoadedSettings {
        let mut warnings: Vec<String> = Vec::new();
        let mut loaded: Option<ReadSettings> = None;
        match self.read(&self.path) {
            Ok(value) => loaded = Some(value),
            Err(failure) => {
                log::debug!("读取设置失败：{}", failure.message);
                if !failure.not_found {
                    warnings.push("设置文件损坏，已尝试恢复最后有效备份".into());
                }
                match self.read(&self.backup) {
                    Ok(value) => {
                        loaded = Some(value);
                        warnings.push("已恢复最后有效设置备份".into());
                    }
                    Err(backup) => {
                        log::debug!("读取设置备份失败：{}", backup.message);
                        if !warnings.is_empty() {
                            warnings.push("备份不可用，已恢复默认设置".into());
                        }
                    }
                }
            }
        }
        self.current = loaded
            .as_ref()
            .map(|value| value.stored.clone())
            .unwrap_or(Stored { settings: default_settings(), revision: 0 });
        self.pending_legacy = loaded.and_then(|value| value.legacy_bytes);
        if self.pending_legacy.is_some() {
            let current = self.current.clone();
            let upgrade = self.preserve_legacy().and_then(|()| self.atomic(&self.path, &current));
            match upgrade {
                Ok(()) => self.pending_legacy = None,
                Err(_) => warnings.push(
                    "设置升级未能写入，原文件已保留；当前使用简化设置，下次保存或启动将重试".into(),
                ),
            }
        }
        LoadedSettings {
            settings: self.current.settings.clone(),
            revision: self.current.revision,
            warnings,
        }
    }

    /// 落盘一次替换：先留档 V1、再备份当前有效版本、最后替换主文件。
    fn persist(&mut self, next: &Stored) -> Result<(), String> {
        fs::create_dir_all(&self.directory).map_err(|error| error.to_string())?;
        self.preserve_legacy()?;
        let current = self.current.clone();
        self.atomic(&self.backup, &current)?;
        self.atomic(&self.path, next)
    }

    /// 以乐观并发写入设置；版本号不匹配返回 `SETTINGS_CONFLICT`。
    pub fn save(&mut self, expected_revision: i64, value: &Value) -> CommandResult<Stored> {
        if expected_revision != self.current.revision {
            return CommandResult::failure(AppError {
                code: "SETTINGS_CONFLICT".into(),
                message: "设置已在其他窗口更新，请重新检查后保存".into(),
                fields: None,
                current_revision: Some(self.current.revision),
            });
        }
        let settings = match validate_settings(value) {
            CommandResult { ok: true, value: Some(settings), .. } => settings,
            other => {
                let error = other
                    .error
                    .unwrap_or_else(|| AppError::new("INVALID_SETTINGS", "请检查设置中的标记项"));
                return CommandResult::failure(error);
            }
        };
        let next = Stored { settings, revision: self.current.revision + 1 };
        match self.persist(&next) {
            Ok(()) => {
                self.current = next.clone();
                self.pending_legacy = None;
                CommandResult::success(next)
            }
            Err(_) => CommandResult::failure(AppError::new(
                "SETTINGS_WRITE_FAILED",
                "无法保存设置，当前有效设置已保留",
            )),
        }
    }
}

/// V1 → V2：只保留八项核心偏好，其余自定义项按产品固有值处理。
fn migrate(settings: &SettingsV1) -> SettingsV2 {
    SettingsV2 {
        schema_version: 2,
        timer: TimerSettings {
            mode: settings.timer.mode,
            interval_minutes: settings.timer.interval_minutes,
            long_idle_minutes: settings.timer.long_idle_minutes,
        },
        reminder: ReminderSettings {
            visual: settings.reminder.visual,
            sound_enabled: settings.reminder.sound_enabled,
        },
        appearance: AppearanceSettings {
            theme: settings.appearance.theme,
            show_tray_countdown: settings.appearance.show_tray_countdown,
        },
        general: GeneralSettings { launch_at_login: settings.general.launch_at_login },
    }
}

/// 非负的安全整数版本号；对齐 JS `Number.isSafeInteger`。
fn safe_revision(value: &Value) -> Option<i64> {
    value
        .as_f64()
        .filter(|revision| {
            revision.is_finite() && revision.fract() == 0.0 && *revision >= 0.0 && *revision <= MAX_SAFE_REVISION as f64
        })
        .map(|revision| revision as i64)
}

/// 临时文件路径，与 TS 的 `${path}.tmp` 一致。
fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".tmp");
    PathBuf::from(name)
}

/// 以 `0o600` 打开（新建或截断）；Windows 上忽略权限位。
fn open_private(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}
