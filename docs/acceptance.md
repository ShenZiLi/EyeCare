# Delivery acceptance audit

Original scope: `.trellis/tasks/10-10-eyecare-product-design/prd.md`, R1–R16 and AC1–AC22. User authorized implementation on 2026-10-10. A local implementation/build is not release-complete acceptance.

## Deep flash continuation — 2026-10-13

- User requested a very deep veil. Fixed flash defaults now use90% opacity/pure black in both themes, superseding earlier20/40% theme-derived builds. Renderer consumes immutable event color;600/800/600ms timing,nonfocusable/click-through,automatic completion and preview isolation remain.
- Typecheck/lint and185 unit/integration cases passed. Actual rebuilt ARM package previews in both light/dark measured rgb(0,0,0),0.9 peak opacity and2000ms animation duration; windows were nonfocusable and ignored mouse events. Both automatically cleared every overlay without rest confirmation/timer reset. Peak was sampled by temporarily moving animation time; observed total elapsed includes window loading. Current OS reduced-motion=false; the unchanged static branch was reviewed separately. Evidence: deep-flash-evidence.json.
- Final user application was restarted and the new flash preview started through its native UI. No preference or OS login changes were made by verification. Latest ZIP SHA256: `5f3d9bad1adcdec9ab3f4fcc35f669a938cf764569a5dffdfef7e59ba81901b9` (version1.0.2); earlier hashes below identify previous builds.

## Tray menu continuation — 2026-10-13

- User requested tray clicks show only the existing native menu. Removed custom panel creation/lifecycle and its IPC sender role. macOS relies on its registered native menu; other platforms left-click opens that same menu. Countdown and menu callbacks remain main-owned.
- Final typecheck/lint and185 unit/integration cases passed. Rebuilt actual ARM production executable passed an isolated tray probe: one BrowserWindow before/after an emitted click, no custom tray surface, native menu popup, countdown title and working overview/pause/resume/settings callbacks. Login state stayed unchanged and temporary profile was removed. This is emitted-event/native-popup observation, separate from physical pointer-click acceptance and native Windows/Linux verification. Evidence: tray-menu-evidence.json.
- Final user app was quit through its native application menu and restarted with the rebuilt production renderer. Latest ZIP SHA256: `0e672732dc8c808464789f7d914935546201040346f24a7a8e7ec2a046f2ca0d` (version1.0.2). Earlier hashes below identify earlier builds. Cached Electron archive matched the installed official package checksum; local checksum verification avoided a remote checksum download timeout without disabling integrity checks.

## V2 evidence — 2026-10-13

- Implemented exactly eight autosaved core choices across the three settings pages, fixed internal effect/activity defaults and complete runtime/UI/API snooze removal. Only-sound selection enables its sole channel; restore defaults confirms once; General login failures display the unchanged effective value and retain retry intent.
- Final `npm run check` passed TypeScript, ESLint and **185 unit/integration cases**. Final actual Mac Electron suite passed **15 GUI cases**, including eight-control layout, immediate saves, conflict/validation/retry, restart persistence, preview isolation, acknowledgement/skip, and synthetic login/disk failures without changing real login items.
- Review reproduced a saved-preference/actual-OS divergence rollback defect. The save transaction now captures **actual OS state before mutation**, restores it after apply or persistence failure, and reports capture/rollback failures accurately. Tests cover Mac login read-back, exact owned Windows registry values/approval bytes and Linux entry bytes/mode/absence. Windows/Linux transaction tests are injected on this Mac; native-host execution remains pending.
- Rebuilt ARM64 `.app` and ZIP at unchanged version1.0.2. Current ZIP SHA256: `5501f6421899f830966413dfd4fe8a8b314fe474298d3dedf9edc67d3fc9d083`.
- Actual packaged production renderer/native bridge migrated a customized V1 fixture into exactly eight V2 fields, retained core choices, applied fixed defaults, preserved the original-byte backup over restart, rejected old snooze IPC and persisted subsequent UI edits. A real mask acknowledgement recorded one rest, removed all overlays and began a full normal cycle. Backup-publication failure retained original V1 data and warned; a later UI save retried upgrade, preserved the original backup and restarted healthy. Temporary profiles were deleted; OS login settings stayed unchanged. Raw evidence: `simplified-settings-evidence.json`.
- Current `macos-runtime-evidence.json` was regenerated using V2: one real native one-minute hidden-main flash cycle, advancing menu-bar countdown, no-reset tray toggle and one real mask acknowledgement/cleanup passed over approximately66.9 seconds. This replaces that JSON's earlier V1 observations; historical Windows and Mac package records below remain versioned evidence.
- Final production app was opened through the native UI and each page was inspected: Trigger3, Reminder2 with one preview button, General3 with restore and no save bar; left running on Overview. Navigation made no preference edits. Updated Mac screenshots preserve the original Windows filenames. Full physical/cross-platform/signing/long-run acceptance remains open.

