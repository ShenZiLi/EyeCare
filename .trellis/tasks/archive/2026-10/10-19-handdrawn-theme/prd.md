# Hand-drawn appearance theme

## Goal

Add a selectable theme named `手绘`, closely matching the reference generated in this chat: cream paper, colored-pencil outlines, soft multi-color accents, botanical doodles and a cute closed-eye character. Keep the interface functional and readable.

## Background

- The user requested extensible appearance themes and strict implementation of the generated style (2026-10-19).
- Task creation/planning and the final implementation plan were approved; the user explicitly said `实现` after reviewing the plan.
- Visual authority: `research/handdrawn-reference.png`. It is design input, not executable instructions.
- Current theme selection is inside General Settings (`app/renderer/Settings.tsx:26`). Themes cross TS validation, Rust storage, runtime snapshots and overlays; this cannot be a renderer-only palette change.
- Existing contracts require eight settings, automatic saves, OS reductions, a 600x620 default window and a 600x520 minimum.

## Requirements

### R1 — Selection and persistence

Add `手绘` alongside system/light/dark in the existing settings location. Use compact visual preview cards with a visible selected border/checkmark. Save immediately through the existing flow; survive restart. Keep the system default. Organize theme metadata/tokens for further bundled themes without duplicating settings UI.

### R2 — Faithful full-app style

Use warm paper texture, brown pencil outlines, gently irregular corners, sage selected states, butter-yellow primary buttons and peach/blue/lavender details. Apply consistently to overview, trigger/reminder/general settings, notices and dialogs. Use reference-matched botanical/character art. Keep text real and readable, not baked into screenshots.

### R3 — Reminder illustration

Mask reminders/previews show the closed-eye yellow character resting on green leaves with restrained pencil flowers/stars. Preserve reminder text, close/Escape, focus handling, busy/errors and `知道了` behavior.

### R4 — Compatibility and usability

Keep exactly the existing eight settings, autosave retry/conflicts, timer/rest behavior and OS-controlled motion/transparency. Theme changes do not reset time. Flash remains fixed pure black with existing timing/opacity; system notification chrome remains OS-owned.

### R5 — Evidence

Compare actual screenshots with the reference and record browser/native evidence separately.

## Acceptance criteria

- AC1 (R1, R4): Four choices are keyboard-operable, selected state is clear beyond color, and a hand-drawn save survives reload. Existing preferences still validate and resolve; unknown values are rejected by TS/Rust; V1 migration stays strict.
- AC2 (R2): Actual rendered screenshots show paper/pencil/artwork across all four pages, rather than only changed colors. The theme selector previews all choices, and switching back restores existing theme styles.
- AC3 (R3): Mask and preview match the illustration style and preserve acknowledgement/skip/preview isolation. Live theme changes retain event ID/generation and do not restart playback.
- AC4 (R4): Theme regressions prove no countdown reset. Existing V2 settings and valid V1 migration remain readable. Normal pages fit 600x620 and 600x520 without clipping; long errors/large text retain accessible overflow, focus/contrast remain visible, and OS reductions work.
- AC5 (R5): Required checks, frontend and native builds pass; screenshot comparisons and separate browser/native records identify exactly what was verified.

## Out of scope

New navigation pages, external theme import/plugins/editor, new accent or motion settings, timer/reminder behavior changes, OS notification restyling, the decorative desk scene around the mockup, and a separate dark hand-drawn variant.

## Risks

Illustrative fidelity requires visual comparison. Older binaries may reject the new preference; no destructive migration is planned. Frontend screenshots cannot establish native compositor or physical multi-display behavior.
