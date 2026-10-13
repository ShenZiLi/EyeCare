# Platform evidence

Windows evidence recorded 2026-10-10; macOS evidence added 2026-10-12 and updated2026-10-13. Interface availability and automated assertions are separate from native acceptance. Linux remains unavailable for native acceptance.

## V2 continuation — 2026-10-13

Final local check passed185 unit/integration cases and15 actual Mac Electron GUI cases. The V2 native runtime record proves one configured minute with the main window hidden, advancing menu-bar countdown, a no-reset countdown toggle, flash automatic completion and one mask confirmation with all overlays cleaned. `macos-runtime-evidence.json` now contains these V2 observations (approximately66.9 seconds), replacing its earlier V1 run.

The rebuilt ARM64 production executable passed isolated V1-to-V2 migration, original-byte/no-overwrite backup, fixed-default resolution, old-snooze rejection, real confirmation/reset, core UI autosave and restart persistence. A blocked migration-backup fixture preserved the source, warned and recovered after save/restart. `simplified-settings-evidence.json` records both runs. Temporary profiles were removed and actual OS login-item readings remained unchanged. ZIP SHA256: `5501f6421899f830966413dfd4fe8a8b314fe474298d3dedf9edc67d3fc9d083`; package version remains1.0.2. Earlier package hashes below identify historical artifacts.

Startup save now captures actual OS state before applying a change, so preference/OS divergence cannot restore the wrong value. Capture failures prevent mutation; apply or disk failure restores the captured state. Windows snapshots only the exact owned Run and StartupApproved entries (value presence/kind/unexpanded data/approval bytes) through bounded fixed PowerShell; Linux snapshots exact owned desktop-entry bytes/mode/absence and restores atomically. Injected tests cover these paths; native Windows/Linux rollback and reboot/logon remain unverified. Real Mac GUI failure tests replace only Electron login methods and do not change actual system registration.

V2 uses combined keyboard/mouse activity on every platform. Mouse-specific adapter diagnostics remain internal legacy capabilities; no mouse-only selection is exposed or required for V2 configuration.

## Implemented adapters

| Capability | Windows | macOS | Linux X11 | Wayland |
|---|---|---|---|---|
| Continuous time including suspend | `GetTickCount64` | `mach_continuous_time` with timebase conversion | `CLOCK_BOOTTIME` | Unverified; critical capabilities suppressed |
| Current-session combined input | `GetLastInputInfo`, unsigned wrap handling | CoreGraphics combined session event age | XScreenSaver idle | Unsupported until a native desktop input bridge is verified |
| Mouse source | Raw Input message-only native window, movement/button/wheel events; no payload read | Minimum CoreGraphics mouse/drag/button/scroll event ages | Disabled with a precise XInput2 verification reason | Disabled |
| Startup lock | Current process WTS session flags **and** input desktop; failure is unknown | Explicit current-session lock boolean, on-console session check, optional explicit IOKit console lock boolean; missing flags remain unknown | Current process logind session Active/LockedHint **and** GNOME/freedesktop ScreenSaver GetActive; disagreement is unknown | Same desktop lock checks; input and overlays still limited |
| Suspend/resume | Electron immediate events; fresh native query on resume | Same | Same; invalidate cached D-Bus results on resume | Same |
| Login startup | Persistent Squirrel stub / portable executable, Electron API with read-back; legacy migration preserves system approval | Electron API with read-back, platform-specific options | XDG desktop entry; AppImage uses original `APPIMAGE` file | Same |

Linux D-Bus reads use fixed executable arguments, no shell, per-process timeouts, output bounds, bounded cache age and a generation fence against stale pre-resume results. Linux input and clock loading failures cannot become zero idle or unlocked. macOS dictionary/registry keys are OS-version-dependent; an absent key is never treated as false. Lock events immediately suppress reminders. Unlock events clear the event latch but cannot override a fresh unknown native lock reading.

Windows mouse registration is released on disposal and initialization failure. First startup mouse age is unknown until a genuine mouse event arrives; keyboard-only activity cannot initialize the mouse counter. The callback reads only the message category and stores a timestamp, never coordinates, button content or keystrokes. The native bridge window is message-only and never visible or focused.

