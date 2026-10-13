# Immediate settings — 2026-10-13

## Authorized interaction

Trigger and reminder pages no longer require “保存设置”. Choices/switches/selects save immediately; numeric/text edits save after300 ms or blur. General's manual preferences retain their original behavior. Invalid input stays visible and never silently replaces effective settings.

## Executable state ownership

`app/renderer/settings-editor.ts` owns versioned per-field intents, readiness/debounce, effective snapshot revision/sequence and a single persist queue. `edit(next, auto, immediate?)` detects changed fields; `pump` composes them into the latest effective settings and calls the existing validated save bridge. The pure main settings validator is Node-free and reused in the renderer bundle, preventing duplicate rules. Related invalid idle/channel/screen fields stay pending; unrelated valid intents can save. Responses clear only matching intent versions. Snapshots and appearance reject stale revision/sequence. Retry remembers automatic vs manual failure scope; automatic retries never commit unrelated manual General input.

## Verified evidence

- TypeScript/ESLint plus162 total unit/integration cases pass;11 editor cases cover debounce, invalid/coupled recovery, delayed responses, no-op writes/reversion, conflict/reapply, disk/connection failure and manual retry scope.
- Final rebuilt Mac source GUI suite:11 cases pass, including rapid changes, absence of save/discard controls, restart persistence, invalid-to-valid/cross-page recovery and actual disk failure/retry.
- Isolated production ARM `.app` GUI edits proved exact fixed42-minute/mask/text values and matching persisted settings. `docs/instant-settings-evidence.json` records this. New ZIP SHA256 is in docs/acceptance.md; version remains1.0.2.

## Diagnostic observation and limits

An intermediate full-suite run filled `请看看远处` but later observed `请看看` in both GUI and saved configuration. Cause was not established. Eight instrumented exact rapid-edit repetitions captured full input events and saved the full string; the final full suite also passed without replacing Chinese text or weakening assertions. A pure out-of-order Chinese prefix/full-value regression passes. The original rapid-edit test now attaches bounded, test-page-only input/composition/focus/controlled-DOM-value and saved-state evidence on failure, restoring observers afterward. No speculative product patch or attribution to native input was made.

Awaited GUI assertions must use `expect.poll` for asynchronous bridge reads. `waitForFunction(() => bridge.getSnapshot().then(predicate))` can pass on a truthy Promise before the saved value is verified; the packaged proof uses polling and exact expected values plus disk equality.

These UI changes do not re-establish older physical lock/sleep/multi-display, signing or additional-host acceptance. That full release work remains open.
