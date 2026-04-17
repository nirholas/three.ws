# 21 — OG image + oEmbed polish

## Why

When an agent link is pasted in Twitter / Discord / Slack / Claude, the unfurl should show a rich card: avatar thumbnail, name, bio, embed-aware oEmbed entry. Today partial.

## Parallel-safety

Additive edits to two existing server files, plus optionally a new thumbnail renderer.

## Files you own

- Edit (additive): [api/a-og.js](../../api/a-og.js) — polish the response, never remove fields.
- Edit (additive): [api/a-page.js](../../api/a-page.js) — ensure `<meta>` tags for og:image, og:video, twitter:card, oembed link.
- Optionally create: `api/a-og-image.js` — dynamic OG image (1200×630 PNG) rendered with `@vercel/og` (ONLY if that's already a dep — check `package.json` first; if not, skip and use a static fallback).

## Read first

- [api/a-og.js](../../api/a-og.js) — current OG response.
- [api/a-page.js](../../api/a-page.js) — current head tags.
- [api/agent-oembed.js](../../api/agent-oembed.js) — confirm oEmbed endpoint exists.
- [package.json](../../package.json) — check for `@vercel/og`.

## Deliverable

### `api/a-page.js` `<head>` must include:

```html
<meta property="og:type" content="profile">
<meta property="og:title" content="${agent.name} — 3D Agent">
<meta property="og:description" content="${agent.bio || 'An embodied 3D agent'}">
<meta property="og:image" content="${ogImageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImageUrl}">
<link rel="alternate" type="application/json+oembed"
      href="${origin}/api/agent-oembed?url=${encodedCurrentUrl}&format=json">
```

### `api/a-og.js` response must include:
- `title`, `description`, `image`, `url`, `type`, plus new fields: `agent.name`, `agent.slug`, `agent.thumbnailUrl`, `agent.chainId?`, `agent.onChain?`.

### Dynamic OG image (if `@vercel/og` exists):
- 1200×630, dark background, centered square thumbnail, agent name, small chain badge if on-chain.
- 60s CDN cache.

If `@vercel/og` is NOT a dep, just use `agent.thumbnailUrl` directly as `og:image` — same header, different source.

## Constraints

- No new deps unless explicitly already present.
- Additive only — do not remove existing fields or meta tags.
- Handle missing fields gracefully (`agent.bio` may be null).

## Acceptance

- `node --check` clean on edited files.
- `npm run build` clean.
- Paste an agent link into Twitter's card validator or `curl -A Twitterbot ...` → card renders correctly.

## Report

- Whether `@vercel/og` was present and which path you took.
- The full meta block you ended up with (paste it).
