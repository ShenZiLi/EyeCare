# EyeCare → Tauri 迁移清单

> 目标：把 Electron 44 主进程替换为 Tauri 2（Rust 核心 + 系统 WebView），常驻内存 140MB → 40–80MB，安装包 ~180MB → ~10MB。
> 约束：保持现有三界面（主/设置、托盘、覆盖层）、`RuntimeSnapshot` 契约、定时引擎语义与设置文件兼容。
>
> 分支：`dev-tauri`（从 `main` 切出）；Rust 工具链由根目录 `mise.toml` 提供（cargo 1.99.1），
> 非交互 shell 中请用 `mise exec -- cargo ...`，npm 脚本 `tauri:dev` / `tauri:build` 已内建 `mise exec`。

---

## 进度

| Phase | 状态 | 说明 |
|---|---|---|
| 0 · 基线冻结 | 未做 | 尚未打 tag、未导出契约快照 |
| 1 · Tauri 骨架 | 完成 | `src-tauri/` 已生成并配置（identifier `org.eyecare.desktop`、`windows: []`、`macOSPrivateApi`）；`app/renderer/bridge.ts` 已就绪；`npm run vite:dev` / `vite:build` 已接入；`lib.rs` 用 `WebviewWindowBuilder` 创建主窗口（600×500、`?surface=main`、标签 `main`），并注册 `get_snapshot` / `settings_requested`，前端可直接拿到快照。其余 14 个命令留到 Phase 6 |
| 2 · 定时引擎移植 | 完成 | `src-tauri/src/engine.rs` + `src-tauri/src/engine/tests.rs`，`cargo test` 28 项全部通过 |
| 3 · 平台原生桥 | 完成（macOS） | `src-tauri/src/platform/`：`mod.rs` 移植 `PlatformAdapter`（连续时钟回退、能力报告、显示器、系统主题），`macos.rs` 移植 `createMacProvider`（`mach_continuous_time`、`CGEventSourceSecondsSinceLastEventType`、会话字典 + IOKit `IOConsoleLocked`）。Windows/Linux 按约定先整体降级为 `unsupported`。`reduceMotion` / `reduceTransparency` / `sleeping` 属「外观/系统事件」，留到 Phase 4 |
| 4–8 | 未开始 | — |


## 0. 迁移原则（先定边界）

| 类别 | 处理方式 | 说明 |
|---|---|---|
| 渲染层 `app/renderer/*`（React 19 + `styles.css`） | **原样复用** | 仅替换 `window.eyeCare` 的来源 |
| 契约 `app/shared/contracts.ts` | **原样复用 + Rust 侧镜像** | TS 类型继续给前端用；Rust 侧用 `serde` 结构体对齐 |
| 定时引擎 `app/main/engine/timer-engine.ts` | **重写为 Rust** | 该文件不依赖 Electron，是最适合移植的部分 |
| 平台桥 `app/main/platform/native.ts` | **重写为 Rust** | koffi FFI → 各平台 crate |
| 设置持久化 `settings-store.ts` / `validation.ts` | **重写为 Rust** | 保留原子写 + 备份 + V1 迁移语义 |
| 窗口/托盘/通知/覆盖层 | **改用 Tauri API** | `windows.ts` `coordinator.ts` `tray/presenter.ts` |
| 自启 `platform/autostart.ts` | **半重写** | 基础能力用 `tauri-plugin-autostart`，回滚/迁移语义需自定义 |
| 校验脚本 `scripts/*.cjs` | **重写或保留为 Node 开发工具** | 见 Phase 7 |

> 判断依据：`timer-engine.ts` 与 `settings/validation.ts` 是纯逻辑（无 Electron import），是"照抄"；`index.ts` / `platform/index.ts` / `coordinator.ts` 深度耦合 Electron API，是"重写"。

---

## 1. 目标架构