Wayland limitations are explicit: ordinary Electron windows do not prove desktop-wide positioning/coverage or whole-session input. No Xwayland flag is used as a substitute. Linux tray support remains unknown because successfully allocating a tray object does not prove a desktop tray is present; the main window must remain a recovery entry.

Windows1.0.2 installed-app tests verified startup registration against the persistent stub, then restarted with legacy entries pointing to an absent old version folder. Both OS-enabled and OS-disabled entries migrated with their original approval state. Only the exact owned current-user Run value is read, with bounded hidden PowerShell execution and UTF-8 JSON; unrelated/missing/stable entries are not changed. Original disabled preference and owned OS entry were restored. Reboot/logon remains unverified. Linux AppImage path selection and desktop entry escaping were tested through real filesystem writes with an injected file-existence result; native Linux execution remains unverified.

## Actual Windows observation

`node scripts/probe-platform.cjs` succeeded against the same provider used by the app on Windows x64 at `2026-10-10T12:44:31.655Z` (20:44 Shanghai):

| Reading | Before | After approximately 3 seconds |
|---|---:|---:|
| Continuous clock ms | 1286375 | 1289390 |
| Combined input idle ms | 0 | 1281 |
| Raw mouse idle ms | unknown | 1203 |
| Current session lock | explicitly unlocked | explicitly unlocked |

The raw mouse receiver observed a real incoming native event while pumping the host message queue. This establishes native registration and delivery on this host; it does **not** prove full physical-device keyboard/mouse separation, Electron dispatch in the packaged application, or lock/sleep transitions. The probe does not inject input, lock or sleep the machine, mutate login settings or create visual overlays.

The separate Electron 44.7.0 probe (`scripts/probe-platform-electron.cjs`) exited successfully at `2026-10-10T12:49:55.417Z` (20:49 Shanghai) using Electron's actual message loop with no manual message pumping. The native continuous clock advanced 1610140 → 1613156 ms; combined idle advanced 105953 → 108969 ms and agreed with Electron's `idle` status. WTS/desktop lock stayed explicitly unlocked. Mouse age stayed unknown because no mouse event arrived during this run; callback delivery under Electron therefore still needs physical input verification. One display was detected (ID 60323411), scale 1.875, bounds 1835 × 769; dark theme and the actual reduced-motion preference were read successfully.

## Actual macOS observation (2026-10-12)

Host: macOS 26.4 / Darwin 25.4.0, ARM64, Electron 44.7.0, Node 24.16.0. One display: 1920 × 1080 logical bounds at scale 2. The initial startup failure was reproduced: `kCGSessionOnConsoleKey` is a `CFSTR` SDK macro, not an exported CoreGraphics symbol. Its actual string is `kCGSSessionOnConsoleKey`. The corrected provider validates the current UID and on-console boolean. On this host the Quartz dictionary omitted the lock key; the IOKit root exposed an explicit boolean `IOConsoleLocked=false`. Missing/invalid flags still suppress reminders, and locked evidence takes precedence.

The actual native probe advanced `mach_continuous_time` from 1580213241.989 to 1580216274.477 ms over approximately 3.03 seconds. Combined input idle advanced 429627.368 → 432633.636 ms; mouse idle advanced 429627.446 → 432633.653 ms; lock was explicitly unlocked in both samples. CoreGraphics session source `0` is used for both combined idle and mouse-event ages; keyboard event types are excluded from the mouse list. These observations establish API loading and finite native measurements, not physical device separation or lock transitions.

`npm run verify:macos-runtime` passed using actual native observations and isolated preferences. Exactly one configured one-minute flash occurred while the main window was hidden; its nonfocusable window closed automatically without confirming rest. Native Tray title getters showed an advancing `mm:ss` countdown; disabling it cleared the title without resetting progress and the icon remained a template image. A subsequent real mask “知道了” confirmed one rest, reset the cycle and left no overlay. OS login-item settings were read before/after and remained unchanged. Raw observations are in `macos-runtime-evidence.json`.

