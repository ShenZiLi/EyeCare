# Delivery acceptance audit

Original scope: `.trellis/tasks/10-10-eyecare-product-design/prd.md`, R1–R16 and AC1–AC22. User authorized implementation on 2026-10-10. A local implementation/build is not release-complete acceptance.

## Current evidence

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
| AC11 / R15 | One engine identity/generation; stale/multi-screen/snooze tests; coordinator cancellation tests | Real hotplug and rapid cross-window actions |
| AC12 / R4 | Default combined keyboard/mouse fields; native Windows raw mouse, macOS event ages; Linux mouse option disabled with explanation | Actual physical mouse vs keyboard separation and native permission cases |
| AC13 / R8,R16 | Real-vs-preview, Escape and acknowledgement e2e/unit tests | Native multi-screen preview and suppression combinations |
| AC14 / R16,R1 | Atomic prefs, fresh restart counters, deferred timer settings, hotplug coordinator; actual Windows install/upgrade/relaunch | Tray recovery, hotplug during overlays, foreground restoration; other target hosts |
| AC15 / R11 | Shared snapshot tray/title/panel, immediate persisted toggle, e2e paused-counter preservation | Tray menu/panel activation, DPI and actual tray background changes; mac adjacent title |
| AC16 / R13,R14 | Exact MASTER tokens, real dark/light mode, manual persistence e2e | System-theme native changes and all overlay/tray surfaces |
| AC17 / R13,R14 | Opaque/transparency and motion fallbacks, keyboard focus/scroll padding, minimum-width test | Composite contrast over real bright/dark/complex backgrounds, 100/125/150/200% scaling and large-font keyboard traversal |
| AC18 / R15,R16 | Strict defaults asserted by unit tests and real first-run app | Installed first-run verification on each target host |
| AC19 / R1,R6 | Fail-closed native lock state, Linux dual checks, fault/disagreement/cache tests | Real GNOME/KDE desktop-service restart, lock and Wayland capability reports |
| AC20 / R15 | Actual flash automatic end without rest; mask Escape/ack distinction | Native timing/focus/input interruption |
| AC21 / R16 | Strict unknown/range/schema checks, real filesystem backups/write failures, invalid-draft/revision e2e, theme no-reset; independent saves; persistent startup paths; installed registration and enabled/disabled legacy migration/read-back/restore | Linux autostart execution, OS login-item failure and preference updates during physical reminders; actual reboot/logon |
| AC22 / R2 | Engine shared gate across both modes/all visual channels, preview identity isolated | Installed native gate combinations across all supported hosts |

## Native acceptance protocol

For each target host, record OS/build, Electron version, desktop/session protocol, hardware/displays/scales, package SHA256, installation method and signature result. Test startup already locked, just-before-dispatch lock, sleep spanning >=3 periods, user pause preserved across short lock, long idle while paused, snooze interrupted by lock/idle/fault, only-keyboard use, only-mouse selection, and native failures. Inspect for any residual overlay or sound and any old event revived after resume.

On two or more displays, test all/primary/selected scopes, unplug selected screen while reminding, primary reassignment and renderer crash. Verify click-through flash against another app, mask Tab/Shift+Tab/Escape, foreground restoration and fullscreen/virtual desktops. Test notification denial and stale clicks, both audio tones and missing devices. Inspect tray <1/99+ and paused/idle/fault states at each DPI, close/reopen/main-window fallback and explicit quit.

Run both palettes over bright/dark/complex actual desktops and each supported scale, measure composed text >=4.5:1 and essential controls >=3:1. Record CPU/RSS during at least a sustained idle/active session; mocks and framework capability flags cannot substitute for this evidence.

## Release blockers

Native macOS/Linux hosts, signing/notarization credentials, full native acceptance across required targets (including Windows lock/sleep/multi-display transitions), and long-run performance evidence are unavailable or unfinished. On 2026-10-10 the user chose “暂时没有，先完成本机可验证交付并保留跨平台验收项”. Local implementation/installation evidence is delivered first; preserve the full objective and keep the delivery task active until the remaining acceptance is proven.