```mermaid
graph TB
  subgraph RustCore["Rust 核心（常驻，无 WebView）"]
    A[TimerEngine<br/>状态机/计时积分]
    B[PlatformAdapter<br/>空闲/锁屏/时钟采样]
    C[ReminderCoordinator<br/>覆盖层生命周期]
    D[SettingsStore<br/>原子写 + 备份 + V1 迁移]
    E[TrayPresenter<br/>托盘图标/菜单/倒计时]
  end

  subgraph Native["平台原生桥（Rust crate）"]
    N1["macOS: objc2 / core-graphics / core-foundation / IOKit"]
    N2["Windows: windows crate (Raw Input / WTS)"]
    N3["Linux: x11rb + xss"]
  end

  subgraph Web["系统 WebView（按需创建，用完销毁）"]
    W1[主窗口/设置]
    W2[覆盖层 x N 屏]
  end

  A --> B
  B --> Native
  A --> C
  C --> W2
  E --> A
  D --> A
  RustCore <-->|"invoke / event（同一契约）"| Web
```

关键收益点：**空闲态只有 Rust 核心在跑**，WebView 仅在弹设置或覆盖层时创建（`coordinator` 现有 teardown 逻辑正好匹配这个模型）。

---

## 2. 分阶段清单

### Phase 0 · 基线冻结

- [ ] 打 tag 冻结当前 Electron 版本，作为回滚点
- [ ] 记录基线指标：`~/Library/Application Support/EyeCare/settings.json` 内容、4 进程内存、冷启时间
- [ ] 导出当前 IPC 契约快照：`app/shared/contracts.ts` 中 `EyeCareBridge` 的 16 个方法 + 12 个 `eyecare:*` 通道
- [ ] 固化设置文件兼容基线：`settings.json`、`settings.last-good.json`、`settings.v1-backup.json` 三个文件路径与 schema

### Phase 1 · Tauri 骨架

- [ ] 初始化 `src-tauri/`（`Cargo.toml`、`tauri.conf.json`、`build.rs`、`capabilities/`）
- [ ] 保留 Vite 作为前端构建（`vite.renderer.config.ts` 基本沿用），把输出目录指向 Tauri 的 `frontendDist`
- [ ] 配置多窗口入口 URL 带 query，沿用 `?surface=main|tray|overlay` 约定（对齐 `app/renderer/main.tsx#L6-L8`）
- [ ] 接入 `tauri-plugin-single-instance`（对齐 `app/main/index.ts#L212` 的 `requestSingleInstanceLock`）
- [ ] 建立 `bridge.ts`：用 `@tauri-apps/api`（`invoke` + `listen`）实现与 `EyeCareBridge` **同形状**的对象
- [ ] 让 `app/renderer/*.tsx` 不修改即可运行（`App.tsx` / `Overlay.tsx` / `Settings.tsx` 原样）

### Phase 2 · 定时引擎移植（纯逻辑）

- [ ] 在 Rust 实现 `TimerEngine`，逐条对齐 `app/main/engine/timer-engine.ts`：
  - [ ] `acceptSample` 的时钟回退拒绝、`delta > 5000` 告警、积分窗口 union 算法（`L137-L149`）
  - [ ] `active` / `fixed` 两种模式与错过的节拍处理（`L150-L155`）
  - [ ] `suppressed()` / `status()` / `fault()` 的状态优先级（`L37-L59`）
  - [ ] `present` / `cancel` / `settleReminder` / `recordReminderChannels` 的 generation 校验
  - [ ] `longIdle` 与 `absenceSince` 的清零规则（`L128-L132`）
- [ ] 把 `tests/unit/timer-engine.test.ts` 的用例移植为 `cargo test`（同一组输入向量，作为移植正确性判据）
- [ ] 保留 TS 版引擎作为 reference，仅用于对照，不进产物

### Phase 3 · 平台原生桥（koffi → Rust）

按平台逐项替换 `app/main/platform/native.ts`：

- [ ] **macOS 空闲/时钟**
  - [ ] `CGEventSourceSecondsSinceLastEventType(0, 0xffffffff)` → `objc2-core-graphics`
  - [ ] `mach_continuous_time` + `mach_timebase_info` → `objc2-core-foundation` / `libc`
  - [ ] 鼠标源事件掩码列表 `[1,2,3,4,5,6,7,22,25,26,27]` 保持一致
- [ ] **macOS 锁屏**
  - [ ] `CGSessionCopyCurrentDictionary` → `objc2-core-foundation`；键 `CGSSessionScreenIsLocked`、`kCGSSessionOnConsoleKey`、`CGSSessionUserIDKey`
  - [ ] `IOKit` 的 `IOConsoleLocked` 根节点属性
  - [ ] 严格保留"缺失不等于 false"的判定（`native.ts#L172-L180`）
