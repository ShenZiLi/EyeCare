# 跨平台能力研究记录

日期：2026-10-10。资料用于设计，不代表实机验收。技术选择为 Electron + TypeScript + React + Vite；所有平台探针留到用户授权实现后。

## 已读取的主要官方资料

| 来源 | 支持设计的事实 | 设计推论 |
|---|---|---|
| [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor) | 系统空闲方法；锁屏事件标注 macOS/Windows；睡眠恢复事件 | Linux 锁屏单独适配，未知状态不能当作未锁屏 |
| [Electron Tray](https://www.electronjs.org/docs/latest/api/tray) | setTitle 仅 macOS；跨平台可设置图标/提示；Linux 托盘与激活行为依桌面环境 | Mac 文字倒计时，Windows/Linux 数字图标和完整面板 |
| [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) | 窗口、点击穿透接口；Wayland 定位/置顶/不抢焦点等存在限制 | 普通窗口不能承诺 Wayland 全屏蒙版可靠，必须专项验证 |
| [Electron screen](https://www.electronjs.org/docs/latest/api/screen) | 显示器列表及变化事件 | 多屏共享一次提醒，按屏幕边界重新计算 |
| [Electron Notification](https://www.electronjs.org/docs/latest/api/notification) | 通知参数与操作有平台差异；macOS 通知要求签名 | 一致操作放应用内，实际打包后验收 |
| [Electron nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme) | 系统/亮/暗主题选择与变化事件 | 跟随系统与手动覆盖分别保存 |
| [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) | 隔离、sandbox 与 IPC 校验指导 | renderer 不接触任意原生 API；固定 preload 白名单 |
| [Microsoft GetLastInputInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo) | 当前会话的最后输入信息，非所有用户会话 | Windows 输入适配限定当前交互会话 |
| [systemd login1 官方源文档](https://raw.githubusercontent.com/systemd/systemd/main/man/org.freedesktop.login1.xml) | 会话属性、Lock/Unlock、LockedHint、IdleHint、PrepareForSleep | 组合桌面状态验证；hint/请求信号不等同实际锁屏或精确输入计时 |

以上推论由本设计给出，不是官方页面承诺 EyeCare 的兼容性。

## 可读取但未完成验证的候选路径

[Apple CGEventSource 事件时间文档](https://developer.apple.com/documentation/coregraphics/cgeventsource/secondssincelasteventtype(_:eventtype:))页面需要动态渲染，本次只读取到入口，不能据此确认设备区分、权限或实际可用性。macOS 仅鼠标桥接在实现阶段验证。

[Wayland ext-idle-notify 协议镜像](https://wayland.app/protocols/ext-idle-notify-v1)显示一般空闲与输入空闲的差别；[原始源](https://gitlab.freedesktop.org/wayland/wayland-protocols/-/blob/main/staging/ext-idle-notify/ext-idle-notify-v1.xml)本次拒绝访问。它仅是协议候选，不承诺 GNOME/KDE 均支持。

systemd 的 freedesktop 文档网页访问失败，改读 systemd 官方仓库源文档。需要实测 LockedHint 是否在目标桌面及时更新，而不是只看到该字段就认为可靠。

## 视觉证据

本地 ui-ux-pro-max style 检索命中 liquid-glass，支持亮暗模式、导航与控件使用、自适应透明度和降低动态/透明度回退。自动设计系统的官网/餐饮布局不适用于此工具，未保存该输出；自定义语义色及不透明表面候选对比度保存在 MASTER.md。

React stack 检索命中有标签的表单控件指导；实现时标签对应输入 ID，不以 placeholder 代替标签。没有运行界面验收。

## 检索路径

按 agent-reach 路由尝试 Exa，但本机 mcporter 未注册 exa，沿用内置浏览工具读取官方文档；未修改检索服务、安装依赖或读取浏览器账户。

## 后续技术验证门槛

- 目标原生系统中的当前会话空闲、锁屏、睡眠、恢复。
- 仅鼠标检测对指针移动、点击、滚轮的覆盖及权限。
- Linux X11 全功能基线；Wayland 单独列能力，不用 Xwayland 开关当作全桌面输入检测证明。
- 多屏、DPI、虚拟桌面、全屏应用、动态托盘数字。
- 实际打包与签名后的通知，能力失败时可理解的回退。

任何核心能力失败都应停止相关提醒或明确受限支持，不能默认未锁屏、伪造活动或静默升级提醒方式。
