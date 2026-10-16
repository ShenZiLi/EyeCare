# EyeCare Runtime Contract

> Branch implementation: Tauri 2 only. Runtime ownership lives in `src-tauri/src/`; renderer IPC lives in `app/renderer/bridge.ts` using invoke/listen. Historical Electron API details and acceptance notes below describe the earlier implementation, not dependencies or verification requirements for this branch. Frontend output is `dist/`; native bundles are in `src-tauri/target/release/bundle/`. Run `npm run check` (frontend + Rust tests); native GUI acceptance remains separate. Legacy settings migration remains supported.


Current contract: user-approved SettingsV2 simplification,2026-10-13. Product requirements: active task prd.md; native/release evidence: docs/acceptance.md. Local framework tests do not prove physical platform support.

## 1. Scope / Trigger

Main owns timer, native observations, persistence, OS startup and reminder identity. Renderer owns only input/display. Eight core choices are persisted; advanced effects are fixed internal defaults. Snooze is removed from every active runtime/API path; only strictly validated legacy storage may contain its former field.

## 2. Signatures

| Operation | Input | Output |
|---|---|---|
| defaultSettings | none | SettingsV2 |
| resolveSettings | SettingsV2 | ResolvedSettings for immutable event options |
| validateSettings | unknown | Result<SettingsV2> |
| SettingsStore.load | none | settings/revision/warnings, migrating legacy disk data |
| SettingsStore.save | expectedRevision,unknown settings | Result<settings/revision> after durable success |
| PlatformAdapter.sample | combined source | PlatformSample |
| TimerEngine.acceptSample | PlatformSample | EngineUpdate(snapshot,effects) |
| Bridge.saveSettings | expectedRevision,SettingsV2 | Result<RuntimeSnapshot> |
| Bridge.preview | SettingsV2 | Result<preview ID> |
| Bridge.resolveReminder | ID,generation,acknowledge or skip | Result<RuntimeSnapshot> |

Remaining whitelist commands cover no-argument pause,resume,remindNow,cancelPreview,getSnapshot/getOverlay,readiness/sound/finished reports,openSettings and quit. Sender exact URL/WebContents role/main-frame and payload validation remain mandatory. No arbitrary Node/shell/path/channel bridge is exposed.

## 3. Data and persistence contracts

SettingsV2 has schemaVersion2 plus exactly these fields:

| Field | Constraint | Default |
|---|---|---|
| timer.mode | active/fixed | active |
| timer.intervalMinutes | integer1..240 | 30 |
| timer.longIdleMinutes | integer1..120 | 10 |
| reminder.visual | flash/mask/notification/none | flash |
| reminder.soundEnabled | boolean;true when visual=none | false |
| appearance.theme | system/light/dark | system |
| appearance.showTrayCountdown | boolean | true |
| general.launchAtLogin | boolean | false |