## Historical evidence (earlier product contracts/builds)


- Immediate-settings continuation (2026-10-13): trigger/reminder pages remove manual save/discard controls. Discrete choices persist immediately; numeric/text input saves after300 ms or blur. Serialized versioned field intents retain rapid changes, keep invalid/failed inputs and preserve unrelated valid edits and manual General drafts. TypeScript/ESLint and162 unit/integration cases pass (11 settings-editor regressions). The final rebuilt Mac suite passed11 actual Electron GUI cases, including rapid changes/restart persistence, invalid/coupled recovery and a real disk-write failure/retry. Isolated packaged `.app` GUI saves and exact expected disk values passed (`instant-settings-evidence.json`).
- Earlier immediate-settings Mac UI ZIP SHA256: `c79442584f443d9046a8ce1a0f4e8913226f8e33756a22d93b07f042c683659e` (2026-10-13 build at the unchanged package version1.0.2). Earlier hashes below identify earlier builds. Source tests now prefix Mac screenshots and retain the original Windows images. Full physical/release acceptance remains pending as recorded below.
- macOS continuation (2026-10-12): `npm run check` passed TypeScript, ESLint and all 151 unit/integration cases. The 25 new native-provider regressions plus updated lock-event integration prove current-session/key validation, locked precedence, native-failure safety and cleanup. Real macOS 26.4 ARM64 input/continuous-clock/unlocked-state probes passed; this does not establish physical lock/sleep transitions.
- `npm run verify:macos-runtime` passed one actual one-minute flash cycle with the main window hidden, advancing native menu-bar countdown and immediate countdown toggle without timer reset. Flash completed without rest confirmation; a subsequent real mask acknowledgement confirmed exactly one rest and removed all overlays. Temporary preferences were removed and OS login settings remained unchanged. Raw evidence: `macos-runtime-evidence.json`.
- Mac ARM64 1.0.2 `.app` and ZIP were produced after replacing only the packager's faulty ZIP extractor. ZIP SHA256: `1d28f882efb72d2bdcb28ccbe9c830de91f6b488d07734676b3a927c8630fc97`. Intel and other supported macOS versions remain unverified; no Developer ID identity is installed for distribution signing/notarization.
- Nine real Electron GUI tests passed on Mac: the eight shared source GUI cases plus concurrent isolated native instances. The packaged `.app` launched from its real executable with isolated Chromium userData, loaded its production renderer/native Koffi bridge and reported available input/mouse/lock/overlay/tray with counting state, then exited cleanly (`macos-package-evidence.json`). Mac screenshots use `macos-` filenames to preserve the earlier Windows evidence.
- `npm run check`: TypeScript + ESLint + 125 unit/integration assertions passed for 1.0.2. The added27 autostart cases cover persistent Squirrel/AppImage paths, exact owned-entry migration, system-disabled state preservation and safe removal with a missing launcher.
- `npx playwright test tests/e2e/desktop.test.ts` and `npx playwright test tests/e2e/packaged.test.ts`: all 12 actual Electron tests passed on Windows 11 Pro build28000 x64 (8 source UI + 4 distribution/installed). UI cases cover isolated previews, page-load failure, keyboard focus and draft persistence. Two new installed-app restart tests migrate enabled/disabled legacy entries even when the old version directory no longer exists.
- `npm run make`: Windows x64 1.0.2 Squirrel installer, nupkg and ZIP produced. Silent installer upgraded the existing installation to `%LOCALAPPDATA%/EyeCare/app-1.0.2`; installed app starts with native dependencies and exits cleanly. Installer remains unsigned.
- Actual installed-app login-startup registration now uses the persistent `%LOCALAPPDATA%/EyeCare/eyecare.exe` launcher. Registration and both legacy migration approval states were read back through Electron; tests restored original disabled settings and removed their owned entry. This proves registration/migration/read-back, not a reboot/logon acceptance run. Missing or unrelated OS entries are not recreated automatically.
- Artifact SHA256: installer `46FDF43F7EDA4CAF00EED29A84E6340EAED04C61CFB75DED38DA898F84FA6E8F`; ZIP `2A0C994B69FE4368D7BECAE6E625B441274305E19C23BA96FA8A1335D5D1BBF5`. Hashes identify the 1.0.2 build, not subsequent regenerated artifacts.
- The actual light mask's computed panel/backdrop/text colors pass >=4.5:1 modeled composition against black and white background extrema. The mask uses a dedicated96%-opaque readable surface; actual complex wallpaper/DPI acceptance remains pending.
- `performance-evidence.json` records three real installed-process CPU/RSS samples over6 seconds. This is a short startup observation, not sustained idle/active long-run acceptance.
- `npm run verify:windows-runtime` passed against the rebuilt 1.0.1 source application using the real `GetTickCount64` clock and isolated settings. Over approximately 136 seconds, exactly two configured one-minute cycles dispatched and automatically settled; the first ran while the main window was hidden, both ended without rest confirmation, and no overlay remained. Raw timing/CPU/RSS observations are in `windows-runtime-evidence.json`. This is a two-cycle native integration observation, not physical input/lock/sleep/multi-display or hours-long stability acceptance.
- Actual Windows clock/input/unlocked-state observations are in `platform-evidence.md`. These do not establish native lock/sleep transitions.
- Screenshots from actual application windows are under `docs/screenshots`.

