# Proposed commit

`feat(ui): 重构银白与黑曜液态玻璃主题`

- `app/renderer/App.tsx`
- `app/renderer/styles.css`
- `.trellis/spec/frontend/ui-contract.md`
- `design-system/eyecare/MASTER.md`
- `docs/acceptance.md`
- `docs/liquid-glass-evidence.json`
- `docs/screenshots/macos-browser-liquid-glass-overview-light.png`
- `docs/screenshots/macos-browser-liquid-glass-overview-dark.png`
- `docs/screenshots/macos-browser-liquid-glass-general-dark.png`
- `.trellis/tasks/10-16-liquid-glass-themes/check.jsonl`
- `.trellis/tasks/10-16-liquid-glass-themes/design.md`
- `.trellis/tasks/10-16-liquid-glass-themes/implement.jsonl`
- `.trellis/tasks/10-16-liquid-glass-themes/implement.md`
- `.trellis/tasks/10-16-liquid-glass-themes/prd.md`
- `.trellis/tasks/10-16-liquid-glass-themes/research/design-research.md`
- `.trellis/tasks/10-16-liquid-glass-themes/task.json`
- `.trellis/tasks/10-16-liquid-glass-themes/commit-plan.md`

## Excluded parallel work

- `src-tauri/src/lib.rs`
- `docs/tauri-migration-checklist.md`

## Validation

Typecheck, lint, 29 frontend tests, 75 Rust tests, frontend build, Tauri release binary build, diff whitespace check and 24 browser layout cases pass. Browser visual/interaction evidence is recorded; native WebView composition and real OS transparency signaling remain separate. User approved this batch with “执行”; no push is authorized.
