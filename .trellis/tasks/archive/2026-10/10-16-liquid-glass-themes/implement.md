# Execution

- [x] Implement centralized light/black dark material tokens and component treatments.
- [x] Add restrained navigation/dialog/control motion without changing domain behavior.
- [x] Run typecheck, lint, unit tests and frontend build.
- [x] Review both themes at 600x520/620 and larger desktop; check all pages, focus, modal and reduced preferences with browser fixture.
- [x] Run Trellis check sub-agent; fix verified findings.
- [x] Attempt native Tauri build and record scope of actual evidence.
- [x] Update existing visual specification and acceptance record.
- [x] Commit the approved file batch (dbec36a); archive and session journal are finalized by trellis-finish-work.

Risk points: pseudo-element layering blocking input, motion overriding switch thumb position, card selection layout drift, transparency fallbacks leaving pseudo highlights, minimum window overflow. Keep pointer-events:none on decoration and don't apply global transform resets to checked switch thumb.

Validation complete. User approved the commit plan with “执行”. Work commit dbec36a is complete; task archive and session journal finalize this session. Unrelated parallel changes in src-tauri/src/lib.rs and docs/tauri-migration-checklist.md are excluded.
