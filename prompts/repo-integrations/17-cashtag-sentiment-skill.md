# 17 — Cashtag sentiment scoring skill

**Branch:** `feat/cashtag-sentiment`
**Source repo:** https://github.com/nirholas/analyze-memecoin-socials
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

analyze-memecoin-socials includes browser-side scraping for cashtag posts. We want a server-side skill that, given a cashtag (e.g. `$WIF`) or token symbol, returns a quick sentiment digest the agent can quote in chat. Because Twitter/X scraping has TOS issues, the v1 reads from a **pasted-in JSON dump** (same pattern as prompt 14/15) and computes scoring locally.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration. |
| https://github.com/nirholas/analyze-memecoin-socials | Cashtag scraping + scoring reference. |

## Build this

1. Add `src/social/sentiment.js` exporting:
    ```js
    export function scoreSentiment(posts)
    // posts: [{ id, ts, text, author }]
    // Returns { score: -1..1, posPct, negPct, neuPct, count, examples: { pos: [...], neg: [...] } }.
    // Use a deterministic lexicon (positive words / negative words) committed to src/social/lexicon.json.
    // No external NLP API.
    ```
2. Add `api/social/sentiment.js` POST endpoint:
    ```js
    // POST /api/social/sentiment
    // body: { posts: [...] }
    // → { score: ..., posPct: ..., ... }
    ```
3. Register a skill `social.cashtagSentiment` in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) that accepts `{ posts }` directly (caller passes them in — could be a pasted screenshot transcript or another tool's output).
4. Register MCP tool `social_cashtag_sentiment`.
5. Add `tests/sentiment.test.js` asserting:
    - All-positive sample → score > 0.5.
    - All-negative → score < -0.5.
    - Mixed → score near 0.

## Out of scope

- Live X scraping.
- Author weighting / follower count weighting (later).
- Persisting analyses.

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/sentiment.test.js` passes.
- [ ] Skill + MCP tool callable.
- [ ] `npx vite build` passes.

## Test plan

1. Submit a hand-written batch of 10 posts; eyeball the score for sanity.
2. Confirm endpoint and skill agree on the same input.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