- [ ] **Windows**
  - [ ] `GetLastInputInfo` / `ProcessIdToSessionId` → `windows` crate
  - [ ] `WTSQuerySessionInformationW(WTSConnectState)` + `OpenInputDesktop` → `windows` crate
  - [ ] Raw Input 鼠标桥（`RegisterRawInputDevices` + 隐藏窗口）→ `windows` crate
- [ ] **Linux**
  - [ ] `CLOCK_BOOTTIME` → `libc`
  - [ ] `XScreenSaverQueryInfo` → `x11rb` + `xss`
- [ ] 保留 `NativeProvider` 的 `unknown`/`error` 语义，`PlatformAdapter` 的 capability 上报文案逐条对齐（`platform/index.ts#L24-L30`）

### Phase 4 · 窗口 / 托盘 / 覆盖层 / 通知

- [ ] **主窗口**：对齐 `app/main/index.ts#L93-L125`
  - [ ] 关闭窗口 = 隐藏（首次弹一次性说明对话框），仅托盘可用时允许隐藏
  - [ ] macOS 关闭后隐藏 Dock 图标、重开时恢复（`hideMainDock` / `app.dock` 逻辑 → Rust 侧 `NSApplication` / `set_activation_policy`）
- [ ] **覆盖层**（`coordinator.ts#L88-L122`）
  - [ ] 每显示器一个 `WebviewWindow`：无边框、透明、`skipTaskbar`、不可移动/缩放
  - [ ] 置顶层：`setAlwaysOnTop(true, 'screen-saver')` → Tauri `set_always_on_top`；**跨全屏空间**需额外设 `NSWindowCollectionBehavior`（见风险 R1）
  - [ ] `flash` 用 `show_inactive`，`mask` 可聚焦；非 mask 走 `set_ignore_cursor_events(true)`
  - [ ] `loadSurface` 的 URL 来源校验（`windows.ts` 的 `surfaceURLs` + `trustedSource`）→ Tauri capability/ACL 等价实现
  - [ ] 保留 12s 就绪超时、`render-process-gone`/`unresponsive` 等价事件、热插拔 `refreshDisplays`
- [ ] **托盘**（`tray/presenter.ts`）
  - [ ] 图标 + `iconAsTemplate`（macOS 模板图）
  - [ ] macOS 倒计时 `setTitle(formatTime)` + 等宽数字字体
  - [ ] 右键菜单六项（打开概览 / 暂停·恢复 / 立即提醒 / 设置 / 退出）+ 禁用态
  - [ ] 非 macOS 点击弹菜单
- [ ] **通知**：`tauri-plugin-notification`
  - [ ] 保留"提交超时 8s 判失败"与 macOS 未授权文案（`coordinator.ts#L5-L10`）
  - [ ] 通知点击 → 打开概览
- [ ] **外观/系统事件**
  - [ ] `nativeTheme.shouldUseDarkColors` / `prefersReducedTransparency` → Tauri window theme / `NSAppearance`
  - [ ] `systemPreferences.getAnimationSettings().prefersReducedMotion` → 原生查询
  - [ ] `powerMonitor` 的 suspend/resume/lock-screen/unlock-screen/user-did-resign/become-active → macOS `NSWorkspace` 通知（sleep/wake、`com.apple.screenIsLocked` 分布式通知）
  - [ ] `screen` 的 display-added/removed/metrics-changed → Tauri monitor 事件

### Phase 5 · 设置持久化与自启

- [ ] **SettingsStore 移植**（`settings-store.ts`）
  - [ ] 同款原子写：临时文件 + `fsync` + `rename`，文件权限 `0o600`
  - [ ] 三份文件路径与命名保持一致（`settings.json` / `settings.last-good.json` / `settings.v1-backup.json`）
  - [ ] 备份发布用 `link` 保证"永不覆盖第一份"（`L45-L60`）
  - [ ] V1→V2 迁移与 `revision` 乐观并发（`SETTINGS_CONFLICT`）
- [ ] **`data dir` 兼容迁移（必做）**
  - [ ] 现状：Electron `app.getPath('userData')` = `~/Library/Application Support/EyeCare`
  - [ ] Tauri `app_data_dir()` 默认基于 bundle identifier，路径不同
  - [ ] 首启做一次性迁移：老目录存在且新目录缺失时搬运三份设置文件，失败时保留原文件并给出 warning
