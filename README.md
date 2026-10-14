<p align="center">
  <img src="resources/icon.png" alt="EyeCare 图标" width="88" />
</p>

<h1 align="center">EyeCare</h1>

<p align="center">让眼睛歇一会儿。</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT 许可证" /></a>
  <img src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/Electron-44-47848F?logo=electron&amp;logoColor=white" alt="Electron 44" />
</p>

EyeCare 是一款常驻托盘的桌面护眼提醒工具，面向 macOS、Windows 和 Linux。它根据鼠标或键盘的活跃时间提醒你休息，也支持固定周期提醒。设置修改后自动保存，配置与计时在本机处理。

项目仍在迭代中，当前版本为 **1.0.2**。目前没有已发布的 GitHub Release 安装包，可先从源码运行或自行打包。各平台的实际验证范围见[平台支持](#平台支持)。

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

```bash
git clone https://github.com/ShenZiLi/EyeCare.git
cd EyeCare
npm ci
npm start
```

`npm start` 启动 Electron 开发应用和本地 Vite 服务。macOS 系统通知需要完整签名的应用包，验证通知请使用 `npm run make` 生成的 `.app`。

如果当前终端设置了 `ELECTRON_RUN_AS_NODE`，请先移除该环境变量，否则 Electron 会按 Node.js 进程运行。

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

下表区分支持目标与已有实机证据，框架支持或构建成功不代表完整平台验收。

| 平台 | 支持目标 | 当前验证情况 |
| --- | --- | --- |
| macOS | 14+，Apple Silicon / Intel | macOS 26.4 ARM64 已有原生计时、输入、打包、托盘与提醒验证；本地签名包通知提交已验证。Intel、其他系统版本及部分物理场景待验证 |
| Windows | Windows 11 x64 | 已有安装、升级、启动路径、原生计时与提醒周期验证；部分物理场景待验证 |
| Linux X11 | Ubuntu 24.04 GNOME、KDE 6，x64 | 已实现适配器和打包配置，尚无 Linux 实机验收记录 |
| Linux Wayland | 桌面相关能力受限 | 全会话输入检测、定位与全屏覆盖尚未完成可靠验证，不能视为完整支持 |

物理锁屏、睡眠、多显示器、虚拟桌面、启动登录和长时间运行等逐项进展见[验收记录](docs/acceptance.md)与[原生能力证据](docs/platform-evidence.md)。

## 本地打包

```bash
# 生成当前平台的应用目录
npm run package

# 生成当前平台的安装包或压缩包
npm run make
```

应用目录位于 `out/`，分发产物位于 `out/make/`。

| 平台 | 产物 |
| --- | --- |
| macOS | `.app` 应用目录、ZIP |
| Windows | Squirrel 安装程序、ZIP |
| Linux x64 | deb、rpm、ZIP、AppImage |

Linux 构建需要 `fakeroot`、`rpm` 和 `appimagetool`；当前工作流使用 appimagetool 1.9.1。桌面运行需要 GTK3、NSS、XScreenSaver、音频库和会话 D-Bus。AppImage 保留 Chromium 安全沙箱，需要目标环境支持对应沙箱机制。安装依赖的示例见[构建工作流](.github/workflows/build.yml)。

### 签名与发布

macOS 未配置 Developer ID 时，本地打包会对完整应用进行 **ad-hoc 签名**。这可用于本地运行和通知提交验证，不能代替 Developer ID 签名与公证。

| 用途 | 构建环境变量 |
| --- | --- |
| macOS Developer ID 签名 | `EYECARE_SIGN_IDENTITY` |
| macOS 公证，在签名基础上配置 | `EYECARE_APPLE_ID`、`EYECARE_APPLE_PASSWORD`、`EYECARE_APPLE_TEAM` |
| Windows 安装程序签名 | `EYECARE_WINDOWS_CERT_FILE`、`EYECARE_WINDOWS_CERT_PASSWORD` |

凭据应通过本机或 CI 环境提供，不要写入仓库。未配置 Windows 证书时产物不带对应发布签名。

[GitHub Actions 工作流](.github/workflows/build.yml)在 Windows、macOS ARM64 / Intel 和 Ubuntu 上检查与构建，并将产物上传为工作流 artifact；工作流没有自动发布 Release 的步骤。

## 开发与验证

技术栈：**Electron 44 · React 19 · TypeScript · Vite · Electron Forge · Koffi**。

```bash
# 类型检查、lint、单元与集成测试
npm run check

# 构建最新主进程和页面后，运行真实 Electron 界面测试
npm run package
npm run test:e2e
```

也可分别运行 `npm run typecheck`、`npm run lint`、`npm run test:unit` 和 `npm run test:integration`。界面测试使用临时配置目录，不以测试结果替代原生平台验收。

### 原生检查

| 命令 | 用途 |
| --- | --- |
| `npm run probe:platform` | 只读检查当前平台的时钟、输入与会话状态 |
| `npm run verify:macos-runtime` | Mac 原生一分钟周期、隐藏窗口、托盘及蒙版确认检查 |
| `npm run verify:windows-runtime` | Windows 原生两个一分钟周期、隐藏窗口及提醒清理检查 |

运行周期检查时会实际显示闪屏或蒙版，使用隔离配置，不修改用户偏好、登录项或通知授权。结果写入 `docs/` 中对应的 runtime evidence 文件。

### 项目结构

```text
EyeCare/
├── app/
│   ├── main/        # 计时、平台观察、配置持久化、提醒与托盘
│   ├── preload/     # 受限 IPC 桥
│   ├── renderer/    # React 设置页面及提醒界面
│   └── shared/      # 共享类型、固定默认值与配置校验
├── resources/       # 图标和内置资源
├── scripts/         # 构建工具与原生验证脚本
├── tests/           # 单元、集成与 Electron 界面测试
├── docs/            # 平台证据、验收记录及截图
├── design-system/   # 界面设计规范
└── .github/         # 跨平台检查与构建工作流
```

主进程唯一持有计时与提醒状态，页面只负责展示和设置输入。计时不依赖页面定时器，关闭窗口后仍可在托盘运行。

## 隐私与配置

- 不采集按键内容、鼠标轨迹或屏幕画面，仅使用系统活动与空闲状态进行计时。
- 设置保存在 Electron `userData` 应用目录中的 `settings.json`。
- 最后有效配置备份为 `settings.last-good.json`；有效旧版配置升级前保留 `settings.v1-backup.json` 原文件备份。
- 旧版升级保留八项核心选择，旧高级参数不再影响运行。
- 重启恢复设置并开始新周期，不补发关闭期间的提醒。

## 常见问题

### macOS 系统通知失败怎么办？

使用 `npm run make` 生成的已签名 `.app`。若提示通知未被允许，请检查「系统设置 → 通知 → EyeCare → 允许通知」。首次出现系统授权提示时，需要由用户选择是否允许。

通知成功提交不保证立即显示横幅，专注模式和屏幕共享等系统设置也可能影响显示。Electron 的通知签名要求见[官方文档](https://www.electronjs.org/docs/latest/api/notification)。

### 为什么暂时不累计或不提醒？

累计模式在超过 60 秒活动窗口后暂停累计。手动暂停、锁屏、睡眠、长空闲或关键系统状态无法确认时，会抑制新提醒。手动暂停需要点击「恢复提醒」。

### 为什么开机启动设置没有生效？

请先查看应用的保存错误提示和系统登录项设置。注册或保存失败时，应用保留原有效配置，并尝试恢复变更前的系统状态；可在应用中重试。

### 构建成功但找不到完整应用？

同时检查 `out/` 中的应用和 `out/make/` 中的分发产物，不要只看命令退出状态。项目对 `@electron/packager` 的解压依赖有固定覆盖：使用 `@electron-internal/extract-zip@1.0.5`，要求 Node ≥22.12；建议使用仓库规定的 Node 24。

## 参与贡献

欢迎通过 [Issues](https://github.com/ShenZiLi/EyeCare/issues)报告问题或提出建议，通过 [Pull Requests](https://github.com/ShenZiLi/EyeCare/pulls)提交改进。

报告问题时请提供系统版本、CPU 架构、桌面环境或 X11 / Wayland 会话、EyeCare 版本、复现步骤、预期行为和错误截图；不要提交凭据或包含私人信息的配置文件。

提交代码前请运行相关检查，行为变更附上针对性测试；涉及系统能力时，请说明实机验证环境与尚未验证的范围。维护与贡献记录见[仓库贡献者](https://github.com/ShenZiLi/EyeCare/graphs/contributors)。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。Copyright © 2026 EyeCare contributors。
