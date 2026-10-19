# Bundled Appearance Themes

## 1. Scope / Trigger

Theme changes affect the existing main pages, confirmation dialogs and mask reminders/previews. The handdrawn theme is named `手绘`. It adds no configurable fields or routes. The surrounding desk scene and fictional preferences in the reference are not application UI.

## 2. Signatures

- Shared `ThemePreference`: system | light | dark | handdrawn.
- Shared `EffectiveTheme`: light | dark | handdrawn; RuntimeSnapshot.theme and OverlayState.theme use it.
- `ThemeChoices({ value: ThemePreference, onChange })` owns accessible four-card selection. `themes` in renderer/themes.tsx supplies bundled labels/icons/preview identifiers.
- `applyAppearance(Pick<RuntimeSnapshot, 'theme' | 'reduceMotion' | 'reduceTransparency'>)` remains the only document appearance writer.

## 3. Contracts

Each theme extends shared tokens using data-theme selectors; handdrawn lives in themes.css and is loaded by both main and overlay entries. Use local Vite-imported handdrawn-rest.png, handdrawn-sidebar.png and handdrawn-paper.png. Illustrations are decorative, pointer-transparent and have no baked text. Controls and labels stay real UI. New bundled themes require explicit shared/native validation and effective resolution as well as renderer metadata/tokens; the registry is not an external plugin API.

Handdrawn is a fixed light-paper presentation independent of OS palette. OS light/dark observations remain separate. Styling must not affect the parser-transparent overlay/flash background. Mask playback remains keyed only by event ID/generation; live appearance refresh cannot restart it.

## 4. Validation and Error Matrix

| Condition | Behavior |
|---|---|
| V2 handdrawn preference | Same automatic-save path and effective-value/failure feedback as existing choices |
| Unknown preference | INVALID_SETTINGS with appearance.theme field error |
| Reduced transparency | Opaque readable handdrawn surfaces; no glass/texture required to convey state |
| Reduced motion | Existing static press/navigation rules win; no additional motion preference |
| Theme swap during reminder | Preserve ID/generation, playback and focus/action ownership |

## 5. Good / Base / Bad Cases

Good: switching to handdrawn changes paper/controls and the live mask without resetting countdown. Base: system still follows OS light/dark. Bad: use a full screenshot for settings, add mockup-only accent settings, or theme-tint the black flash.

## 6. Required Tests and Evidence

Cover all theme literals, unknown rejection and actual persistence. Verify all four normal pages at CSS600x620 and CSS600x520, plus keyboard focus, selected checkmark, long-error overflow and OS reductions. Account for browser zoom before claiming viewport dimensions. Wait for navigation transitions before comparing screenshots. Compare the rendered mask with the reference. Browser route fixtures are test-only and never enter production; report native GUI observations separately.

Also verify the actual native minimum frame: macOS title-bar space can reduce the renderer viewport below the configured window height. At a600x520 frame, compact handdrawn spacing must keep the restore button wholly visible without shrinking fonts or44px targets. Use the scoped max-height560px padding rules; do not assume a CSS520px browser fixture proves native minimum-size fit. Native window defaults/minimums are configured in create_main_window as600x620/600x520.

## 7. Wrong vs Correct

Wrong: add handdrawn only to CSS or map it to light before sending OverlayState. Correct: carry a typed effective theme through Rust snapshots and overlay updates to data-theme, while keeping platform samples light/dark.
