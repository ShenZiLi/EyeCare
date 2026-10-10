# Backend implementation guidelines

## Scope and pre-development checklist

Read `runtime-contract.md`, current PRD/design/execution record and `app/shared/contracts.ts` before changing a command or runtime state. Inspect the current affected code and tests. Keep engine, OS adapter, persistence and rendering ownership separate.

## Signatures and shared contracts

Import `SettingsV1`, `PlatformSample`, `EngineUpdate`, `RuntimeSnapshot`, `ReminderEvent`, `Result<T>` and channel types from the shared contract. Renderer data crosses `unknown` validation once. Native provider errors return unknown/null through the platform adapter; only engine chooses the user-visible runtime priority.

## Persistence and commands

Settings schema rejects unknown nested fields, nonintegral times, invalid channel combinations, unsupported mouse source and empty selections. Save changes only after durable success and revision agreement; failed login startup rolls back OS preference. Counters/reminder IDs never persist.

## Error behavior

`CommandError.detail` is the typed IPC error; thrown store/native errors become visible failure messages. Critical lock/input/clock faults block reminders. Old messages no-op, while invalid sender/channel identity is rejected. Every overlay failure must destroy all associated windows and stop attached audio.

## Good/base/bad cases

Good: lock changes invalidate an immutable event generation before show. Base: successful flash completion starts one new round without rest confirmation. Bad: tray/renderer decrement separate counters, settings drafts write despite invalid fields, missing native flags become unlocked, partial window load leaves an input blocker.

## Quality check

Run `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` for backend changes. Run packaged Electron e2e when command/window/native wiring changes; rebuild `.vite` first. Virtual-clock and mocked adapter tests prove logic only; native-host acceptance remains separate.

## Wrong vs correct

Wrong: both `index.ts` build entries write `index.js`. Correct: explicit main/preload entry names. Wrong: any `file:` sender is trusted. Correct: exact registered local URL plus known WebContents/main frame and role authorization.
