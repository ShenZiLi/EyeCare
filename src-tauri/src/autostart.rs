//! `app/main/platform/autostart.ts` 的 Rust 移植（macOS / Linux）。
//!
//! 与 TS 版一致，登录启动开关不是「写偏好」而是「改系统状态」：变更前先读取系统真实
//! 状态（可能与磁盘偏好不同，例如被系统设置关闭），变更后再回读校验；任何一步失败都
//! 回滚到读取到的状态。`tauri-plugin-autostart` 只覆盖基础开关，无法表达这套
//! capture → apply → 校验 → rollback 语义，因此这里直接绑定平台 API。
//!
//! Windows 的注册表快照（`StartupApproved` 二进制值）与旧 Squirrel 启动项升级依赖
//! `app.getLoginItemSettings().launchItems` 这类 Electron 专有 API，需要与 Windows 原生桥
//! （Phase 3/4 已整体降级）一起实现，本阶段先返回明确的未实现错误。

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use uuid::Uuid;

/// 目标平台；与 TS 的 `NodeJS.Platform` 在移植范围内保持一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    MacOs,
    Windows,
    Linux,
}

/// 当前运行平台。
pub fn current_platform() -> Platform {
    if cfg!(target_os = "macos") {
        Platform::MacOs
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Linux
    }
}

/// 判定文件是否存在的注入点，对应 TS 测试中被 mock 的 `fs.existsSync`。
pub type ExistsFn = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// 生产环境的存在性判定。
pub fn file_exists() -> ExistsFn {
    Arc::new(|file: &str| Path::new(file).exists())
}

/// 登录启动项登记所需的环境信息，对应 TS 的 `AutostartContext`。
#[derive(Debug, Clone)]
pub struct AutostartContext {
    pub platform: Platform,
    pub executable: String,
    pub xdg_config_home: Option<String>,
    pub appimage: Option<String>,
    pub appdir: Option<String>,
    pub home: Option<String>,
}

impl AutostartContext {
    /// 读取当前进程的真实环境。
    pub fn current() -> Self {
        let executable = std::env::current_exe()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default();
        let environment = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
        Self {
            platform: current_platform(),
            executable,
            xdg_config_home: environment("XDG_CONFIG_HOME"),
            appimage: environment("APPIMAGE"),
            appdir: environment("APPDIR"),
            home: environment("HOME"),
        }
    }
}

/// 是否需要拒绝这段路径：含控制字符的路径会被 desktop entry / 注册表解释成另有含义的内容。
fn has_control_character(value: &str) -> bool {
    value.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
}

/// 需要登记到登录启动项的入口，等价于 TS 的 `autostartExecutable`。
///
/// AppImage 必须登记原始镜像路径，而不是 `/tmp/.mount_*` 挂载点——挂载点每次启动都会变化，
/// 登记它等于登记了一个失效路径；无法确认持久路径时直接失败，绝不写入临时路径。
pub fn autostart_executable(context: &AutostartContext, exists: &ExistsFn) -> Result<String, String> {
    if context.platform == Platform::Linux {
        if let Some(image) = context.appimage.as_deref() {
            if !Path::new(image).is_absolute() || has_control_character(image) || !exists(image) {
                return Err("AppImage 登录启动路径无效".into());
            }
            return Ok(image.to_owned());
        }
        if context.appdir.is_some() {
            return Err("无法确认 AppImage 的持久路径，未创建自动启动项".into());
        }
    }
    Ok(context.executable.clone())
}

/// 生成 Linux 自动启动项，等价于 TS 的 `autostartDesktopEntry`。
///
/// desktop entry 会先反转义再解析 `Exec` 的引号，因此反斜杠要按四倍转义，
/// 反引号与 `$` 还要再加一层反斜杠，避免被 shell 展开。
pub fn autostart_desktop_entry(executable: &str) -> Result<String, String> {
    if has_control_character(executable) {
        return Err("自动启动路径无效".into());
    }
    let quoted = executable
        .replace('\\', "\\\\\\\\")
        .replace('"', "\\\\\"")
        .replace('`', "\\\\`")
        .replace('$', "\\\\$")
        .replace('%', "%%");
    Ok(format!(
        "[Desktop Entry]\nType=Application\nVersion=1.0\nName=EyeCare\nComment=Eye care reminders\nExec=\"{quoted}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
    ))
}

