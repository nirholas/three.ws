# microsoft 23: make three.ws fully visible to Bing and Copilot answers (IndexNow, sitemaps, structured data)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3123.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Bing's index feeds Microsoft Copilot, Copilot in Edge and Windows search, and several other AI assistants. A page Bing has not indexed, or indexed with a thin description, does not show up when someone asks Copilot "where can I make a 3D model from a photo". IndexNow pushes new and changed URLs to Bing within minutes, and complete structured data tells Bing exactly what each page is. With thousands of creations and agent pages, the gap between what exists and what Bing knows is large and measurable.

## Step 0: re-derive the current state

    grep -rn -i "indexnow" api scripts public 2>/dev/null | head
    ls public | grep -i -E "sitemap|robots|\.txt$"; curl -s https://three.ws/robots.txt
    curl -s https://three.ws/sitemap.xml | head -40
    grep -rn "application/ld+json" pages src api 2>/dev/null | head -20
    grep -n -i "sitemap" vercel.json package.json | head

Measure: how many public URLs exist by type (pages, creations, agents, models, docs) from the database and data/pages.json, versus how many the sitemaps list. Read the IndexNow protocol docs (key file, batch submission, limits) and Bing Webmaster Guidelines for structured data.

## Tasks

1. **IndexNow, complete.** Key file served at the documented path; a module that submits batches on create, update and delete of every public resource type (creations, agents, models, public pages), deduplicated and rate limited, plus a cron that reconciles anything missed. Logged results. If IndexNow exists partially, extend it to every type and test it.
2. **Sitemaps.** A sitemap index with per-type child sitemaps generated from the database (paged at the protocol limit of 50,000 URLs), correct `lastmod` from real timestamps, served with caching; robots.txt references the index; private and noindex content excluded.
3. **Structured data.** JSON-LD per page type: `Organization` on the home page with `sameAs` including the Microsoft Marketplace listing URL and official social profiles; `SoftwareApplication` for the product pages; `3DModel` (with `encoding` of the GLB) or `CreativeWork` for creations; `Person` or `SoftwareApplication` as appropriate for agents; `BreadcrumbList` sitewide; `FAQPage` only where a real FAQ exists. Validate each against schema.org definitions.
4. **Meta audit.** Titles, descriptions and canonical URLs on every page type, with a check script `npm run audit:seo` that fails on missing or duplicate values across a crawl sample.
5. **Docs.** `docs/ops/bing-and-indexnow.md` with the Bing Webmaster Tools steps (site verification method, sitemap submission, URL inspection), what the cron does, and how to read results. STRUCTURE.md row if a new module landed, changelog entry.

## Definition of done

- [ ] Test-first tests for sitemap paging, `lastmod`, exclusion rules, IndexNow batching and dedupe, and JSON-LD per type.
- [ ] A real IndexNow submission of real three.ws URLs returns the documented success code (evidence in the report), run only against URLs already live in production.
- [ ] `npm run audit:seo` passes on a crawl sample of the dev server on port 3123; the URL count before and after in the report.
- [ ] Docs and changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The IndexNow key file is not deployed yet | Submit only after the key is reachable on production; otherwise build and test, and put "deploy, then run `npm run indexnow:reconcile`" in the owner message. |
| Bing Webmaster verification | Owner step; add the verification meta tag or file the docs describe if it can be done in repo, and name the step. |
| Too many URLs to compute quickly | Stream from the database by id cursor; never load all rows. |
| A schema.org type is ambiguous | Use the most specific type Bing documents support for; note it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
