# Bing, Copilot and IndexNow

Bing's index feeds Microsoft Copilot, Copilot in Edge and Windows search, and several other assistants. A page Bing has not indexed, or indexed with a thin description, does not appear when someone asks Copilot where to make a 3D model from a photo. Three things keep three.ws visible there:

1. **IndexNow** announces every new, changed or removed public URL to Bing (and Yandex, Seznam, Naver) within minutes instead of waiting for the next crawl.
2. **Sitemaps** list every indexable URL, generated from the database, with real `lastmod` values.
3. **Structured data and meta** tell Bing what each page is, and `npm run audit:seo` fails when titles, descriptions or canonicals go missing or collide.

This runbook covers how each part works, how to read its results, and the Bing Webmaster Tools steps the owner runs.

## IndexNow

| Piece | Where |
|---|---|
| Key file | [public/1a34d91143f6e085eedef0f9669c93be.txt](../../public/1a34d91143f6e085eedef0f9669c93be.txt), served at `https://three.ws/1a34d91143f6e085eedef0f9669c93be.txt` |
| Protocol client (one POST, batch limit, status meanings) | [api/_lib/indexnow.js](../../api/_lib/indexnow.js) |
| Outbox: enqueue, drain, reconcile | [api/_lib/indexnow-queue.js](../../api/_lib/indexnow-queue.js) |
| Canonical URL per resource type | [api/_lib/seo-resources.js](../../api/_lib/seo-resources.js) |
| Ten-minute cron | [api/cron/indexnow-reconcile.js](../../api/cron/indexnow-reconcile.js), `*/10 * * * *` in `vercel.json` `crons`, synced to Cloud Scheduler |
| Manual run | `npm run indexnow:reconcile` ([scripts/indexnow-reconcile.mjs](../../scripts/indexnow-reconcile.mjs)) |
| Tables | `indexnow_urls` (one row per URL), `indexnow_submissions` (one row per request), `indexnow_cursors`; schema in `api/_lib/migrations/20261111163200_indexnow.sql` |
| Tests | [tests/indexnow-queue.test.js](../../tests/indexnow-queue.test.js) |

### How a URL gets announced

- **Write paths** (agent, avatar, widget and profile create, update and delete) call `enqueueIndexNow`, which upserts the canonical URL into `indexnow_urls`. It never throws, so an outbox hiccup cannot fail the user's request.
- **The reconcile cron** scans every public table (agents, avatars, forge creations, widgets, profiles, and the pages in `data/pages.json`) for rows changed since that type's cursor and enqueues anything a write path missed: a backfill, a direct SQL fix, a path with no hook. Then it drains the outbox.
- **The drain** posts pending URLs to `api.indexnow.org` in batches of up to 10,000 and logs every request to `indexnow_submissions`.

### Dedupe and rate limits

- One row per URL. Ten edits in a minute make one pending row.
- A URL submitted in the last 24 hours is held until that floor passes, unless the change is a delete (the page now answers 404 or noindex and the engine should drop it now).
- After an HTTP 429 the drain pauses for an hour.
- A URL that fails five requests in a row is parked until it changes again.

### Privacy

A URL is only announced while its resource is public. When a resource goes private or unlisted, its URL is announced again (so the engine re-crawls it and drops it) only if this pipeline announced it before. A URL that was never public is never sent anywhere.

### Reading results

```bash
npm run indexnow:reconcile -- --status      # outbox depth and the last five requests
npm run indexnow:reconcile -- --dry-run     # what the next run would enqueue; writes and sends nothing
npm run indexnow:reconcile                  # scan since each cursor, then submit
npm run indexnow:reconcile -- --since 2026-11-01 --types agent,page
npm run indexnow:reconcile -- --drain       # submit what is already queued, scan nothing
```

The cron's JSON response and its log line (`[indexnow-reconcile] agent=N avatar=N ... submitted=N pending=N`) carry the same numbers. Each `indexnow_submissions` row has the request time, source (`cron`, `manual`), URL count and HTTP status:

| Status | Meaning | Action |
|---|---|---|
| 200 | Accepted | None |
| 202 | Accepted, key still being validated | None; normal for the first requests after the key file goes live |
| 400 | Bad request | A malformed URL reached the outbox; look at the batch in the log |
| 403 | Key not valid | The key file is not served at the key location; check `curl -s https://three.ws/1a34d91143f6e085eedef0f9669c93be.txt` |
| 422 | URLs do not belong to the host, or the key does not match | A non-three.ws URL was enqueued |
| 429 | Too many requests | The drain pauses itself for an hour |

The manual script fetches each catalog page from production first and holds back any page that does not answer 200 (and the page cursor with it), because this checkout's `data/pages.json` can list pages production does not serve yet. Run it after a deploy, never before.

