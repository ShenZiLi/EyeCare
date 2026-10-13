# Compact four-page follow-up — 2026-10-13

User explicitly requests better-ui and compact,one-viewport presentation of Overview/Trigger/Reminder/General. Apply /Users/shen/.skills-manager/skills/better-ui-plugin/skills/better-ui/SKILL.md and surfaces/animations recipes,keeping existing Liquid Glass palette/component library and eight-setting automatic-save contract.

## Change boundary

Compact layout lives in renderer App/Settings/components/styles. Final manual-pause follow-up also changes engine/main/preload/shared/native tray pause contracts;deep black flash and settings storage stay unchanged. Reduce oversized whitespace and duplicated status chrome,compact cards/toggles/radio grid,parallel time inputs and group footer actions. Normal page content must fit native880x620 and640x520 in both themes,including saved feedback and past preview results. Do not hide actions or clip with overflow:hidden. Long errors,diagnostics and large fonts retain an accessible overflow fallback.

Close nested radii are concentric;neutral layered shadows provide depth while focus/selected/divider borders communicate state/structure. Explicit interactive transitions<=150ms,press scale0.96,static navigation/reduced motion,consistent icon stroke2 with600 labels. Suppress color transitions only on actual theme flips,not on every one-second snapshot. No new dependencies or expressive page entrances.

## Verification

Real Electron tests measure viewport overflow and every visible control/label/footer across four pages,two themes,two sizes and a max4-hour countdown;test hover/focus/press and reduced-motion/static states. Existing invalid-input/failed-save/retry/restore/preview cases must remain accessible. Walk actual browser states and slow interactions to0.1 playback;document coverage limits instead of approving unseen states. Root owns tests/docs;implement agent owns renderer;check agent audits final diff. Rebuild Mac,check actual packaged layout and restart user app;local Git commit,no push,overall native release task stays active.

## Review finding

Live slow-playback test found that four press-selector pseudo-classes outweighed reduced-motion overrides. Use button:active:where(:not(:disabled):not(.nav-item):not([data-static])) so exclusions add zero specificity. Assert computedscale1 for both dataset and OS-media reduction while actively pressed;turning off transition alone is insufficient. Programmatic focus after mouse input does not imply focus-visible;keyboard Tab traversal is the appropriate focus-ring check.

## 最终交互调整

用户明确概览下拉框是提醒间隔（20、30、40、自定义分钟），与触发条件共用自动保存；暂停仅手动恢复。删除概览规则卡片及采样延迟提示的界面投影，保留引擎对未知时段的安全处理及其他异常说明。用户要求只验证改动，最终调整不重复全量测试。

## 收尾记录

初始紧凑布局完成时185项检查、17项Electron界面用例通过，旧Mac打包布局16组合通过。最终交互调整定向46项后端测试、类型检查及相关lint通过，3项Electron用例通过（四页/双主题/双窗口尺寸、提醒间隔自动保存及手动暂停、提示/规则卡片删除）。Mac .app/ZIP已重建。随后用户要求立即停止校验并收尾；不再重复全量测试或新版打包实机矩阵。已有跨平台验收记录保持原样。
