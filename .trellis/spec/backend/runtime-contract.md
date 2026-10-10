# Planned EyeCare Runtime Contract

Status: design only, not an implemented API. Source of product behavior: `.trellis/tasks/10-10-eyecare-product-design/prd.md`; architecture: `.trellis/tasks/10-10-eyecare-product-design/design.md`. Implementation is explicitly unauthorized in the current session.

## 1. Scope / Trigger

This contract governs the future main-process timer, platform observations, settings persistence, and renderer boundary. It prevents duplicate reminders, stale multi-screen acknowledgements, divergent countdowns, and reminders on a locked screen.

## 2. Signatures

These are design signatures, not code to execute.

| Operation | Input | Output |
|---|---|---|
| PlatformAdapter.sample | none | PlatformSample |
| PlatformAdapter.subscribe | event listener | unsubscribe handle |
| TimerEngine.acceptSample | PlatformSample | RuntimeSnapshot + effects |
| SettingsStore.save | expectedRevision, SettingsV1 | updated settings or typed error |
| Bridge.getSnapshot | none | RuntimeSnapshot |
| Bridge.subscribeSnapshot | listener | unsubscribe handle |
| Bridge.saveSettings | expectedRevision, SettingsV1 | settings revision + snapshot |
| Bridge.pause | durationMinutes or until-resumed | RuntimeSnapshot |
| Bridge.resume | none | RuntimeSnapshot |
| Bridge.remindNow | none | reminder ID or suppression error |
| Bridge.resolveReminder | reminderId, generation, action | RuntimeSnapshot |
| Bridge.preview | validated reminder options | preview ID or suppression error |
| Bridge.quit | none | clean cancellation then process exit |

Pause duration choices are 15/30/60 minutes or until-resumed. Reminder actions are acknowledge, skip, or snooze; snooze duration comes from validated settings. Preview is a separate lifecycle and cannot resolve a real reminder.

## 3. Contracts

### SettingsV1

| Field | Type / constraint | Default |
|---|---|---|
| schemaVersion | integer, exactly 1 | 1 |
| timer.mode | active or fixed | active |
| timer.intervalMinutes | integer, 1..240 | 30 |
| timer.activitySource | combined or mouse | combined |
| timer.activeWindowSeconds | integer, 5..300 | 60 |
| timer.longIdleMinutes | integer, 1..120; seconds >= active window | 10 |
| reminder.visual | flash, mask, notification, none | flash |
| reminder.soundEnabled | boolean | false |
| reminder.soundId | shipped audio asset identifier | gentle |
| reminder.volumePercent | integer, 0..100 | 50 |
| reminder.flashOpacityPercent | integer, 5..80 | 20 |
| reminder.flashColor | validated sRGB hex or theme-derived | theme-derived |
| reminder.fadeInMs / fadeOutMs | integer, 100..5000 | 600 / 600 |
| reminder.holdMs | integer, 0..10000 | 800 |
| reminder.snoozeMinutes | integer, 1..60 | 5 |
| reminder.screenScope | all, primary, selected | all |
| reminder.screenIds | unique stable IDs, required for selected | empty |
| reminder.message | non-empty trimmed plain text, <=200 characters | localized reminder |
| appearance.theme | system, light, dark | system |
| appearance.showTrayCountdown | boolean | true |
| appearance.reduceMotion / reduceTransparency | system, on | system / system |
| general.launchAtLogin | boolean | false |

There is no preserve-after-long-idle setting. `visual=none` requires soundEnabled and volumePercent > 0. Unsupported mouse-only capability rejects that selection. Unknown fields are rejected at the IPC boundary; schema migrations are explicit.

PlatformSample: increasing sequence, trustworthy timestamp, combinedIdleMs, selectedSourceIdleMs, lockState (locked/unlocked/unknown), sleeping, displays, and capability statuses. Failed or unavailable measurements are nullable, never coerced to zero. Input content and pointer trajectories are never present.

Capability status: available / unsupported / permission_required / error / unknown, plus non-sensitive reason. Required lock capability must be healthy before dispatch. Linux adapters verify the current session and desktop; logind hints alone are not proof of observed lock state.

RuntimeSnapshot: settingsRevision, sequence, status, elapsedActiveMs, remainingMs or null, pauseRemainingMs or null, snoozeRemainingMs or null, currentReminderId or null, theme, capability summary, and latest reminder result. Renderer and tray share this snapshot. Paused/idle/locked status is explicit; countdown display does not decide eligibility.