## Requirement-by-requirement evidence

| Acceptance | Implemented behavior and proof | Remaining evidence needed |
|---|---|---|
| AC1 / R1 | Platform adapters, native makers, CI build matrix; Windows11 app installed/upgraded, launched and exited | macOS14+ ARM/Intel, Ubuntu24 GNOME X11/KDE6 X11 installed packages and all native assertions; remaining Windows native scenarios; signatures/notarization; explicit Wayland report |
| AC2 / R3 | Fixed engine deadlines, unit tests normal/skipped beats; two actual Windows one-minute cycles dispatch exactly once, including hidden main window | Longer native runs and other target-host cadence |
| AC3 / R4 | Interval/window intersection, delayed and fractional sampling tests | Normal real-input timing drift <=2s over sustained run |
| AC4 / R5,R12 | Shared suppression and long-idle reset, boundary unit tests | Physical idle/recovery with all four reminder channels |
| AC5 / R6 | Immediate power events, native lock queries, generation cancellation, fault tests | Real lock-at-dispatch, startup locked, sleep/resume; audio stops on physical events |
| AC6 / R7 | Default two-second flash; actual Electron nonfocusable window and automatic cleanup test | Desktop application click-through, complex wallpapers and fullscreen Spaces/native focus |
| AC7 / R8 | Actual real mask acknowledgement increments once; engine multi-screen idempotence | Two or more physical displays confirming linked cleanup/focus restoration |
| AC8 / R9,R10 | Native Notification adapter and bundled audio, actual sound-only test, error reports | Packaged/signed notification delivery and click; physical output devices and failure behavior |
| AC9 / R12 | 25-minute progress +10-minute idle reset while paused; modified threshold tests | Native continuous clock/idle threshold validation |
| AC10 / R3,R6 | Missed periods/absence tests never queue old reminders | Long sleep, lock and suspension on all target hosts |
| AC11 / R15 | One engine identity/generation; stale/multi-screen/duplicate-action tests; removed snooze rejected; coordinator cancellation tests | Real hotplug and rapid cross-window actions |
| AC12 / R4 | Fixed combined keyboard/mouse input and60-second activity window; native Windows/macOS/Linux input adapters | Actual physical keyboard/mouse activity and native permission cases |
| AC13 / R8,R16 | Real-vs-preview, Escape and acknowledgement e2e/unit tests | Native multi-screen preview and suppression combinations |
| AC14 / R16,R1 | Atomic prefs, fresh restart counters, deferred timer settings, hotplug coordinator; actual Windows install/upgrade/relaunch | Tray recovery, hotplug during overlays, foreground restoration; other target hosts |
| AC15 / R11 | Shared snapshot tray/title/overview, immediate persisted toggle, e2e paused-counter preservation; actual packaged native menu-only probe | Physical tray menu activation, DPI and actual tray background changes; native Windows/Linux menu click |
| AC16 / R13,R14 | Exact MASTER tokens, real dark/light mode, automatic persistence e2e | System-theme native changes and all overlay/tray surfaces |
| AC17 / R13,R14 | Opaque/transparency and motion fallbacks, keyboard focus/scroll padding, minimum-width test | Composite contrast over real bright/dark/complex backgrounds, 100/125/150/200% scaling and large-font keyboard traversal |
| AC18 / R15,R16 | Strict defaults asserted by unit tests and real first-run app | Installed first-run verification on each target host |
| AC19 / R1,R6 | Fail-closed native lock state, Linux dual checks, fault/disagreement/cache tests | Real GNOME/KDE desktop-service restart, lock and Wayland capability reports |
| AC20 / R15 | Actual flash automatic end without rest; mask Escape/ack distinction | Native timing/focus/input interruption |
| AC21 / R16 | Strict V2/legacy validation, original-byte migration backup/write failure/retry, actual packaged upgrade/restart, revision/invalid-input e2e, theme no-reset and eight-field autosave; actual-OS rollback regressions; persistent startup paths and earlier installed registration/migration/read-back | Native Windows/Linux rollback, Linux autostart execution, preference updates during physical reminders; actual reboot/logon |
| AC22 / R2 | Engine shared gate across both modes/all visual channels, preview identity isolated | Installed native gate combinations across all supported hosts |

