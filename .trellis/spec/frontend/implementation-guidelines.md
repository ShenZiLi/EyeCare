# Frontend implementation guidelines

## Pre-development

Read ui-contract.md,MASTER.md,currentPRD and shared V2bridge types. Main decides time/eligibility;renderer only edits8 core preferences and presents snapshots.

## State and signatures

App subscribes to SettingsEditor,which owns versioned field intents,effective snapshots and one persistence queue. edit(next,immediate?),flush(),retry(),accept(snapshot) use SettingsV2 and shared Node-free settings-validation.ts. Every page autosaves;no manual draft/save API. Overlay consumes ResolvedSettings only from immutable main event.

## Validation and feedback

Discrete changes persist immediately;numeric input waits300ms or blur. Fields preserve empty/invalid input with inline errors. Later intent versions survive old save responses. Unrelated valid changes can persist. None+soundfalse is rejected;UI chooses only-sound with an atomic true sound flag. General displays effective settings on failure and retains retry intents. Restore confirms once and uses the same queue. Preview errors remain visible in the active dialog.

## Style and accessibility

Use centralized existing theme tokens,system/CJK fonts,tabular digits and lucide SVGs. Keep minimum640x520 and fit all four normal pages without scrolling at that and default880x620;readable labels,keyboard focus and currentOS reduction fallback remain. Exceptional long errors/large text may overflow accessibly. Press exclusions use zero-specificity :where;verify computedscale1 during active press for both dataset and OS reduced-motion,not merely transition:none. No advanced controls or manual save bar;capability details only relevant abnormalities. Never declare native support from style/framework flags.

## Cases

Good: autosave41-minute interval and12-minute idle threshold survive an in-flight theme save. Base: know in preview closes onlypreview. Bad: old V1parameters configure the UI,theme refresh restartsflash,skip confirms rest or loginfailure looks enabled.

## Quality check

Run typecheck/lint and meaningful controller tests;rebuild then actualElectronGUI tests for surface changes. Verify8-choice inventory,all-page save/retry/restore,only-sound,mask/no-snooze and preview isolation. Preserve Mac-prefixed vs originalWindows screenshots. Actual desktop contrast/DPI/physical lock/sleep/multidisplay/signing remain host acceptance.
