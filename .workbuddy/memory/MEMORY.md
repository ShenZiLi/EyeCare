# EyeCare 项目长期记忆

## 项目规范（立立定）

1. **每次改动都要提交 git**（2026-10-10 立立明确）
   - 任何文件/代码/文档改动完成后，立即 `git add` + `git commit`，不攒批、不留未提交工作区。
   - commit message 用约定式前缀（feat/fix/docs/chore/refactor）。
   - 提交前先跑通相关验证；验证失败则不提交。

## 工程约定

- 仓库根：`/Users/shen/Studio/Code/EyeCare`，主分支 `main`。
- 项目由 Trellis 管理，工作知识在 `.trellis/`（workflow.md / spec/ / workspace/ / tasks/）。
- 代码检索优先用 codebase-memory-mcp 图谱工具（search_graph / trace_path / get_code_snippet），grep 仅兜底。
