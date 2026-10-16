<p align="center">
  <img src="resources/icon.png" alt="EyeCare 图标" width="88" />
</p>

<h1 align="center">EyeCare</h1>

<p align="center">让眼睛歇一会儿。</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT 许可证" /></a>
  <img src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&amp;logoColor=white" alt="Tauri 2" />
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

EyeCare 是一款常驻托盘的桌面护眼提醒工具，面向 macOS、Windows 和 Linux。它根据鼠标或键盘的活跃时间提醒你休息，也支持固定周期提醒。设置修改后自动保存，配置与计时在本机处理。

当前分支仅保留 **Tauri 2 + Rust** 实现，版本为 **1.0.3**。既有发行包及原生验收记录可能来自旧 Electron 实现，不能作为当前 Tauri 分支的验收结论。

[快速开始](#快速开始) · [使用说明](#使用说明) · [本地打包](#本地打包) · [常见问题](#常见问题) · [参与贡献](#参与贡献)

## 功能

- **两种计时模式**：累计鼠标或键盘活跃时间，或按固定周期提醒。
- **四种提醒方式**：柔和闪屏、确认蒙版、系统通知、仅声音；视觉提醒可叠加声音。
- **自动识别离开状态**：长空闲清零，锁屏、睡眠或关键检测异常时停止新提醒，恢复后不补发旧提醒。
- **托盘常驻**：显示倒计时，提供暂停、恢复、立即提醒、设置与退出菜单。
- **手动暂停**：暂停后由用户点击恢复，不自动恢复。
- **即时设置**：仅保留八项核心配置，无需点击保存。
- **亮暗主题**：支持亮色、暗色和跟随系统，采用紧凑的 Liquid Glass 界面。
- **系统偏好适配**：自动遵循减少动态、减少透明度等系统偏好。

## 快速开始

### 环境要求

- Node.js **24**，仓库构建工作流使用 **24.15.0**。
- npm **11**。
- Git，以及当前系统的桌面会话。

依赖版本由 [package-lock.json](package-lock.json) 锁定。请在目标平台上运行和打包，支持情况见下方说明。

### 从源码启动

还需通过 mise 安装 Rust **1.90+**（`mise install`），并准备目标平台构建依赖：macOS 的 Xcode 命令行工具、Windows 的 MSVC C++ 工具与 WebView2，或 Linux 的 WebKitGTK 4.1 等开发库。

```bash
git clone https://github.com/ShenZiLi/EyeCare.git
cd EyeCare
npm ci
npm start
```

`npm start` 启动 Tauri 应用与本地 Vite 服务。`npm run vite:dev` 仅启动前端预览，原生命令需要在 Tauri 宿主中使用。

## 使用说明

1. 在「触发条件」选择计时模式并设置时间。
2. 在「提醒方式」选择视觉方式和声音开关，可通过「预览效果」查看提醒。
3. 关闭主窗口后继续在托盘运行；点击托盘打开菜单。选择「退出 EyeCare」才会停止服务。没有可靠托盘的环境会保留可找回的主窗口。

设置修改后自动保存。数值输入在停止输入约 300 毫秒或失去焦点后保存；无效值或保存失败会显示原因，并保留原来的有效配置。恢复默认设置需要确认一次。

### 核心设置

| 页面 | 设置 | 默认值 | 可选范围 |
| --- | --- | --- | --- |
| 触发条件 | 计时模式 | 累计活跃时间 | 累计活跃时间 / 固定周期 |
| 触发条件 | 提醒时间 | 30 分钟 | 整数 1–240 分钟 |
| 触发条件 | 空闲清零时间 | 10 分钟 | 整数 1–120 分钟；累计活跃模式下显示 |
| 提醒方式 | 主视觉方式 | 柔和闪屏 | 柔和闪屏 / 确认蒙版 / 系统通知 / 仅声音 |
| 提醒方式 | 启用声音提醒 | 关闭 | 开启 / 关闭 |
| 通用设置 | 主题 | 跟随系统 | 跟随系统 / 亮色 / 暗色 |
| 通用设置 | 托盘倒计时 | 开启 | 开启 / 关闭 |
| 通用设置 | 开机启动 | 关闭 | 开启 / 关闭 |

累计活跃模式将提醒时间显示为「活跃提醒时间」，固定周期模式显示为「间隔时间」。选择「仅声音」会自动开启声音，不能关闭唯一提醒通道。默认窗口为 **600 × 620** 逻辑像素，窄窗使用图标导航，按钮悬停可查看页面名称。

### 计时与提醒规则

| 场景 | 行为 |
| --- | --- |
| 累计活跃 | 鼠标或键盘任一活动维持固定 60 秒活动窗口；窗口外暂停累计 |
| 固定周期 | 按设定间隔提醒；被锁屏、睡眠、暂停等状态抑制的周期直接跳过 |
| 达到长空闲阈值 | 清零进度并停止新提醒；手动暂停期间仍会清零 |
| 柔和闪屏 | 全屏纯黑蒙版渐入、停留、渐出，总计约 2 秒；最高不透明度 90%，不抢焦点、可点击穿透 |
| 确认蒙版「知道了」 | 关闭所有关联蒙版，记为一次休息确认，清零并开始下一轮 |
| 关闭蒙版 / Escape | 跳过本轮并开始下一轮，不记为休息确认 |
| 通知提交 / 声音结束 | 自动结束本轮，不记为休息确认 |
| 预览效果 | 不改变真实计时进度或休息确认 |

提醒覆盖全部显示器，声音使用内置轻柔音效和固定 50% 音量。活动窗口、效果参数、文案、音效与屏幕范围采用固定约定，不提供高级配置或延期提醒。

## 平台支持

构建目标为 macOS、Windows 和 Linux。macOS 已有原生输入、时钟与锁屏适配；Windows 和 Linux 当前会报告能力受限，关键状态未知时暂停提醒。平台功能对齐、物理锁屏和睡眠、多显示器、通知送达及登录自启仍需 Tauri 实机验收。

`docs/` 中保留迁移进度和旧版实现的历史证据。旧 Electron 验收结果不代表 Tauri 行为已获验证。

## 本地打包

```bash
npm run package   # 编译应用，不生成安装包
npm run make      # 编译并生成原生安装包
```

产物位于 `src-tauri/target/release/bundle/`：macOS 为 DMG/app，Windows 为 MSI/NSIS，Linux 为 deb/rpm/AppImage。请在目标系统上构建，CI 覆盖四组系统及架构。

签名使用 Tauri 的平台配置，旧 Forge 签名环境变量已不再使用。仍可通过工作流的 `publish_release` 选项发布；已发布版本不能覆盖。

## 开发与验证

技术栈：**Tauri 2 · Rust · React 19 · TypeScript · Vite**。

```bash
npm run check             # 类型检查、lint、前端及 Rust 测试
npm run test:unit         # 前端设置与控制器测试
npm run test:integration  # Rust 运行时测试
npm run vite:build        # 前端生产构建
npm run tauri:build       # 原生生产构建与打包
```

Electron 专属界面测试和探针已移除。自动测试验证逻辑，原生界面仍需独立实机验收。

```text
EyeCare/
├── app/renderer/   # React 页面、覆盖层与 Tauri IPC 桥
├── app/shared/     # TypeScript 契约与配置校验
├── src-tauri/      # Rust 计时、平台适配、配置、托盘与提醒
├── tests/unit/     # 前端控制器与设置测试
├── resources/      # 源图与生成资源
├── scripts/        # 资源生成工具
└── docs/           # 迁移说明与历史验收证据
```

Rust 运行时持有计时与提醒状态，页面负责展示快照和发送命令。关闭主窗口后仍可在托盘运行。

## 隐私与配置

- 不采集按键内容、鼠标轨迹或屏幕画面，仅使用系统活动与空闲状态进行计时。
- 设置保存在 Tauri 应用数据目录（`org.eyecare.desktop`）中的 `settings.json`。需要时从旧 EyeCare 目录导入已有设置。
- 最后有效配置备份为 `settings.last-good.json`；有效旧版配置升级前保留 `settings.v1-backup.json` 原文件备份。
- 旧版升级保留八项核心选择，旧高级参数不再影响运行。
- 重启恢复设置并开始新周期，不补发关闭期间的提醒。

## 常见问题

### macOS 系统通知失败怎么办？

请使用打包应用，并检查「系统设置 → 通知 → EyeCare」的权限。专注模式和屏幕共享可能影响横幅；成功提交不保证可见送达。

### 为什么暂时不累计或不提醒？

累计模式在超过 60 秒活动窗口后暂停累计。手动暂停、锁屏、睡眠、长空闲或关键系统状态无法确认时，会抑制新提醒。手动暂停需要点击「恢复提醒」。

### 为什么开机启动设置没有生效？

请先查看应用的保存错误提示和系统登录项设置。注册或保存失败时，应用保留原有效配置，并尝试恢复变更前的系统状态；可在应用中重试。

### 构建成功后在哪里找应用？

运行 `npm run make` 后检查 `src-tauri/target/release/bundle/`。`npm run package` 仅编译，不生成安装包。

## 参与贡献

欢迎通过 [Issues](https://github.com/ShenZiLi/EyeCare/issues)报告问题或提出建议，通过 [Pull Requests](https://github.com/ShenZiLi/EyeCare/pulls)提交改进。

报告问题时请提供系统版本、CPU 架构、桌面环境或 X11 / Wayland 会话、EyeCare 版本、复现步骤、预期行为和错误截图；不要提交凭据或包含私人信息的配置文件。

提交代码前请运行相关检查，行为变更附上针对性测试；涉及系统能力时，请说明实机验证环境与尚未验证的范围。维护与贡献记录见[仓库贡献者](https://github.com/ShenZiLi/EyeCare/graphs/contributors)。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。Copyright © 2026 EyeCare contributors。
