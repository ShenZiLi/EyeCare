# Research: soft flash first-frame timing

- Query: Why can a native flash occur before the intended 600/800/600ms dim/hold/brighten cycle?
- Scope: internal source and installed native dependency source; macOS Tauri
- Date: 2026-10-16

## Findings

### Files found

- `app/renderer/Overlay.tsx`: immutable event mount, appearance application, readiness and WAAPI playback.
- `app/renderer/main.tsx`: shared entry marks overlay surface only after module imports execute.
- `app/renderer/index.html`: shared document lacks parser-time overlay surface or transparent canvas rule.
- `app/renderer/styles.css`: opaque main body fallback, dark root color scheme, transparent overlay body, zero-opacity flash.
- `app/renderer/components.tsx`: applies appearance independently of reminder identity.
- `app/renderer/bridge.ts`: readiness uses an asynchronous invoke promise.
- `src-tauri/src/reminders.rs`: hidden transparent native windows, native show, readiness and playback guards.
- `src-tauri/src/lib.rs`: validates readiness identity and returns after native ready path.
- `vite.renderer.config.ts`: currently one default HTML input.
- `src-tauri/capabilities/default.json`: overlay-* window permission scope, relevant if entry URL changes.
- `src-tauri/Cargo.toml`: Tauri 2.12.4 with macos-private-api.

### Actual sequence and code patterns

1. Native builder requests `index.html?surface=overlay`, transparent=true, visible=false (`reminders.rs:998-1003`). It lacks explicit background_color, but this alone is not a confirmed defect.
2. Shared HTML loads main module. Imported stylesheet gives all bodies an opaque theme background (`styles.css:79`). `body[data-surface="overlay"]` becomes transparent only with the marker (`styles.css:80`). Marker is assigned by JavaScript (`main.tsx:7-8`), after imports; there is no parser-time surface marker.
3. Overlay subscribes and fetches current state (`Overlay.tsx:9-14`). `receive` calls setState then applyAppearance (`Overlay.tsx:11`), setting root data-theme/data-motion/data-transparency (`components.tsx:28-37`). Dark root inherits color-scheme:dark (`styles.css:40-41`). Overlay-specific CSS does not reset html color-scheme or declare html transparent.
4. Event keyed by ID:generation mounts (`Overlay.tsx:17`). Its effect requests overlayReady (`Overlay.tsx:60`). Native `overlay_ready` validates identity, ticks eligibility, calls coordinator.ready, then returns success (`lib.rs:770-791`). Coordinator sets ready=true then calls window.show (`reminders.rs:267-278`), schedules playback protection and returns true.
5. Only after asynchronous invoke resolution does frontend create its animation (`Overlay.tsx:63-69`). CSS initial flash opacity is already zero (`styles.css:210`). Thus a DOM flash div at full black before animation is NOT supported by current source; the visible transient would need to originate from underlying document/native canvas/compositor, or another surface. Theme refresh does not recreate the effect because dependencies are ID/generation only (`Overlay.tsx:76-77`). No StrictMode wrapper exists in main.tsx.

### Evidence-ranked causes

- **High confidence architectural exposure, unconfirmed observed root:** native window shows before playback setup and before any compositor acknowledgment; the first visible backing buffer may precede the intended transparent document frame. The sequence is proven, the exact composited pixel is not.
- **Plausible first-frame source:** shared document initially uses the main opaque body style until JS marks surface; initial document painting while hidden could leave stale backing content when native window is shown. Source proves the transient styling opportunity, not that WebKit presents it after readiness in this host.
- **Plausible dark-specific source:** root color-scheme:dark may affect canvas/base color behavior even with transparent body; requires native A/B evidence. Do not state this browser behavior as confirmed without measurement.
- **Weak as sole cause:** missing explicit native background color. Installed Wry already sets drawsBackground=false for transparent=true. Explicit RGBA zero additionally configures underPageBackgroundColor on macOS >=12, useful defense but not a substitute for transparent document styling.
- **Lower likelihood:** appearance refresh restarting animation. Current keyed identity and effect dependencies intentionally prevent it; no evidence of an event remount or duplicate animation in the current report.

### Installed dependency references

Primary source on this host: `/Users/shen/.cargo/registry/src/rsproxy.cn-e3de039b2554c837/wry-0.57.0/src/wkwebview/mod.rs:371-375` disables WKWebViewConfiguration drawsBackground when transparent or an explicit background is requested. Lines429-444 explain/set underPageBackgroundColor only when an explicit color exists (macOS >=12). These are local installed source references, not browser verification. Tauri dependency requested 2.12.4; React19.1.1, Vite6.3.5 from package.json. No external web research performed.

