---
mode: agent
description: "End-to-end smoke test of the whole priority stack on a cold browser"
---

# 00 · End-to-end stack smoke test

## Why it matters

After any batch of pillar work lands, the loop from "open incognito → embodied agent on chain resolvable in a host" must actually work. This prompt is the pass you run before declaring a milestone done. Not a test file — a reproducible manual/scripted walk-through with clear pass/fail gates.

## Prerequisites

- Pillar 1–6 prompts at least partially merged.

## Read these first

- [prompts/build/README.md](./README.md) — stack order.
- Each pillar's "Acceptance" block.

## Build this

A single `scripts/smoke-stack.sh` (or `.js`) that walks the stack:

1. **Auth** — script spins up a headless wallet signer (ethers with a test private key), hits `/api/auth/siwe/nonce`, signs, posts to `/verify`, asserts 200 + session cookie.
2. **Selfie** — upload a fixture JPEG to `/api/selfies/presign` + register.
3. **Generate** — kick off `/api/selfies/generate`, poll until done (bypass in CI if provider unavailable; gate with env flag `E2E_RUN_GENERATE=1`).
4. **Agent page** — HEAD `/agent/:id` and `/agent/:id/embed` → 200.
5. **Card** — GET `/api/agents/:id/card.json` → valid JSON with required fields.
6. **Mint** — (optional, gated `E2E_RUN_ONCHAIN=1`) run `registerAgent` on a testnet fork → assert `erc8004_agent_id` persists.
7. **Resolve from chain** — GET `/api/agents/by-chain?...` → matches step 6.
8. **MCP** — JSON-RPC call `render_agent` against `/api/mcp` → resource URL in response.

Report: pass/fail per step, total runtime, any warnings.

## Out of scope

- Full frontend UI automation (Playwright) — too much overhead for a smoke script.
- Load / stress testing.
- Browser compatibility matrix.

## Deliverables

- `scripts/smoke-stack.sh` or `scripts/smoke-stack.js`.
- A short README block in the script's header explaining env vars and how to run it.

## Acceptance

- `node scripts/smoke-stack.js` against a running dev server exits 0 when the stack is healthy.
- Fails fast and loud on the first broken pillar.
- No new runtime deps (use `node:fetch`, `ethers` already present, no Playwright).
