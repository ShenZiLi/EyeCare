# Bug analysis: reminder startup and completion discontinuities

## 1. Root cause category
B (cross-layer contract), E (implicit assumption), D (coverage gap). Source allowed a shared main document to initialize with an opaque canvas before overlay identity was assigned. Native show occurred before animation preparation. Separately, a duration timeout assumed renderer animation time started immediately, which browser frame sampling disproved.

## 2. Evidence and uncertainty
Opaque pre-module body and early success while opacity0.650815 are directly measured browser defects. The user-reported intermittent native pre-flash was not captured at frame resolution, so the precise native contribution remains uncertain. Wry already disables background painting for transparent windows; missing explicit native background was not treated as a proven root. One/double rAF is not a compositor acknowledgment and can stall hidden WebViews.

## 3. Why the first repair was insufficient
A parser-transparent entry plus paused zero frame closes the startup exposure, but retaining a total-duration timer can still destroy an overlay before its rendering timeline reaches zero. A frame-sampled delay exposed that independent gap before release. Actual `animation.finished` now owns normal completion; the existing native watchdog bounds failure.

## 4. Prevention mechanisms
- Architecture: dedicated transparent parser entry + isolated overlay module; keep main styles separate from boot identity.
- Runtime contract: prepare before readiness, play only after acceptance, settle from actual animation completion, ignore disposed callbacks.
- Tests: actual two-entry build plus delayed ready/finish, rejection, cleanup, static, mask and sound-only regressions.
- Review: distinguish DOM readiness, native show, compositor frames and animation time. Never infer one from another.
- Native acceptance: use exact .app path; historical Electron install has the same display/bundle name. Record functional repeats separately from high-frame-rate visual proof.

## 5. Knowledge capture
Updated frontend ui-contract and backend runtime-contract in this task. This application has no src/templates/markdown/spec mirror; no template copy applies. Work commit follows the project's separate confirmation gate. No memory files were written.
