# 34 — ERC-8004 attestation for signal quality

**Branch:** `feat/erc8004-signal-attestation`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

ERC-8004 lets agents attest to facts on-chain. If our MCP signal endpoints sign and post a periodic "signal quality" attestation (e.g. precision/recall over the last 24h vs ground truth), downstream agents can choose us over competitors based on a verifiable track record.

## Read these first

| File | Why |
| :--- | :--- |
| [api/erc8004/](../../api/erc8004/) | Existing on-chain attestation surface. |
| [contracts/](../../contracts/) | Contract code if modification needed. |
| [scripts/solana-attest-smoke.js](../../scripts/solana-attest-smoke.js) | Smoke pattern. |
| [scripts/backfill-erc8004.mjs](../../scripts/backfill-erc8004.mjs) | Existing 8004 batch script — match style. |

## Build this

1. Add `services/signal-quality/index.js` running on a schedule (cron or one-shot script):
    - Computes daily precision/recall for `pumpfun_whale_alerts` against a ground-truth window (whales who held >10 minutes vs flipped).
    - Output `{ window: '24h', tool: 'pumpfun_whale_alerts', precision, recall, sampleSize, ts }`.
2. Add `scripts/post-signal-attestation.js` that takes the daily output and submits an ERC-8004 attestation via the existing on-chain helpers in [api/erc8004/](../../api/erc8004/). Reuse — do not invent a new transaction path.
3. Add `tests/signal-quality.test.js` asserting precision/recall math against a fixture.
4. Document the new attestation schema in [contracts/](../../contracts/) only if the existing schema can't carry the fields. Otherwise just write to the existing schema.

## Out of scope

- Live cron — wire as a CLI script; scheduling is operator's call.
- Multi-tool aggregation in one attestation.
- A new contract.

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/signal-quality.test.js` passes.
- [ ] `node scripts/post-signal-attestation.js --dry-run` prints the payload without a tx send.
- [ ] `npx vite build` passes.

## Test plan

1. Run the calculator over a fixture; eyeball numbers.
2. `--dry-run` — confirm payload is well-formed.
3. (Optional) Submit on testnet; confirm tx lands.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