`npm run make` produced `out/EyeCare-darwin-arm64/EyeCare.app` and `out/make/zip/darwin/arm64/EyeCare-darwin-arm64-1.0.2.zip`. ZIP SHA256: `1d28f882efb72d2bdcb28ccbe9c830de91f6b488d07734676b3a927c8630fc97`. The packager's old JavaScript ZIP extraction hung and exited without an artifact on this host; a scoped, pinned override to Electron's native `@electron-internal/extract-zip@1.0.5` resolved it. No Developer ID identity is installed; these artifacts do not establish distribution signing/notarization or signed notifications.

Nine actual Electron GUI tests passed (eight shared GUI cases plus concurrent native instances with separate preference directories). The packaged ARM64 executable independently launched with isolated Chromium userData, loaded its production page and reported healthy native input/mouse/lock/overlay/tray capabilities with counting state. It exited cleanly; startup evidence is in `macos-package-evidence.json`. This packaged smoke test does not prove its physical transitions or signed notification delivery.

## Automated safety evidence

`npx vitest run tests/unit/mac-native.test.ts tests/integration/platform.test.ts`: 41 tests passed on 2026-10-12 (25 macOS native-provider cases and 16 platform integration cases). Covered separate combined/mouse fields, clock and input validation, current-session UID/on-console gates, typed lock flags and locked precedence, failed/missing optional APIs, allocation cleanup, unknown after unlock, immediate suspend/resume, accessibility preferences, Linux dual confirmation/disagreement/cache expiry/pre-resume stale-result rejection/unavailable services/inactive session suppression.

`npx tsc --noEmit` and focused ESLint checks passed after implementation. These tests use injected providers and mocked Electron surfaces; they prove safety logic, not native compatibility.

## Required native acceptance still outstanding

- Windows installed application: lock/unlock (including launching already locked), sleep/resume, physical mouse/keyboard/wheel/drag separation, multiple displays and DPI, overlay focus/click-through, tray readability, notification/audio permissions, launch startup.
- Native macOS: startup already locked and lock transitions on supported OS versions, login-session switching, sleep duration, physical mouse/keyboard/wheel/drag separation and permission behavior, multiple displays/Spaces/fullscreen, visual menu-bar readability, signed notification delivery and login startup execution. Current ARM host observations are recorded below; Intel remains unverified.
- Ubuntu GNOME X11 and KDE X11: D-Bus lock transitions and startup detection, XScreenSaver idle, tray presence/recovery path, overlays/display positioning, packaged dependencies and autostart. Mouse-only stays disabled until an independently validated XInput2 bridge is delivered.
- GNOME/KDE Wayland: desktop-specific input and overlay bridges and published supported-capability matrix; currently limited and explicitly disabled where reliability is unverified.

## Primary references

- [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor): lock events are macOS/Windows; suspend/resume events and idle queries.
- [Microsoft WTSINFOEX_LEVEL1](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ns-wtsapi32-wtsinfoex_level1_w): explicit session lock flags; Windows 7 flag reversal is outside the Electron-supported baseline.
- [Microsoft OpenInputDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-openinputdesktop): desktop receiving user input and handle lifecycle.
- [Microsoft Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input): input sinks and device separation.
- [Apple CGSessionCopyCurrentDictionary](https://developer.apple.com/documentation/coregraphics/cgsessioncopycurrentdictionary%28%29): current Quartz session dictionary and ownership.
- [Apple fast user switching](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPMultipleUsers/Concepts/FastUserSwitching.html): on-console/current-session properties. Lock-key reliability is an implementation hypothesis requiring native verification, not an Apple API guarantee.
- [systemd login1 source documentation](https://raw.githubusercontent.com/systemd/systemd/main/man/org.freedesktop.login1.xml): current session lookup and LockedHint semantics.
- [Koffi callback lifetime](https://koffi.dev/callbacks): registered callback ownership and unregister requirement.
- [Electron login item settings](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows): Squirrel persistent stub and identical query options.
- [AppImage environment variables](https://docs.appimage.org/packaging-guide/environment-variables.html): `APPIMAGE` identifies the original file; `APPDIR` identifies the mount point.

No platform is labeled release-verified by this file.
