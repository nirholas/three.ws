# Sharing: Teams, LinkedIn and link previews

Every creation, agent and avatar can be shared to Microsoft Teams and LinkedIn from the share menu, and the page behind the link has to unfurl correctly in both. For embedding an agent on a site, see [share-and-embed.md](share-and-embed.md). For Share on X and Ask @grok, see [share-to-x.md](share-to-x.md).

## Where the buttons are

- `src/shared/share.js` (`showSharePanel`): the shared menu used by the Forge result, agent detail and fork flows. Gets "Share to Teams" and "Share on LinkedIn".
- Avatar and agent profile action bar (`pages/avatar-page.html`, `src/avatar-page.js`): same two targets beside "Share on X".
- `src/shared/share-targets.js`: the one helper behind both. It builds the URLs, opens a sized popup (Teams 700x600, LinkedIn 620x640), falls back to the anchor's own new-tab navigation when the popup is blocked, leaves ctrl/cmd/shift/middle clicks to the browser, and records the action through the share funnel beacon (`creation_page` / `action`, aggregate and non-identifying).

| Target | URL |
|---|---|
| Teams | `https://teams.microsoft.com/share?href=<url>&msgText=<text>&preview=true` |
| LinkedIn | `https://www.linkedin.com/sharing/share-offsite/?url=<url>` |

LinkedIn ignores any text parameter. Both networks build the card from the page's Open Graph tags, so the page head is the source of truth.

## Preview rules

Enforced by `scripts/lib/share-preview-rules.mjs`:

- `og:title` present, at most 120 characters. `og:description` present, at most 300.
- `og:type`, `og:url` and `link[rel=canonical]` present, absolute https.
- `og:image` absolute https, PNG, JPEG or GIF (LinkedIn does not render SVG, WebP is unreliable), at most 5 MB, at least 1200x627, ratio near 1.91:1.
- `og:image:width` and `og:image:height` declared and equal to the real image size.
- `twitter:card` is `summary_large_image`.

Crawler-facing generators that must satisfy this: `api/page-og.js` (PNG), `api/og/agent.js` (SVG by default, PNG with `?format=png`, which every agent head uses), `api/avatar-og.js` (thumbnails are letterboxed into a 1200x630 PNG), `server/creation-head.mjs`, `server/seo-head.mjs`.

## Checking

```
npm run audit:share-previews                     # production
npm run audit:share-previews -- --base http://localhost:3138
```

It samples the Forge, marketplace, viewer, creation, agent and avatar pages, fetches each `og:image`, and prints the exact offending tag per URL. Exit 1 on any violation.

Note: the Vite dev server proxies `/api/*` to production, so API-side image fixes only show against `node server/index.mjs` with a database.

## Refreshing a stale LinkedIn preview

LinkedIn caches a link's preview for about a week. After fixing tags, open the URL in the [Post Inspector](https://www.linkedin.com/post-inspector/), press Inspect, and the cache is re-scraped. Teams re-reads on each new share.
