# Approved work batch

User: 问题已修复，提交git，并推送远程

`fix(reminder): 修复柔和闪屏首帧闪烁与提前结束`

- `app/renderer/Overlay.tsx`
- `app/renderer/overlay-playback.ts`
- `app/renderer/overlay-main.tsx`
- `app/renderer/overlay.html`
- `src-tauri/src/reminders.rs`
- `vite.renderer.config.ts`
- `tests/unit/overlay-playback.test.ts`
- `tests/unit/overlay-entry.test.ts`
- `.trellis/spec/frontend/ui-contract.md`
- `.trellis/spec/backend/runtime-contract.md`
- `docs/acceptance.md`
- `docs/flash-first-frame-evidence.json`
- `.trellis/tasks/10-16-flash-first-frame/check.jsonl`
- `.trellis/tasks/10-16-flash-first-frame/design.md`
- `.trellis/tasks/10-16-flash-first-frame/implement.jsonl`
- `.trellis/tasks/10-16-flash-first-frame/implement.md`
- `.trellis/tasks/10-16-flash-first-frame/prd.md`
- `.trellis/tasks/10-16-flash-first-frame/research/browser-before-completion-fix.json`
- `.trellis/tasks/10-16-flash-first-frame/research/bug-analysis.md`
- `.trellis/tasks/10-16-flash-first-frame/research/first-frame-timing.md`
- `.trellis/tasks/10-16-flash-first-frame/task.json`
- `.trellis/tasks/10-16-flash-first-frame/commit-plan.md`

Excluded parallel edits: src-tauri/src/lib.rs and docs/tauri-migration-checklist.md. Push current dev-tauri branch, including its earlier liquid-glass work and bookkeeping commits. No force push.
