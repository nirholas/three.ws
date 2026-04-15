# 04-01 — OG image endpoint for agent pages

**Branch:** `feat/agent-og-image`
**Stack layer:** 4 (View + embed)
**Depends on:** 02-03 (every agent has an avatar)
**Blocks:** nothing, but every embed share-path is uglier without it

## Why it matters

[public/agent-home.html](../../public/agent-home.html) references `/api/agent-og?id=<id>` in `<meta property="og:image">`, but that endpoint doesn't exist. When an agent link is pasted into Slack, Discord, Telegram, Twitter, or Claude, the preview shows nothing or a broken image. OG images are how the product spreads.

## Read these first

| File | Why |
|:---|:---|
| [public/agent-home.html](../../public/agent-home.html) | References `/api/agent-og`. See the exact param shape it expects. |
| [api/agents.js](../../api/agents.js) | `GET /api/agents/:id` — used to look up the avatar model URL and agent name. |
| [vercel.json](../../vercel.json) | Current route table. |

## Build this

### Endpoint — `GET /api/agent-og`

- **Auth:** public (rate-limited via Upstash).
- **Query:** `id` (agent id) or `slug`. At least one required.
- **Output:** `image/png`, 1200×630, `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`.

### Rendering approach — two-tier fallback

**Tier 1 (preferred): cached server-rendered PNG.** On first request, render the agent's GLB in a headless three.js context via `@napi-rs/canvas` or `node-canvas` + a Node-side GL shim. If this is too heavy for Vercel serverless limits, skip to Tier 2. Store the resulting PNG in R2 under `og/<agent_id>.png` and redirect there.

**Tier 2 (ship this first): SVG template rendered to PNG.** Compose a 1200×630 SVG with:
- Agent name (big)
- Short tagline (from agent bio, truncated)
- Avatar thumbnail (use the `thumbnail_url` field from avatars — if absent, fall back to a generic silhouette)
- Brand background (use the `--accent` colour from [style.css](../../style.css))

Convert the SVG to PNG via `@resvg/resvg-js` (small, fast, Vercel-friendly). Add the dep with a one-line PR justification.

### Invalidation

On agent name change or avatar swap (see 03-02), delete the cached `og/<agent_id>.png` so the next request regenerates.

## Out of scope

- Do not render a full 3D scene unless Tier 1 fits the serverless envelope easily. Ship Tier 2 and leave Tier 1 as a follow-up prompt.
- Do not add Twitter-specific meta tags — OG covers the major platforms and Twitter falls back to OG.
- Do not animate. A static PNG is the spec.

## Acceptance

- [ ] `GET /api/agent-og?id=<existing>` returns a 1200×630 PNG in under 2s warm, under 5s cold.
- [ ] Pasting an agent URL into Slack / Discord shows the preview card.
- [ ] Missing agent returns a 404, not a broken image.
- [ ] Twitter/X card validator and Facebook sharing debugger both show the card.
- [ ] Renaming the agent or swapping the avatar invalidates the cache — next share shows the new image.
