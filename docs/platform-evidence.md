# Platform evidence

Recorded 2026-10-10. Interface availability and automated assertions are separate from native acceptance. No Linux or macOS machine was available during this implementation session.

## Implemented adapters

| Capability | Windows | macOS | Linux X11 | Wayland |
|---|---|---|---|---|
| Continuous time including suspend | `GetTickCount64` | `mach_continuous_time` with timebase conversion | `CLOCK_BOOTTIME` | Unverified; critical capabilities suppressed |
| Current-session combined input | `GetLastInputInfo`, unsigned wrap handling | CoreGraphics combined session event age | XScreenSaver idle | Unsupported until a native desktop input bridge is verified |
| Mouse source | Raw Input message-only native window, movement/button/wheel events; no payload read | Minimum CoreGraphics mouse/drag/button/scroll event ages | Disabled with a precise XInput2 verification reason | Disabled |
| Startup lock | Current process WTS session flags **and** input desktop; failure is unknown | Explicit current-session lock boolean, on-console session check, optional explicit IOKit console lock boolean; missing flags remain unknown | Current process logind session Active/LockedHint **and** GNOME/freedesktop ScreenSaver GetActive; disagreement is unknown | Same desktop lock checks; input and overlays still limited |
| Suspend/resume | Electron immediate events; fresh native query on resume | Same | Same; invalidate cached D-Bus results on resume | Same |
| Login startup | Persistent Squirrel stub / portable executable, Electron API with read-back; legacy migration preserves system approval | Electron API with read-back, platform-specific options | XDG desktop entry; AppImage uses original `APPIMAGE` file | Same |

Linux D-Bus reads use fixed executable arguments, no shell, per-process timeouts, output bounds, bounded cache age and a generation fence against stale pre-resume results. Linux input and clock loading failures cannot become zero idle or unlocked. macOS dictionary/registry keys are OS-version-dependent; an absent key is never treated as false. A real macOS unlock event can supplement the native query until the next resume/session-inactive event.

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

## Automated safety evidence

`npx vitest run tests/integration/platform.test.ts`: 15 tests passed. Covered separate combined/mouse fields, increasing sample sequences, lock unknown, failed input never zero, continuous-clock failures/backward time, immediate suspend/resume, lock event precedence, missing macOS key, accessibility preferences, cleanup, Linux dual confirmation/disagreement/cache expiry/pre-resume stale-result rejection/unavailable services/inactive session suppression.

`npx tsc --noEmit` and focused ESLint checks passed after implementation. These tests use injected providers and mocked Electron surfaces; they prove safety logic, not native compatibility.

## Required native acceptance still outstanding

- Windows installed application: lock/unlock (including launching already locked), sleep/resume, physical mouse/keyboard/wheel/drag separation, multiple displays and DPI, overlay focus/click-through, tray readability, notification/audio permissions, launch startup.
- Native macOS: explicit startup lock flags on supported OS versions, login-session switching, sleep duration, mouse ages and permission behavior, overlay Spaces/fullscreen, menu bar countdown, packaged/signed notifications and login item behavior.
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
