# Task: Modularize the MCP Server

## Context

This is the `three.ws` 3D agent platform. The MCP server (`api/mcp.js`) is a single 1,201-line file implementing the Model Context Protocol with 14 tools. All tool logic, auth gating, payment handling, and JSON-RPC dispatch are co-located. This makes it hard to add tools, test individual tools, or reason about the codebase.

## Goal

Split `api/mcp.js` into focused modules **without changing any behavior**. The public interface (`POST /api/mcp`, tool names, response shapes, auth behavior) must remain identical.

## Proposed Structure

```
api/
  mcp.js                  ← entry point, stays as the Vercel handler (~50 lines)
  _mcp/
    dispatch.js           ← JSON-RPC router: initialize, tools/list, tools/call
    auth.js               ← bearer/x402 auth gating for tool calls
    tools/
      avatars.js          ← list_my_avatars, get_avatar, search_public_avatars, render_avatar, delete_avatar
      models.js           ← validate_model, inspect_model, optimize_model
      solana.js           ← solana_agent_reputation, solana_agent_attestations, solana_agent_passport
      pumpfun.js          ← pumpfun_recent_claims, pumpfun_token_intel, pumpfun_creator_intel, pumpfun_recent_graduations
    catalog.js            ← TOOL_CATALOG array assembled from all tool modules
    payments.js           ← x402 payment verification + settlement logic
```

## Instructions

1. Read `api/mcp.js` carefully before touching anything.
2. Create the `api/_mcp/` directory and the files above.
3. Move code in small, verifiable steps — one module at a time.
4. After each module extraction, confirm `api/mcp.js` still works by tracing imports.
5. Keep `api/mcp.js` as the Vercel-exported `default` handler; it should just import from `_mcp/` and call `dispatch()`.
6. Do not change any function signatures, tool names, response shapes, or error codes.
7. Do not add new functionality.

## What NOT to Do

- Do not rename tools, change tool descriptions, or alter input/output schemas
- Do not add a new abstraction layer (e.g., a "tool base class") — just move code
- Do not change auth behavior or payment flow
- Do not convert to TypeScript

## Success Criteria

- `api/mcp.js` is ≤ 60 lines after refactor
- Each file in `api/_mcp/` is ≤ 250 lines
- `npm test tests/api/mcp.test.js` passes (if tests exist — run `npm test` to check)
- Manual smoke test: `curl -X POST /api/mcp -d '{"jsonrpc":"2.0","method":"initialize","id":1}'` returns the same response as before
