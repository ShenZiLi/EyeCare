# EyeCare UI Contract

> Branch implementation: Tauri 2 only. Runtime ownership lives in `src-tauri/src/`; renderer IPC lives in `app/renderer/bridge.ts` using invoke/listen. Historical Electron API details and acceptance notes below describe the earlier implementation, not dependencies or verification requirements for this branch. Frontend output is `dist/`; native bundles are in `src-tauri/target/release/bundle/`. Run `npm run check` (frontend + Rust tests); native GUI acceptance remains separate. Legacy settings migration remains supported.


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
- Overview keeps state,time,pause/resume/remindNow and reminder-interval dropdown20/30/40/custom1..240minutes;it shares the timer.intervalMinutes autosave queue with Trigger. No current-rules block or pause-duration options. Pause requires explicit resume. Hide only the sampling-gap warning text from UI;retain engine gap safety and other warnings. Timer ownership stays in main. Tray follows the same snapshot;countdown display does not decide eligibility. Clicking the tray opens only its native menu;no custom countdown panel is created.
- On macOS, closing a main window with confirmed tray availability hides the main window and its Dock icon, retaining the native tray and background reminders. Reopening overview/settings restores the Dock icon and main-window focus. Background reminder overlays do not restore the Dock icon; minimization retains ordinary Dock behavior. Keep no-tray access and real quit behavior intact. Rapid close/reopen must not let delayed Dock work hide an open window or re-show a hidden application.
- General shows only relevant capability abnormalities;unused mouse-only diagnostics are omitted. Linux unknown tray retains an accessible main window. Healthy systems do not show a diagnostic list.
- Theme system/light/dark persists immediately,affects main/overlay tokens and does not reset time. Motion/transparency automatically respect OS;no app overrides.
- Mask has Know/知道了 and close/Escape. Acknowledge closes all linked masks,confirms once and starts a full next cycle;skip starts a cycle without rest confirmation. No延期 action exists. Preview acknowledgement only closes preview.
- Flash is a fixed90%-opaque pure black veil in both themes,with600/800/600ms fade/hold/fade. Its color/opacity come from immutable event options;do not substitute theme palette colors. Flash remains nonfocusable and click-through,automatically settles without rest confirmation. Current event options are immutable;appearance refresh does not restart audio/effect.
- Press feedback uses exactscale0.96 with<=150ms named transitions. Keep eligibility exclusions in :where so dataset and OS reduced-motion scale1 rules win;transition:none alone does not stop scaling. Theme swaps suppress transitions only on actual effective-theme changes,not each snapshot.
- Labels/units remain visible. Error text is near its field,with accessible association. Pending/success/failure text uses status/alert semantics without each-second timer announcements.
- Main600x620,min600x520;all four normal pages fit one viewport in both themes,including core choices,actions and successful feedback. Prefer compact grouping/parallel fields and reduced whitespace;never clipping,hidden actions or unreadable fonts. Long errors/capability reasons/large text retain accessible overflow fallback. Focus is never obscured by sticky manual-save content (none exists).
- Neutral silver light / black dark semantic palette (2026-10-16; no green), existing vector family/CJK system font/tabular digits and keyboard focus remain. Glass focuses on navigation/controls with stable readable content surfaces;OS reductions use equivalent opaque/static behavior.

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
- Main owns macOS Dock visibility. Electron 44.7 can ignore hide calls within one second of another hide or immediately after an awaited Dock.show completes. Use a monotonic 1.1-second transition cooldown; delayed hides re-check current window identity, requested/actual visibility, tray availability and quitting, and are cancelled by reopening/quit. Native regression must exercise first-close, rapid close/reopen, late show completion, background overlays, minimize/restore and clean exit; mocked Dock calls alone do not prove this OS behavior.
- Overlay consumes resolved creation-time options,validates readiness/playback callbacks and cleans timers/audio when destroyed.
- Fixed production CSP permits local scripts/media only,renderer Node remains disabled.

### Stable choice switching

Trigger/reminder selection is frequent state feedback,not an entrance animation. Keep choice-card geometry/opacity stable across pointer/keyboard selection and automatic-save completion. Reserve a consistent settings-page feedback slot;pending status must not push all content down and remove it again. No global section/field/notice mount keyframes or card transform/scale. Card keyboard focus uses input:focus-visible with one visible card ring;pointer focus must not add a second ring. Preserve native radio semantics,disabled handling and rapid autosave intents. Any selection transition is short,named-property and interruptible;keyboard/reduced-motion selection is immediate. Do not hide errors to obtain stable geometry.


### Neutral optical glass — 2026-10-16

`styles.css` owns all material and motion tokens. Light uses silver/white; dark uses black/charcoal with equal-RGB neutral highlights and accents (semantic errors remain red). `App` renders one decorative `.nav-lens` with inline current-index transform; its 44px height and 52px pitch match 44px navigation rows plus 8px gaps. Keep decoration `aria-hidden` and `pointer-events:none`.

Glass uses static illumination, edge highlights and inset shadows; countdown ellipse is decorative and must not imply timed progress. No continuous/per-second material animation or pointer tracking. Navigation uses a 260ms transform transition, switches 240ms, dialog opacity/transform 240ms with `@starting-style`; unsupported engines display the final state. Keyboard-visible focus disables spatial transition. Choice cards remain stable.

Dataset/media reductions cover gradients, blur and decorative pseudo-elements. Motion reduction removes transition/animation on both pseudo-element types and forces active button scale1, but preserves checked switch thumb translation. Do not apply global `transform:none`: that would make an enabled switch look disabled. Test checked position, not just transition duration. Normal four-page layout is verified at CSS 600x520, 600x620 and 880x620 in each theme; large text/errors may scroll accessibly.


### Transparent reminder startup and actual completion — 2026-10-16

Native overlay windows load `overlay.html?surface=overlay`, built alongside `index.html`. The dedicated HTML must declare overlay identity and critical transparent backgrounds for html/body/#root plus `color-scheme: normal` at parse time, before any application CSS/module executes. Do not replace this with the main entry and a later JavaScript dataset assignment: that permits an opaque main-surface backing frame. Keep the critical rules higher priority than normal dark-theme canvas rules; mask content still uses theme tokens. No additional script CSP permission is needed.

`startOverlayPlayback(state, flash, bridge, soundUrl): () => void` prepares one normal-motion WAAPI animation paused at currentTime0 before `overlayReady`. Successful readiness starts animation/audio. Reduced motion prepares its static opacity before readiness and uses the fixed presentation-duration timer. Cancelled/stale/failed readiness cleans up without playing; unmount cancels timers/animation/audio and suppresses late callbacks. Creation-time settings and event identity remain immutable.

Normal flash reports visual success from `animation.finished` only. A wall-clock timeout equal to the keyframe duration can fire while a delayed rendering timeline remains dark; do not use it as proof of visual completion. Observe the finished rejection immediately so cancellation during readiness cannot create an unhandled rejection. The native coordinator watchdog remains the bounded stalled-playback protection; it is a failure path, not a successful fade timer.

Regression points: parser-time transparent document with JS blocked in light/dark; paused zero-opacity before readiness; delayed/rejected readiness; disposal before response and queued finish; delayed actual animation completion beyond nominal duration; unexpected animation rejection; reduced-motion static timing; mask/sound-only behavior. Browser timing and source tests do not establish absence of native compositor flashes; record exact-path native package observations separately.
