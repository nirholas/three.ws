# 419. Fix duplicate /grok and /docs/creator-payouts sitemap entries, and the noindex page submitted in the sitemap

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: the failure is reproduced below. Confirm it fails for the stated reason, fix it, confirm green, commit test and fix together.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- No em-dash/en-dash anywhere you write.

## Step 0: re-derive the current state

    npm run audit:seo

As measured 2026-10-24, this prints `ERROR (6)` including:

    title-duplicate × 3
        https://three.ws/grok: 2 pages share "three.ws for Grok Bot: a free 3D studio and a body for Grok · three.ws": https://three.ws/grok, https://three.ws/grok
        https://three.ws/trenches: 2 pages share "Trenches Pulse · three.ws": https://three.ws/trenches, https://three.ws/docs/trenches
        https://three.ws/docs/creator-payouts: 2 pages share "Docs · Creator payouts · three.ws": https://three.ws/docs/creator-payouts, https://three.ws/docs/creator-payouts
    description-duplicate × 2
        https://three.ws/grok: 2 pages share one description: https://three.ws/grok, https://three.ws/grok
        https://three.ws/docs/creator-payouts: 2 pages share one description: https://three.ws/docs/creator-payouts, https://three.ws/docs/creator-payouts
    noindex-in-sitemap × 1
        https://three.ws/irl/sign: robots: noindex, follow

Confirm the root cause directly in the data file:

    grep -n '"path": "/grok"' data/pages.json
    grep -n '"path": "/docs/creator-payouts"' data/pages.json
    grep -n '"path": "/irl/sign"' data/pages.json
    curl -s https://three.ws/sitemap/core.xml | grep -c '<loc>https://three.ws/grok</loc>'
    curl -s https://three.ws/sitemap/core.xml | grep -c '<loc>https://three.ws/docs/creator-payouts</loc>'

As measured 2026-10-24: `/grok` appears at `data/pages.json` lines 664 and 6647 (two different entries, `added: "2026-10-08"` vs `added: "2026-10-09"`, the second a richer rewrite that was never deleted from the first add). `/docs/creator-payouts` appears at lines 7286 and 7294, byte-for-byte identical (same title, description, priority, changefreq, `added: "2026-10-23"`), a plain double-add. Both print `2` from the `grep -c` on the live sitemap, confirming the duplicate rows really do produce two `<loc>` entries for the same URL in `sitemap/core.xml`. `pages/irl-sign.html` line 12 carries `<meta name="robots" content="noindex, follow" />` (a deliberate choice: `/irl/sign` is a per-agent printable utility page, not a destination worth ranking), yet its `data/pages.json` entry (line 305) still has it submitted via the sitemap with a real `priority`/`changefreq`, which tells Google to crawl and index a URL the page itself says not to index.

If step 0 now prints 0 errors, run `git log --oneline -5 -- data/pages.json` to find the fix, confirm the three duplicates/noindex-conflict are gone, and retire this order per the "Never blocked" table.

## Root cause

`data/pages.json` is the single source of truth `scripts/build-sitemap.mjs`-equivalent sitemap/pages tooling reads to emit `public/sitemap/core.xml` and feed `audit:pages`/`audit:seo`. Nothing in the add-a-page workflow checks for an existing entry with the same `path` before appending a new one, so:
1. A page that gets a copy refresh (as `/grok` did between 2026-10-08 and 2026-10-09) can get a second entry instead of an edit to the first, if whoever added the refresh appended rather than searched.
2. A page added twice by mistake (as `/docs/creator-payouts` was on 2026-10-23) produces an exact duplicate.
3. Nothing cross-checks a page's own `<meta name="robots">` against its sitemap inclusion, so a page that opts itself out of indexing (`/irl/sign`) still gets submitted.

## Task

1. Open `data/pages.json` and remove the stale `/grok` entry at line 664 (`added: "2026-10-08"`, title `"three.ws for Grok"`), keeping the 2026-10-09 entry (line 6647, the fuller "three.ws for Grok Bot..." copy, `changefreq: "weekly"`).
2. Remove one of the two identical `/docs/creator-payouts` entries (lines 7285-7300), keeping a single copy.
3. Remove the `/irl/sign` entry (lines 304-311) from `data/pages.json` entirely: a page whose own HTML opts out of indexing must not be submitted through the sitemap. Do not change `pages/irl-sign.html`'s `noindex` meta tag; that is the correct, deliberate choice for a printable per-agent utility page.
4. Search `data/pages.json` for any other exact-duplicate `path` values beyond these three, since the audit only reports title/description collisions (which catches duplicates that share copy, but would miss a hypothetical duplicate pair that was independently given two different titles):

       node -e "
       const pages = require('./data/pages.json');
       const flat = [];
       (function walk(node) {
         if (Array.isArray(node)) { node.forEach(walk); return; }
         if (node && typeof node === 'object') {
           if (typeof node.path === 'string') flat.push(node.path);
           Object.values(node).forEach(walk);
         }
       })(pages);
       const seen = new Map();
       for (const p of flat) seen.set(p, (seen.get(p) || 0) + 1);
       for (const [p, n] of seen) if (n > 1) console.log(n, p);
       "

   Fix any additional duplicate the same way (keep the most recent/complete entry, remove the rest).
