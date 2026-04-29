# 22 — Vanity mint keygen skill

**Branch:** `feat/vanity-mint-keygen`
**Source repo:** https://github.com/nirholas/solana-wallet-toolkit
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

Pump.fun token creators often want vanity mint addresses (e.g. ending in `pump`). solana-wallet-toolkit ships a multi-threaded vanity keygen. Wrapping it as a server-side skill + endpoint lets the studio's launch flow offer "make my mint end in X" without users running a CLI.

## Read these first

| File | Why |
| :--- | :--- |
| [api/](../../api/) | API conventions. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration. |
| https://github.com/nirholas/solana-wallet-toolkit | Reference for the keygen logic (Rust + TS). |

## Build this

1. Add `src/pump/vanity-keygen.js` exporting:
    ```js
    export async function generateVanityKey({ suffix, prefix, caseSensitive = false, maxAttempts = 5_000_000, signal })
    // Generates Solana keypairs until one matches both prefix and suffix.
    // Returns { publicKey, secretKey: Uint8Array, attempts, ms } | null if maxAttempts hit.
    // Implementation: pure JS using @solana/web3.js (already a transitive dep). Single-threaded is fine for v1.
    ```
2. Add `api/pump/vanity-keygen.js`:
    ```js
    // POST /api/pump/vanity-keygen
    // body: { suffix?, prefix?, caseSensitive?, maxAttempts? }
    // Streams progress via Server-Sent Events; final event delivers { publicKey, secretKey: base58, attempts, ms }.
    // Reject if both prefix and suffix are empty.
    ```
3. Register skill `pumpfun.vanityMint` and MCP tool `pumpfun_vanity_mint`. The non-streaming version (one batch result) is fine for the skill / MCP path.
4. Hard cap: 60 seconds wallclock per request server-side; abort and 408 if exceeded.
5. Add `tests/vanity-keygen.test.js` asserting the function returns a key whose base58 ends with the requested suffix.

## Out of scope

- Multi-threaded / WebWorker parallelism (later).
- Persisting generated keys (caller must save them).
- GPU keygen.

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/vanity-keygen.test.js` passes.
- [ ] Endpoint accepts a request with `suffix: "ab"` and returns a matching key in under 60s.
- [ ] Endpoint rejects empty inputs and aborts long-running requests.
- [ ] `npx vite build` passes.

## Test plan

1. `curl -X POST -d '{"suffix":"a"}' http://localhost:3000/api/pump/vanity-keygen` — expect a result quickly.
2. With `suffix:"abcdef"` — expect a 408 (timeout) or success after a long search.
3. Confirm secret keys are returned base58-encoded and never logged.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
