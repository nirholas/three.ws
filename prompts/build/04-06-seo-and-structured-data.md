# 04-06 — SEO: sitemap, robots, structured data

## Why it matters

Public agent pages are the only surface we expose to search. Without structured data, the agent card never appears as a rich result; without a sitemap, public agents never get indexed at all. This is cheap work with compounding value — especially once Layer 6 turns every onchain agent into a canonical URL worth indexing.

## Context

- Static [public/robots.txt](../../public/robots.txt) and [public/sitemap.xml](../../public/sitemap.xml) exist but are hand-authored stubs.
- Public agent page: [public/agent/index.html](../../public/agent/index.html).
- Visibility: `agents.visibility` / `avatars.visibility` — only `public` rows are crawlable.

## What to build

### Dynamic sitemap — `api/sitemap.xml.js`

- `GET` → `application/xml`. Streams from `agents where visibility = 'public' and deleted_at is null` ordered by `updated_at desc`. One `<url>` per agent:
  ```xml
  <url>
    <loc>https://3dagent.vercel.app/a/{id}</loc>
    <lastmod>{updated_at iso}</lastmod>
    <changefreq>weekly</changefreq>
  </url>
  ```
- Add the landing page, `/features`, `/docs-widgets`, and the top-level `/` explicitly.
- Cache: `public, max-age=3600`.
- Update [public/robots.txt](../../public/robots.txt) to point at the dynamic path: `Sitemap: https://3dagent.vercel.app/sitemap.xml`. Wire `/sitemap.xml` in [vercel.json](../../vercel.json) to the serverless function.

### Structured data on the agent page

Inject a `<script type="application/ld+json">` block into [public/agent/index.html](../../public/agent/index.html) rendered server-side or at request-resolve time:

```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "<agent name>",
  "image": "<og-image url>",
  "url": "https://3dagent.vercel.app/a/<id>",
  "identifier": "<agentId>",
  "sameAs": ["<erc8004 explorer url if onchain>"]
}
```

Plus a second block of `@type: "SoftwareApplication"` or `"3DModel"` when the agent has a public GLB — include `contentUrl` pointing at the signed GLB URL.

### Meta tags

- Canonical URL on every agent page.
- `og:title`, `og:description`, `og:image` (from 02-05), `og:url`, `og:type=profile`.
- `twitter:card=summary_large_image`, `twitter:site=@3dagent` (or the actual handle).
- `<link rel="alternate" type="application/json+oembed" href="/api/agent-oembed?url=…">`.

### Robots policy

- `/a/:id` public pages: allow.
- `/dashboard`, `/onboard/*`, `/api/*`, `/studio`: disallow.
- Provide an explicit `X-Robots-Tag: noindex` on embed iframes (`/a/:id/embed`) so Google doesn't index them as standalone pages.

## Out of scope

- Server-side rendering of the agent page for richer crawling (React / etc.). Static + LD-JSON is enough.
- Automatic submission to Search Console / Bing Webmaster.
- Tracking crawl coverage or implementing 410 on deletions (a soft `Disallow` in sitemap exclusion is fine).

## Acceptance

1. `curl https://<host>/sitemap.xml` returns valid XML containing every public agent.
2. `View source` on `/a/:id` shows the JSON-LD block with the correct fields.
3. Google Rich Results test on a public agent URL passes for Person (and 3DModel if applicable).
4. `curl -I /a/:id/embed` includes `X-Robots-Tag: noindex`.
5. `node --check` passes on new files.