Reminder: immutable ID, generation, configuration snapshot, screen IDs, kind (real/preview), and channel results. Exactly one real reminder or snooze exists. Only a valid real mask acknowledge emits `rest_confirmed`; it is a runtime event, not a durable statistics page in v1.

Persistence: versioned settings in userData/settings.json, atomic replace and last-known-good backup. Runtime counters and reminder IDs are not persisted. No product environment variables or cloud services are required.

### Time invariants

- Sample at 1-second cadence, integrate elapsed eligible time; never add a constant tick to compensate for delays.
- Missing observations longer than 5 seconds are not credited as activity.
- Mouse-only accumulation and combined long-idle detection use different fields.
- Lock, sleep, pause, snooze, presentation, and critical faults block accumulation.
- Long idle resets accumulated time even while manually paused.
- Fixed deadlines skip missed periods; no historical queue.
- A created reminder/snooze cancelled by suppression consumes its cycle; its old generation cannot restart after resume.
- Theme/countdown display changes apply immediately without reset. Timer parameter changes reset an ordinary cycle; while a real reminder is presenting, save them for the next cycle without replacing that reminder's immutable parameters.

## 4. Validation & Error Matrix

| Condition | Error / behavior |
|---|---|
| wrong type, out-of-range, empty required value | INVALID_SETTINGS; retain effective settings and draft |
| active window exceeds long-idle threshold | INVALID_IDLE_WINDOW |
| no usable reminder channel | NO_REMINDER_CHANNEL |
| mouse-only capability unavailable | CAPABILITY_UNAVAILABLE |
| selected screen list empty | INVALID_SCREEN_SELECTION |
| config revision changed | SETTINGS_CONFLICT; return current revision |
| persistence failure | SETTINGS_WRITE_FAILED; retain last effective state |
| corrupt settings on startup | recover last-known-good/default, show recovery message |
| locked/sleeping/unknown lock or critical fault | REMINDER_SUPPRESSED; no visual or sound effect |
| existing reminder or preview collision | REMINDER_BUSY; do not create another event |
| stale/duplicate resolve | STALE_REMINDER or idempotent no-op; no reset, no rest event |
| obsolete/duplicate platform sample | ignore; no double integration |
| all channels failed | settle one cycle, report error, no immediate retry |

Sender origin and payload validation apply to every renderer call. No arbitrary IPC channel, native module, shell, or user-supplied file path is exposed.

## 5. Good / Base / Bad Cases

- Good: combined input drives the default mode; long idle clears progress; the next input starts a full interval.
- Base: a flash and optional sound belong to one reminder. Flash completion settles the cycle once and does not emit rest_confirmed.
- Good: acknowledge on screen A closes A and B; duplicate acknowledge on B has no effect.
- Bad: a keyboard user is treated as long-idle just because activitySource=mouse; use combinedIdleMs for long-idle detection.
- Bad: a 30-minute sleep contributes 30 minutes of activity; sleep is excluded and trusted absence duration drives reset.
- Bad: a late previous-generation window action resets the next cycle; reject obsolete generation.

## 6. Tests Required

Virtual-clock tests: active-window and long-idle boundaries, 25-minute then 10-minute idle reset, fixed missed deadlines, delayed/duplicate ticks, NTP jumps, startup/restart, lock at dispatch, sleep duration, pause/snooze cancellation, old generation, repeated multi-screen resolve, all-channel failure, settings conflicts and corruption.

Integration assertions: one main-process owner; typed preload API; no renderer Node access; shared snapshot sequences for tray/UI; previews cannot mutate real timer; destroyed windows cannot leave an input-blocking overlay; platform unknown is not unlocked.

Native assertions: actual current-session input, lock/sleep/resume, permissions, displays, DPI, notifications in signed/packaged binaries. Mock tests do not establish platform support.

## 7. Wrong vs Correct

Wrong: UI timer and tray timer each decrement their own counter. Correct: one engine snapshot drives both displays.

Wrong: a notification was submitted, therefore the user rested. Correct: only the user's real mask acknowledge has that product meaning.

Wrong: no lock measurement means unlocked. Correct: unknown lock state blocks new reminders and surfaces a reason.
