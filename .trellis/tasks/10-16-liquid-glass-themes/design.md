# Design

## Boundaries
Modify renderer styles and small presentation markup only. The behavior gap is visual: current flat green surfaces lack optical depth and responsive glass feedback. Theme material lives in styles.css, navigation and countdown composition in App.tsx, shared controls/dialog in components.tsx. Do not intercept SettingsEditor or Tauri bridge.

## Material system
Use a cool silver light background, neutral black dark background, layered static radial illumination, translucent chrome, top/side edge highlights, inset shadows and graduated material weight. Dark accents are silver/white; light interaction accent can be restrained graphite/blue neutral. Keep typography and numbers on stable high-opacity surfaces. Centralize all colors and motion tokens.

## Motion
Use an interruptible sliding navigation lens if feasible, switch thumb movement and brief dialog materialization. No section/choice entrance animation, no continuous background motion, no per-second countdown animation. Preserve exact .96 / <=150ms press. Keyboard choice selection remains immediate. Handle dataset + media reductions, high contrast, and unsupported backdrop-filter with opaque equivalents. Theme swaps preserve existing effective-change suppression.

## Compatibility and rollback
No persisted data migration. Existing main/overlay appearance datasets remain authoritative. Changes can be rolled back as renderer-only files. Browser previews use a temporary test fixture external to production; no fake desktop state in shipped renderer.
