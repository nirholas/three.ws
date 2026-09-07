# Search indexing

How three.ws pages reach a search index, what broke, and what to check before
concluding a page "just isn't ranking yet". Companion to
[seo-keyword-plan.md](./seo-keyword-plan.md), which covers what to write;
this doc covers whether a crawler can read it at all.

---

## The three ways a page is served to a crawler

Every public URL falls into one of these, and the failure modes are different:

1. **A static page** (`pages/*.html`, most of `data/pages.json`). The HTML on
   disk is the HTML a crawler sees. `scripts/inject-seo-meta.mjs` backfills the
   title, description, canonical, OG/Twitter tags and JSON-LD from
   `data/pages.json`, so the meta a crawler reads matches the catalog. Run it
   with `--write` after adding a page; it never overwrites a tag a page already
   has.

2. **A server-rendered page** (`api/*-og.js`, `api/markets/*`). The handler
   composes the document per request from the database. `/markets/news/...` and
   the crawler pages below are here.

3. **A single-page-app shell.** One HTML file backs an unbounded URL space:
   `/coin/:id` renders `pages/coin.html`, `/m/:id` renders `pages/model.html`,
   and so on. The shell has no content and no canonical until the controller
   fills it in from an API call. Google indexes the *rendered* DOM, so this
   works, but only if the controller sets the head tags. `src/seo-meta.js`
   exists for exactly that (`setCanonical`, `markNoindex`).

`/avatars/:id` and `/agents/:id` are the interesting case: a browser gets the
SPA shell, and a crawler UA is rewritten by `vercel.json` to a server-rendered
page instead (`api/avatar-detail-og.js`, `api/agent-detail-og.js`). Those two
URL spaces are also the largest on the site: the avatars sub-sitemap alone
submits up to 45,000 URLs.

---

## The duplicate-cluster failure (2026-09)

Search Console, page indexing report, snapshot 2026-09-03: **30.2k indexed,
25.1k not indexed**, and the single largest exclusion was **18,768 pages under
"Duplicate without user-selected canonical"**, alongside 1,101 "Page with
redirect", 1,382 "Crawled - currently not indexed" and 813 "Duplicate, Google
chose different canonical than user".

The cause was in the crawler pages, and it is worth understanding because the
same shape is easy to reintroduce. The rendered page carried the avatar's name
and description in `<meta>` tags, and the visible document was:

```html
<noscript>
  <div class="shell"><h1>Shaw</h1><p>Rigged, walk-ready avatar…</p></div>
</noscript>
<div class="shell"><div class="spinner"></div><p>Loading Shaw…</p></div>
<script>(function(){window.location.replace("/avatars/19da5ca4-…");})()</script>
```

Two things go wrong, and they compound:

- **The redirect target is the URL the crawler is already on.** The rewrite is
  keyed on the User-Agent, not the path, so re-requesting the same URL behind
  the same UA returns a byte-identical response and the navigation repeats. A
  crawler that runs JS (Googlebot, bingbot and Applebot all render before
  indexing) never lands anywhere else, and may bucket the URL as a redirect.
- **Rendering removes `<noscript>`.** The only real text on the page lived
  inside it, so the document that reached the indexer was a spinner over the
  word "Loading". Every avatar URL rendered to the same nothing.

45,000 URLs with no distinguishing content is one duplicate cluster 45,000 wide.
The canonical tag in the head could not save it: a cluster where nothing
differs has no preferred version to point at.

### The fix

`api/_lib/crawler-page.js` now renders both crawler pages, and:

- **The content is in the body.** Name, description, the 1200x630 card as a real
  `<img>`, a definition list of facts (creator, category, rig state, fork count,
  publication date for an avatar; skills, ERC-8004 identity, home URL for an
  agent), tag chips linking into `/gallery` or `/agents`, and a footer of
  related surfaces. Plus `3DModel` / `SoftwareApplication` JSON-LD and a
  `BreadcrumbList`. No `<noscript>`, because nothing hides in it any more.
- **The self-redirect is emitted only for crawlers that never index.**
  `isSearchCrawler()` splits indexing crawlers (Googlebot, bingbot, Applebot,
  GPTBot, ClaudeBot, PerplexityBot, and the rest) from link unfurlers
  (Twitterbot, Slackbot, Embedly, Iframely). An unfurler still gets bounced to
  the app, which is the friendly outcome for a human arriving behind a scraper
  UA. A search engine gets content and no script.
- **A missing entity 404s** instead of 302-ing to `/gallery` or `/agents`. Those
  redirects were the "Page with redirect" and "Soft 404" rows: a crawler asked
  about a deleted avatar and was told, in effect, "here is a different page".
  Now it is told the truth, on a `noindex` document, and the URL leaves the
  index.
- **An id that names the other store 301s across.** Agent and avatar UUIDs are
  separate spaces and links cross over (`resolveEntity` in `src/avatar-page.js`
  does the same thing client-side), so `/agents/<an avatar id>` sends a real 301
  to `/avatars/<id>` rather than reporting nothing.
- **A database failure returns 503, not 404.** A read failure is ours, not the
  URL's; a 404 there would drop live pages out of the index.