### Minimal robust design direction

- Make overlay document transparent from the first parser frame. Preferred: dedicated overlay.html with static data-surface on html/body and inline critical html/body/#root margin/background/overflow/color-scheme rules in head, plus a dedicated renderer entry. Add both HTML entries to Vite build and change overlay URL only; retain main entry behavior. Scope canvas color-scheme:normal to the overlay html while keeping theme tokens for mask content. Avoid loading App/main presentation logic into overlay where practical.
- Alternative: an early synchronous surface bootstrap before styles and module scripts in the shared HTML, with CSP support, setting the root marker and critical CSS. This is smaller but more sensitive to CSP/build transforms and marker-order regressions. Dedicated HTML gives a directly testable static contract and avoids inline script permission expansion.
- Add explicit transparent native background as defense across native canvas/overscroll. Keep transparent(true), hidden creation, no focus and click-through for flash.
- Prepare flash playback before readiness if using WAAPI (paused at opacity0) so there is one initialized animation, then play after native success. Do not let hidden playback consume the intended duration. Protect cancellation before readiness resolves, failure cleanup, reduced-motion static opacity and one completion only. This strengthens sequencing but does not guarantee a committed compositor frame.
- Do not treat one/double requestAnimationFrame as proof of paint; hidden-window rAF may be throttled and an unbounded pre-show wait can deadlock readiness. Any renderer scheduling fence must be bounded and not marketed as native compositor acknowledgment.
- Propagate native show failure rather than reporting successful readiness while hidden if touching this path. Current `let _ = window.show()` discards failure (`reminders.rs:277`). Coordinate state/cleanup so ready=true cannot strand failed playback.

### Validation and repro points

- Unit/static document contract: overlay HTML parser-time marker, transparent html/body/root and scoped color-scheme; build emits overlay.html and native URL resolves it. Main background stays ordinary in both themes.
- Playback lifecycle with deferred readiness: exactly one prepared animation, no play/audio before readiness success, no play after unmount, reduced motion static veil, same ID appearance update does not restart, rejected/stale readiness cleans up. Mock assertions cannot establish native flicker absence.
- Native repeat captures on the exact freshly built Tauri executable/bundle, not application-name launch (old Electron install may win). Use high-frame-rate recording/camera against a stable checkerboard or bright static background. Trigger flash preview repeatedly in light/dark/system, cold/warm launch, with/without sound; include first reminder after idle and real scheduled/remind-now events. Compare pre-change baseline and post-change frames: no luminance spike/dip before one intended monotonic dim, hold, monotonic brighten. Count opportunities and observed failures; absence in a short sample is not proof of elimination.
- Native mask and sound-only regression; no Dock reappearance, focus stealing, input blocking, duplicate completion, or stale window after cancel/lock/quit. Multi-screen and reduced motion require separate host acceptance.
- If unresolved, instrument timestamps for document bootstrap, state receive, animation creation, ready request, native show, ready return, animation play and finish; capture native first-frame pixels rather than assuming timing logs establish composition.

### Related specs

`.trellis/spec/frontend/ui-contract.md`: fixed pure-black90% flash,600/800/600ms, click-through/nonfocusable, immutable current options and no restart on appearance refresh; native evidence separate.
`.trellis/spec/backend/runtime-contract.md`: sender/ID/generation validation, unknown-lock suppression, event cleanup and playback reports.
Both implementation-guidelines.md files require frontend checks, Rust tests and native build for window wiring; GUI acceptance remains independent.

## Caveats / Not Found

- No native reproduction performed by this researcher. The parent is preparing the exact Tauri bundle and baseline reproduction.
- No claim that transparency=true guarantees a transparent initial HTML canvas. Installed Wry source only establishes its native background configuration.
- No claim that CSS color-scheme causes this bug; it remains an evidence-backed test hypothesis.
- Graph coverage checked for cited main code paths: no recorded issue, metadata matched at research time; this is best effort, not completeness proof. Direct source used for CSS/HTML/config and installed dependency inspection.
- Memory registry quick search found no EyeCare/flash/Tauri prior notes; no memory-derived findings used.
- Concurrent lib.rs and docs/tauri-migration-checklist.md edits were not modified. Researcher writes only this research file.
