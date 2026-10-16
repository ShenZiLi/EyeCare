<p align="center">
  <img src="resources/icon.png" alt="EyeCare icon" width="88" />
</p>

<h1 align="center">EyeCare</h1>

<p align="center">Give your eyes a break.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&amp;logoColor=white" alt="Tauri 2" />
</p>

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
</p>

EyeCare is a desktop break reminder that lives in your system tray, built for macOS, Windows, and Linux. It reminds you to rest based on mouse or keyboard activity, or at fixed intervals. Settings save automatically, and configuration and timing are handled locally.

This branch contains the **Tauri 2 + Rust** implementation, version **1.0.3**. Earlier releases and native acceptance records may describe the retired Electron implementation. They do not establish acceptance of this Tauri branch.

[Quick start](#quick-start) · [Usage](#usage) · [Local packaging](#local-packaging) · [FAQ](#faq) · [Contributing](#contributing)

## Features

- **Two timing modes**: accumulate active mouse or keyboard time, or receive reminders at fixed intervals.
- **Four reminder types**: a gentle screen fade, an acknowledgment overlay, a system notification, or sound only. Visual reminders can also play a sound.
- **Automatic away detection**: extended idle time resets progress. Locking, sleep, or a failure in a critical system check suppresses new reminders; missed reminders are not replayed on return.
- **System tray integration**: a countdown and menu actions for pausing, resuming, triggering a reminder, opening settings, and quitting.
- **Manual pause**: reminders stay paused until you choose to resume.
- **Instant settings**: eight core options that save automatically.
- **Light and dark themes**: light, dark, and system appearance in a compact Liquid Glass interface.
- **System preferences**: automatically respects preferences such as reduced motion and reduced transparency.

## Quick start

### Requirements

- Node.js **24**. The repository's build workflow uses **24.15.0**.
- npm **11**.
- Rust **1.90+**, installed through mise (`mise install`) for the local scripts.
- Tauri platform prerequisites: Xcode command-line tools on macOS, MSVC C++ tools and WebView2 on Windows, or WebKitGTK 4.1 and build libraries on Linux.
- Git and an active desktop session on your operating system.

Dependency versions are locked in [package-lock.json](package-lock.json). Run and package the app on the target platform; see the support details below.

### Run from source

```bash
git clone https://github.com/ShenZiLi/EyeCare.git
cd EyeCare
npm ci
npm start
```

`npm start` launches the Tauri app and local Vite server. `npm run vite:dev` serves the frontend only; native commands require the Tauri host.

## Usage

1. Choose a timing mode and duration under Trigger conditions (触发条件).
2. Choose a visual reminder type and sound setting under Reminder type (提醒方式). Use Preview (预览效果) to try the reminder.
3. Close the main window to keep EyeCare running in the tray, and click the tray icon to open its menu. Choose Quit EyeCare (退出 EyeCare) to stop the app. In environments without a reliable system tray, the main window remains accessible.

Settings save automatically. Numeric inputs save about 300 milliseconds after you stop typing, or when the field loses focus. Invalid values or save failures show an explanation and leave the previous valid configuration in place. Restoring defaults requires confirmation.

### Core settings

| Page | Setting | Default | Options / range |
| --- | --- | --- | --- |
| Trigger conditions | Timing mode | Accumulated active time | Accumulated active time / Fixed interval |
| Trigger conditions | Reminder time | 30 minutes | Whole numbers from 1–240 minutes |
| Trigger conditions | Idle reset threshold | 10 minutes | Whole numbers from 1–120 minutes; shown in accumulated active time mode |
| Reminder type | Primary visual mode | Gentle screen fade | Gentle screen fade / Acknowledgment overlay / System notification / Sound only |
| Reminder type | Enable reminder sound | Off | On / Off |
| General settings | Theme | System | System / Light / Dark |
| General settings | Tray countdown | On | On / Off |
| General settings | Launch at login | Off | On / Off |

The reminder time is labeled Active reminder time (活跃提醒时间) in accumulated active time mode and Interval (间隔时间) in fixed interval mode. Choosing Sound only automatically enables sound, so the sole reminder channel cannot be disabled. The default window size is **600 × 620** logical pixels. Narrow windows use icon navigation; hover over a button to see its page name.

### Timing and reminder rules

| Scenario | Behavior |
| --- | --- |
| Accumulated active time | Any mouse or keyboard activity maintains a fixed 60-second activity window; accumulation pauses outside that window |
| Fixed interval | Reminds at the configured interval; cycles suppressed by locking, sleep, manual pause, or similar states are skipped |
| Idle reset threshold reached | Resets progress and stops new reminders; progress also resets during manual pause |
| Gentle screen fade | A full-screen black overlay fades in, holds, and fades out over about 2 seconds, reaching 90% opacity; it does not take focus and allows clicks through |
| Acknowledgment overlay: Got it (知道了) | Closes all associated overlays, records a confirmed break, resets progress, and starts the next cycle |
| Close overlay / Escape | Skips the current cycle and starts the next one without recording a confirmed break |
| Notification submitted / Sound finished | Automatically ends the current cycle without recording a confirmed break |
| Preview | Does not affect actual timing progress or break confirmations |

Reminders cover all displays. Sound uses a built-in gentle effect at a fixed 50% volume. The activity window, effect parameters, wording, sound, and display coverage follow fixed conventions. Advanced configuration and snoozing are not available.

## Platform support

macOS, Windows and Linux are build targets. macOS has a native input/clock/lock adapter; Windows and Linux currently report limited capabilities, and critical unknown state suppresses reminders. Full platform parity, physical lock/sleep, multi-display coverage, notification delivery and login startup still require Tauri-specific native acceptance.

The files in `docs/` record earlier implementation evidence and migration progress. Historical Electron results do not prove Tauri behavior.

## Local packaging

```bash
npm run package   # Compile without generating installers
npm run make      # Compile and create native bundles
```

Bundles are written to `src-tauri/target/release/bundle/`: DMG/app on macOS, MSI/NSIS on Windows, and deb/rpm/AppImage on Linux. Run builds on the target OS. The workflow installs Linux prerequisites and builds all four OS/architecture targets.

Signing uses Tauri's platform signing configuration. The removed Forge signing variables are no longer consumed. Release publishing remains available through the workflow's `publish_release` input; existing published versions cannot be overwritten.

## Development and verification

Stack: **Tauri 2 · Rust · React 19 · TypeScript · Vite**.

```bash
npm run check             # TypeScript, lint, frontend tests and Rust tests
npm run test:unit         # Frontend settings/controller tests
npm run test:integration  # Rust runtime tests
npm run vite:build        # Frontend production build
npm run tauri:build       # Native production build and bundles
```

Electron-specific tests and probes have been removed. Automated tests cover logic; native GUI acceptance remains separate.

```text
EyeCare/
├── app/renderer/   # React pages, overlays and Tauri invoke/listen bridge
├── app/shared/     # TypeScript contracts and settings validation
├── src-tauri/      # Rust runtime, platform adapters, settings, tray and reminders
├── tests/unit/     # Frontend controller and settings tests
├── resources/      # Source artwork and generated assets
├── scripts/        # Asset generation
└── docs/           # Migration notes and historical acceptance evidence
```

The Rust runtime owns timing and reminder state. Pages display snapshots and send commands. Closing the main window keeps the tray runtime active.

## Privacy and configuration

- EyeCare does not collect keystroke content, mouse trajectories, or screen images. It uses only system activity and idle state for timing.
- Settings are stored in `settings.json` in Tauri’s application data directory (`org.eyecare.desktop`). The runtime imports existing settings from the legacy EyeCare directory when needed.
- The last valid configuration is backed up as `settings.last-good.json`. Before upgrading a valid legacy configuration, the original file is preserved as `settings.v1-backup.json`.
- Upgrades from older versions preserve the eight core choices; legacy advanced parameters no longer affect runtime behavior.
- Restarting restores settings and starts a new cycle. Reminders missed while the app was closed are not replayed.

## FAQ

### What should I do if macOS system notifications fail?

Test the bundled app and check System Settings → Notifications → EyeCare. Permission, Focus and screen sharing can affect banners. Successful submission does not guarantee visible delivery.

### Why has time accumulation or a reminder stopped?

Accumulated active time mode pauses accumulation after the 60-second activity window expires. Manual pause, locking, sleep, extended idle time, or an unconfirmed critical system state suppresses new reminders. After a manual pause, choose Resume reminders (恢复提醒) to continue.

### Why did launch at login not take effect?

Check the app's save error message and your system's login item settings first. If registration or saving fails, the app keeps the previous valid configuration and attempts to restore the prior system state. You can retry in the app.

### The build succeeded. Where is the complete app?

Check `src-tauri/target/release/bundle/` after `npm run make`. `npm run package` deliberately compiles without generating installers.

## Contributing

Report bugs or suggest improvements through [Issues](https://github.com/ShenZiLi/EyeCare/issues), and submit changes through [Pull Requests](https://github.com/ShenZiLi/EyeCare/pulls).

When reporting an issue, include your OS version, CPU architecture, desktop environment or X11 / Wayland session, EyeCare version, reproduction steps, expected behavior, and error screenshots. Do not submit credentials or configuration files containing private information.

Run the relevant checks before submitting code, and add focused tests for behavior changes. For changes involving system capabilities, describe the real-device test environment and any areas that remain unverified. See the [repository contributors](https://github.com/ShenZiLi/EyeCare/graphs/contributors) for contribution history.

## License

This project is licensed under the [MIT License](LICENSE). Copyright © 2026 EyeCare contributors.
