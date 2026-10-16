# Liquid glass light and dark themes

## Goal
Refactor EyeCare into a coherent, tactile liquid glass desktop interface in both themes. Dark mode must use a black neutral base with no green.

## Authorization
The user requested ui-ux-pro-max, liquid glass texture and animation, then explicitly instructed “创建并修改” (create and modify). This authorizes task creation and implementation without another permission round.

## Background
React 19 / Tauri 2 renderer uses centralized green-tinted themes in app/renderer/styles.css. Four pages, SettingsEditor autosave, and immutable reminder overlays already work.

## Requirements
- R1: Light theme uses silver/white translucent glass, crisp edges, inset specular highlights and restrained depth.
- R2: Dark theme uses black/charcoal neutral surfaces and white/silver highlights. No green surfaces, accents, text, or glow.
- R3: Navigation and controls convey a liquid material through layered highlights and interruptible state transitions; overview has a polished focal point. Avoid ongoing decorative animation or pointer tracking.
- R4: Keep existing navigation, eight settings, autosave, reminder preview, timer and overlay behavior. Pure black flash remains immutable.
- R5: Preserve keyboard semantics, visible focus, text contrast, stable choice-card geometry, exact .96 button press <=150ms, reduced motion/transparency and accessible exceptional overflow.

## Acceptance criteria
- All four normal pages fit 600x520 and 600x620 in both themes without clipping or hidden actions.
- Both themes show a visible glass hierarchy; dark mode is black neutral without green.
- Navigation, toggles, buttons and dialogs provide responsive, interruptible feedback; reduced motion removes positional animation and active scaling, reduced transparency provides opaque equivalents.
- Existing controller tests, typecheck, lint and frontend build pass. Attempt Tauri build; record native evidence limits separately.
- Browser screenshots and interaction checks cover both themes, all pages, keyboard, reductions and modal. Browser fixture is not proof of native composition.

## Out of scope
Backend/IPC/settings schema changes, timer behavior, native window lifecycle, new settings, new dependencies and continuous shader/refraction loops.