- [ ] **自启**（`autostart.ts`）
  - [ ] 基础开关用 `tauri-plugin-autostart`（macOS launchd / Windows 注册表 / Linux `.desktop`）
  - [ ] 迁移 `prepareLoginChange` 的 **capture → apply → 校验 → rollback** 语义（Windows 需保留 `StartupApproved` 二进制值校验）
  - [ ] 迁移 Windows 旧 Squirrel 启动项升级 `migrateWindowsLaunchAtLogin`
  - [ ] 迁移 `autostartExecutable` 的 AppImage/`APPDIR` 路径保护
- [ ] `save-with-login.ts` 的"设置先落盘、自启后应用、失败回滚"编排保持一致

### Phase 6 · IPC 契约对齐

- [ ] 在 Rust 侧实现 16 个命令，名称与载荷字段与 `EyeCareBridge` 一一对应
- [ ] 事件通道对齐：`eyecare:snapshot-updated`、`eyecare:overlay-updated`、`eyecare:open-settings`
- [ ] 移植 `ipc-validation.ts`：来源信任校验、payload 白名单、`Result<T>` 错误码（`0001`/`REMINDER_BUSY`/`STALE_REMINDER`…）
- [ ] 保留命令串行化（`commandQueue`，`index.ts#L145-L148`）
- [ ] 错误码与文案逐条对齐 `contracts.ts#AppError` 与现有 `CommandError`

### Phase 7 · 打包 / 签名 / 验收脚本

- [ ] `tauri.conf.json` bundle：`identifier = org.eyecare.desktop`、`category = public.app-category.healthcare-fitness`、图标 `resources/icon`
- [ ] macOS 签名/公证沿用现有环境变量：`EYECARE_SIGN_IDENTITY` / `EYECARE_APPLE_ID` / `EYECARE_APPLE_PASSWORD` / `EYECARE_APPLE_TEAM`
- [ ] 产物：`.app`/`.dmg`(macOS)、NSIS(Windows)、`.deb`/`.rpm`/AppImage(Linux)
- [ ] `scripts/probe-platform.cjs`、`verify-macos-runtime.cjs`、`verify-windows-runtime.cjs` → 改为 Rust 侧自检命令或 Node CLI 抽取
- [ ] `tests/integration/*` 与 `tests/e2e/*` 映射到 `cargo test` + tauri-driver（WebDriver）
- [ ] 保留 lint/typecheck 门禁：`npm run typecheck && npm run lint`（前端）+ `cargo clippy`（Rust）

### Phase 8 · 验收

- [ ] 内存达标：空闲态总 RSS ≤ 80MB（目标 40–60MB），且无 WebView 常驻进程
- [ ] 功能对齐：暂停/恢复、立即提醒、预览、三显示器覆盖、锁屏抑制、长空闲清零、通知通道
- [ ] 设置兼容：直接把旧 `settings.json` 放进新目录后启动，revision 与字段一致
- [ ] 自启：三平台开关 + 回滚路径各验证一次
- [ ] 崩溃恢复：覆盖层窗口被杀后按现有"安全关闭"语义收尾

---

## 3. 文件级映射表

