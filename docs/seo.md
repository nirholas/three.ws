# How three.ws is served to search engines

three.ws is a JavaScript application, and search engines index HTML. Most of the site's pages are shells whose content arrives after a fetch, so every surface that matters for search has a server-side path that puts real text in the response before any script runs.

This page maps those paths, names the file that owns each one, and describes the two contracts that keep them honest. Read it before changing how any page is rendered, and before adding a route to a sitemap.

## The five render paths

| Surface | What the crawler gets | Owner |
|---|---|---|
| Catalogued static pages (`/`, `/create`, `/markets`, and 800 others) | The page's own `<title>`, description, canonical, Open Graph tags and JSON-LD, rewritten per path into a shared shell | [server/seo-head.mjs](../server/seo-head.mjs) |
| Content pages behind a fetch (`/tutorials/<slug>`, `/walkthroughs/<slug>`) | The head above, plus the rendered markdown or walkthrough steps injected into the shell body | [server/crawler-body.mjs](../server/crawler-body.mjs) |
| Entity pages (`/agents/<id>`, `/avatars/<id>`) | A full server-rendered page: name, description, facts, tags, breadcrumbs and JSON-LD, routed by User-Agent | [api/_lib/crawler-page.js](../api/_lib/crawler-page.js) |
| Forge creation pages (`/m/<id>`) | The model shell with its head rewritten per creation for every User-Agent: title, canonical, a `summary_large_image` card whose image is the PNG render of the model, and `3DModel` JSON-LD | [server/creation-head.mjs](../server/creation-head.mjs) |
| News permalinks (`/markets/news/<month>/<id>-<slug>`) | A server-rendered story page with `NewsArticle` and `BreadcrumbList` JSON-LD and a bounded excerpt | [api/news/story-page.js](../api/news/story-page.js) |

Sitemaps are generated per entity type by [api/sitemap/[type].js](../api/sitemap/%5Btype%5D.js): `core` reads `data/pages.json`, the entity sitemaps read the database, and `news` reads the archive. `sitemap.xml` is the index over all six.

The human-readable counterpart is [/sitemap](https://three.ws/sitemap), a fully static page written by [scripts/build-page-index.mjs](../scripts/build-page-index.mjs) from the same `data/pages.json`. It ships every catalogued page as real HTML (no fetch, so a crawler and a reader see the same thing), grouped by section, with a "Newest" strip of the most recently added pages and a client-side filter over titles, paths and descriptions. The filter is token-based, so `studio avatar` and `avatar studio` return the same rows; it mirrors the query into `?q=`, so `/sitemap?q=wallet` is a shareable link, and `Enter` opens the first match. Regenerate it with `npm run build:pages` after any `data/pages.json` edit; the script is idempotent and reports which files it rewrote.

## Contract 1: a page and its manifest entry must agree

`data/pages.json` decides what is submitted to search engines. The page itself decides what a crawler may do once it arrives. When those disagree the crawler obeys the page, and Search Console records the difference as an error against the site.

Two ways to disagree, both caught by `npm run audit:pages`:

- The manifest submits a page whose HTML answers `<meta name="robots" content="noindex">`. Reported as "Submitted URL marked noindex".
- The manifest submits a path that `robots.txt` disallows. Reported as "Indexed, though blocked by robots.txt", and the crawler never sees the page well enough to drop it.

The fix for either is one line: set `"indexable": false` on the manifest entry. The page stays reachable, stays in the human sitemap with an `internal` badge, and leaves the XML sitemap. Signed-in surfaces, viewers that need a query parameter, and API endpoints all belong in that category.

`robots.txt` deliberately does **not** disallow `/dashboard`, `/settings` or `/my-agents`: those pages carry a `noindex` tag, and a crawler has to be allowed to fetch a page to read the tag that removes it. Disallowing them is what kept them in the index as bare URLs.

## Creation structured data

Every page that shows something a person made (a forge creation at `/m/<id>` and `/forge/share/<id>`, an avatar at `/avatars/<id>`, an agent at `/agents/<id>`) carries one schema.org node built by [api/_lib/creation-jsonld.js](../api/_lib/creation-jsonld.js), so a search engine, X's card crawler, or Grok answering "what is this?" under a shared link reads the same facts everywhere:

| Property | Value |
|---|---|
| `@type` | `3DModel` for models and avatars; `SoftwareApplication` for an agent, whose body rides along as the encoding |
| `encoding` | The GLB as a `MediaObject` with `encodingFormat: model/gltf-binary` (only public files) |
| `thumbnailUrl` | `GET /api/render/glb?glbUrl=<the GLB>&width=1200&height=630`, the PNG render of the model, omitted when the file is past the renderer's 10 MB cap |
| `creator` | The three.ws user who made it, when one is on record; anonymous forges name nobody |
| `dateCreated` | The creation date |
| `license` | `/legal/tos`: the creator keeps ownership (section 5) and three.ws displays it under those terms |

`/m/<id>` is rewritten for every User-Agent, not only known crawlers. Grok Bot browses with an ordinary browser and xAI documents no user-agent token to route on (checked against docs.x.ai on 2026-10-08), so a crawler-only branch would miss it. The same reason is recorded in `robots.txt`, which also allows `/api/render/glb` in the default group: that endpoint is the card image and thumbnail on every creation page, and readers without a group of their own (Twitterbot, Grok) are judged by `User-agent: *`. `npm run dev` applies the same rewrite, reading the creation from the dev API upstream. Tests: [tests/legible-to-grok.test.js](../tests/legible-to-grok.test.js).

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
