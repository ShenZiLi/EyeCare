# EyeCare UI Contract

Status: implemented in `app/renderer`; real Windows Electron e2e evidence and screenshots are recorded in `docs/acceptance.md`. Use `design-system/eyecare/MASTER.md` and the task PRD as sources of truth. Full native composite contrast, scaling and target-host acceptance remain pending.

## 1. Scope / Trigger

This contract covers overview, trigger settings, reminder settings, general settings, tray panel, previews, and mask interactions. It keeps liquid glass legible and makes all timer decisions visible without putting timer ownership in the renderer.

## 2. Signatures

| Surface / operation | Contract |
|---|---|
| Overview | renders RuntimeSnapshot; pause/resume/remindNow via bridge |
| TriggerSettings | draft SettingsV1 + expectedRevision; one validated save |
| ReminderSettings | visual selection + independent sound + preview |
| GeneralSettings | immediate theme/countdown preference commits |
| TrayPanel | same RuntimeSnapshot + identical commands |
| Mask | resolveReminder with ID/generation/action |
| Preview | separate preview identity; never resolves a real reminder |

## 3. Contracts

- Default theme=system, default visual=flash, sound disabled, tray countdown enabled.
- Theme modes are system/light/dark; light/dark are the only palettes. Manual mode ignores system theme changes, switching back synchronizes immediately.
- Overview renders one primary remaining-time value and a human-readable rule summary. Active-mode remaining time is conditional on activity, not a promise of a wall-clock reminder timestamp.
- State copy distinguishes counting, short idle, long idle, manual pause, snooze, waiting for mask confirmation, lock/sleep and capability fault.
- Windows/Linux tray numeric icons expose units and exact time in the panel; Mac can show full adjacent title. Do not claim equal native typography across platforms.
- Disabled capabilities include a visible reason; users can return to settings without losing their draft.
- Labels remain visible. Timer/source parameters use explicit units. Field errors appear beside the control; values are preserved after failure.
- Theme/countdown toggles save immediately without timer reset. Other forms commit as a valid batch; leaving unsaved drafts offers keep/discard.
- Main window is approximately 880x620, minimum 640x520 logical pixels; layout adapts without clipping controls.
- Text uses system sans with CJK fallback; tabular digits stabilize countdown width. Ordinary text target >=4.5:1, important controls/icons >=3:1.
- Glass is concentrated in navigation/controls; content has stable surfaces. Reduced transparency replaces glass with opaque semantic equivalents.
- Reduced motion removes decorative transitions and converts flash to a short static color prompt; timer digits do not roll every second.
- Icons are from one vector family. Icon-only controls have accessible names; decorative icons beside text are hidden from the accessibility tree.
- Mask keyboard focus stays inside its interactive panel. Escape skips; Know/“知道了” confirms rest; no gesture-only exit. Restore previous application focus when the platform permits.
- All selected screens share one reminder identity. Acknowledge once closes all; previews do not change progress or emit rest.
- Closing the main window leaves an accessible tray entry; where no tray exists, do not hide the only reachable control surface.

## 4. Validation & Error Matrix

| UI condition | Response |
|---|---|
| invalid time or incompatible window/idle values | inline message, save blocked, keep input |
| no visual and sound disabled/zero | explain missing channel, save blocked |
| selected screen unplugged | temporary primary fallback plus message, retain saved intent |
| theme/countdown save fails | revert to last effective choice with error feedback |
| revision conflict | retain draft, show latest effective settings, offer reapply |
| preview requested while locked/sleeping | no effects, show suppression reason on return |
| unsupported input/lock/overlay capability | explain precise unavailable function, never fake success |
| failed notification or audio | report channel failure, do not silently upgrade visual intrusion |

## 5. Good / Base / Bad Cases

- Good: system changes to dark while theme=system; all application surfaces update, timer progress stays the same.
- Base: tray countdown display is disabled; icon/menu remain and the engine continues unchanged.
- Good: “知道了” in a real mask starts a full new period; the same action in a preview only closes preview.
- Bad: translucent panel is unreadable over a bright desktop; increase surface opacity or use opaque fallback, not lighter text.
- Bad: a timer is announced every second by a screen reader; announce meaningful state changes, not each tick.

## 6. Tests Required

UI tests: both themes, manual override/system sync, persistence, countdown toggle without reset, validation and preserved drafts, keyboard/focus order, real-vs-preview action isolation, multi-screen acknowledgement, rule summaries and state labels.

Visual/native checks: actual light/dark desktop backgrounds, composite contrast, 100/125/150/200% scale, CJK long labels, large fonts, reduced motion/transparency, tray digits, no focus theft from flash, usable Escape on mask. None of these is claimed to have passed at the design stage.

## 7. Wrong vs Correct

Wrong: applying one translucent card and text color to both themes. Correct: distinct semantic palettes plus measurements of the composed surface.

Wrong: the countdown toggle disables reminders. Correct: it only changes the tray presentation.

Wrong: a close button and “知道了” have identical rest semantics. Correct: skipping and confirming are different event actions.

## Implemented conventions

- `App` owns the form `draft`, effective `base` and expected `revision`; snapshots never overwrite dirty input. Invalid saves and version conflicts retain it; reapply explicitly uses latest effective revision. Immediate appearance commits merge only theme/countdown into existing drafts.
- Preview active controls and terminal feedback derive from shared `currentPreviewId` / `latestPreviewResult`; never maintain a local boolean that stays active after the coordinator closes its windows. Automatic completion, acknowledgement, Escape, cancellation and failure each update the main page. Failed startup stays visible in the preview dialog and cannot show success feedback.
- `Overlay` mounts an event keyed by ID/generation. Creation-time parameters start once after `overlayReady`; appearance messages update tokens without restarting audio or flash. Audio `play()` resolution sends `overlaySoundStarted`; end/error sends one channel result. Window destruction cancels animation, timers and audio.
- `Field` and `Toggle` use visible wrapping labels; numeric controls keep units and preserve invalid/empty input. Sidebar icon-only mode keeps explicit accessible names.
- `Modal` and masks trap Tab/Shift+Tab, offer button exits, support Escape and restore local focus. Saved scroll padding and control scroll margins reserve 132px against the sticky save bar so focus is not obscured.
- Static production CSP permits only local scripts/media. Development uses a local Vite nonce for React refresh; no production remote page or renderer Node access is enabled.