/// 本应用的 Linux 自动启动项路径，等价于 TS 的 `linuxLoginFile`。
pub fn linux_login_file(context: &AutostartContext) -> Result<PathBuf, String> {
    let root = match context.xdg_config_home.as_deref() {
        Some(root) if Path::new(root).is_absolute() => PathBuf::from(root),
        _ => {
            let home = context.home.as_deref().ok_or("无法确定用户主目录")?;
            Path::new(home).join(".config")
        }
    };
    Ok(root.join("autostart").join("eyecare.desktop"))
}

/// 自动启动项的原始内容与权限位，用于「按字节恢复」。
#[derive(Debug, Clone, PartialEq, Eq)]
struct LinuxEntry {
    bytes: Vec<u8>,
    mode: u32,
}

/// 读取权限位；Windows 没有 Unix 权限位，返回 0。
fn entry_mode(info: &fs::Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        info.permissions().mode() & 0o7777
    }
    #[cfg(not(unix))]
    {
        let _ = info;
        0
    }
}

/// 读取自动启动项的真实状态；`lstat` 语义：符号链接一律拒绝，绝不顺着链接读写。
/// `Ok(None)` 表示文件不存在（首启的正常情况）。
fn inspect_linux_login(file: &Path) -> Result<Option<LinuxEntry>, String> {
    let info = match fs::symlink_metadata(file) {
        Ok(info) => info,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !info.is_file() || info.file_type().is_symlink() {
        return Err("登录启动项必须是普通文件".into());
    }
    let bytes = fs::read(file).map_err(|error| error.to_string())?;
    Ok(Some(LinuxEntry { bytes, mode: entry_mode(&info) }))
}

/// 以 `0o600` 新建或覆盖自动启动项。
fn write_linux_login(file: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut handle = options.open(file).map_err(|error| error.to_string())?;
    handle.write_all(contents).map_err(|error| error.to_string())?;
    Ok(())
}

/// 移除自动启动项；不存在视为已达成。
fn remove_linux_login(file: &Path) -> Result<(), String> {
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// 系统登录启动项的最小接口，对应 TS 里被 mock 的 `electron.app` 两个方法。
pub trait LoginBackend: Send + Sync {
    /// 系统当前是否会在登录时启动本应用。
    fn read_enabled(&self) -> Result<bool, String>;
    /// 写入系统登录启动项；`path` 是本次要登记的入口路径（macOS 忽略该参数）。
    fn write_enabled(&self, enabled: bool, path: &str) -> Result<(), String>;
}

/// 各后端共享的句柄；撤销事务的闭包需要持有它的克隆。
pub type Backend = Arc<dyn LoginBackend>;

/// Linux 后端：系统状态就是 `~/.config/autostart/eyecare.desktop` 是否存在。
#[derive(Debug, Clone)]
pub struct LinuxLoginBackend {
    file: PathBuf,
}

impl LinuxLoginBackend {
    /// 以上下文解析自动启动项路径。
    pub fn new(context: &AutostartContext) -> Result<Self, String> {
        Ok(Self { file: linux_login_file(context)? })
    }
}

impl LoginBackend for LinuxLoginBackend {
    fn read_enabled(&self) -> Result<bool, String> {
        Ok(inspect_linux_login(&self.file)?.is_some())
    }

    /// 写入前先确认目标不是符号链接；关闭时只删自己这一份，不动同目录的其它条目。
    fn write_enabled(&self, enabled: bool, path: &str) -> Result<(), String> {
        inspect_linux_login(&self.file)?;
        if !enabled {
            return remove_linux_login(&self.file);
        }
        let entry = autostart_desktop_entry(path)?;
        write_linux_login(&self.file, entry.as_bytes())
    }
}

/// macOS 登录启动后端：直接读写 `SMAppService` 的主应用登录项。
#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy)]
pub struct MacLoginBackend;

#[cfg(target_os = "macos")]
impl LoginBackend for MacLoginBackend {
    /// 只有「已启用」才代表系统真的会在登录时启动；「等待用户批准」与「未注册」都不能当作已启用。
    fn read_enabled(&self) -> Result<bool, String> {
        match macos_sm::status()? {
            macos_sm::ENABLED => Ok(true),
            macos_sm::NOT_REGISTERED | macos_sm::REQUIRES_APPROVAL | macos_sm::NOT_FOUND => Ok(false),
            other => Err(format!("系统登录启动项状态无效：{other}")),
        }
    }

    /// 主应用的登录项由系统按 bundle 识别，入口路径参数被忽略。
    fn write_enabled(&self, enabled: bool, _path: &str) -> Result<(), String> {
        macos_sm::set_registered(enabled)
    }
}

/// 创建当前平台的真实后端。
pub fn system_backend(context: &AutostartContext) -> Result<Backend, String> {
    match context.platform {
        Platform::MacOs => native_backend().ok_or_else(|| "当前构建未提供 macOS 登录启动后端".into()),
        Platform::Linux => Ok(Arc::new(LinuxLoginBackend::new(context)?)),
        Platform::Windows => Err("Windows 登录启动后端随 Windows 原生桥一并在后续阶段实现".into()),
    }
}

#[cfg(target_os = "macos")]
fn native_backend() -> Option<Backend> {
    Some(Arc::new(MacLoginBackend))
}

#[cfg(not(target_os = "macos"))]
fn native_backend() -> Option<Backend> {
    None
}

/// 一次「系统登录启动项」事务：apply 应用目标状态，rollback 恢复捕获到的状态。
pub struct LoginChange {
    apply: Box<dyn FnMut() -> Result<(), String> + Send>,
    rollback: Box<dyn FnMut() -> Result<(), String> + Send>,
}

impl LoginChange {
    /// 以两个动作构造事务。
    pub fn new(
        apply: impl FnMut() -> Result<(), String> + Send + 'static,
        rollback: impl FnMut() -> Result<(), String> + Send + 'static,
    ) -> Self {
        Self { apply: Box::new(apply), rollback: Box::new(rollback) }
    }

    /// 应用目标状态。
    pub fn apply(&mut self) -> Result<(), String> {
        (self.apply)()
    }

    /// 恢复捕获到的状态。
    pub fn rollback(&mut self) -> Result<(), String> {
        (self.rollback)()
    }
}

/// 变更系统登录启动项，对应 TS 的 `setLaunchAtLogin`。
pub fn set_launch_at_login(
    enabled: bool,
    context: &AutostartContext,
    backend: &Backend,
    exists: &ExistsFn,
) -> Result<(), String> {
    // 关闭时使用进程自身路径，这样即使安装目录已被移除也能清掉残留条目。
    let path = if enabled { autostart_executable(context, exists)? } else { context.executable.clone() };
    backend.write_enabled(enabled, &path)?;
    // Linux 的判定依据就是刚写入的文件本身，不需要再回读。
    if context.platform != Platform::Linux && backend.read_enabled()? != enabled {
        return Err("系统未保存登录启动设置".into());
    }
    Ok(())
}

/// 准备一次登录启动变更：先捕获系统真实状态，再返回 apply / rollback，
/// 对应 TS 的 `prepareLoginChange`。
pub fn prepare_login_change(
    enabled: bool,
    context: &AutostartContext,
    backend: Backend,
    exists: &ExistsFn,
) -> Result<LoginChange, String> {
    match context.platform {
        Platform::MacOs => {
            // 磁盘偏好可能与系统状态不一致（例如用户在系统设置里关掉），必须以系统状态为准。
            let before = backend.read_enabled()?;
            let (apply, rollback) = (context.clone(), context.clone());
            let (apply_backend, rollback_backend) = (Arc::clone(&backend), backend);
            let (apply_exists, rollback_exists) = (Arc::clone(exists), Arc::clone(exists));
            Ok(LoginChange::new(
                move || set_launch_at_login(enabled, &apply, &apply_backend, &apply_exists),
                move || set_launch_at_login(before, &rollback, &rollback_backend, &rollback_exists),
            ))
        }
        Platform::Linux => {
            let file = linux_login_file(context)?;
            let before = inspect_linux_login(&file)?;
            let apply = context.clone();
            let apply_backend = Arc::clone(&backend);
            let apply_exists = Arc::clone(exists);
            Ok(LoginChange::new(
                move || set_launch_at_login(enabled, &apply, &apply_backend, &apply_exists),
                move || {
                    // 保存偏好期间目标被换成符号链接时，绝不能顺着链接把内容写回去。
                    inspect_linux_login(&file)?;
                    let Some(snapshot) = before.clone() else {
                        return remove_linux_login(&file);
                    };
                    let temporary = temporary_path(&file);
                    let restored = (|| -> Result<(), String> {
                        if let Some(parent) = file.parent() {
                            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                        }
                        let mut options = fs::OpenOptions::new();
                        options.write(true).create_new(true);
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::OpenOptionsExt;
                            options.mode(snapshot.mode);
                        }
                        let mut handle = options.open(&temporary).map_err(|error| error.to_string())?;
                        handle.write_all(&snapshot.bytes).map_err(|error| error.to_string())?;
                        drop(handle);
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            fs::set_permissions(&temporary, fs::Permissions::from_mode(snapshot.mode))
                                .map_err(|error| error.to_string())?;
                        }
                        fs::rename(&temporary, &file).map_err(|error| error.to_string())
                    })();
                    let _ = fs::remove_file(&temporary);
                    restored?;
                    match inspect_linux_login(&file)? {
                        Some(entry) if entry.bytes == snapshot.bytes && entry.mode == snapshot.mode => Ok(()),
                        _ => Err("系统登录启动项未能恢复".into()),
                    }
                },
            ))
        }
        Platform::Windows => Err("Windows 登录启动项快照随 Windows 原生桥一并在后续阶段实现".into()),
    }
}

