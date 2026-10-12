# macOS native continuation evidence — 2026-10-12

## Reproduced failures

- `createMacProvider` attempted an exported `kCGSessionOnConsoleKey` symbol. The installed macOS SDK's `CoreGraphics/CGSession.h` defines it as `CFSTR("kCGSSessionOnConsoleKey")`; loading the nonexistent symbol disabled the provider. The correction creates the literal CF key and checks current UID plus typed on-console state before lock evidence.
- This host's Quartz session dictionary has no lock key. IOKit root contains an explicit boolean `IOConsoleLocked=false`. Missing/wrong-type values remain unknown. Explicit locked evidence dominates; a prior unlock event cannot replace current unknown native evidence.
- Forge/packager18.4.4 with extract-zip2.0.1 stopped after beginning extraction, exit0 and no output `.app`. A direct kept-alive extraction also stalled. The same cached Electron44.7.0 archive extracted successfully in594ms through `@electron-internal/extract-zip@1.0.5`. The package-scoped npm alias now replaces only packager's extractor; full make emitted an ARM64 `.app` and ZIP. Node >=22.12 is required, within the project Node24 baseline. Package metadata/source in node_modules supplies the local implementation reference.

## Implementation contracts and proof

- CoreGraphics source0 supports current-session combined idle; mouse ages sample event types1..7,22,25..27 and exclude keyboard10..12. Every age must be finite/non-negative before selecting the minimum. Reads retain no input content.
- CF keys/dictionaries and IO entries have owned cleanup; borrowed values are not released. Optional lock loading failures leave independently valid clock/input available and lock unknown.
- Set development-only `EYECARE_TEST_USER_DATA` before `requestSingleInstanceLock`; two isolated instances coexist. Packaged code ignores that test env. Packaged smoke test uses Chromium's `--user-data-dir` and compares real paths before observing state, since macOS canonicalizes `/var` to `/private/var`.
- Native verification uses temporary settings and bounded waits/owned-process cleanup. It reads actual clock/input/lock, observes real Tray methods, checks a one-minute automatic flash plus mask acknowledgement, and retains the flash configuration by value before subsequent mask changes.
- Full check151 tests; focused native/platform41; real GUI9; native runtime and packaged startup evidence under docs. Screenshots are prefixed `macos-`, preserving Windows images.

## Limits

macOS26.4 ARM64 only, one display at scale2. No distribution signing identity. Physical lock/sleep, input-device separation, multiple displays/Spaces, login execution, signed notifications, other architectures/OS versions and long-run performance remain acceptance work. Native API availability and fake-provider tests do not prove these scenarios.
