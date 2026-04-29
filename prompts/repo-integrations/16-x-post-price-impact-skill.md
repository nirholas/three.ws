# 16 — X post → price impact correlation skill

**Branch:** `feat/x-post-price-impact`
**Source repo:** https://github.com/nirholas/analyze-memecoin-socials
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

analyze-memecoin-socials correlates X (Twitter) posts to memecoin price moves. Exposing a single-shot "did this post move the price?" skill lets the 3D agent reason about cause/effect in real-time conversations about tokens.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration. |
| https://github.com/nirholas/analyze-memecoin-socials | Correlation logic + price-fetch shape. |

## Build this

1. Add `src/social/x-post-impact.js` exporting:
    ```js
    export async function correlateXPost({ postUrl, mint, windowMin = 30 })
    // Inputs: an X post URL (or id), the related token mint, and a +/- window in minutes around post time.
    // Returns { post: { id, ts, author, text }, priceBefore, priceAfter, deltaPct, volBefore, volAfter, deltaVolPct }.
    ```
2. Use the existing pump.fun price source already wired in `src/pump/*` for `priceBefore` / `priceAfter` (do not add a new dep). Read post metadata via the X oEmbed endpoint (no API key required) — if oEmbed fails, return `{ post: null, ... }` and still compute the price-impact half.
3. Register skill `social.xPostImpact` in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js).
4. Register MCP tool `social_x_post_impact` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js).
5. Add `tests/x-post-impact.test.js` mocking fetch and asserting deltaPct math is correct.

## Out of scope

- Bulk historical analysis.
- Twitter/X API auth — oEmbed only.
- Persisting analysis results.

## Acceptance

- [ ] `node --check src/social/x-post-impact.js` passes.
- [ ] `npx vitest run tests/x-post-impact.test.js` passes.
- [ ] Skill + MCP tool callable.
- [ ] `npx vite build` passes.

## Test plan

1. Pass a real recent post URL + a real mint; confirm a sensible delta.
2. Pass an invalid URL; confirm graceful fallback (post=null, prices still computed).
3. Pass an unknown mint; confirm a clean error.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
