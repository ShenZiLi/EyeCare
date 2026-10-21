//! `app/main/tray/presenter.ts` 的 Rust 移植。
//!
//! 职责：创建系统托盘，维护图标、倒计时标题、提示文案与右键菜单，并把菜单动作交回
//! `crate::handle_tray_menu` 分发。
//!
//! 线程约束：tauri 的托盘 setter 通过 `run_item_main_thread!` 阻塞等待主线程执行，
//! 因此 [`TrayPresenter::update`] 只允许在主线程调用（由 `emit_snapshot` 投递），
//! 否则会与主线程上的托盘菜单回调互相等待。

mod icon;

use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Wry};

use std::sync::atomic::{AtomicBool, Ordering};

use crate::contracts::{format_time, status_label, RuntimeSnapshot, RuntimeStatus, EffectiveTheme};

/// 托盘标识；`tray_by_id` 与菜单事件都依赖这个稳定标识。
pub const TRAY_ID: &str = "eyecare-tray";

/// 「托盘对象丢失」是否已经记过一次日志；`update` 每秒执行，需要限流。
static TRAY_MISSING_LOGGED: AtomicBool = AtomicBool::new(false);

/// 状态栏菜单项（禁用态，仅作标题展示）。
pub const MENU_STATUS: &str = "tray-status";
/// 「打开概览」菜单项。
pub const MENU_SHOW_MAIN: &str = "tray-show-main";
/// 「暂停」菜单项。
pub const MENU_PAUSE: &str = "tray-pause";
/// 「恢复计时」菜单项。
pub const MENU_RESUME: &str = "tray-resume";
/// 「立即提醒」菜单项。
pub const MENU_REMIND_NOW: &str = "tray-remind-now";
/// 「设置」菜单项。
pub const MENU_SETTINGS: &str = "tray-settings";
/// 「退出 EyeCare」菜单项。
pub const MENU_QUIT: &str = "tray-quit";

/// 浅色标准图标；编译期嵌入，避免 dev 与打包环境下的资源路径差异。
const REST_LIGHT: &[u8] = include_bytes!("../../resources/tray-rest-light.png");
/// 深色标准图标：近白色的眼睛，供非 macOS 平台的深色外观使用。
const REST_DARK: &[u8] = include_bytes!("../../resources/tray-rest-dark.png");

/// 标准托盘图标，对应 `presenter.ts#L10-L15` 的 `standardIcon`。
///
/// macOS 侧 tray-icon 会把图标统一缩到 18pt 高再交给状态栏，因此直接交给它解码；
/// 其余平台按 Electron 的 32px 规则输出，避免原生托盘按 64px 原图展示。
///
/// macOS 恒走模板图（只取 alpha 当遮罩），由系统按菜单栏明暗自动反色，因此固定用浅色
/// 变体——深浅两张图的 alpha 完全一致。其余平台没有模板机制，只能按外观直接换图。
fn standard_icon(dark: bool) -> Option<Image<'static>> {
    let darwin = cfg!(target_os = "macos");
    let source = if dark && !darwin { REST_DARK } else { REST_LIGHT };
    if darwin {
        return Image::from_bytes(source).ok();
    }
    let decoded = image::load_from_memory(source).ok()?;
    let scaled = decoded.resize(32, 32, image::imageops::FilterType::Lanczos3).to_rgba8();
    let (width, height) = scaled.dimensions();
    Some(Image::new_owned(scaled.into_raw(), width, height))
}

/// 数字点阵图标，对应 `presenter.ts#L39` 的 `numericTrayIcon(text, dark)`。
fn numeric_icon(label: &str, dark: bool) -> Image<'static> {
    Image::new_owned(icon::numeric_icon_rgba(label, dark), icon::ICON_SIZE, icon::ICON_SIZE)
}

