# Fix intermittent flash before the soft flash animation

## Goal
A soft flash should begin transparently and execute one smooth dim/hold/brighten cycle, without a preceding visible flash.

## Confirmed facts
The user reports an intermittent extra flash before the normal animation. Current OverlayEvent calls overlayReady, then starts its WAAPI fade only after the response. ReminderCoordinator.ready shows the native window before that response. build_overlay creates an initially hidden transparent WebView. This is a timing suspect, not yet a reproduced root cause.

## Requirements
- Remove the unintended pre-animation visual discontinuity.
- Preserve fixed pure-black 90% opacity and 600/800/600ms default fade/hold/fade once actually presented.
- Preserve click-through/nonfocusable flash, mask focus, immutable creation options, sound coordination, cancellation and real/preview isolation.
- Delayed readiness, duplicate events and appearance updates must not trigger extra cycles or expose an unprepared frame.
- Normal visual success must follow actual fade completion even if the rendering timeline starts late; retain bounded native failure cleanup and static reduced-motion duration.

## Acceptance criteria
- Deterministic regression test captures the relevant initialization/order failure and passes with the fix.
- Native preview runs on the exact current .app; user confirms the intermittent symptom is fixed. Evidence clearly distinguishes native observations/user acceptance from mock timing assertions.
- Current frontend checks, relevant Rust tests and production build pass.

## Out of scope
Theme redesign, settings schema, new effect options, timer semantics and unrelated native-window work.

## Authorization and convergence
User explicitly approved the preceding combined request to create the task, reproduce and fix the bug ("可以"). No new product decisions remain: preserve the existing effect and remove unintended flashes. Planning artifacts are reviewed against the current source before implementation.

## Evidence boundaries
The source confirms an opaque shared-entry startup path and show-before-animation ordering. Native Tauri preview was invoked successfully via the exact .app path; the intermittent pre-flash has not yet been captured at frame resolution. Browser/mocked tests prove initialization contracts, not the absence of native compositor artifacts.

## Acceptance result
The user confirmed “问题已修复” and requested git commit plus remote push. All checks passed; no unresolved product decision remains.
