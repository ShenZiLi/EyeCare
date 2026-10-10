# EyeCare

常驻桌面的护眼提醒工具。鼠标或键盘活动累计到设定时长后温和提醒，也可切换固定周期。全部设置保存在本机，不采集按键内容、鼠标轨迹或屏幕画面。

## 使用

- 默认累计活跃 30 分钟，活动窗口 60 秒，长空闲 10 分钟后清零。
- 默认全屏柔和闪屏，约 2 秒后自动结束，不抢焦点、不阻挡点击。声音默认关闭。
- 蒙版“知道了”视为完成一次休息；Escape 跳过，延期不会记为休息。
- 主题与托盘倒计时开关即时保存；其他设置点击“保存设置”一次生效。
- 主窗口关闭后继续运行，托盘提供概览、暂停、恢复、立即提醒、设置和退出。没有已确认可用托盘的环境保留可找回的主窗口。
- 锁屏、睡眠、长空闲和关键能力未知时停止新提醒；恢复不会补弹旧事件。

默认时间属于产品配置。软件不提供医疗诊断或治疗效果承诺。

## 开发与验证

构建环境：Node 24.15.0 / npm 11；依赖版本和完整性固定在 `package-lock.json`。

```sh
npm ci
npm start
npm run check
npm run package
npm run test:e2e
npm run make
```

界面测试直接启动真实 Electron 应用，使用临时配置目录；测试前需要 `npm run package` 构建最新主进程及页面。`npm run probe:platform` 运行只读当前会话探针。`node_modules/electron/dist/electron.exe scripts/probe-platform-electron.cjs` 在 Windows 验证实际 Electron 状态；环境变量 `ELECTRON_RUN_AS_NODE` 必须不存在。

GitHub 网络不可达时，构建命令可临时设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 与 `ELECTRON_CUSTOM_DIR={{ version }}`；下载仍由 Electron 内置 checksum 校验。镜像不是运行时依赖。

Windows 输出 Squirrel 安装程序和 ZIP；macOS 原生构建输出各架构 ZIP；Linux x64 输出 deb、rpm、ZIP 和 AppImage。Linux 构建需 `fakeroot`、`rpm`、`appimagetool`（官方 1.9.1），桌面运行依赖 GTK3、NSS、XScreenSaver、音频库及当前会话 D-Bus。AppImage 不关闭 Chromium 安全沙箱，需要目标环境允许相应沙箱机制。跨平台构建工作流在 `.github/workflows/build.yml`，当前未在远程运行。

## 签名与发布

本机产物未签名。Windows 配置 `EYECARE_WINDOWS_CERT_FILE`、`EYECARE_WINDOWS_CERT_PASSWORD` 后由 Squirrel 签名；macOS 配置 `EYECARE_SIGN_IDENTITY`，公证还需 `EYECARE_APPLE_ID`、`EYECARE_APPLE_PASSWORD`、`EYECARE_APPLE_TEAM`。凭据通过构建环境提供，禁止写入仓库。

没有自动上传或发布流程。安装包构建通过不能证明原生锁屏、多屏、虚拟桌面、通知或签名验收。平台和逐项交付进展见 [验收记录](docs/acceptance.md) 与 [原生能力证据](docs/platform-evidence.md)。

## 结构

`app/shared` 定义共享数据与白名单桥；`app/main` 唯一持有计时、平台状态、持久化和提醒；`app/preload` 隔离 IPC；`app/renderer` 提供 React 页面、托盘面板和提醒。计时不依赖页面定时器，关闭页面不丢失计时。