/// 托盘呈现层；字段与 `presenter.ts` 的同名私有字段一一对应。
#[derive(Default)]
pub struct TrayPresenter {
    /// 最近一次设置的图标键，避免每秒重复刷新图标。
    icon_key: String,
    /// 最近一次构建的菜单键，避免每秒重建菜单。
    menu_key: String,
}

impl TrayPresenter {
    /// 创建空的呈现层；托盘本身在 [`TrayPresenter::create`] 中按需创建。
    pub fn new() -> Self {
        Self::default()
    }

    /// 创建托盘并注册菜单回调，返回托盘是否可用。必须在主线程调用。
    pub fn create(app: &AppHandle) -> bool {
        let mut builder = TrayIconBuilder::with_id(TRAY_ID)
            .tooltip("EyeCare")
            // macOS 交给模板图：tray-icon 只取 alpha 当遮罩，由系统按菜单栏明暗反色，
            // 深色菜单栏自动出白色，浅色菜单栏自动出黑色；其余平台没有模板机制。
            .icon_as_template(cfg!(target_os = "macos"))
            // macOS 点击即弹出已注册菜单；其余平台同样以点击弹菜单对齐 Electron 行为。
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| crate::handle_tray_menu(app, event.id().as_ref()));
        if let Some(image) = standard_icon(false) {
            log::info!("托盘图标已解码：{}x{} px", image.width(), image.height());
            builder = builder.icon(image);
        } else {
            // 图标解码失败时 status item 会以「无图标、无标题」创建，宽度退化为 0，
            // 表现为用户完全看不到也点不到，因此这条必须留痕。
            log::warn!("托盘图标解码失败，将以空图标创建（预计不可见）");
        }
        match builder.build(app) {
            Ok(tray) => {
                log::info!("系统托盘已创建：{:?}", tray.id());
                true
            }
            Err(error) => {
                log::warn!("系统托盘不可用：{error}");
                false
            }
        }
    }

    /// 释放托盘；退出前调用。
    pub fn dispose(app: &AppHandle) {
        app.remove_tray_by_id(TRAY_ID);
    }

    /// 托盘对象当前是否仍挂在状态栏上。
    ///
    /// macOS 在 activation policy 切换（Dock 图标显隐）时会重建菜单栏并回收本进程的
    /// NSStatusItem，此时 [`TrayPresenter::update`] 开头的 `tray_by_id` 会返回 `None`
    /// 并静默跳过，图标就此永久消失。调用方必须在切换后用它确认托盘仍然存在。
    pub fn exists(app: &AppHandle) -> bool {
        app.tray_by_id(TRAY_ID).is_some()
    }

    /// 清空图标与菜单的缓存键。
    ///
    /// 托盘重建后，缓存键描述的旧对象已随托盘一起消失，必须清空；否则下一次
    /// [`TrayPresenter::update`] 会认为「图标与菜单都已是最新」而不再下发，重建出来的
    /// 托盘会缺图标或缺菜单。
    pub fn reset(&mut self) {
        self.icon_key.clear();
        self.menu_key.clear();
    }

    /// 按快照刷新图标、标题、提示与菜单，对应 `presenter.ts#L27-L56`。必须在主线程调用。
    pub fn update(&mut self, app: &AppHandle, snapshot: &RuntimeSnapshot) {
        let Some(tray) = app.tray_by_id(TRAY_ID) else {
            // 只在第一次丢失时记日志：刷新是每秒一次，无限流会刷爆日志。
            if !TRAY_MISSING_LOGGED.swap(true, Ordering::Relaxed) {
                log::warn!("托盘刷新时找不到托盘对象：图标已从状态栏移除");
            }
            return;
        };
        TRAY_MISSING_LOGGED.store(false, Ordering::Relaxed);
        let remaining = snapshot.remaining_ms;
        let showing = snapshot.settings.appearance.show_tray_countdown;
        let state = status_label(snapshot.status);
        let counting = matches!(snapshot.status, RuntimeStatus::Counting | RuntimeStatus::ShortIdle);
        let paused = snapshot.status == RuntimeStatus::Paused;
        let text = if paused {
            "P".to_string()
        } else if counting {
            icon::tray_label(remaining)
        } else if snapshot.status == RuntimeStatus::CapabilityError {
            "!".to_string()
        } else {
            "-".to_string()
        };
        let dark = snapshot.theme == EffectiveTheme::Dark;
        let darwin = cfg!(target_os = "macos");
        // macOS 图标恒为标准图、倒计时落在标题上；其余平台在数字图标与眼睛图标之间切换。
        // 图标键不需要带外观位：macOS 靠模板图让系统反色，深浅切换无需重新下发。
        let key = if darwin {
            if showing { "icon:text".to_string() } else { "icon".to_string() }
        } else {
            format!("{}:{dark}", if showing { text.as_str() } else { "eye" })
        };
        if key != self.icon_key {
            let image = if darwin {
                standard_icon(dark)
            } else if showing {
                Some(numeric_icon(&text, dark))
            } else {
                standard_icon(dark)
            };
            if let Some(image) = image {
                // 图标与模板标志必须原子下发：单独 `set_icon` 会重建 NSImage 并丢掉模板
                // 标志，图标退回原始填充色（深绿实心块），在深色菜单栏上几乎看不见。
                let _ = tray.set_icon_with_as_template(Some(image), cfg!(target_os = "macos"));
            }
            self.icon_key = key;
        }
        if darwin {
            let title = if showing {
                if counting { format_time(remaining) } else { state.to_string() }
            } else {
                String::new()
            };
            let _ = tray.set_title(Some(title));
        }
        let mut tooltip = format!("EyeCare · {state}");
        if showing {
            tooltip.push_str(" · ");
            tooltip.push_str(&format_time(remaining));
        }
        if !snapshot.status_reason.is_empty() {
            tooltip.push('\n');
            tooltip.push_str(&snapshot.status_reason);
        }
        let _ = tray.set_tooltip(Some(tooltip));
        // 菜单键对齐 `presenter.ts#L45`：状态 + 是否显示倒计时 + 剩余分钟数取整。
        let menu_key = format!(
            "{}:{showing}:{}",
            snapshot.status as u8,
            (remaining.unwrap_or(0).max(0) + 59_999) / 60_000
        );
        if menu_key != self.menu_key {
            match build_menu(app, state, counting, paused) {
                Ok(menu) => {
                    let _ = tray.set_menu(Some(menu));
                    self.menu_key = menu_key;
                }
                Err(error) => log::warn!("托盘菜单构建失败：{error}"),
            }
        }
    }
}

