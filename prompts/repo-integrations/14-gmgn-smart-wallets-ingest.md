# 14 — gmgn.ai smart wallets ingest

**Branch:** `feat/gmgn-smart-wallets-ingest`
**Source repo:** https://github.com/nirholas/scrape-smart-wallets
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

scrape-smart-wallets has browser console scripts that extract gmgn.ai's smart-money wallet lists. We want a server-side ingest that converts pasted gmgn JSON dumps into a usable wallet list the agent skills (and any KOL widgets) can read.

## Read these first

| File | Why |
| :--- | :--- |
| [api/](../../api/) | API conventions. |
| [scripts/](../../scripts/) | Where one-shot ingest scripts live. |
| https://github.com/nirholas/scrape-smart-wallets | Field shapes of gmgn dumps. |

## Build this

1. Add `src/kol/gmgn-parser.js` exporting:
    ```js
    export function parseGmgnSmartWallets(rawJson)
    // Accepts either the gmgn raw API JSON or scrape-smart-wallets' normalized output.
    // Returns [{ wallet, label?, pnlUsd?, winRate?, source: 'gmgn' }].
    // Throws if `rawJson` is not recognizable.
    ```
2. Add `api/kol/import-gmgn.js` — POST endpoint:
    ```js
    // POST /api/kol/import-gmgn
    // body: { rawJson: <string|object> }
    // → { imported: <number>, wallets: [...] }
    ```
    Persists into `src/kol/wallets.json` (a checked-in JSON file) by merging with existing entries by `wallet` (latest wins). If the file does not exist, create it.
3. Add a CLI script `scripts/ingest-gmgn.js` that reads a JSON file path and calls `parseGmgnSmartWallets` then writes the merged list to disk:
    ```bash
    node scripts/ingest-gmgn.js path/to/gmgn-dump.json
    ```
4. Add `tests/gmgn-parser.test.js` with two fixtures (raw gmgn shape, normalized shape) confirming parse output.

## Out of scope

- Scraping gmgn live (cors / TOS). Only ingest pasted dumps.
- DB-backed persistence; JSON file is fine.
- A UI for managing the wallet list.

## Acceptance

- [ ] `node --check` passes for new JS.
- [ ] `npx vitest run tests/gmgn-parser.test.js` passes.
- [ ] `node scripts/ingest-gmgn.js <fixture>` writes `src/kol/wallets.json`.
- [ ] Endpoint returns the merged count.
- [ ] `npx vite build` passes.

## Test plan

1. Save a gmgn dump fixture under `tests/fixtures/gmgn-dump.json`.
2. Run the CLI; confirm the wallet file appears with expected entries.
3. POST the same JSON to the endpoint; confirm the count matches.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