| 现有文件 | 目标 | 动作 |
|---|---|---|
| [app/renderer/App.tsx](file:///Users/shen/Studio/Code/EyeCare/app/renderer/App.tsx) / Overlay.tsx / Settings.tsx / components.tsx / styles.css | 就地保留 | 复用（零改动） |
| [app/renderer/main.tsx](file:///Users/shen/Studio/Code/EyeCare/app/renderer/main.tsx) | 就地保留 | 仅新增 `import './bridge'`，保留 `?surface=` 分发 |
| [app/shared/contracts.ts](file:///Users/shen/Studio/Code/EyeCare/app/shared/contracts.ts) | `src/shared/contracts.ts` + `src-tauri/src/contracts.rs` | 复用 + Rust 镜像 |
| [app/main/engine/timer-engine.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/engine/timer-engine.ts) | `src-tauri/src/engine.rs` | 重写（Rust） |
| [app/main/platform/native.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/platform/native.ts) | `src-tauri/src/platform/{macos,windows,linux}.rs` | 重写（crate 替换 koffi） |
| [app/main/platform/index.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/platform/index.ts) | `src-tauri/src/platform/mod.rs` | 重写 |
| [app/main/reminders/coordinator.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/reminders/coordinator.ts) | `src-tauri/src/reminders.rs` | 重写（Tauri window） |
| [app/main/tray/presenter.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/tray/presenter.ts) + icon.ts | `src-tauri/src/tray.rs` | 重写（Tauri tray） |
| [app/main/settings/settings-store.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/settings/settings-store.ts) | `src-tauri/src/settings/store.rs` | 重写 |
| [app/main/settings/validation.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/settings/validation.ts) / legacy-validation.ts | `src-tauri/src/settings/validation.rs` | 重写（纯逻辑） |
| [app/main/settings/save-with-login.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/settings/save-with-login.ts) | `src-tauri/src/settings/save.rs` | 重写 |
| [app/main/platform/autostart.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/platform/autostart.ts) | `src-tauri/src/autostart.rs` | 半重写 |
| [app/main/windows.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/windows.ts) | `src-tauri/src/windows.rs` | 重写 |
| [app/main/ipc-validation.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/ipc-validation.ts) | `src-tauri/src/ipc.rs` | 重写 |
| [app/main/index.ts](file:///Users/shen/Studio/Code/EyeCare/app/main/index.ts) | `src-tauri/src/lib.rs` + `main.rs` | 重写（应用编排） |
| [app/preload/index.ts](file:///Users/shen/Studio/Code/EyeCare/app/preload/index.ts) | `app/renderer/bridge.ts` | 替换（Tauri invoke/listen） |
| [forge.config.ts](file:///Users/shen/Studio/Code/EyeCare/forge.config.ts) | `src-tauri/tauri.conf.json` | 替换 |
| [vite.renderer.config.ts](file:///Users/shen/Studio/Code/EyeCare/vite.renderer.config.ts) | 同文件 | 沿用（调 `build.outDir`） |
| [vite.main.config.ts](file:///Users/shen/Studio/Code/EyeCare/vite.main.config.ts) / vite.preload.config.ts | — | 删除 |
| [tests/unit/timer-engine.test.ts](file:///Users/shen/Studio/Code/EyeCare/tests/unit/timer-engine.test.ts) | `src-tauri/src/engine.rs#[cfg(test)]` | 移植 |
| [tests/integration/*](file:///Users/shen/Studio/Code/EyeCare/tests/integration) / e2e/* | `src-tauri/tests/` + tauri-driver | 移植 |

---

## 4. 关键风险与验收点

| 编号 | 风险 | 验收方式 |
|---|---|---|
| R1 | 覆盖层要压过全屏应用并跨所有 Space。Tauri `set_always_on_top` 不足，需 objc 设 `NSWindowCollectionBehavior.canJoinAllSpaces \| .fullScreenAuxiliary` 与合适的 window level | 在全屏 Safari/视频下触发提醒，多 Space 各验一次 |
| R2 | macOS 锁屏判定：必须保留"键缺失 ≠ false"的保守语义，否则锁屏期间会误发提醒 | 反复锁/解锁各 10 次，确认状态切换与抑制 |
| R3 | 通知权限与签名强相关，未签名包在 macOS 可能拿不到授权 | 用正式签名包验证通知送达与点击 |
| R4 | WebView 常驻会吃掉全部收益——必须保证空闲态创建了 0 个 WebView | 空闲 10 分钟后 `ps`/`top` 确认无 webview 子进程 |
| R5 | 设置目录变更导致老用户配置丢失 | 首启迁移 + 断网/只读目录下的失败保留验证 |
| R6 | Windows 自启回滚需读写 `StartupApproved` 二进制值，`tauri-plugin-autostart` 不覆盖 | 单独回归 `prepareLoginChange` 的三段语义 |

---

## 5. 回滚策略

- 保留 Electron 分支与 tag，Phase 1–6 期间不删 `forge.config.ts` 与 `app/preload`
- Rust 侧与 TS 侧共用同一份 `contracts.ts`，契约变更必须双改
- 迁移完成且 Phase 8 全部通过后，再删除 Electron 相关文件与依赖
