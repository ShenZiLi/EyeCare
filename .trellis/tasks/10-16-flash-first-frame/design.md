# Flash first-frame design

## Findings
The overlay URL currently loads index.html?surface=overlay. Main stylesheet gives body the opaque application background until main.tsx sets the body dataset; the overlay inherits root dark color-scheme. Overlay.ready shows the native window before the renderer creates its fade animation. Wry transparent(true) already disables drawsBackground, so a missing native background color is not a demonstrated root cause. Native observation has not frame-captured the intermittent bug.

## Smallest repair
Add a dedicated overlay.html entry that declares overlay identity, transparent html/body/root and normal color-scheme at parse time, before the application stylesheet/module executes. Configure both HTML inputs in Vite and load the overlay entry from native build_overlay. Preserve index.html/main behavior and IPC sender+identity validation.

Prepare the flash at its first opacity before calling overlayReady: normal-motion animation paused at time zero; reduced-motion static state prepared explicitly. Start actual playback only after successful readiness. Normal motion reports visual success only when the actual WAAPI animation finishes, not from a wall-clock timeout; use the existing native playback watchdog for a stalled renderer. Reduced-motion static presentation retains its total-duration timer. No unbounded hidden requestAnimationFrame wait: hidden native WebViews may suppress callbacks. Handle cancellation/stale readiness without playback or late reports, and clean up any prepared animation/audio once.

## Contracts
Retain existing overlay_ready/finished payloads and immutable event options. No new settings/bridge commands. Native transparency, nonfocusability, click-through, mask focus, sound coordinator and preview identity remain. If additional native background configuration proves necessary, use existing Tauri API with evidence rather than treating it as the sole fix.

## Verification
Deterministic tests cover first transparent document before JS, dark appearance preserving transparent canvas, normal/reduced preparation ordering, delayed/failed/stale ready and teardown before response. Production build must emit and reference both entries. Browser fixture verifies styles and timeline but cannot certify macOS composition. Build and launch exact-path Tauri .app, repeat preview cold/warm and record observed results/limits. Preserve unrelated dirty src-tauri/src/lib.rs and docs/tauri-migration-checklist.md.

## Rollback
Renderer entry, Vite input, overlay initialization and native URL form one atomic change. Revert that unit together. No persisted migration.

## Discriminating browser evidence
A production entry with renderer modules blocked had body rgb(236,238,241), no surface marker and light color-scheme. Dedicated overlay entry remains rgba(0,0,0,0) for html/body/root and normal scheme in both light/dark before app JS.

A delayed-ready browser fixture then exposed a second concrete lifecycle flaw: normal animation stayed at time0 for about430ms before advancing. Fixed wall2000ms completion reported success while animation time was1566.12ms and opacity0.650815; the actual fade reached0 only at wall2429.7ms. This proves a fixed completion timer can truncate the animation when the animation timeline starts late. It is not a direct recording of the user's native pre-flash.
