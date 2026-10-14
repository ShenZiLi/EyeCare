# Stable choice switching —2026-10-14

User reports trigger/reminder choice cards jumping/flashing on click. Apply animate skill: frequent settings feedback should be near-imperceptible state indication;keyboard selection instant. Existing renderer has conditional autosave status which changes header height, broad section/notice/field mount content-in translate/opacity keyframes, and mouse focus-within duplicatecard+native-radio rings. Minimal scope renderer App.tsx/styles.css/Settings.tsx asneeded,focusedGUI test. Preserve corepreferences/autosave,liquidglasspalette,normalbuttonfeedback andpreview/timerbehaviour.

Reserve stable header autosave feedback slot even when healthy (empty/noextra usercopy),remove unsolicited mount keyframes,reuse stable timer field identity through mode changes,keyboard-only card focus-visible (no double nativeoutline). Radio native rendering may be replaced with CSS checked state retaining nativeinput semantics if actualflicker callsforit. Keep fixed geometry and subtle fast selectedstatefeedback; no transform/scale/outline animation on optioncard,no animation replay onsnapshot/savecompletion. Reducedmotion dataset+OS suppress selectiontransitions.

Root validates relevantonly in isolatedactualElectron profile,builds localMac with completedadhocsigning,restartsuserapp andlocalcommit. No fullsuite,no test notification permissions.

## Implementation and proof

Settings-header feedback slot remains mounted with1.6em minimum height;Overview spacing preserved. Removed global content-in and retained first timefield Numeric node identity. Radios use stable18px CSS circle/8px checked dot while preserving native semantics. Pointer selection only background/border130ms;keyboard-only card focus ring is instantaneous and whole focused group has transitionnone,including deselected peer. Dataset/OS reducedmotion suppress choice transitions. No dependencies.

Typecheck and scopedlint passed,source review approved. Focused realElectron case covers Trigger/Reminder×light/dark×native880620/640520:sampled card positions through420ms selection/autosave stay fixed,opacity1/transformnone,no CSSkeyframes,checked state persists,mousehasnoextraoutline,keyboardfocus/arrowcheckedstate and reducedmotion pass;normal content fits viewport. Mac fullsigned.app/ZIP rebuilt and restarted. No fullsuite.
