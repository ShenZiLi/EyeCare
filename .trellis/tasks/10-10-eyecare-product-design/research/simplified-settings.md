# Approved simplified settings implementation — 2026-10-13

User explicitly requested implementation of the complete reviewed plan. This amendment supersedes historical configurable advanced parameters, snooze and manual General saves in existing task/spec files. Existing native release acceptance remains open.

## Product decisions

Only eight configurable values: timer mode active/fixed (active), intervalMinutes1..240 (30), longIdleMinutes1..120 (10), reminder visual flash/mask/notification/none (flash), soundEnabled (false), appearance theme system/light/dark (system), showTrayCountdown (true), general launchAtLogin (false). All pages autosave discrete edits immediately and numeric input after300 ms/blur. Restore defaults requires one confirmation then autosaves; no save/discard/manual-draft navigation UI.

Fixed defaults: combined mouse/keyboard input, activeWindowSeconds60; flash fadeInMs600/holdMs800/fadeOutMs600/opacity20/theme-derived color; gentle sound/volume50; all screens; built-in message. Motion/transparency follow system. Choosing visual none (display label only-sound) atomically enables sound, disabling sole sound is disabled with a clear explanation. Preview is one button; no individual sound prelisten. System capabilities show only abnormalities. Overview has concise state/time/actions/summary.

Delete snooze end-to-end: no duration, action, runtime state, remaining time, timer branch, preview outcome, IPC acceptance or strings. Mask acknowledge closes every overlay, confirms once and resets the normal cycle. Skip/Escape resets without rest confirmation. Flash/notification/audio keep automatic completion. No historical catch-up after suppression. Event identities and immutable creation-time options remain.

## Coordination / shared interface

Backend owns app/shared, app/main, app/preload, scripts, unit/integration engine/store/validation/native tests. Frontend owns app/renderer, tests/e2e and tests/unit/settings-editor.test.ts. Root owns task/docs/spec/bookkeeping. .idea is user-owned and must remain untouched.

`SettingsV2` has schemaVersion2 and only the eight nested timer/reminder/appearance/general values. `defaultSettings(): SettingsV2`. Export centralized readonly `PRODUCT_DEFAULTS` for fixed values plus `ResolvedSettings` and `resolveSettings(settings: SettingsV2): ResolvedSettings`, used for immutable ReminderEvent options. RuntimeSnapshot.settings and bridge save/preview take V2; ReminderEvent.settings is resolved. Shared defaults live in one place, not as user-editable or persisted V2 properties. Backend should publish these exports first and coordinate their exact layout with frontend.

Storage accepts strictly validated V1 envelopes only for migration, retains eight core values, ignores removed customization after validating legacy structure, and upgrades to V2 atomically. Preserve an original V1 migration backup once (settings.v1-backup.json, no overwrite). Migration failure must preserve the original file and warn; usable in-memory V2 remains available for retry. Main/last-good recovery supports legacy migration as well. Saves retain atomicity, revision conflicts, strict unknown-field rejection and OS login rollback. Old snooze bridge action is rejected as INVALID_COMMAND.

## Verification / delivery

Backend proof: V1 upgrade with customized removed options, core preservation/default resolution, exact backup and migration failure/restart/recovery; V2 exact keys and unknown/snooze rejection; acknowledge/skip/idempotence/no-reschedule; active/fixed/suppression/next-cycle settings; startup rollback. Frontend proof: only eight controls, no advanced/save/snooze UI, only-sound automatic pairing, General autosave/restore/retry, persistence/restart/rapid edits and preview isolation. Physical lock/sleep/multi-display/signing remains distinct from fake-provider and Electron tests.

Root runs full check, native make, actual Mac GUI suite and isolated packaged V2 migration/save/confirmation smoke. Test userData is temporary; do not toggle real login items or OS permissions. Commit locally, no push; keep overall delivery task in_progress.

## Final review and evidence

Review reproduced startup rollback when persisted enabled=true but OS disabled=false: a failed disk save restored true incorrectly. `prepareLoginChange` now captures actual OS state before mutation; saveWithLogin uses its apply/rollback pair. Capture failure prevents writes, rollback failure has a separate accurate error, Windows exact owned registry values/approval and Linux bytes/mode/absence are preserved. Final185 pure/integration and15 real MacGUI tests passed; make and isolated packaged V1 migration/backup/failure retry/core autosave/restart/real mask acknowledgement passed. Actual native V2 one-minute cycle passed; evidence is in docs/acceptance.md and the Mac JSON files. Native Windows/Linux transaction execution remains separate acceptance.
