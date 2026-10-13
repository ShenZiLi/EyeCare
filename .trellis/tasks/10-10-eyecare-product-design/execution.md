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

## Immediate trigger/reminder settings — 2026-10-13

User requested “触发条件、提醒方式 删除保存设置，默认点击立即生效”. Updated PRD/design/MASTER and frontend contracts accordingly. Those two pages now save field intents automatically with no manual save/discard bar; General's other fields retain manual behavior. The shared editor serializes changes against the latest effective baseline, debounces numeric/text input300 ms with blur flush, validates coupled parameters, preserves newer/failed/invalid input, isolates unrelated valid fields and offers scoped retry/reapply. Preview uses effective non-reminder settings with current reminder inputs. Native engine/IPC semantics remain unchanged.

Final TypeScript, ESLint and162 unit/integration cases passed. Eleven real Mac Electron GUI cases passed on the final rebuilt renderer. Packaged ARM `.app` changes matched exact expected trigger/reminder values and disk persistence in an isolated directory; newest ZIP hash and evidence recorded in docs/acceptance.md. One intermediate GUI run observed truncated Chinese text; eight input-event diagnostic repeats and the final unchanged full-suite assertion passed. A Chinese delayed-response regression and failure-only event/controlled-value diagnostics preserve this observation without claiming an unproven cause or speculative code fix. Additional details: research/instant-settings.md. Product scope is delivered locally; existing cross-platform/physical/signing acceptance keeps the overall task active.

## Eight settings and snooze removal — 2026-10-13

The user explicitly authorized the reviewed SettingsV2 implementation, verification, documentation and local Git commit. All three settings pages now expose exactly3+2+3 core choices and automatically save. Advanced effects/activity parameters are internal defaults, only-sound enforces a channel, restore confirms once, normal capability diagnostics are hidden. The full snooze timer/action/state/UI path is removed; legacy storage still validates its old field solely for migration, and old IPC actions are rejected. Mask acknowledge closes all overlays, confirms once and resets a normal cycle; skip/Escape resets without a rest. Previews remain isolated and current events retain creation-time parameters.

Valid V1 primary/last-good data migrates its eight core values to V2 with a once-only original-byte backup and atomic writes. Upgrade failures preserve the source, warn, keep usable V2 memory and retry on save/restart. Review reproduced preference/OS startup divergence during disk failure; the fix captures actual OS state before mutation and restores that captured state rather than the saved preference. Injected tests cover capture/apply/persistence/rollback failure, exact owned Windows value/approval data and Linux entry bytes/mode/absence; native Windows/Linux rollback remains pending.

Final TypeScript, ESLint and185 unit/integration cases passed. Fifteen actual Mac Electron GUI cases passed after the final rebuild. A real native one-minute hidden-main/tray/flash/mask V2 run passed; regenerated macos-runtime-evidence.json records it. The final ARM .app independently passed customized V1 migration, exact backup retention, internal defaults, old-snooze rejection, real mask acknowledgement/cleanup/reset, UI save and restart persistence. A blocked backup publication preserved V1, warned, retried after repair and restarted healthy. OS login readings stayed unchanged and temporary profiles were removed. Build SHA256 and detailed scopes are recorded in docs/acceptance.md and simplified-settings-evidence.json. Original Windows/historical Mac evidence remains retained; full platform/physical/signing acceptance keeps the task in_progress.
