# Implementation plan

- [x] Add transparent overlay entry and production Vite input; update native overlay URL.
- [x] Prepare zero-opacity flash before readiness, play only after acceptance; preserve cleanup/cancellation/static reductions.
- [x] Add focused deterministic ordering/startup regressions without new dependencies.
- [x] Run typecheck/lint/unit/Rust checks and production app build.
- [x] Inspect browser startup/dark/reduction behavior and exact native app preview; record visual evidence limits.
- [x] Dispatch Trellis checker; fix verified issues.
- [x] Record prevention contract, acceptance evidence and commit plan.

Scope: app/renderer/overlay.html, Vite config, app/renderer/Overlay.tsx and narrowly needed lifecycle helper/tests, src-tauri/src/reminders.rs URL only unless concrete evidence requires a local correction. No changes to native lib.rs or parallel migration checklist. Do not claim double-rAF proves native paint.

User confirmed the problem fixed and explicitly authorized commit plus remote push. Native repeated-test scope was concluded on user acceptance after one cold native preview; no frame-resolution native claim is made. Final checks:40 frontend+75 Rust,lint,typecheck,production entry test and .app build pass.