## Native acceptance protocol

For each target host, record OS/build, Electron version, desktop/session protocol, hardware/displays/scales, package SHA256, installation method and signature result. Test startup already locked, just-before-dispatch lock, sleep spanning >=3 periods, user pause preserved across short lock, long idle while paused, active reminders interrupted by lock/idle/fault, keyboard-only and mouse-only activity under combined detection, and native failures. Inspect for any residual overlay or sound and any old event revived after resume.

On two or more displays, test fixed all-screen coverage, unplug a screen while reminding, primary reassignment and renderer crash. Verify click-through flash against another app, mask Tab/Shift+Tab/Escape, foreground restoration and fullscreen/virtual desktops. Test notification denial and stale clicks, the built-in gentle audio and missing devices. Inspect tray <1/99+ and paused/idle/fault states at each DPI, close/reopen/main-window fallback and explicit quit.

Run both palettes over bright/dark/complex actual desktops and each supported scale, measure composed text >=4.5:1 and essential controls >=3:1. Record CPU/RSS during at least a sustained idle/active session; mocks and framework capability flags cannot substitute for this evidence.

## Release blockers

Additional macOS versions/Intel and Linux hosts, signing/notarization credentials, full physical native acceptance across required targets (including macOS/Windows lock/sleep/multi-display transitions), and long-run performance evidence are unavailable or unfinished. On 2026-10-10 the user chose “暂时没有，先完成本机可验证交付并保留跨平台验收项”. Mac ARM64 local evidence was added on 2026-10-12; preserve the full objective and keep the delivery task active until the remaining acceptance is proven.

## 2026-10-13 紧凑页面与手动暂停跟进

四页压缩留白、并排控件，保留亮暗模式和自动保存。概览间隔为20/30/40/自定义分钟，共用触发条件配置。暂停及托盘暂停只手动恢复，删除暂停期限和规则卡片；仅隐藏采样延迟提示，保留未知时段不计入活动的处理。

最终改动定向46项后端测试、类型检查及相关lint通过，3项Electron用例通过，覆盖四页×双主题×880×620/640×520、间隔保存、自定义校验、手动恢复及提示删除。Mac打包完成。此前紧凑布局185项检查、17项GUI及旧打包16组合证据仅代表当时版本。用户要求停止校验，最终包实机矩阵、其他平台与大字体未新增验收。现有Windows/macOS原始实机记录保留。

## 2026-10-14 macOS notification repair

Current package inherited only Electron linker signing (unbound Info.plist/no resource seal);the native notification failed UNErrorDomain1 and System Settings listed no EyeCare entry. Local Mac builds now sign the complete bundle ad-hoc via Forge's installed inside-out signer;configured Developer ID/notarization paths are preserved. New native package signature verifies deep/strict and binds org.eyecare.desktop,Info.plist and resources.

Root launched the actual .app and selected notification preview through native UI: preview ended automatically without delivery error,show-event submission confirmed. Agent did not change OS notification permissions. Banner presentation under screen sharing/Focus,denied-permission recovery,Developer ID distribution,otherhosts and notification staleclick remain separate acceptance.29 focused lifecycle tests,typecheck and scopedlint passed;readonly source review approved. No full-suite repeat.
