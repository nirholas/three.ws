# 23 — Solana name service resolution helper

**Branch:** `feat/solana-name-resolution`
**Source repo:** https://github.com/nirholas/solana-wallet-toolkit
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The project already depends on `@bonfida/spl-name-service` (see [package.json](../../package.json)). solana-wallet-toolkit demonstrates the lookup pattern. Adding a clean `resolveSnsName(name)` / `reverseLookupAddress(addr)` helper, plus an agent skill, lets users say "what's this .sol address?" and the agent answers.

## Read these first

| File | Why |
| :--- | :--- |
| [package.json](../../package.json) | Confirms `@bonfida/spl-name-service` is installed. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration. |
| https://github.com/nirholas/solana-wallet-toolkit | Reference for the SNS calls. |

## Build this

1. Add `src/solana/sns.js` exporting:
    ```js
    export async function resolveSnsName(name)        // 'foo.sol' → 'PublicKey...' | null
    export async function reverseLookupAddress(addr)  // 'PublicKey...' → 'foo.sol' | null
    ```
2. Use `@bonfida/spl-name-service`. Reuse the existing Solana RPC connection from `src/pump/*` if one exists; otherwise pull `SOLANA_RPC_URL` from env with a sensible default.
3. Register two skills (`solana.resolveSns`, `solana.reverseSns`) and matching MCP tools.
4. Add `tests/solana-sns.test.js` mocking the SDK and asserting forward + reverse paths normalize null results consistently.

## Out of scope

- Caching — keep it simple.
- Subdomains / record lookups beyond the basic A-record resolution.
- ENS or other chains.

## Acceptance

- [ ] `node --check src/solana/sns.js` passes.
- [ ] `npx vitest run tests/solana-sns.test.js` passes.
- [ ] Skills + MCP tools callable.
- [ ] `npx vite build` passes.

## Test plan

1. Resolve `bonfida.sol` (or another known name); confirm a PublicKey returns.
2. Reverse-lookup the same PublicKey; confirm round-trip.
3. Look up `nope-not-real-domain-xyz.sol`; confirm `null`.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
