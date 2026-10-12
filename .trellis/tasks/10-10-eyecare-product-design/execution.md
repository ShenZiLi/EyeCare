# EyeCare delivery execution record

## Authorization and preserved scope

On 2026-10-10 the user explicitly requested: “按照设计文档交付完整软件”. This authorizes implementing the existing finalized PRD, design and implementation plan, superseding their historical design-only stop. R1–R16 and AC1–AC22 remain the acceptance scope. Work uses the clean `dev` branch tracking `origin/dev`. No remote publication is authorized.

## Implementation boundaries

- Shared contracts own settings, validated commands, observations and snapshots in `app/shared/contracts.ts`.
- Pure engine and settings validation/persistence implement time/event semantics with deterministic tests in `app/main/engine`, `app/main/settings`, `tests/unit`, `tests/integration`.
- Native adapters implement current-session observations, capability reporting and fail-closed lock detection in `app/main/platform`; unavailable native hosts stay unverified.
- Main process, restricted preload, multi-display reminder coordinator and tray wire those contracts. No renderer timer owns real state.
- React renderer implements all documented surfaces and preferences using MASTER.md. Form drafts survive failed validation and revision conflicts.
- Forge provides native Windows/macOS/Linux packaging. Automated and actual native evidence are tracked separately in `docs/acceptance.md`.

## Ordered verification and rollback

- [x] Lock dependency versions, run native capability probes on this Windows host; document remaining native host requirements.
- [x] Implement pure engine and settings, run `npm run test:unit` and `npm run test:integration`.
- [x] Wire secure IPC, reminders, platform and tray; run `npm run typecheck` and `npm run lint`.
- [x] Implement all UI surfaces and run `npm run test:e2e`, theme/keyboard/responsive checks.
- [x] Run `npm run make`, inspect packaged and actually installed Windows application and native probes.
- [x] Update actual code guidelines and audit all R/AC evidence; retain native gaps. Commit the verified local delivery per repository convention.
- [ ] Native macOS, Ubuntu GNOME X11, KDE X11, Wayland, certificates/signing and installed package full acceptance remain required before release-complete status.

Rollback is by coherent new commits. Settings keep last-good backup; unknown lock state stops effects; any reminder failure destroys all overlays. Do not remove user files, silently narrow platform scope, or claim mocked tests prove native support.

## Local-first delivery decision

User confirmed no other native hosts/certificates currently available and requested local verifiable delivery first while retaining cross-platform acceptance. Final evidence:87 unit/integration assertions and8 real Electron/source/distribution/installed tests passed, Windows11 build28000 installer produced and installed. Remaining platform/release checks stay open in `docs/acceptance.md`; task remains in_progress.

## 1.0.1 continuation

Fixed independent appearance saves when the persisted activity source or selected display becomes unavailable, while still rejecting new invalid selections. Added main-owned preview identity/results and accurate terminal feedback/errors without affecting the real timer or rest count. Verified98 unit/integration assertions,8 source GUI regressions and2 distribution/installed checks; actual installed login-startup registration/read-back restored the original preference. Built and silently upgraded Windows1.0.1. The rebuilt version also passed two real one-minute cycles over approximately136 seconds, including hidden-main operation and overlay cleanup. Native multi-host/physical scenarios/signatures and extended stability remain open.

## 1.0.2 local delivery

Fixed startup paths surviving Squirrel version-directory removal and AppImage unmount. Migrates only the exact owned Windows legacy entry, preserving Task Manager's enabled/disabled choice without recreating missing or unrelated entries. Disabling startup still works with a broken launcher. A regression against the installed1.0.1 reproduced the unstable-path defect;1.0.2 passes125 unit/integration assertions and12 actual Electron tests, including two installed restart/migration cases with an absent legacy folder. Built and silently upgraded Windows1.0.2; original disabled startup preference/owned OS entry restored. Installer/ZIP hashes and unsigned status are recorded in docs/acceptance.md. Earlier1.0.1 native two-cycle evidence remains explicitly versioned; timer semantics did not change. All local authorized delivery work is complete; external native hosts, physical acceptance and signing remain tracked for full release acceptance.

## macOS continuation — 2026-10-12

User requested “实现mac端目前缺失的能力”. The existing task remains the implementation target. Reproduced native startup failure and fixed the SDK macro/string mismatch, current-session validation, explicit IOKit fallback, unknown-after-unlock suppression, invalid mouse-age validation and native resource cleanup. Moved development-only preference isolation before the single-instance lock. The reviewed implementation passes151 unit/integration assertions, TypeScript/ESLint and9 actual Mac Electron GUI tests.

Real macOS26.4 ARM64 native clock/input/unlocked readings passed. A native one-minute hidden-main flash cycle proved advancing Tray titles and no-reset countdown toggle; automatic flash did not confirm rest; real mask “知道了” confirmed once and left no overlay. Login-item settings remained unchanged. The packager-only native ZIP extraction override repaired successful-exit/no-artifact builds. Actual `.app`/ZIP were produced; packaged production renderer/native bridge startup and clean exit passed with isolated userData. Evidence and artifact hash live in docs/acceptance.md, docs/platform-evidence.md and the Mac JSON files. Physical lock/sleep, separate input devices, multiple displays/Spaces, login execution, Intel/additional macOS versions, distribution signing/notifications and sustained stability remain open; keep task in_progress.