/// 回滚用的临时文件名，与 TS 的 `${file}.${randomUUID()}.tmp` 一致。
fn temporary_path(file: &Path) -> PathBuf {
    let mut name = file.as_os_str().to_os_string();
    name.push(format!(".{}.tmp", Uuid::new_v4()));
    PathBuf::from(name)
}

/// macOS 通过 `SMAppService` 读写主应用登录项。
///
/// Electron 在 macOS 13 及以后同样使用 `SMAppService`：沿用同一注册项才能让用户此前
/// 的「登录时启动」选择继续有效，也不会遗留一份无法关闭的重复启动项。这里直接调用
/// ObjC 运行时，避免为一个开关引入额外的第三方依赖。
#[cfg(target_os = "macos")]
mod macos_sm {
    use std::ffi::{c_char, c_int, c_void};

    /// `SMAppServiceStatus` 取值。
    pub const NOT_REGISTERED: isize = 0;
    pub const ENABLED: isize = 1;
    pub const REQUIRES_APPROVAL: isize = 2;
    pub const NOT_FOUND: isize = 3;

    /// `RTLD_NOW`。
    const RTLD_NOW: c_int = 0x2;

    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        /// ObjC 消息发送入口；它没有固定 C 签名，按 selector 在调用处转换。
        fn objc_msgSend();
    }

    unsafe extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
    }

    /// 以 NUL 结尾的 C 字符串。
    fn cstring(value: &str) -> Vec<u8> {
        let mut bytes = value.as_bytes().to_vec();
        bytes.push(0);
        bytes
    }

    /// 注册一个 selector。
    fn selector(name: &str) -> *mut c_void {
        unsafe { sel_registerName(cstring(name).as_ptr().cast()) }
    }

    /// 调用「无参数、返回对象」的 selector。
    fn send_object(receiver: *mut c_void, selector: *mut c_void) -> *mut c_void {
        let send: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
            unsafe { std::mem::transmute(objc_msgSend as unsafe extern "C" fn()) };
        unsafe { send(receiver, selector) }
    }

    /// 调用「返回 `BOOL`、可回传 `NSError *`」的 selector。
    fn send_boolean(receiver: *mut c_void, selector: *mut c_void, error: *mut *mut c_void) -> u8 {
        let send: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut *mut c_void) -> u8 =
            unsafe { std::mem::transmute(objc_msgSend as unsafe extern "C" fn()) };
        unsafe { send(receiver, selector, error) }
    }

    /// 调用「返回 `NSInteger`」的 selector。
    fn send_integer(receiver: *mut c_void, selector: *mut c_void) -> isize {
        let send: unsafe extern "C" fn(*mut c_void, *mut c_void) -> isize =
            unsafe { std::mem::transmute(objc_msgSend as unsafe extern "C" fn()) };
        unsafe { send(receiver, selector) }
    }

    /// `+[SMAppService mainAppService]`；系统不支持时返回 `None`。
    pub fn main_service() -> Option<*mut c_void> {
        // ServiceManagement 没有链接进本进程，需要先显式加载框架才会注册 ObjC 类。
        unsafe {
            let path = cstring("/System/Library/Frameworks/ServiceManagement.framework/ServiceManagement");
            if dlopen(path.as_ptr().cast(), RTLD_NOW).is_null() {
                return None;
            }
            let class = objc_getClass(cstring("SMAppService").as_ptr().cast());
            if class.is_null() {
                return None;
            }
            let service = send_object(class, selector("mainAppService"));
            (!service.is_null()).then_some(service)
        }
    }

    /// 当前服务的注册状态。
    pub fn status() -> Result<isize, String> {
        let Some(service) = main_service() else {
            return Err("当前系统不支持 SMAppService（需要 macOS 13 或更高版本）".into());
        };
        Ok(send_integer(service, selector("status")))
    }

    /// 登记或移除登录启动项；ObjC 返回 `NO` 即失败。
    pub fn set_registered(register: bool) -> Result<(), String> {
        let Some(service) = main_service() else {
            return Err("当前系统不支持 SMAppService（需要 macOS 13 或更高版本）".into());
        };
        let name = if register { "registerAndReturnError:" } else { "unregisterAndReturnError:" };
        let mut error: *mut c_void = std::ptr::null_mut();
        let ok = send_boolean(service, selector(name), std::ptr::from_mut(&mut error).cast());
        if ok != 0 {
            return Ok(());
        }
        Err(if register {
            "系统未能登记登录启动项，请检查系统设置中的登录项".into()
        } else {
            "系统未能移除登录启动项，请检查系统设置中的登录项".into()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// 每个用例独立的临时目录，离开作用域即清理。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let name = format!("eyecare-autostart-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
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

    /// 可脚本化的登录启动后端，对应 TS 测试中被 mock 的 `electron.app`。
    #[derive(Clone, Default)]
    struct FakeBackend {
        enabled: Arc<Mutex<bool>>,
        writes: Arc<Mutex<usize>>,
        read_error: Arc<Mutex<Option<String>>>,
        write_error: Arc<Mutex<Option<String>>>,
        /// 写入后回读仍返回原值，用于模拟「系统拒绝保存」。
        swallow_writes: Arc<Mutex<bool>>,
    }

    impl FakeBackend {
        fn with_state(enabled: bool) -> Self {
            Self { enabled: Arc::new(Mutex::new(enabled)), ..Self::default() }
        }

        /// 写入被系统吞掉：回读不到目标状态。
        fn swallowing_writes() -> Self {
            let backend = Self::with_state(false);
            *backend.swallow_writes.lock().expect("写入开关") = true;
            backend
        }

        fn write_count(&self) -> usize {
            *self.writes.lock().expect("读取写入次数")
        }
    }

    impl LoginBackend for FakeBackend {
        fn read_enabled(&self) -> Result<bool, String> {
            if let Some(error) = self.read_error.lock().expect("读取脚本").clone() {
                return Err(error);
            }
            Ok(*self.enabled.lock().expect("读取系统状态"))
        }

        fn write_enabled(&self, enabled: bool, _path: &str) -> Result<(), String> {
            if let Some(error) = self.write_error.lock().expect("读取脚本").clone() {
                return Err(error);
            }
            *self.writes.lock().expect("累加写入次数") += 1;
            if !*self.swallow_writes.lock().expect("读取开关") {
                *self.enabled.lock().expect("写入系统状态") = enabled;
            }
            Ok(())
        }
    }

    fn never_exists() -> ExistsFn {
        Arc::new(|_| false)
    }

    fn mac_context() -> AutostartContext {
        AutostartContext {
            platform: Platform::MacOs,
            executable: "/Applications/EyeCare.app/Contents/MacOS/eyecare".into(),
            xdg_config_home: None,
            appimage: None,
            appdir: None,
            home: None,
        }
    }

    fn linux_context(root: &Path, appimage: Option<&str>) -> AutostartContext {
        AutostartContext {
            platform: Platform::Linux,
            executable: "/tmp/.mount_EyeCare/usr/lib/eyecare".into(),
            xdg_config_home: Some(root.to_string_lossy().into_owned()),
            appimage: appimage.map(str::to_owned),
            appdir: None,
            home: None,
        }
    }

    fn read(path: &Path) -> Vec<u8> {
        fs::read(path).expect("读取文件")
    }

    #[test]
    fn writes_the_original_appimage_path_and_escapes_exec() {
        let folder = TempDir::new();
        let directory = folder.path().to_string_lossy().replace('\\', "/");
        let image = format!("{directory}/My $Eye`Care\"100%\\.AppImage");
        let context = linux_context(folder.path(), Some(&image));
        let exists: ExistsFn = Arc::new({
            let image = image.to_owned();
            move |file: &str| file == image
        });
        let executable = autostart_executable(&context, &exists).expect("AppImage 路径应被接受");
        assert_eq!(executable, image);
        let entry = autostart_desktop_entry(&executable).expect("生成自动启动项");
        let exec_line = entry.lines().find(|line| line.starts_with("Exec=")).expect("存在 Exec 行");
        assert_eq!(exec_line, format!(r#"Exec="{directory}/My \\$Eye\\`Care\\"100%%\\\\.AppImage""#));

        let backend: Backend = Arc::new(LinuxLoginBackend::new(&context).expect("解析自动启动项路径"));
        set_launch_at_login(true, &context, &backend, &exists).expect("写入自动启动项");
        let file = linux_login_file(&context).expect("解析自动启动项路径");
        assert_eq!(String::from_utf8(read(&file)).expect("自动启动项是 UTF-8"), entry);
        assert!(!String::from_utf8_lossy(&read(&file)).contains(".mount_"));

        // 关闭时只删自己这一份，同目录的其它条目原样保留。
        let other = folder.path().join("autostart").join("other.desktop");
        fs::write(&other, "unrelated").expect("写入其它条目");
        set_launch_at_login(false, &context, &backend, &exists).expect("移除自动启动项");
        assert!(!file.exists(), "自动启动项应被移除");
        assert_eq!(String::from_utf8(read(&other)).expect("其它条目是 UTF-8"), "unrelated");
    }

    #[test]
    fn refuses_invalid_appimage_paths() {
        let folder = TempDir::new();
        for image in ["relative.AppImage", "/tmp/Eye\nCare.AppImage", "/missing.AppImage"] {
            let context = linux_context(folder.path(), Some(image));
            let exists: ExistsFn = Arc::new(|file: &str| file != "/missing.AppImage");
            assert!(autostart_executable(&context, &exists).is_err(), "应拒绝 AppImage 路径 {image:?}");
        }
    }

    #[test]
    fn refuses_an_appimage_mount_without_the_original_path() {
        let folder = TempDir::new();
        let mut context = linux_context(folder.path(), None);
        context.appdir = Some("/tmp/.mount".into());
        assert!(autostart_executable(&context, &never_exists()).is_err(), "缺少原始镜像路径时不应登记");
    }

    #[test]
    fn reports_a_native_registration_failure_without_a_readback() {
        let backend: Backend = Arc::new(FakeBackend::swallowing_writes());
        assert_eq!(
            set_launch_at_login(true, &mac_context(), &backend, &never_exists()),
            Err("系统未保存登录启动设置".into())
        );
    }

    #[test]
    fn desktop_entry_rejects_control_characters() {
        assert!(autostart_desktop_entry("/tmp/Eye\nCare").is_err());
    }

    #[test]
    fn captures_a_system_disabled_mac_choice_and_restores_it() {
        let backend = Arc::new(FakeBackend::with_state(false));
        let handle: Backend = Arc::clone(&backend) as Backend;
        let mut change = prepare_login_change(true, &mac_context(), handle, &never_exists()).expect("捕获系统状态");
        assert_eq!(backend.write_count(), 0, "捕获阶段不应写入系统");
        change.apply().expect("应用目标状态");
        assert!(*backend.enabled.lock().expect("读取系统状态"));
        change.rollback().expect("恢复捕获到的状态");
        assert!(!*backend.enabled.lock().expect("读取系统状态"));
    }

    #[test]
    fn fails_safely_without_a_typed_mac_snapshot() {
        let backend = Arc::new(FakeBackend::with_state(false));
        *backend.read_error.lock().expect("写入脚本") = Some("系统登录启动项状态无效".into());
        let handle: Backend = Arc::clone(&backend) as Backend;
        let error = prepare_login_change(true, &mac_context(), handle, &never_exists()).err().expect("缺少有效快照应失败");
        assert!(error.contains("状态无效"), "错误文案为 {error}");
        assert_eq!(backend.write_count(), 0, "捕获失败后不应写入系统");
    }

    #[test]
    fn restores_linux_original_bytes_and_mode() {
        let folder = TempDir::new();
        let context = linux_context(folder.path(), None);
        let file = linux_login_file(&context).expect("解析自动启动项路径");
        fs::create_dir_all(file.parent().expect("存在父目录")).expect("创建目录");
        let original = "[Desktop Entry]\r\nHidden=true\r\n# custom\u{a0}comment\r\n".as_bytes().to_vec();
        fs::write(&file, &original).expect("写入原始条目");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o764)).expect("设置原始权限");
        }
        let other = folder.path().join("autostart").join("other.desktop");
        fs::write(&other, "unrelated").expect("写入其它条目");

        let backend = Arc::new(LinuxLoginBackend::new(&context).expect("解析自动启动项路径"));
        let handle: Backend = backend;
        let mut change = prepare_login_change(true, &context, handle, &never_exists()).expect("捕获系统状态");
        change.apply().expect("应用目标状态");
        assert_ne!(read(&file), original, "应用后内容应发生变化");
        change.rollback().expect("恢复原始条目");
        assert_eq!(read(&file), original, "应逐字节恢复原始条目");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&file).expect("读取权限").permissions().mode() & 0o777;
            assert_eq!(mode, 0o764, "应恢复原始权限位");
        }
        assert_eq!(String::from_utf8(read(&other)).expect("其它条目是 UTF-8"), "unrelated");
    }

    #[test]
    fn restores_the_absence_of_the_owned_linux_file() {
        let folder = TempDir::new();
        let context = linux_context(folder.path(), None);
        let backend = Arc::new(LinuxLoginBackend::new(&context).expect("解析自动启动项路径"));
        let handle: Backend = backend;
        let mut change = prepare_login_change(true, &context, handle, &never_exists()).expect("捕获系统状态");
        change.apply().expect("应用目标状态");
        change.rollback().expect("恢复空状态");
        let file = linux_login_file(&context).expect("解析自动启动项路径");
        assert!(!file.exists(), "回滚后不应残留自动启动项");
    }

    #[test]
    fn rejects_linux_symlinks_before_writing_their_targets() {
        let folder = TempDir::new();
        let context = linux_context(folder.path(), None);
        let file = linux_login_file(&context).expect("解析自动启动项路径");
        fs::create_dir_all(file.parent().expect("存在父目录")).expect("创建目录");
        let other = folder.path().join("autostart").join("other.desktop");
        fs::write(&other, "untouched").expect("写入其它条目");

        let backend = Arc::new(LinuxLoginBackend::new(&context).expect("解析自动启动项路径"));
        let handle: Backend = backend;
        let mut change = prepare_login_change(true, &context, handle, &never_exists()).expect("捕获系统状态");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&other, &file).expect("创建符号链接");
        #[cfg(not(unix))]
        fs::write(&file, "symlink placeholder").expect("创建占位文件");

        #[cfg(unix)]
        {
            assert!(change.apply().is_err(), "符号链接不应被写入");
            assert!(change.rollback().is_err(), "符号链接不应被回滚");
            let backend = Arc::new(LinuxLoginBackend::new(&context).expect("解析自动启动项路径"));
            assert!(prepare_login_change(true, &context, backend, &never_exists()).is_err(), "符号链接不应被捕获");
            assert_eq!(String::from_utf8(read(&other)).expect("其它条目是 UTF-8"), "untouched");
        }
    }

    #[test]
    fn windows_snapshots_are_deferred_with_an_explicit_error() {
        let mut context = mac_context();
        context.platform = Platform::Windows;
        context.executable = "C:\\Portable\\eyecare.exe".into();
        assert!(system_backend(&context).is_err(), "Windows 后端尚未实现");
    }

    /// 真实 macOS 后端的只读路径必须可用：类加载、selector、状态读取都不能崩。
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_backend_reads_the_native_login_item_state() {
        let enabled = MacLoginBackend.read_enabled().expect("读取系统登录启动项");
        log::debug!("系统登录启动项当前为 {enabled}");
    }
}
