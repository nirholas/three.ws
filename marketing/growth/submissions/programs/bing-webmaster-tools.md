# Bing Webmaster Tools and IndexNow

Program: Bing Webmaster Tools (free), plus IndexNow.
Plan item: `docs/microsoft-marketplace-offer-plan.md` section 13 (priority #13).
Drafted: 2026-11-04. Nothing here has been done. Verification needs the owner's Microsoft account.

## What already exists

| Piece | State | Source |
| --- | --- | --- |
| IndexNow key file | Live at `https://three.ws/1a34d91143f6e085eedef0f9669c93be.txt` | `public/1a34d91143f6e085eedef0f9669c93be.txt` |
| IndexNow client | `pingIndexNow(urls)` posts to `https://api.indexnow.org/IndexNow` with `host: three.ws`, the key and `keyLocation`. Only `https://three.ws/` URLs pass the filter. Fire-and-forget, 5 second timeout, never blocks the request. 200 and 202 count as success. | `api/_lib/indexnow.js` |
| Automatic pings | A new agent pings its page `https://three.ws/agents/<id>` at creation. | `api/_lib/agent-create.js` |
| Bulk submit | `scripts/indexnow-submit.mjs` submits pages from `data/pages.json` (default: added in the last 7 days; `--days`, `--since`, `--all`, `--dry-run`) through the same client, in batches of up to 10,000. | `scripts/indexnow-submit.mjs` |
| Sitemap index | `https://three.ws/sitemap.xml`, declared in robots.txt (`Sitemap: https://three.ws/sitemap.xml`). | `public/robots.txt`, `vercel.json` |
| Robots | Present at `https://three.ws/robots.txt`. | `public/robots.txt` |

IndexNow is consumed by Bing and Yandex, Seznam and Naver. Google does not use it.

## Sitemap URLs to submit

The index `https://three.ws/sitemap.xml` is enough: Bing follows it to the children. Submit the index first. Submit the children too if you want per-section crawl and index counts in the Sitemaps report. The exact routes come from `vercel.json` (`/sitemap/(core|agents|avatars|widgets|profiles|news).xml`) and the type list in `api/sitemap/[type].js`:

```
https://three.ws/sitemap.xml
https://three.ws/sitemap/core.xml
https://three.ws/sitemap/agents.xml
https://three.ws/sitemap/avatars.xml
https://three.ws/sitemap/widgets.xml
https://three.ws/sitemap/profiles.xml
https://three.ws/sitemap/news.xml
```

Each child streams up to 45,000 URLs, under the 50,000 limit of the sitemaps.org protocol, so no child needs splitting yet.

## Steps (owner)

1. Sign in at <https://www.bing.com/webmasters> with the Microsoft account that owns the Marketplace publisher profile.
2. Choose **Add a site** and enter `https://three.ws`. Prefer **Import from Google Search Console** if the site is already verified there: it verifies and imports the sitemaps in one step.
3. Otherwise verify by one of:
   - **XML file:** download `BingSiteAuth.xml` and place it in `public/BingSiteAuth.xml`. It is served at `https://three.ws/BingSiteAuth.xml`. Commit it and deploy (production deploys need owner approval).
   - **Meta tag:** add `<meta name="msvalidate.01" content="...">` to the root page head.
   - **DNS CNAME:** the least invasive: add the CNAME record Bing shows at the DNS provider. No deploy needed.
4. After verification, open **Sitemaps** and submit the URLs above.
5. Open **IndexNow** in the left menu and confirm Bing shows the key `1a34d91143f6e085eedef0f9669c93be` and recent submissions from `three.ws`.
6. Open **URL inspection** on `https://three.ws/`, `/marketplace`, `/create` and one agent page to confirm they are indexable.
7. Open **Site Scan** and **Crawl Information**. Check for blocked pages: `public/robots.txt` should not block the pages you want in Copilot answers.

## Check IndexNow from the command line

```bash
curl -sI https://three.ws/1a34d91143f6e085eedef0f9669c93be.txt | head -1   # expect 200
node scripts/indexnow-submit.mjs --dry-run                                  # print the URLs it would send, send nothing
```

A bulk push of the core pages after Bing verification gets them crawled in minutes. It is a public write to a third party, so the owner runs it.