- **Private agents are no longer served at all.** The agent query filtered only
  on `deleted_at`, so an agent with `is_public = false` had its name and
  description rendered to anything sending a bot UA. It now matches the
  sitemap's predicate (`is_public = true`).

### Content parity, not cloaking

Serving crawlers a different document than browsers is dynamic serving, which is
allowed as long as the content is equivalent. It is: the crawler page carries
the same name, description, imagery, tags, and creator the interactive page
shows. What it omits is the WebGL viewport a crawler cannot run. Keep it that
way. If a fact appears on the crawler page that a visitor cannot find on the
real one, that is the line.

---

## The other duplicate source: untouched onboarding rows

Rendering real content only helps if the entities differ. Measured against
production on 2026-09-07:

| | Public | Indexable | Dropped |
|---|---|---|---|
| Agents | 3,397 | 2,038 | 1,359 (40%) |
| Avatars | 67,164 | 66,994 | 170 |

**1,163 of the 3,397 public agents were still named "My First Agent"**, and
1,158 of those still carried the starter description word for word. Those pages
are not thin, they are the same page with a different UUID, and no server-side
rendering can separate them.

[`api/_lib/indexable-entity.js`](../../api/_lib/indexable-entity.js) decides.
An agent is indexable unless it keeps *both* its default name and its starter
description; an avatar is indexable unless it keeps a default name with no prose
at all (a generated avatar still gets its own description and tag set, which is
why so few are dropped). Both the sitemap builders and the crawler pages import
the predicate, so the file and the page can never disagree.

A non-indexable entity is not hidden: its page still renders, still unfurls with
its own card, and still links onward. It is served `noindex, follow` and left
out of the sitemap. The moment its owner types a name or a description it
becomes indexable again, with no migration and no backfill, which is why the
rule reads the row instead of storing a flag.

Re-measure before quoting these numbers:

```bash
node --input-type=module -e "
import { config } from 'dotenv'; config({ path: '.env.local', quiet: true });
const { sql } = await import('./api/_lib/db.js');
const { isIndexableAgent } = await import('./api/_lib/indexable-entity.js');
const rows = await sql\`select name, description from agent_identities
  where deleted_at is null and is_public = true\`;
console.log(rows.length, '->', rows.filter(isIndexableAgent).length);
process.exit(0);"
```

---

## Indexed, though blocked by robots.txt

25 URLs sat in this state, and it is always the same mistake:
`public/robots.txt` disallowed `/dashboard`, `/settings` and `/my-agents`, while
every page under them already carried `<meta name="robots" content="noindex">`.
A crawler that is not allowed to fetch the page never sees the noindex, so the
URL stays in the index as a bare link. The two directives cancel each other out.

Crawling is what removes them, so those three prefixes are now open in
robots.txt and the `noindex` does the work. `pages/dashboard-next/data-api.html`,
`developers.html` and `billing.html` were missing the tag and now carry it.

**Rule: pick one.** `Disallow` keeps a page out of the crawl; `noindex` keeps it
out of the index. Never both on the same URL.

---

## Soft 404s from SPA shells

A shell that renders "not found" over a `200` is a soft 404. The router cannot
know the entity is missing, but the controller can, so it calls `markNoindex()`
from [`src/seo-meta.js`](../../src/seo-meta.js) at the moment it renders the
empty state. Wired into `src/coin-page.js`, `src/model-page.js` and
`src/signal-detail.js`. Any new shell with a not-found branch should do the
same, and should call `setCanonical()` once it knows which entity it is showing.

---

## Checking a page yourself

Fetch as a crawler rather than trusting a browser view, because the UA branch
changes the response:

```bash
UA='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/128.0.0.0 Safari/537.36'
curl -sS -A "$UA" https://three.ws/avatars/<id> | grep -E 'canonical|robots|<h1>'
```

What a healthy indexable page looks like:

- `200`, exactly one `<link rel="canonical">`, pointing at itself.
- `<meta name="robots">` absent or `index, follow`.
- A `<h1>` and body copy that differ from every sibling URL.
- No `location.replace` anywhere in the document.

Sub-sitemap sizes, which is the fastest way to see how much of each space is
being submitted:

```bash
for t in core agents avatars widgets profiles news; do
  echo "$t: $(curl -sS https://three.ws/sitemap/$t.xml | grep -c '<loc>')"
done
```

`npm run audit:web` sweeps every page in `data/pages.json` in a real browser
(see [page-audit.md](./page-audit.md)); it catches console errors, not indexing
state, so run both.

---

## What to expect after a fix lands

Search Console does not recount on deploy. Google has to recrawl each URL, and
at this volume that is weeks, not days. The order things move in:

1. "Page with redirect" and "Soft 404" fall first: they are decided by the
   response, which changes immediately.
2. "Duplicate without user-selected canonical" drains as pages are re-rendered
   and start to differ from one another.
3. Indexed count rises last.

Use the URL Inspection tool on a handful of representative URLs to confirm the
rendered HTML is what this doc describes before reading anything into the
aggregate charts.
