# grok-startups 11: turn /grok into the one page that shows everything three.ws does with Grok

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3281.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Every post, listing, email and reshare in this campaign links somewhere. That somewhere is `/grok`. When an xAI staffer or a developer lands there, the page must answer in five seconds what three.ws does with Grok, how to install it in their tool, and that it is real and used. Sibling orders add sections to this page in small anchored edits; this order owns its structure, its membership wording, its install paths, its live numbers and its share card. It must look like a page a senior designer shipped, not a docs dump.

## Step 0: re-derive the current state

    wc -l pages/grok.html; grep -n "<section\|<h2\|data-i18n" pages/grok.html | head -60
    grep -n "grok" vercel.json data/pages.json | head
    grep -rn "grok" src/*.js | grep -i "page\|init" | head
    git log --oneline -10 -- pages/grok.html
    grep -n "xai\|grok" data/partner-programs.json | head
    curl -s -o /dev/null -w "%{http_code}\n" https://three.ws/grok

Open `http://localhost:3281/grok` with Playwright at 1440 and 390 widths and screenshot it before you touch anything. List every surface that exists today: the two MCP servers, the Cursor plugin, the Grok Build plugin, the Grok skill file, Grok Bot, grok.com connector, the @-mention bot status (order 928), the examples folder, and any section a sibling order already added. Read how other pages in the repo fetch live stats (find a page with a live counter) and how OG images are made (find the OG generator).

## Tasks

1. **Structure and copy.** Hero: one sentence on what three.ws does with Grok, the approved membership line ("three.ws is a member of xAI's Grok for Startups program") as a small credential, and two primary actions (add the connector, install a plugin). Then sections in this order: Install (tabbed: Grok Bot, grok.com, Grok Build, Cursor, any MCP client, each with the exact value to paste and a copy button), What you can make (real outputs with links to their viewer pages, chosen from real public models), Build with it (examples and docs links), Live (numbers), Reliability (uptime if `/api/status/mcp` exists), FAQ (account, cost, data handling). Token-free throughout. Re-read the page right before each edit; siblings may have added a section: keep theirs, place it in the structure, and note it in the report.
2. **Install deep links that work.** Each tab gives the precise value and, where the client supports a link that pre-fills the install (Cursor's install link format, for example; verify in Cursor docs), a real deep link. Verify every link opens the right thing; a dead deep link is worse than none.
3. **Live numbers from real data.** `GET /api/grok/stats` (route in `vercel.json`, hot file): models generated through the Grok-facing servers in 24 hours and 30 days and distinct connected clients in 30 days, computed from `usage_events` grouped by `client_id` (read which labels the Grok surfaces write; if they do not tag themselves, add the tag at those call sites test-first). Cached 5 minutes, no personal data. The section renders only when the endpoint answers, with a skeleton while loading and no section at all on error (never zeros pretending to be data).
4. **Share card.** A 1200 x 630 OG image for `/grok` produced by the repo's OG pipeline (or rendered from the page's hero with Playwright and committed if no pipeline exists), plus `og:` and `twitter:` meta. No xAI or X logos (context file, marks rule).
5. **Quality bar.** Responsive from 360 to 1920, keyboard navigable, visible focus states, hover and active states on every control, reduced-motion respected, a Lighthouse accessibility score of at least 95 on your dev server (run it), no console errors. i18n: if the page uses `data-i18n`, add every new key to the en locale and run the repo's locale check.
6. **Docs.** Update `docs/grok.md` (hot file) to mirror the install tabs, the `data/pages.json` entry description, and a changelog entry.

## Definition of done

- [ ] Before and after Playwright screenshots at 1440 and 390 in the report; no console errors.
- [ ] Every install deep link and copy value verified (list with result).
- [ ] `/api/grok/stats` returns real numbers from the isolated DB with real rows on your dev server, and from production after deploy (owner step); `npx vitest run tests/grok-stats.test.js` passes.
- [ ] Lighthouse accessibility at least 95 (score in the report).
- [ ] `grep -niE "partner of xai|backed by xai|official grok|\\\$THREE" pages/grok.html` returns nothing.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A sibling edits `pages/grok.html` at the same time | Re-read before each edit, make small anchored edits, commit right after each. Your structure must hold their sections. |
| The Grok surfaces do not tag `client_id` | Add tags at the call sites test-first; numbers start from deploy. The section stays hidden until data exists. |
| Lighthouse is not installed | Run it via `npx lighthouse` in your scratchpad with the Playwright Chromium binary. |
| A deep-link format is undocumented | Ship the copy value only for that client and say why in one line. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (deploy): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (Lighthouse accessibility and performance scores).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
