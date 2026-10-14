# 407. Publish or explicitly park the 10 docs pages that are live but undiscoverable

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and
say "run this work order". Runnable now, no gate. Written by the evolve scout lane on
2026-10-14 from a live `npm run audit:docs` run.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an
  unexecuted plan. A judgment call on any one doc goes in one line of the final report; it
  never becomes a question that halts work on the other nine.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any
  irreversible on-chain write, `git push` or a production deploy, posting to an external
  channel, committing content that names a crypto project other than $THREE, and destroying
  unrecoverable data. This order touches none of them.
- No mocks, no TODO markers, no placeholder descriptions. A `data/pages.json` entry you add
  must carry a real, accurate title and description of the doc's actual content.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or
  `git add .`), re-check `git status` and `git diff --staged` before each commit.
- Before committing, run `npm run check:rules -- --paths <files you touched>` and
  `npm run audit:docs`. Both must exit 0 (or report only pre-existing, unrelated findings).

## Why this matters (measured 2026-10-14)

`npm run audit:docs` reports 10 docs served live at `/docs/<slug>` that no crawler, sitemap,
or `llms.txt` entry can find, because they carry no entry in `data/pages.json` and no entry in
the script's own `UNPUBLISHED_DOCS` exemption list (`scripts/audit-docs.mjs:284`):

```
docs/forge-workflows.md
docs/listings-registry.md
docs/run-receipts-x-reply-and-thread.md
docs/standalone-repo-playbook.md
docs/standalone-repos.md
docs/team-chat.md
docs/ui-lint.md
docs/x-mention-avatar.md
docs/x-partner-series.md
docs/x-reply-playbook.md
```

A doc in this state is the worst of both worlds: it answers 200 to anyone who finds the exact
URL, so it is not actually private, but it is in no sitemap and no nav, so almost nobody does.
Each one needs exactly one of two outcomes: a real `data/pages.json` entry (if it documents a
live, user-facing feature) or an entry in `UNPUBLISHED_DOCS` with the reason (if it is
genuinely internal, a dry-run operator note, or gated behind something not yet live), per the
rule at the top of `scripts/audit-docs.mjs`. This session's own research into each file,
to save the next agent from re-deriving it:

