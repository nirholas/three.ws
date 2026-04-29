# 07 — Cloudflare Workers MCP transport for pump.fun

**Branch:** `feat/cf-workers-mcp-mirror`
**Source repo:** https://github.com/nirholas/pump-fun-workers
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

Today `api/pump-fun-mcp.js` runs as a Vercel function. The pump-fun-workers repo is a Cloudflare Worker that implements the MCP Streamable HTTP transport. Adding a Workers-deployable mirror gives us edge-deploy parity (sub-50ms cold starts, region-local) without losing the Vercel deployment.

## Read these first

| File | Why |
| :--- | :--- |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | The Vercel implementation we're mirroring. |
| [api/mcp.js](../../api/mcp.js) | Base MCP framing. |
| [vercel.json](../../vercel.json) | Routing for the existing Vercel endpoint — do not break. |
| https://github.com/nirholas/pump-fun-workers | Reference implementation; copy the streaming response shape. |

## Build this

1. Add `workers/pump-fun-mcp/` with:
    - `worker.js` — fetch handler implementing the MCP Streamable HTTP transport for the same tool set exposed in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js). Reuse the tool registration logic by importing pure-JS helpers from `src/pump/` only — no Node-only deps.
    - `wrangler.toml` — minimal config with `name = "pump-fun-mcp"`, `main = "worker.js"`, `compatibility_date = "2025-01-15"`.
    - `README.md` — one-liner: "Mirror of `/api/pump-fun-mcp`. Deploy: `wrangler deploy`."
2. Extract any shared, runtime-agnostic logic out of [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) into `src/pump/mcp-tools.js` so both runtimes call the same code. Both endpoints must continue to work.
3. Add `tests/pump-mcp-tools.test.js` (or extend the existing one) asserting the tool list returned from `src/pump/mcp-tools.js` matches the legacy Vercel handler's response.
4. Document deployment in [docs/](../../docs/) by adding `docs/pump-fun-mcp-edge.md` (one new doc file is fine).

## Out of scope

- Migrating Vercel callers off `/api/pump-fun-mcp` — both must keep working.
- Auth / rate limiting beyond what the Vercel handler does.
- A custom domain — leave that to the user's wrangler config.

## Acceptance

- [ ] `node --check workers/pump-fun-mcp/worker.js` passes.
- [ ] Existing tests for pump-fun-mcp still pass (`npx vitest run tests/pumpfun-mcp.test.js tests/pumpfun-mcp-tools.test.js`).
- [ ] New test asserts tool-list parity between runtimes.
- [ ] Vercel endpoint behavior unchanged (eyeball test: a tools/list curl returns the same JSON as before).
- [ ] `npx vite build` passes.

## Test plan

1. `npx wrangler dev workers/pump-fun-mcp/worker.js --local`; curl `http://localhost:8787` with `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` and confirm tools appear.
2. Call the same JSON-RPC against `http://localhost:3000/api/pump-fun-mcp`; diff the tool lists — they must match.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
