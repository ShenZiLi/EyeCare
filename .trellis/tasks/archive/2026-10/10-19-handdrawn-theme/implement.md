# Implementation plan

The user approved the final plan with `实现`; task activated and implementation completed. Frontend/Rust checks passed; independent review fixed reduced-transparency coverage. Visual acceptance and commit preparation are recorded in research/acceptance.md.

1. Load phase 1.4, activate after approval, then phase 2.1. Curated manifests must have real entries.
2. Dispatch trellis-implement with `Active task: .trellis/tasks/10-19-handdrawn-theme`, explicit ownership of contracts/theme flow/renderer/assets/focused tests, and instruction to preserve other contributors' work. Load before-dev/UI/imagegen context when native injection does not supply it.
3. Implement handdrawn preference, separate app-effective theme resolution, exact serialized literals and exhaustive native appearance key; keep OS light/dark types and strict legacy validation.
4. Generate/inspect local reference-matched artwork and texture; implement theme registry, four preview cards, scoped paper/pencil styling across all pages and illustrated mask.
5. Add meaningful TS/Rust acceptance, rejection, persistence and existing-theme regressions; cover V1 strictness, unchanged countdown/event identity and no playback restart. Avoid tests that merely mirror source text.
6. Run npm run check, npm run vite:build, npm run package using the configured toolchain. Fix real failures and verify emitted asset/executable paths.
7. Load the appropriate browser skill and use an isolated test bridge fixture for screenshots of all pages at 600x620 and 600x520, light/dark regression, keyboard focus and mask. Never add production mock fallbacks. Compare directly with research/handdrawn-reference.png. Exercise native preview if host tooling permits; report exact coverage separately.
8. Dispatch trellis-check, fix verified findings and repeat affected checks. Update theme contracts/specs, then follow finish-work/journal/commit policy. Do not claim unexecuted native/platform checks.

## Affected areas

- app/shared/contracts.ts and settings-validation.ts
- app/renderer/Settings.tsx, components.tsx, Overlay.tsx, styles.css, local theme metadata/assets
- src-tauri/src/contracts.rs, engine.rs, lib.rs, settings/validation.rs; reminders.rs if type adaptation requires it
- Existing TS unit and Rust settings/engine regression suites
- UI/runtime specs and acceptance evidence

## Acceptance matrix

- New V2 value accepted in both runtimes; unknown values rejected; V1 stays three-theme-only.
- Save/reload succeeds; schema/fields/defaults and old settings remain compatible.
- System/light/dark resolve as before; handdrawn survives OS palette changes without changing OS samples.
- Runtime/overlay appearance sync retains countdown/event/playback.
- Paper/pencil/artwork is consistent across pages, theme cards and reminder; controls remain actual accessible UI.
- Default/minimum size, focus/contrast and motion/transparency reductions remain usable; flash remains transparent before ready and black during playback.

## Risk and rollback points

Review every effective-theme match and shared legacy validator list. Do not change schema/defaults, timer/flash behavior, native permissions or personal OS login settings. Roll back frontend/native contracts as a unit; do not rewrite persisted user data.
