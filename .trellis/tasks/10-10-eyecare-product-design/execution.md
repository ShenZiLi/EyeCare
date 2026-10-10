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
