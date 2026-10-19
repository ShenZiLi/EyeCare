# Design

## Contracts and data flow

Theme choice -> SettingsEditor -> TS validation -> Tauri save -> Rust validation/storage -> runtime snapshot -> applyAppearance -> theme tokens/components. Live overlays receive effective appearance through ReminderCoordinator.sync_appearance.

Persist `handdrawn` while retaining schemaVersion 2 and all eight existing fields. Define shared TS theme types and renderer metadata (label, preview variant). Keep OS-observed light/dark distinct from the app's effective theme: use a dedicated effective-theme type for snapshots/overlays where needed, with exhaustive Rust conversion at the engine boundary. Do not make platform samples report handdrawn. Align serialized literals, native theme_key and renderer data-theme.

## Persistence

Update V2 validators/types/tests together. Rust THEMES currently serves both V2 and V1 validation (settings/validation.rs:54, :169, :254): separate allowlists so adding the V2 preference cannot widen V1. LegacyAppearanceSettings reuses ThemePreference; explicitly test fabricated V1 handdrawn rejection. Keep envelopes/revisions/backups and existing values unchanged; no schema migration or automatic reselection.

## Visual system

The saved reference overrides generic design-library recommendations. Reproduce its UI style, not its desk scene or fictional controls. Starting palette: cream #F8F1E4/#FFFBF2; brown ink #493B2F; muted #756653; sage #7E9F72 with wash #E6ECD9; butter #F8D77E; peach #EFA78E; sky #A8CBE2; lavender #C6B0DD. Verify contrast before freezing exact colors.

Use theme-scoped paper texture, pencil-like edges, imperfect corners and restrained offset shadows; replace glass gradients/lens/blur only in handdrawn. Cover navigation, overview dial, settings cards, controls, notices and dialogs. Retain system/CJK readability and tabular digits. Decorations are aria-hidden, pointer-transparent and cannot obscure focus or enter the transparent flash background.

Extend existing theme controls into compact two-column visual previews with labels, pressed state and selected checkmark. Adapt to existing 600px window and navigation rather than copying the wide reference canvas. No extra preferences.

## Artwork

During implementation, use the imagegen skill to generate isolated reference-matched yellow closed-eye character on leaves with pencil flowers/stars, without text/UI, using the saved image as reference. Inspect output, save final assets under app/renderer/assets and import through Vite. Add local paper texture/botanical decoration where useful. Existing vector icons remain reusable; raster illustration provides the requested hand-drawn character. Do not replace live controls/text with a screenshot.

## Overlay invariants

Keep startOverlayPlayback keyed by event ID/generation. Theme rerenders select illustration/palette without replacing events or restarting audio/effects. Keep mask focus trap, close/Escape, acknowledge and errors in the existing action path. Reserve artwork dimensions. Flash retains its dedicated transparent entry and fixed pure-black effect.

## Validation and rollback

Meaningful regressions cover TS/Rust accept/reject, persistence, existing themes, strict V1 and unchanged timer/event identity on swaps. Browser screenshots prove appearance/layout only; native build/preview evidence is separate. Revert renderer/backend theme changes together if needed; never silently rewrite real user preferences for tests or rollback.
