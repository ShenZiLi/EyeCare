# Appearance Theme Resolution

## 1. Scope / Trigger

Adding a bundled app theme spans serialized V2 preferences, validation/storage, runtime snapshots and live overlay appearance. No schemaVersion or field-count change is needed for the handdrawn enum extension.

## 2. Signatures

`ThemePreference::{System,Light,Dark,Handdrawn}` serializes to system/light/dark/handdrawn. `EffectiveTheme::{Light,Dark,Handdrawn}` is used by RuntimeSnapshot.theme and OverlayState.theme. PlatformSample.system_theme remains `Theme::{Light,Dark}`. `From<Theme> for EffectiveTheme` converts OS observations at the engine boundary. `theme_key(EffectiveTheme)` is exhaustive.

## 3. Contracts

TimerEngine.get_snapshot resolves System from the observed OS theme (light fallback), while manual choices resolve directly. Handdrawn does not depend on OS palette. A preference save changes appearance without resetting elapsed time or replacing the immutable current reminder. ReminderCoordinator.sync_appearance copies only theme/reduction presentation fields; event identity/options remain unchanged.

Use separate V2 and V1 theme allowlists. LegacyAppearanceSettings reuses ThemePreference internally, so extending that enum alone must not widen accepted historical data. Keep strict unknown-field validation, original-byte backups and existing envelope/revision semantics. Default remains system. Older binaries may reject handdrawn; no automatic downgrade rewrite is implemented.

## 4. Validation and Error Matrix

| Payload | Result |
|---|---|
| V2 theme system/light/dark/handdrawn | Accept and persist through existing transaction |
| V2 unknown theme | INVALID_SETTINGS, appearance.theme |
| V1 theme handdrawn or unknown | Reject legacy payload; not a migration candidate |
| Appearance-only change during current event | New presentation, unchanged event ID/generation/options |

## 5. Good / Base / Bad Cases

Good: handdrawn survives storage reload and an OS palette update while elapsed time remains intact. Base: system maps observed dark to effective dark. Bad: widen PlatformSample's OS palette to handdrawn or reuse the V2 whitelist for V1.

## 6. Required Tests

The settings suite round-trips all bundled preferences, rejects unknown V2 and fabricated V1 handdrawn, and preserves existing migrations. The engine suite asserts handdrawn independence from OS changes, no timer reset, and unchanged event identity/settings across a live appearance swap. Compile exhaustive native matches and build both frontend entries. Source/mocked tests do not establish native compositor or physical platform behavior.

## 7. Wrong vs Correct

Wrong: add Handdrawn to the OS-observation Theme enum or silently convert it to Light before publishing. Correct: use EffectiveTheme for app presentation and retain Theme for native observations.
