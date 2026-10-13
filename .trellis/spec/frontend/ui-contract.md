# EyeCare UI Contract

Current: user-approved eight-choice SettingsV2,2026-10-13. Existing Liquid Glass tokens and native-host evidence remain under MASTER.md/docs/acceptance.md. This contract replaces legacy advanced/manual/snooze UI.

## 1. Scope / Trigger

Overview,trigger/reminder/general pages,native tray menu,preview and mask are presentation-only. Settings are8 core choices; defaults are centralized shared product behavior,not an advanced form or hidden preference.

## 2. Signatures

| Surface | Contract |
|---|---|
| TriggerSettings | V2 mode,intervalMinutes,longIdleMinutes;auto intent updates |
| ReminderSettings | V2 visual/soundEnabled,one preview action |
| GeneralSettings | V2 theme/countdown/login,restore confirmation;auto intents |
| SettingsEditor | edit(next,immediate?),flush,retry,accept;serialized V2save |
| Mask | acknowledge/skip with ID/generation,immutable resolved options |
| Preview | V2 options,independent identity/result,no timer/rest mutation |

## 3. Behavior contracts

- Pages have3+2+3 configurable values. No custom effect/text/tone/volume/screen/source/window controls,manual save/discard bar,manual navigation confirmation or separate prelisten.
- Defaults:active30min,long idle10min,flash,soundoff,system theme,traycountdownon,startupoff. Numericranges1..240/1..120minutes preserve invalid/empty inputs.
- Only-sound atomically selects visual=none and sound=true. Sound toggle is visibly disabled with an explanation while it is the sole channel. Server validation still rejects none+false.
- All discrete edits autosave immediately,numbers after300ms or blur. Preserve versioned field intents separately from effective baseline; serialize saves,never overwrite later input with older responses. Invalid unrelated fields do not block valid edits. Conflict or persistence/OS failure retains intent and offers retry/reapply,without a retry storm.
- General controls display effective values on failure;OS login failure must not imply successful enablement. Restore once confirmed replaces all core values via the same queue and autosaves,with visible failure if transaction fails.
- Overview keeps state,time,pause/resume/remindNow and short rules. Timer ownership stays in main. Tray follows the same snapshot;countdown display does not decide eligibility. Clicking the tray opens only its native menu;no custom countdown panel is created.
- General shows only relevant capability abnormalities;unused mouse-only diagnostics are omitted. Linux unknown tray retains an accessible main window. Healthy systems do not show a diagnostic list.
- Theme system/light/dark persists immediately,affects main/overlay tokens and does not reset time. Motion/transparency automatically respect OS;no app overrides.
- Mask has Know/知道了 and close/Escape. Acknowledge closes all linked masks,confirms once and starts a full next cycle;skip starts a cycle without rest confirmation. No延期 action exists. Preview acknowledgement only closes preview.
- Flash remains nonfocusable and click-through,automatically settles without rest confirmation. Current event options are immutable;appearance refresh does not restart audio/effect.
- Labels/units remain visible. Error text is near its field,with accessible association. Pending/success/failure text uses status/alert semantics without each-second timer announcements.
- Main880x620,min640x520;compact navigation and scrolling retain all necessary actions. Focus is never obscured by sticky manual-save content (none exists).
- Existing semantic palette/vector family/CJK system font/tabular digits and keyboard focus remain. Glass focuses on navigation/controls with stable readable content surfaces;OS reductions use equivalent opaque/static behavior.

## 4. Error matrix

| Condition | Response |
|---|---|
| Invalid/empty numeric input | Keep input and old effective value,inline error;other valid fields save |
| No reminder channel | Explain and reject;only-sound UI atomically avoids this state |
| Revision conflict | Retain inputs,show reapply against latest snapshot |
| Disk/OS/login failure | Old effective choices remain,enabled retry,accurate failure |
| Old snapshot/response | Reject old revision/sequence;do not revert appearance/input |
| Suppressed preview/remind | No effects,show reason |
| Failed channel/window startup | Report failure,clear preview identity and cleanup |
| Duplicate/old overlay action | No extra rest/reset |

## 5. Good / Base / Bad cases

Good: mode changes and two numeric edits all survive in-flight saves and restart. Base: choosing only-sound also enables audio in one save. Good: General login error leaves the old effective switch and retry. Bad: merely hiding a snooze button while preserving expiry behavior. Bad: retained old screen/volume settings override fixed defaults. Bad: skipping and acknowledgement both confirm rest.

## 6. Required proof

Controller tests:debounce/blur,invalid-to-valid and independent fields,rapid/reverted in-flight intents,no-op writes,snapshot ordering,conflict,retry and restore defaults. ActualElectron tests:exact eight-choice inventory,all-page autosave/persistence/restart,only-sound pairing,restore confirmation,General disk/OSfailure with injected OS APIs,preview/real mask distinction and no延期 button,flash/audio cleanup,compact/focus/theme behavior. Tests use temporary userData;OSlogin failure/success APIs are injected and restored,not global actual login changes. Preserve platform-prefixed screenshots.

Visual/native acceptance remains separate for actual desktop composition,DPI/large fonts,physical lock/sleep/multi-screen/Spaces,notification signing and long-run performance.

## 7. Wrong vs Correct

Wrong: hiding advanced configuration while old persisted values still govern reminders. Correct: strict V2 core values plus shared immutable resolved defaults.

Wrong: older save response replaces a later draft or theme. Correct: versioned field intents and accepted snapshot ordering.

Wrong: full form needs another Save button. Correct: all8 controls autosave and failure has an explicit recovery action.

## Implemented boundaries

- Preview controls/results derive from main snapshot identity;renderer local booleans cannot outlive closed windows.
- Overlay consumes resolved creation-time options,validates readiness/playback callbacks and cleans timers/audio when destroyed.
- Fixed production CSP permits local scripts/media only,renderer Node remains disabled.