PRODUCT_DEFAULTS is readonly and central: combined input,60-second active window; fade600/hold800/fade600ms,opacity90%,pure black (#000000) independent of theme; gentle sound/volume50;all screens,built-in message. resolveSettings copies core choices and resolves fixed parameters; ReminderEvent.settings uses ResolvedSettings. Fixed parameters never become editable/persisted V2 fields. System reductions come from platform observations only.

RuntimeSnapshot.settings is V2. No snoozed status/snoozeRemainingMs/snooze action or preview outcome exists. Real/preview events have immutable ID/generation/options/target IDs; exactly one real reminder exists. Only valid real mask acknowledgement emits rest_confirmed once. Preview identities/results are separate and cannot modify real time/rest.

Storage envelope is settings+nonnegative safe-integer revision. Current validation is Node-free under app/shared/settings-validation.ts and reused by renderer/main. Legacy SettingsV1 validation is storage-only and strict, including removed old fields. A valid primary or last-good legacy envelope maps eight choices to V2; removed customizations do not survive resolution. Before replacement preserve original UTF-8 bytes once in settings.v1-backup.json without overwriting an existing valid migration backup. Sync temporary writes then publish backup/primary atomically. Migration failure preserves source and warns while retaining usable in-memory V2 and retry intent. Last-good/default recovery remains explicit; runtime progress and event IDs never persist.

Login startup uses a stable executable and existing platform API/read-back. `prepareLoginChange(enabled)` captures actual OS state before mutation and returns apply/rollback; `saveWithLogin` must use that capture, never the persisted preference as a rollback substitute. Capture failure is LOGIN_READ_FAILED and prevents all writes. Apply or preference-save failure restores the captured OS state and leaves effective settings unchanged; failed rollback is LOGIN_ROLLBACK_FAILED. Mac captures Electron openAtLogin with read-back. Windows captures only exact owned Run/StartupApproved entries including presence, value kind, unexpanded string and approval bytes using bounded fixed PowerShell; do not touch unrelated entries or execute captured data. Linux captures owned desktop bytes/mode/absence, rejects symlinks and uses exclusive temporary writes/chmod/rename/read-back for restoration. Migration alone does not enable/disable OS login items. Windows owned legacy-path repair retains system approval; unrelated/missing items are untouched.

Tray interaction uses only the existing native context menu. macOS setContextMenu owns click presentation; other platform left-click handlers open that same menu. No custom panel window or panel IPC sender role exists. Menu actions call the same main-owned callbacks; tray countdown/title/tooltip remain snapshot-derived.

### Time invariants

- One-second native observations integrate eligible elapsed intervals, never constant ticks or renderer clocks.
- Combined input alone drives both activity and long-idle checks, with60-second window. Missing observations>5 seconds are not credited.
- Clock/input/lock failures are unknown/null and suppress new effects. Unknown lock is never unlocked.
- Lock/sleep/pause/presentation/fault block accumulation; long idle clears even while paused.
- Fixed deadlines skip missed beats; no historical queue or deferred reminder expiry exists.
- A suppressed created reminder consumes its cycle and cannot revive after resume.
- Core timer changes reset an ordinary cycle; while presenting they apply to the next cycle. Reminder creation options remain immutable.
- Theme/countdown changes do not reset time. Snapshot sequence/revision prevents stale presentation updates.

## 4. Validation and error matrix

| Condition | Behavior |
|---|---|
| Wrong version/type/range,missing or unknown field | INVALID_SETTINGS;no persistence or effective replacement |
| visual=none with sound=false | NO_REMINDER_CHANNEL |
| Old snooze action | INVALID_COMMAND;never deferred scheduling |
| Stale config revision | SETTINGS_CONFLICT,latest revision returned |
| Persistence failure | SETTINGS_WRITE_FAILED,prior effective settings retained;restore actual captured OS startup state |
| Login capture/rollback failure | LOGIN_READ_FAILED before mutation / LOGIN_ROLLBACK_FAILED with accurate partial-state warning |
| Invalid/corrupt disk data | Last-good/default recovery with warning |
| Migration backup/write failure | Source retained,warning,in-memory V2 and later retry |
| Locked/sleeping/critical observation fault | Suppress effects,cleanup current event |
| Existing event/preview collision | REMINDER_BUSY |
| Stale/duplicate action | No reset/rest side effect |
| All-channel delivery failure | Settle one cycle,cleanup,report;no retry storm |

## 5. Good / Base / Bad cases

Good: legacy mouse/custom-color/screen/snooze preferences migrate only eight choices; runtime uses combined/black/all/fixed defaults. Base: flash+sound belongs to one event and settles once. Good: acknowledge on A closes A/B and rest increments once. Bad: removing only the button leaves a backend snooze branch. Bad: treating failed migration as a corrupt valid legacy file and discarding core choices. Bad: default-derived options are persisted as custom V2 fields.

## 6. Required assertions

Tests must cover exact V2 keys/ranges/unknown-field rejection and storage-only strict V1 migration; original-byte/no-overwrite backup; migration failure/restart/last-good recovery; login rollback; fixed defaults overriding removed customization. Engine tests cover fixed/active boundaries,missed beats,absence/long idle,clock failure,ack/skip/automatic,idempotence,no-reschedule,immutable current event and next-cycle timer settings. Integration validates exact sender/identity,old snooze rejection,real/preview separation,all-overlay cleanup and unknown-lock safety. Actual Electron/packaged tests separately prove UI/bridge/native loading; physical lock/sleep/multi-screen/signing requires host acceptance.

## 7. Wrong vs Correct

Wrong: rollback startup to the saved preference when actual OS state differs. Correct: capture actual state before any mutation and restore that state.

Wrong: UI and tray have separate counters. Correct: both consume one snapshot.

Wrong: persist or accept removed advanced options in V2. Correct: strict eight-field schema plus central defaults resolved into events.

Wrong: a submitted notification proves rest. Correct: only real mask acknowledge has that product meaning.

Wrong: absence of lock evidence means unlocked. Correct: unknown suppresses.

## Implementation guardrails

- Atomic saves serialize and use expected revision. Publish effective state only after successful disk/OS transaction.
- Preload is role/URL validated, renderer has no Node or remote content, production CSP remains local.
- Capture WebContents IDs while alive; closed callbacks must not access destroyed webContents. Every delivery failure/cancel destroys all owned surfaces and stops audio.
- Event readiness and playback reports match registered sender+ID+generation and original options. Appearance refresh must not restart audio/flash.
- Build the React frontend to `dist/` and compile the sole native runtime from `src-tauri/`. No main/preload bundle, Koffi or Forge dependency is used.
- Development EYECARE_TEST_USER_DATA applies before single-instance lock and is ignored when packaged. Tests never change real OS permissions/login preferences.
- Never infer Linux tray availability by allocating Tray. Unknown tray retains main-window recovery; unknown Wayland input/overlay remains explicit.

### macOS native observations and build verification

- `kCGSessionOnConsoleKey` is an SDK `CFSTR("kCGSSessionOnConsoleKey")` macro, not an exported symbol. Create the exact CF string and validate the dictionary's typed on-console boolean plus current UID before accepting lock evidence. A missing/wrong-type key or another session is unknown.
- Query typed current-session `CGSSessionScreenIsLocked` and root `IOConsoleLocked` evidence. Missing flags never mean unlocked; any explicit locked observation wins over unlocked disagreement. Optional IOKit failures must not discard otherwise valid clock/input observations. Unlock events clear only the event latch; they do not turn a fresh unknown native query into unlocked.
- CoreGraphics combined session source `0` supplies combined idle and the minimum mouse/drag/button/scroll ages for event types `1..7`, `22`, `25..27`. Validate every age as finite and non-negative before taking the minimum; keyboard types `10..12` are excluded. Never collect event content or pointer coordinates.
- Release only owned CF strings/dictionaries and acquired IO entries, including partial initialization and exceptional paths. Dispose is idempotent; borrowed dictionary values are not released.
- Native-provider regressions must cover macro-key construction, UID/on-console mismatch, missing/malformed flags, lock disagreement, optional API failures, bad event ages, partial allocations and duplicate disposal. Real native probes and `verify:macos-runtime` separately prove current-host observations and one actual minute's tray/flash/mask integration; they do not prove physical lock/sleep or other hardware.
- Build under the documented Node 24 baseline. Pin the packager-only `extract-zip` alias to `npm:@electron-internal/extract-zip@1.0.5` in package/lock files. Its Node >=22.12 requirement is mandatory. Do not infer package success from exit status: verify the target `.app` executable and generated ZIP; the old extractor exited successfully with an incomplete extraction on this host.

Wrong: `cg.symbol('kCGSessionOnConsoleKey')`, absent flags treated as false, or an old unlock event accepted as current evidence. Correct: literal CF keys, typed current-session evidence and unknown suppression. Wrong: invalid event ages hidden by `Math.min`; correct: validate each age first.

### macOS notification signing

Electron44 uses UNUserNotificationCenter and requests authorization internally. Notification.isSupported() proves API availability only;successful show/failed events determine delivery. A packaged Mac app needs a complete bundle signature binding Info.plist/resources,not merely an inherited Electron linker signature. Local builds without a configured Developer ID use full ad-hoc bundle signing;Developer ID/notarization remains required for distribution. Never disable security checks/reset user permissions or silently replace notification with a mask. macOS UNErrorDomain1 maps to actionable notification-settings/signed-app instructions;retain generic errors for other platforms/domains/codes. Local signing cannot override user denial.


### Overlay entry and readiness — 2026-10-16

`build_overlay` uses local `overlay.html?surface=overlay`, not the main HTML. Vite must emit both entries. Preserve hidden transparent creation, `overlay-*` sender ownership and ID/generation validation, nonfocusable/click-through flash and focusable mask. Frontend readiness means first opacity is already prepared; do not start the animation clock while hidden or rely on hidden requestAnimationFrame callbacks to unblock show.

Normal visual success is the actual WAAPI finish callback. Native `playback_timeout_ms` remains `max(fade_in + hold + fade_out + 5000ms, 10000ms)` and cleans stalled playback as failure. Do not replace actual renderer completion with nominal fade duration; native timing and renderer animation timelines can start at different instants. This changes no settings schema, IPC payload, timer/rest or preview identity contract.