/// 构建托盘菜单，对应 `presenter.ts#L47-L53` 的模板。
fn build_menu(app: &AppHandle, state: &str, counting: bool, paused: bool) -> tauri::Result<Menu<Wry>> {
    let status = MenuItemBuilder::with_id(MENU_STATUS, format!("EyeCare · {state}"))
        .enabled(false)
        .build(app)?;
    let show_main = MenuItemBuilder::with_id(MENU_SHOW_MAIN, "打开概览").build(app)?;
    let toggle = if paused {
        MenuItemBuilder::with_id(MENU_RESUME, "恢复计时").build(app)?
    } else {
        MenuItemBuilder::with_id(MENU_PAUSE, "暂停").build(app)?
    };
    // Electron 仅在计时态允许「立即提醒」。
    let remind_now = MenuItemBuilder::with_id(MENU_REMIND_NOW, "立即提醒")
        .enabled(counting)
        .build(app)?;
    let settings = MenuItemBuilder::with_id(MENU_SETTINGS, "设置").build(app)?;
    let quit = MenuItemBuilder::with_id(MENU_QUIT, "退出 EyeCare").build(app)?;
    MenuBuilder::new(app)
        .item(&status)
        .separator()
        .item(&show_main)
        .item(&toggle)
        .item(&remind_now)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()
}
