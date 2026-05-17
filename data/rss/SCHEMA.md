# `data/rss/items.json` — schema

Every entry in `items[]` controls one item in the RSS feed
(`https://three.ws/rss/announcements.xml`) AND one permalink page
(`https://three.ws/news/<slug>`).

## Required fields

| Field       | Type   | Notes |
|-------------|--------|-------|
| `id`        | string | Stable unique identifier. Used internally and to derive a slug if `slug` is not set. |
| `title`     | string | Headline. Shows as `<h1>` on the permalink, `<title>` on RSS, OG/Twitter title. |
| `date`      | string | ISO 8601 timestamp (e.g. `2026-05-17T12:00:00.000Z`). Drives sort order, `pubDate`, `article:published_time`. |
| `body_html` | string | Full article HTML. Will be inserted into `<article>` on the page and `<content:encoded>` in RSS. |

## Recommended fields

| Field             | Type     | Notes |
|-------------------|----------|-------|
| `slug`            | string   | URL slug. Auto-derived from `id` if omitted (e.g. `t-12345` → `12345`). Editor SHOULD set this for human-readable URLs like `live-on-alibaba-cloud-marketplace`. |
| `summary`         | string   | Plain-text excerpt (≤280 chars). Auto-derived from `body_html` if omitted. Used in `<description>`, OG/Twitter description, JSON-LD `description`. |
| `author`          | string   | Display name. Defaults to `three.ws`. |
| `tags`            | string[] | Lowercase, hyphenated (e.g. `["launch","x402","solana"]`). Surfaced as `<category>` in RSS, `article:tag` meta, JSON-LD `keywords`, and pill badges on the page. |
| `image`           | string   | Cover image URL or relative path (e.g. `/news-images/foo.jpg`). See [Cover images](#cover-images). |
| `image_alt`       | string   | Alt text for the cover image. **Required if `image` is set.** |

## Optional fields

| Field             | Type     | Notes |
|-------------------|----------|-------|
| `external_link`   | string   | Original source URL (e.g. the X post). Surfaces as `<source>` in RSS and as an "Originally shared on X" footer. If omitted but `link` is non-three.ws, `link` is used instead. |
| `image_width`     | number   | Pixel width — enables `og:image:width` and `<media:content width="...">`. Recommended ≥1200 for social cards. |
| `image_height`    | number   | Pixel height — enables `og:image:height`. Recommended ≥630 for social cards. |
| `og_title`        | string   | Override OG/Twitter title (defaults to `title`). |
| `og_description`  | string   | Override OG/Twitter description (defaults to `summary`). |
| `published`       | boolean  | If `false`, the item is excluded from the feed, sitemap, and permalink generation. Default `true`. Use to draft entries. |
| `link`            | string   | Legacy — original use was the canonical link. Now superseded by the auto-generated `permalink` (`https://three.ws/news/<slug>`). If set to a non-three.ws URL it's treated as `external_link`. |

## Cover images

Put image files in `public/news-images/<filename>` and reference them in
items.json as `/news-images/<filename>`. Vite copies `public/` to `dist/`
at build time, so the image is served at the same path on three.ws.

Best practices:

- **Dimensions:** 1200×630 minimum for social cards (Twitter / OG). Aspect ratio ≥ 1.91:1.
- **Format:** WebP first (smaller), JPEG fallback if compatibility matters.
- **Always set `image_alt`.** Required for accessibility AND for `og:image:alt`.
- **Always set `image_width` + `image_height`.** Prevents cumulative layout shift and unlocks `og:image:width/height`.

Absolute URLs work too (e.g. an R2 / Vercel Blob URL): set `image` to the
full `https://...` and the same fields apply.

## Slugs

The permalink is `https://three.ws/news/<slug>`. Slugs are lowercase
`[a-z0-9-]` with leading/trailing hyphens trimmed, capped at 80 chars.

If `slug` is unset:
- Tweet-derived entries (`id: t-<tweet-id>`) drop the `t-` prefix.
- Other entries lowercase + sanitize the `id`.

If you change a slug after publishing, the old URL 404s — set a
[Vercel redirect](https://vercel.com/docs/edge-network/redirects) for
seamless migration.

## Build pipeline

`scripts/build-news.mjs` is run automatically before `vite build`
(see `prebuild` in `package.json`). It reads this file and writes:

- `public/news/<slug>.html` — one per published item
- `public/news/index.html` — chronological listing page
- `data/_generated/news-routes.json` — consumed by
  `scripts/build-page-index.mjs` to add news entries to `public/sitemap.xml`,
  `public/llms.txt`, and `public/sitemap/index.html`

Both `public/news/` and `data/_generated/` are gitignored — they are
deterministic build artifacts.

To regenerate without a full build:

```bash
npm run build:news
```

## Runtime

The RSS feed (`/api/rss/announcements`) reads items.json on every
request and emits RSS 2.0 with `<content>`, `<dc>`, `<atom>`, and
`<media>` namespaces. The CDN cache is 10 minutes
(`s-maxage=600, stale-while-revalidate=86400`).
