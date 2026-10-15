# Implementation Plan

## 1. Establish the Parity Baseline

- [ ] Review the active product requirements and `docs/acceptance.md` against the latest macOS/Windows evidence.
- [ ] Produce a capability-by-capability matrix for time/input, lock/sleep, timer suppression, reminder channels and cleanup, displays, tray/recovery, settings, login startup and packaging.
- [ ] Mark each row as source implemented, automated-tested, packaged-app verified, native-host verified, or open. Identify Windows code gaps separately from missing Windows-host evidence.

## 2. Close Confirmed Windows Gaps

- [ ] Trace each confirmed gap to its owner in `app/main/platform/native.ts`, `app/main/platform/index.ts`, `app/main/platform/autostart.ts`, the main process, reminder coordinator or packaging configuration.
- [ ] Implement the smallest owning-layer change while preserving shared contracts, generation/cancellation behavior and fail-closed capability handling.
- [ ] Add or update focused regression tests for safety-sensitive behavior. Do not add tests that only restate implementation details.

## 3. Reconfirm macOS Reference Behavior

- [ ] Re-run relevant type/lint and unit/integration checks after shared changes.
- [ ] Verify the packaged macOS runtime on the available supported Mac host, using isolated preferences and preserving actual OS login/notification settings.
- [ ] Keep Intel and unavailable OS-version results explicitly open unless corresponding native evidence exists.

## 4. Verify Windows 11 x64

- [ ] Build and install the Windows package on Windows 11 x64; exercise launch, upgrade/relaunch and login-startup behavior with owned test data.
- [ ] Verify real clock/input readings, already-locked startup, lock/unlock, suspend/resume, and safe recovery after each interruption.
- [ ] Verify reminder flash/mask focus and click-through, cleanup, tray access/countdown, notification/audio behavior, DPI and multi-display scenarios available on the host.
- [ ] Preserve pre-test OS login state and use isolated test user-data.

## 5. Update Evidence and Review Scope

- [ ] Update `docs/platform-evidence.md`, `docs/acceptance.md` and relevant per-platform evidence with host/build/package identity and exact observed results.
- [ ] Leave unavailable scenarios as open with a concrete reason; do not infer native support from mocks or package creation.
- [ ] Confirm no Linux implementation was changed and review the final diff against the task scope.

## Validation Commands

- `npm run check`
- `npm run verify:macos-runtime`
- `npm run verify:windows-runtime`
- `npm run make` on each platform host being packaged
- Relevant packaged Electron and installed-app tests on macOS and Windows 11 x64

## Risky Areas

- Native lock/input lifecycle in `app/main/platform/native.ts` and `app/main/platform/index.ts`.
- Startup transaction and rollback behavior in `app/main/platform/autostart.ts`.
- Reminder cancellation/cleanup across lock, sleep and display changes.
- Installed-app evidence can mutate real OS preferences if test isolation is bypassed; use the existing safety mechanisms and verify restoration.
