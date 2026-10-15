# Technical Design

## Scope and Boundaries

This phase targets macOS 14+ and Windows 11 x64. macOS is the reference behavior; Windows differences are corrected where the existing shared product behavior and native APIs allow. Linux and Wayland are explicitly deferred. Shared contracts for timer, settings, IPC, reminder identity, suppression and cleanup remain authoritative.

The delivery is considered complete only for the hosts and scenarios with recorded evidence. Unsupported architecture, permission, display, OS-version or physical lifecycle cases stay open in the acceptance matrix.

## Existing Architecture

- `app/main/platform/native.ts` supplies native clocks, combined idle observations, mouse diagnostics and lock state. Windows uses `GetTickCount64`, `GetLastInputInfo`, Raw Input and WTS/input-desktop checks. macOS uses `mach_continuous_time`, CoreGraphics event ages and the current-session lock reader.
- `app/main/platform/index.ts` converts native readings and Electron power events into the shared `PlatformSample` and capability reports. Unknown or failed critical readings suppress effects.
- `app/main/platform/autostart.ts` owns OS login-startup transactions. `app/main/index.ts` wires platform observations into the main-owned engine and shared snapshot.
- `app/main/reminders/coordinator.ts` owns reminder windows, notifications, audio delivery and cleanup. Renderer, tray and settings consume shared snapshots and commands.
- Existing Windows/macOS evidence lives in `docs/platform-evidence.md`, `docs/acceptance.md` and the platform-specific runtime evidence files. The existing build/runtime verification commands are declared in `package.json`.

## Approach

1. Build a capability matrix from the current macOS behavior and product acceptance criteria. For each Windows gap, identify whether it is a native observation issue, Electron lifecycle/platform behavior, packaging/autostart behavior, or missing host evidence.
2. Reuse shared timer, settings, tray, reminder and renderer behavior. Implement only demonstrated Windows gaps in the module that owns the behavior. Avoid duplicate cross-platform UI or duplicated runtime state.
3. Preserve fail-closed behavior: unknown clock/input/lock or failed critical native queries never become an available/unlocked state; lock/suspend transitions cancel or suppress reminders consistently.
4. Keep macOS as the control baseline. Re-run relevant runtime and packaged checks after shared changes; only modify macOS code when the evidence shows a defect.
5. Record source/automated results separately from installed-app/native observations. Update acceptance documents with host, OS/build, architecture, package identity and the exact scenario observed.

## Data Flow and Contracts

Native providers → `PlatformAdapter` → `PlatformSample`/capabilities → main-owned `TimerEngine` → immutable reminder event → `ReminderCoordinator` → shared renderer/tray surfaces.

No shared contract change is expected. If a missing capability needs new state, first assess whether the existing `Capabilities` and `PlatformSample` can express it. Any contract change must remain validated and fail closed on both macOS and Windows.

## Validation Strategy

- Automated: `npm run check` or, when narrowing failures, typecheck, lint and relevant platform unit/integration tests.
- macOS native/package: `npm run verify:macos-runtime`, `npm run make`, and the relevant packaged Electron checks on macOS.
- Windows native/package: `npm run verify:windows-runtime`, `npm run make`, and installed-app scenarios on Windows 11 x64.
- Record which platform/host each command actually exercised. A Windows test run on macOS with injected APIs does not count as native Windows evidence; ARM64 Mac evidence does not count as Intel evidence.

## Risks and Recovery

- WTS/session and secure-desktop behavior, sleep/resume, global input, display topology/DPI, native tray interaction, login startup and notification permissions can differ from mocked or source-level behavior.
- Build/verification can interact with the user's current development app or OS login state. Use isolated test user-data and preserve actual OS state as existing scripts require.
- The current worktree contains unrelated uncommitted UI/assets changes. Review diffs carefully and keep this task's edits limited to necessary platform code, tests and evidence.
- If a host or permission is unavailable, keep that acceptance item open and report the missing evidence; do not substitute a mocked assertion.

## Deferred

- Linux X11 and Wayland implementation/evidence remain outside this phase.
- macOS Intel, unsupported macOS versions, distribution signing/notarization, and physical scenarios unavailable on the current host remain explicit acceptance gaps unless those hosts and credentials become available.
