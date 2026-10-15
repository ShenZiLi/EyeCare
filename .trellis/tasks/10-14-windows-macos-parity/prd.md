# Windows 与 macOS 功能对齐和原生验收

## Goal

Bring Windows 11 and supported macOS builds to the same dependable core EyeCare experience, using the existing macOS implementation as the behavior reference. Implement Windows gaps, recheck the macOS baseline, and record native evidence for both platforms. Linux work is deferred.

## Confirmed Facts

- The existing product scope targets macOS 14+ Apple Silicon/Intel and Windows 11 x64. Linux is a separate target and is explicitly deferred for this phase (`.trellis/tasks/10-10-eyecare-product-design/prd.md`, R1; current scope set by the user on 2026-10-14).
- Shared app behavior owns timers, settings, reminders, overlays, notifications, sound, tray state and persistence. Platform adapters own native clock/input/lock observations, lifecycle integration, login startup and packaging differences.
- macOS has native clock, combined-input and lock paths, plus ARM64 runtime/package evidence. Physical transitions, additional architectures/versions and other native scenarios remain open (`docs/platform-evidence.md`, `docs/acceptance.md`).
- Windows has native clock, combined-input, Raw Input mouse, lock/session and login-startup paths, plus prior Windows 11 installed-app evidence. Several physical lock/sleep/input/multi-display/tray/startup cases remain open (`app/main/platform/native.ts`, `docs/platform-evidence.md`, `docs/acceptance.md`).
- Automated adapter tests can validate fail-closed logic but do not establish native compatibility. Windows-specific host verification must run on Windows; macOS package/runtime verification must run on macOS.
- Current workspace has unrelated uncommitted UI/assets changes. Keep the implementation scoped to platform parity and do not overwrite or revert those changes.

## Requirements

- Compare macOS and Windows behavior across trusted time and combined activity, lock/sleep suppression, timer continuity, flash/mask/notification/audio reminders, multi-display behavior, tray/recovery access, settings persistence, login startup, and packaged installation/runtime.
- Correct any confirmed Windows behavior gap at its owning platform/native boundary, preserving shared contracts and fail-closed safety behavior.
- Treat the current macOS implementation as the reference. Change macOS code only to fix a demonstrated defect or a shared-contract issue needed for parity.
- Verify both platforms with automated checks and native host evidence. Clearly distinguish source/tests, packaged-app evidence, and physical/native acceptance.
- Document remaining host, architecture, permissions, signing, DPI, display, and lifecycle gaps instead of reporting them as complete.
- Do not implement Linux in this phase. Keep Linux and Wayland's current capabilities and limitations accurately documented; do not make unrelated Linux changes.
- Do not publish installers or push changes remotely as part of this task.

## Acceptance Criteria

- [ ] A macOS-to-Windows capability matrix covers every parity area above and marks each item as implemented, natively verified, or still open with evidence and a reason.
- [ ] Windows 11 x64 packaged-app checks cover startup, trusted clock and combined input, lock/sleep suppression and recovery, reminder delivery/cleanup, tray/recovery behavior, login startup and installation/upgrade paths relevant to this product.
- [ ] macOS packaged-app checks preserve the existing ARM64 baseline and verify affected runtime behavior; Intel or other OS versions are marked unverified unless tested on those hosts.
- [ ] Automated checks cover safety-sensitive adapter behavior and pass for the changed code.
- [ ] Shared timer, settings, IPC, reminder and fail-closed contracts have no regressions; platform evidence and acceptance status are updated.
- [ ] Linux implementation remains unchanged and explicitly deferred in this task's records.

## Out of Scope

- Linux/X11/Wayland implementation and native acceptance; keep existing status notes current only if this task's documentation edits require them.
- Changing the shared product contract or adding platform-specific user preferences to mimic native behavior.
- Claiming architecture or OS coverage from a different host, mocked tests, or package creation alone.
- Publishing, signing for distribution, notarizing, or pushing to a remote repository.
