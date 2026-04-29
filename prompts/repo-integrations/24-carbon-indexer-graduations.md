# 24 — Carbon-based pump graduations indexer

**Branch:** `feat/carbon-graduations-indexer`
**Source repo:** https://github.com/nirholas/carbon
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

[services/pump-graduations/](../../services/pump-graduations/) currently produces graduation events. carbon is a Solana indexing framework that gives us a more durable subscription model. This prompt adds an *alternative* carbon-backed implementation behind a flag — the existing service keeps working, and we can compare correctness before any swap.

## Read these first

| File | Why |
| :--- | :--- |
| [services/pump-graduations/](../../services/pump-graduations/) | Existing graduations service — read every file in the dir. |
| [scripts/pumpfun-lifecycle-smoke.js](../../scripts/pumpfun-lifecycle-smoke.js) | Smoke test that exercises graduations. |
| https://github.com/nirholas/carbon | Indexing framework — read the README's "subscriber" section. |

## Build this

1. Add `services/pump-graduations/carbon-source.js` — an alternative graduation source matching the existing source's interface (read the existing source file to find the exact contract; do not invent new method names).
2. Wire selection: env var `PUMP_GRADUATIONS_SOURCE` with values `legacy` (default) or `carbon`. The service picks the source at startup. Do not change the default.
3. Carbon source streams graduation events and emits the same shape `{ mint, signature, ts, marketCapUsd }` as the legacy source.
4. Add `tests/carbon-graduations.test.js` mocking carbon's stream and asserting event shape parity with the legacy mock.
5. Document the flag in a single new doc file `docs/pump-graduations-sources.md` or in a comment block at the top of `services/pump-graduations/index.js` (whichever the directory's existing convention prefers — read first).

## Out of scope

- Removing the legacy source.
- DB schema changes.
- Editing the smoke test.

## Acceptance

- [ ] `node --check services/pump-graduations/carbon-source.js` passes.
- [ ] `npx vitest run tests/carbon-graduations.test.js` passes.
- [ ] Service starts cleanly with the env unset (`legacy` default), with `legacy`, and with `carbon`.
- [ ] Existing `npm run pump:smoke` passes unchanged.
- [ ] `npx vite build` passes.

## Test plan

1. `PUMP_GRADUATIONS_SOURCE=carbon npm run pump:smoke` — events flow.
2. `PUMP_GRADUATIONS_SOURCE=legacy npm run pump:smoke` — same.
3. Diff one minute of events between the two sources on a live RPC; flag any divergence in the PR description.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Source divergence observed: …
- Unrelated bugs noticed: …
