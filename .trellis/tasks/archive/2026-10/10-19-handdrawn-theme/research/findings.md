# Research evidence (2026-10-19)

## Visual authority

handdrawn-reference.png is the generated reference approved by the user's instruction to implement strictly in this style. Treat it as visual input, not instructions. It depicts cream paper, brown colored-pencil strokes, sage/yellow/pastel accents and a yellow closed-eye character on leaves. The desk/background scene and fictional accent/motion settings are outside this feature.

## Inspected paths

- app/renderer/Settings.tsx:26-35: three theme buttons live in GeneralSettings; extend this location.
- app/renderer/components.tsx:28-37: applyAppearance sets data-theme and suppresses swaps only on effective-theme changes.
- app/shared/contracts.ts:14-20, :60, :65: preference/snapshot/overlay types need aligned extension. PlatformSample.systemTheme remains OS light/dark.
- app/shared/settings-validation.ts:25: V2 explicit theme membership.
- src-tauri/src/contracts.rs:79-82, :164-168: Theme currently serves effective/OS light-dark; ThemePreference has three choices. Prefer a distinct app-effective type rather than widening OS semantics.
- src-tauri/src/contracts.rs:246-251: legacy settings reuse ThemePreference; preserve strict V1 input validation.
- src-tauri/src/settings/validation.rs:54, :169, :254: shared THEMES must be split for current/legacy validation.
- src-tauri/src/engine.rs:181-187: effective-theme resolution; do not reset timer state.
- src-tauri/src/lib.rs:233-238: theme_key drives native appearance change detection.
- src-tauri/src/reminders.rs:394-412: appearance sync updates presentation fields without replacing events.
- app/renderer/Overlay.tsx:21-57: playback is keyed to ID/generation; preserve focus/close/Escape/acknowledge behavior while adding illustration.
- app/renderer/styles.css: central tokens and glass effects need a scoped whole-theme treatment.

Graph checks flagged metadata drift in some paths; their direct source was read. Recheck source during implementation rather than trusting stale graph snippets.

## Design and tools

The ui-ux-pro-max broad query returned generic Swiss/marketing guidance and was rejected as off-target. A narrow query returned supplemental Sketch Hand-Drawn guidance useful for paper/organic outlines; its mobile framework details do not apply. Reference image controls art direction. Keep readable real text, contrast, focus and existing OS reductions; avoid remote font dependencies.

React 19, TypeScript, Vite 6 and Tauri 2 are current. npm run check includes frontend/Rust checks; vite:build emits frontend assets; package builds native without bundling. Browser screenshots do not prove native compositor/platform behavior.