5. Rebuild the sitemap and page-index artifacts that read from `data/pages.json`:

       npm run build:pages

6. Re-run `npm run audit:seo` and confirm `title-duplicate`, `description-duplicate` and `noindex-in-sitemap` no longer appear in the `ERROR` section.
7. Add a regression guard so a future duplicate `path` in `data/pages.json` fails fast instead of silently shipping to the sitemap: extend `scripts/audit-page-index.mjs` (run via `npm run audit:pages`, already in `npm run gate`) to flag any `path` value that appears more than once across `data/pages.json`, with a clear error naming the duplicate path and both source locations (line numbers if practical, otherwise the duplicate count). Add a corresponding test case or fixture under `tests/` (follow that script's existing test file if one exists, e.g. `tests/audit-page-index.test.js`; create one matching the project's existing audit-script test pattern if it does not) that feeds a pages array with a deliberate duplicate `path` and asserts the audit reports it.
8. Re-run `npm run audit:pages` and confirm it is still green against the de-duplicated `data/pages.json`, and that the new test from step 7 fails against a duplicate fixture and passes once the duplicate is removed.

## Done when

- `npm run audit:seo` prints 0 errors in the `title-duplicate`, `description-duplicate` and `noindex-in-sitemap` categories.
- `curl -s https://three.ws/sitemap/core.xml` is not checkable until deploy, but `public/sitemap/core.xml` (regenerated by `npm run build:pages`) contains exactly one `<loc>` entry each for `https://three.ws/grok` and `https://three.ws/docs/creator-payouts`, and zero for `https://three.ws/irl/sign`.
- `data/pages.json` has no duplicate `path` values anywhere (step 4's one-off script prints nothing).
- `scripts/audit-page-index.mjs` now rejects a duplicate `path`, proven by a new passing test.
- `npm run audit:pages`, `npm run audit:docs` and `npm run test:core` show no new failures versus the pre-change baseline.
- `git diff` touches only: `data/pages.json`, `public/sitemap/**` (and any other `build:pages` output, e.g. `public/sitemap-index.xml`, `data/pages-search.json` if that exists), `scripts/audit-page-index.mjs`, and the new/updated test file.
- Committed on `evolve` with an explicit-path commit naming the fix.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Unsure which of the two `/grok` entries to keep | The 2026-10-09 one is strictly fuller copy with a tighter `changefreq`; the 2026-10-08 one is the stale first draft | Keep 2026-10-09, remove 2026-10-08 |
| Tempted to "fix" `/irl/sign` by removing its `noindex` meta tag instead | That tag is deliberate: it is a printable, parameterized per-agent utility page with no standalone SEO value, and indexing it would create near-duplicate-content bloat across every agent's printed sign | Remove the `data/pages.json` entry instead; leave `pages/irl-sign.html` untouched |
| `npm run build:pages` regenerates more files than expected and the diff looks large | The script is deterministic over the whole `data/pages.json`; a large diff on first run after a multi-entry edit is expected, not a sign something broke | Confirm the diff is only removed/shifted entries (no content corruption), not a reason to abort |
| Step 0's counts are already 0 when you check | Another agent may have shipped this | Confirm via `git log --oneline -5 -- data/pages.json`, verify the three issues above are gone, retire this order without further changes |
| `/trenches` vs `/docs/trenches` sharing one title (`title-duplicate` row 2) looks like the same bug | It is a different, lower-priority copy issue: two genuinely distinct pages with coincidentally identical titles, not a duplicate sitemap row | Out of scope for this order; leave it unless you have time left after steps 1-8, in which case retitle `/docs/trenches` to `"Docs · Trenches Pulse"` matching the `/docs/creator-payouts` naming convention and note it in the report |

## Report format

State: the step-0 "before" `audit:seo` error list, the exact lines removed from `data/pages.json` for each of the three issues, the step-4 duplicate-scan output (before and after), the `scripts/audit-page-index.mjs` diff and its new test's passing output, the `npm run build:pages` diff summary, the "after" `audit:seo`/`audit:pages`/`audit:docs`/`test:core` results, and the commit SHA.
