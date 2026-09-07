# How three.ws is served to search engines

three.ws is a JavaScript application, and search engines index HTML. Most of the site's pages are shells whose content arrives after a fetch, so every surface that matters for search has a server-side path that puts real text in the response before any script runs.

This page maps those paths, names the file that owns each one, and describes the two contracts that keep them honest. Read it before changing how any page is rendered, and before adding a route to a sitemap.

## The four render paths

| Surface | What the crawler gets | Owner |
|---|---|---|
| Catalogued static pages (`/`, `/create`, `/markets`, and 800 others) | The page's own `<title>`, description, canonical, Open Graph tags and JSON-LD, rewritten per path into a shared shell | [server/seo-head.mjs](../server/seo-head.mjs) |
| Content pages behind a fetch (`/tutorials/<slug>`, `/walkthroughs/<slug>`) | The head above, plus the rendered markdown or walkthrough steps injected into the shell body | [server/crawler-body.mjs](../server/crawler-body.mjs) |
| Entity pages (`/agents/<id>`, `/avatars/<id>`) | A full server-rendered page: name, description, facts, tags, breadcrumbs and JSON-LD, routed by User-Agent | [api/_lib/crawler-page.js](../api/_lib/crawler-page.js) |
| News permalinks (`/markets/news/<month>/<id>-<slug>`) | A server-rendered story page with `NewsArticle` and `BreadcrumbList` JSON-LD and a bounded excerpt | [api/news/story-page.js](../api/news/story-page.js) |

Sitemaps are generated per entity type by [api/sitemap/[type].js](../api/sitemap/%5Btype%5D.js): `core` reads `data/pages.json`, the entity sitemaps read the database, and `news` reads the archive. `sitemap.xml` is the index over all six.

## Contract 1: a page and its manifest entry must agree

`data/pages.json` decides what is submitted to search engines. The page itself decides what a crawler may do once it arrives. When those disagree the crawler obeys the page, and Search Console records the difference as an error against the site.

Two ways to disagree, both caught by `npm run audit:pages`:

- The manifest submits a page whose HTML answers `<meta name="robots" content="noindex">`. Reported as "Submitted URL marked noindex".
- The manifest submits a path that `robots.txt` disallows. Reported as "Indexed, though blocked by robots.txt", and the crawler never sees the page well enough to drop it.

The fix for either is one line: set `"indexable": false` on the manifest entry. The page stays reachable, stays in the human sitemap with an `internal` badge, and leaves the XML sitemap. Signed-in surfaces, viewers that need a query parameter, and API endpoints all belong in that category.

`robots.txt` deliberately does **not** disallow `/dashboard`, `/settings` or `/my-agents`: those pages carry a `noindex` tag, and a crawler has to be allowed to fetch a page to read the tag that removes it. Disallowing them is what kept them in the index as bare URLs.

## Contract 2: server content is replaced, never merged

Every server-rendered body here is written into a container the client player overwrites wholesale on load (`article.innerHTML = …`, `root.innerHTML = …`). A visitor with JavaScript therefore sees exactly one version of the page, and a crawler without it sees a complete one.

Two consequences worth knowing before you edit a shell:

- The server render and the client render must agree on structure, or the page changes shape as it hydrates. The tutorial shell's hero owns the `<h1>`, so both [server/crawler-body.mjs](../server/crawler-body.mjs) and the player strip the leading `# Title` line out of the markdown before rendering it. Skip that on either side and the document ends up with two competing top-level headings.
- If a shell's markup changes so the injection no longer matches, `crawler-body.mjs` logs and returns the untouched shell rather than serving a half-rendered page. A blank body that still answers 200 is the failure mode to avoid.

## Auditing

```bash
npm run audit:seo                        # the live site, core pages
npm run audit:seo -- --limit 40          # a quick pass
npm run audit:seo -- --sitemap agents    # another URL set
npm run audit:seo -- --base http://localhost:3000
npm run audit:seo -- --strict            # exit 1 on any error
```

[scripts/audit-seo.mjs](../scripts/audit-seo.mjs) reads a sitemap, fetches every URL in it as Googlebot, and reports what a search engine would act on: dead or redirecting sitemap entries, pages answering noindex, missing or non-self-referencing canonicals, duplicate titles and descriptions across the corpus, missing `h1`, absent Open Graph tags, and structured data that fails to parse or carries a truncated character.

It reads the live origin on purpose. Only the served response proves what a crawler receives after routing, the shell rewrite and the CDN, so point `--base` at a preview origin to check a change before it ships.

Errors are things a search engine acts on immediately; warnings are quality signals. A title over 65 characters or a description over 165 is truncated in results rather than dropped, so those are reported as warnings, not failures.

## Related

- [docs/guards.md](./guards.md): the full guard registry, including `audit:seo` and `audit:pages`
- [api/_lib/safe-text.js](../api/_lib/safe-text.js): why every string that reaches JSON-LD is truncated on grapheme boundaries
- [STRUCTURE.md](../STRUCTURE.md): where each product surface lives
