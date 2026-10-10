# Frontend implementation guidelines

## Scope and pre-development checklist

Read `ui-contract.md`, MASTER.md, the active PRD and shared bridge types. Modify renderer state only for presentation and drafts; every real runtime action invokes the whitelist bridge.

## Component signatures

`App({tray?:boolean})` renders a runtime snapshot and draft settings. `Overlay` consumes `OverlayState`. `Field`, `Toggle`, `Section`, `Notice` and `Modal` provide shared form/accessibility structure. Pages use the one SVG icon family from lucide-react.

## Theme and layout contracts

All colors use centralized semantic CSS variables. Follow system/light/dark from main; opaque fallback keeps identical structure. Numeric time is tabular, never animated or announced every second. Main minimum640x520, compact labeled navigation, readable controls and scrollable settings. No network fonts.

## Validation and error behavior

Server field errors appear beside visible labels. Draft, base and expected revision stay distinct; failed save or background preference update cannot discard user input. Theme/countdown commits are immediate and do not save other unsaved fields. Failed preview errors remain inside the active dialog.

## Good/base/bad cases

Good: Tab scrolls a switch fully above the sticky save bar. Base: normal theme change updates tokens while the reminder animation consumes its original options. Bad: theme updates restart a flash, Escape confirms rest, numeric invalid values silently normalize, a preview mutates the main engine.

## Quality check

Run `npm run typecheck` and `npm run lint`; rebuild then run `npm run test:e2e` for surface changes. Inspect both palettes, compact/large text, focus and opaque/motion fallbacks. Composite contrast, DPI, actual tray/desktop backgrounds and multi-display focus require native evidence.

## Wrong vs correct

Wrong: a screenshot/test mock proves platform support. Correct: use screenshots for layout, actual Electron tests for wiring, and documented native-host runs for OS capabilities.
