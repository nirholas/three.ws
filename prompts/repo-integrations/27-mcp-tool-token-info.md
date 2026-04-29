# 27 — MCP tool: pump.fun token info

**Branch:** `feat/mcp-token-info`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

LLMs need a single canonical "tell me about this token" call. We have the data scattered across SDK calls; this prompt consolidates into one MCP tool returning the fields a chat actually wants.

## Read these first

| File | Why |
| :--- | :--- |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP registration. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | What fields the widget already pulls — match these. |
| `node_modules/@pump-fun/pump-sdk/` | SDK surface for token metadata. |

## Build this

1. Register MCP tool `pumpfun_token_info`:
    - Args: `{ mint: string }`
    - Returns:
      ```jsonc
      {
        "mint": "...",
        "name": "...",
        "symbol": "...",
        "image": "...",
        "description": "...",
        "creator": "...",
        "marketCapUsd": 0,
        "priceUsd": 0,
        "graduated": false,
        "createdAt": 0,
        "uri": "..."
      }
      ```
2. Implement in `src/pump/token-info.js` using the existing pump SDKs. Read the agent-token widget to discover which calls already fetch each field — reuse those.
3. Add `tests/pump-token-info.test.js` mocking the SDK and asserting field normalization (e.g. lamports → SOL, raw price → USD).

## Out of scope

- Fetching off-chain metadata if `uri` is dead — surface `uri` and let the caller follow it.
- Holder lists (later).
- Trade history (covered by other prompts).

## Acceptance

- [ ] Tool appears in `tools/list`.
- [ ] `npx vitest run tests/pump-token-info.test.js` passes.
- [ ] Calling against a real active mint returns coherent fields.
- [ ] `npx vite build` passes.

## Test plan

1. Pick three mints: pre-graduation, just-graduated, dead. Call the tool against each. Confirm `graduated` flag matches reality and other fields look sane.
2. Call against an invalid mint; confirm a clean error.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
