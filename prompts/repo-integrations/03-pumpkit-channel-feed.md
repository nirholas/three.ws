# 03 — Pumpkit channel-feed ingest

**Branch:** `feat/pumpkit-channel-feed`
**Source repo:** https://github.com/nirholas/pumpkit
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

Pumpkit's channel-feed lets a Telegram channel publish curated pump.fun signals. We want the same firehose available as an HTTP endpoint so the 3D agent (and any embed) can consume it without a Telegram dependency.

## Read these first

| File | Why |
| :--- | :--- |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | Existing API style for pump endpoints. |
| [api/pump/](../../api/pump/) | Existing pump-related HTTP handlers — match style and error shape. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| https://github.com/nirholas/pumpkit (channel-feed module) | Logic to port. Read README + channel-feed source. |

## Build this

1. Add `api/pump/channel-feed.js` — an HTTP GET endpoint that returns a normalized JSON array of recent pump.fun signals (new mints + first whale buys + creator claims, deduped by signature, newest first):
    ```js
    // GET /api/pump/channel-feed?limit=50&kinds=mint,whale,claim
    // → { items: [{ kind, mint, signature, ts, summary, refs }] }
    ```
2. Add `src/pump/channel-feed.js` exporting `fetchChannelFeed({ limit, kinds })` for client/server reuse. The HTTP endpoint is a thin wrapper.
3. Register a skill `pumpfun.channelFeed` in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) that calls `fetchChannelFeed` and returns a digest the LLM can summarize.
4. Add a vitest test `tests/pump-channel-feed.test.js` that:
    - Mocks the upstream sources (mint stream, whale source, claim source).
    - Asserts dedupe-by-signature works.
    - Asserts `kinds=mint,claim` excludes whale events.

## Out of scope

- A Telegram bridge (use an existing pumpkit deployment for that).
- Persisting the feed; this endpoint is read-through.
- Auth / rate limiting beyond what other pump endpoints already do.

## Acceptance

- [ ] `node --check api/pump/channel-feed.js` and `node --check src/pump/channel-feed.js` pass.
- [ ] `npx vitest run tests/pump-channel-feed.test.js` passes.
- [ ] `curl 'http://localhost:3000/api/pump/channel-feed?limit=10'` returns a valid JSON array.
- [ ] Skill `pumpfun.channelFeed` appears in `getSkills()` output.
- [ ] `npx vite build` passes.

## Test plan

1. Boot dev server. Hit the endpoint with `limit=10`, then `kinds=mint`, then `kinds=mint,whale,claim`.
2. Confirm dedupe by re-running and checking each signature appears once.
3. Call the skill from the agent and confirm a coherent digest comes back.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