## Sitemaps

- `https://three.ws/sitemap.xml` is a sitemap index ([api/sitemap.js](../../api/sitemap.js)). Its children come from [api/sitemap/[type].js](../../api/sitemap/%5Btype%5D.js): `core` (from `data/pages.json`), `agents`, `avatars`, `creations`, `widgets`, `profiles`, `news`.
- Each child is paged at the protocol limit of 50,000 URLs by id cursor, so no request loads a whole table.
- `lastmod` is the row's real `updated_at` (or `created_at`), never the request time.
- Excluded: private and unlisted rows, untouched onboarding agents and avatars ([api/_lib/indexable-entity.js](../../api/_lib/indexable-entity.js)), seed-cron service-account profiles, and catalog pages marked `"indexable": false` in `data/pages.json`.
- `creations.xml` lists one creation per distinct prompt (the newest). The image-to-3D and auto-rig pipelines are each listed individually because their pages carry their own titles. Thousands of identical prompts would otherwise be thousands of near-identical pages competing for one query.
- `robots.txt` references the index.

## Structured data

| Page type | JSON-LD |
|---|---|
| Home | `Organization` with `sameAs` (the Microsoft Marketplace listing and the official social profiles), `WebSite` |
| Product and feature pages | `SoftwareApplication` / `WebApplication`, `BreadcrumbList`; `FAQPage` only where the page shows that FAQ |
| Creations (`/m/:id`) | `3DModel` with the GLB as `encoding`, creator, `BreadcrumbList` |
| Avatars (`/avatars/:id`) | `3DModel`, `BreadcrumbList` |
| Agents (`/agents/:id`) | `SoftwareApplication` with the 3D body as `encoding`, `BreadcrumbList` |
| Profiles (`/u/:username`) | `ProfilePage` with a `Person` as `mainEntity`, `BreadcrumbList` |

Crawler pages for agents, avatars and profiles are routed by user agent in `vercel.json` to `api/*-detail-og.js` and rendered by [api/_lib/crawler-page.js](../../api/_lib/crawler-page.js). Head titles carry the owner (and, for default-named widgets, the creation date) so that thousands of same-named entities do not share one title.

FAQ markup has to match what a reader sees. [tests/feature-faq-markup.test.js](../../tests/feature-faq-markup.test.js) holds the feature pages to that, and `audit:seo` reports `faq-not-shown` (an error: none of the declared questions are visible) and `faq-question-hidden` (a warning: some are not).

## Meta audit

```bash
npm run audit:seo                                   # production, a sample of every sitemap type
npm run audit:seo -- --base http://localhost:3123   # the dev server
npm run audit:seo -- --sample 60 --json report.json
npm run audit:seo -- --sitemap creations --limit 200
```

It reads the sitemap index, counts every URL each child declares, crawls a sample from every type as a search crawler, and exits 1 on any error:

- `title-missing`, `title-duplicate`, `description-missing`, `description-duplicate`
- `canonical-missing`, `canonical-relative`, `canonical-mismatch`, `canonical-duplicate`
- `sitemap-dead`, `sitemap-redirect`, `noindex-in-sitemap`
- `faq-not-shown`, and structured data that does not parse

Length issues (`title-short`, `title-long`, `description-short`, `description-long`) and `faq-question-hidden` are warnings. A dev-server run needs `DATABASE_URL` in `.env.local` so `server/dev-api-pages.mjs` answers sitemap and crawler URLs with the local handlers instead of proxying production.

## Bing Webmaster Tools (owner steps)

1. **Verify the site.** Open [bing.com/webmasters](https://www.bing.com/webmasters) and sign in. The fastest route is **Import from Google Search Console**, which carries the verified property and its sitemaps across. Otherwise add `https://three.ws/`, pick **XML file**, place the downloaded `BingSiteAuth.xml` in `public/`, deploy, and press Verify. (The DNS TXT record option needs no deploy.)
2. **Submit the sitemap.** Sitemaps → Submit sitemap → `https://three.ws/sitemap.xml`. Bing reads the children from the index. Status should move to Success, with a discovered-URL count close to the `audit:seo` declared total.
3. **Check IndexNow.** IndexNow → the dashboard lists URLs received through the key, by day. After the first cron runs it should show the submitted counts from `indexnow_submissions`.
4. **Inspect a URL.** URL Inspection → paste a page (for example `https://three.ws/features/forge`) → Live URL. It shows whether Bing can index the page, which canonical it chose, and which structured data it detected. Use it after any change to a crawler page.
5. **Watch Site Explorer and Search Performance** weekly. A drop in indexed pages for one directory points at a renderer regression; run `npm run audit:seo -- --sitemap <type>` to find it.