- **`forge-workflows.md`** documents a real, live app route: `/forge/workflows` is already in
  `data/pages.json` (confirmed at `data/pages.json:875`). The doc itself says "Page:
  [/forge/workflows](https://three.ws/forge/workflows)". This is a straightforward miss: add
  the doc page entry alongside the existing app-route entry.
- **`team-chat.md`** is the same shape: `/team-chat` is already a live route in
  `data/pages.json` (confirmed at `data/pages.json:2181`), and the doc documents that feature
  ("Squad chat is the conversational front door to your agents"). Add the doc entry.
- **`run-receipts-x-reply-and-thread.md`** opens with "Nothing here is posted or queued" and
  "Every link to `/runs` needs the next production deploy before it resolves." This is an
  internal drafting note for a not-yet-live X reply, the same category as the existing
  `UNPUBLISHED_DOCS` entries for `x-mention-bot` and `x-mention-image3d`. Add it to
  `UNPUBLISHED_DOCS` with that reason; re-check at publish time whether it should move to
  `data/pages.json` once the run is live.
- **`x-mention-avatar.md`** documents the `avatar` intent of the X mention bot and says
  explicitly "It runs in dry run only... nothing is posted to X until the account goes live."
  This is a sibling of the two X-mention-bot entries already in `UNPUBLISHED_DOCS`
  (`x-mention-bot`, `x-mention-image3d`) that were simply missed when those were added. Add it
  with the same "public once the bot goes live" framing.
- **`x-partner-series.md`** and **`x-reply-playbook.md`** are both internal X content
  operating playbooks (the daily partner spotlight format, and the long-thread-plus-article
  recipe for answering questions), the same category as the existing `UNPUBLISHED_DOCS`
  entries `announcement-coverage`, `announcement-coverage-telegram`, and
  `announcement-factory` ("internal: the marketing machinery that fills the X content queue").
  Add both with an equivalent reason.
- **`ui-lint.md`** documents an internal dev tool (`lintapple`, a design-system QA script run
  against `ui-policy.json`), not a reader-facing product feature. Add it to
  `UNPUBLISHED_DOCS` as internal tooling documentation.
- **`standalone-repo-playbook.md`** is an internal checklist for making a package discoverable
  by humans and LLM crawlers once mirrored out of this monorepo; it is written for whoever
  runs the mirror-promotion work, not for an end user. Add it to `UNPUBLISHED_DOCS` as
  internal.
- **`listings-registry.md`** and **`standalone-repos.md`** are the two genuinely ambiguous
  ones; this session did not find an existing public page that already surfaces either, so
  resolve them fresh:
  - `listings-registry.md` is a generated master index ("Every place three.ws is listed,
    submitted to, or known to be absent from") built by `scripts/listings.mjs` from
    `data/listings.json`, distinct from the prose doc `docs/listings.md` it cross-links.
    Check whether `docs/listings.md` itself is in `data/pages.json`; if it is and is treated as
    the public-facing version, `listings-registry.md` is probably the internal operator
    tracker and belongs in `UNPUBLISHED_DOCS`. If neither is published, decide based on
    whether the content (a registry of submission statuses, some likely showing "absent from")
    is something three.ws wants a competitor or partner reading verbatim; when in doubt,
    `UNPUBLISHED_DOCS` is the safer default and this order's own binding clause says a
    judgment call here is a one-line report note, not a reason to stop.
  - `standalone-repos.md` is a generated catalog ("Every publishable package in this monorepo
    is mirrored to its own repository... so it can be found, starred, installed and cited on
    its own") from `scripts/gen-standalone-catalog.mjs`. This reads as exactly the kind of page
    three.ws wants discoverable (it is marketing the open-source footprint), and `/open-source`
    already exists as a related live page per `data/pages.json:59`. Check whether
    `/open-source` already renders this catalog's content; if it does not, this is the
    strongest "publish it" candidate of the ambiguous pair, since it directly supports the
    existing open-source-credits and open-source-engine docs already live nearby in
    `data/pages.json` (see the entries around lines 496, 852, 869, 909 for the pattern and
    phrasing to match).

## Tasks

1. For `forge-workflows` and `team-chat`: add a doc-page entry to `data/pages.json` using the
   same shape as a neighboring doc entry (title, path `/docs/<slug>`, description written from
   the doc's actual first paragraph, not a placeholder).
2. For `run-receipts-x-reply-and-thread`, `x-mention-avatar`, `x-partner-series`,
   `x-reply-playbook`, `ui-lint`, `standalone-repo-playbook`: add each to `UNPUBLISHED_DOCS`
   in `scripts/audit-docs.mjs` (around line 284) with a one-line reason in the house style of
   the existing entries there.
3. For `listings-registry` and `standalone-repos`: do the research named above (grep
   `data/pages.json` for `/open-source` and `docs/listings.md`, read what each currently
   renders), make the call, and either publish (task 1's shape) or park (task 2's shape).
4. Run `node scripts/build-pages.mjs` or whatever `npm run build:pages` wraps if you touch
   `data/pages.json`, so any derived sitemap/llms.txt artifact regenerates in the same commit
   rather than drifting from the source table.
5. Append one `data/changelog.json` entry covering whichever docs actually got published in
   task 1 and task 3 (not the `UNPUBLISHED_DOCS` ones, since those stay invisible by design).

## Definition of done

- [ ] `npm run audit:docs` no longer lists any of the 10 slugs above under "Public docs missing
      from data/pages.json".
- [ ] Every `data/pages.json` entry added has a real title and a description quoting or
      accurately summarizing the doc's actual content, not a generic placeholder.
- [ ] Every `UNPUBLISHED_DOCS` entry added has a reason in the same one-line house style as its
      neighbors, not just "internal".
- [ ] If `data/pages.json` changed, the derived build output (sitemap/llms.txt, via
      `npm run build:pages`) was regenerated in the same commit.
- [ ] `data/changelog.json` has one new entry for whichever docs were newly published (skip
      this line entirely if every one of the 10 ended up in `UNPUBLISHED_DOCS`, since nothing
      user-visible changed).
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] Explicit-path commit(s).

## Never blocked (pre-answered)

| Blocker | Do this |
|---|---|
| Can't tell if `/open-source` already renders the standalone-repos catalog | Read `src/*.js` or the page template behind `/open-source` (grep `data/pages.json:59`'s neighboring route wiring) directly; if it already shows an equivalent table, `standalone-repos.md` is redundant prose and belongs in `UNPUBLISHED_DOCS` instead of being published a second way. State which you found. |
| `npm run build:pages` doesn't exist under that exact name | Check `package.json` for the actual script name (`grep -n "build:pages\|build:sitemap\|build:llms" package.json`); run whichever one regenerates the artifacts `data/pages.json` feeds. |
| A doc's true intent is still ambiguous after the research above | Default to `UNPUBLISHED_DOCS` (the reversible, lower-risk choice: a doc can be promoted to `data/pages.json` any time with no data loss, while publishing something meant to stay internal is harder to fully undo once crawled). State the call and move on; this is exactly the kind of judgment call the binding clause says goes in one report line, not a stop. |

## Report format

1. The `audit:docs` "Public docs missing" section before and after.
2. A table: slug → outcome (published to `data/pages.json` / parked in `UNPUBLISHED_DOCS`) →
   one-line reason.
3. Whether `data/pages.json`-derived build output was regenerated, and how you verified it.
4. Commit SHA(s).
