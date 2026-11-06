# Clear every X content queue validator error and refilm the stale approved posts, stopping before approve

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/749-plan-x-content-queue-clear-validator-errors.md`.

**Priority:** P2, new capability with clear value (score 44 of 100 inside the tier). **Area:** x-content. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

The announcement factory (`npm run announce:kit`) and the X content pipeline (`data/x-content/queue.json`) are built and enforce strict gates, but the queue itself is stuck. As of 2026-11-03 `npm run x:content -- check` reports 25 problems: nine items already at `approved` or `review` have proof reels older than 20 days and reviews older than 20 days (the pipeline refuses to publish stale proof because "the product moves"), one proof run is failing live (`render-lab-sheet` at step 11, a 45 s `locator.waitFor` timeout expecting 24 renders at 256px, which may be a real production defect), and six items are stuck at `draft` with concrete schema or claim errors. The backlog the factory was built for is large (the docs count about 300 shipped surfaces never announced), so a queue that cannot release anything wastes the whole machine. Posting stays owner-gated; this order gets everything to the owner's approve step.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `data/x-content/queue.json`: 79 items. Status counts: posted 47, review 16, approved 9, draft 6, paused 1 (`intel-globe`, deliberately held for the owner; leave it paused).
- `npm run check:announce` reports "18 pack(s) OK". `data/announce-plan/` does not exist (generated), and `data/announcements.json` is missing, so `npm run announce:plan` fails with "Build it first: npm run announce:rank -- --probe --write".
- Validator output, grouped:
  - Stale proof and review (error): `restyle-presets`, `avatar-embed-moves`, `changelog-feed`, `concierge-ask`, `docs-freshness`, `parts-studio`, `platform-analytics`, `render-lab-call`.
  - `genesis`: the copy, media or claims changed after the last review (re-review).
  - `render-lab-sheet`: last proof run failed at step 11 (expect 24 live renders at 256px), `locator.waitFor` timeout 45000 ms.
  - Claims not quoting the copy: `holo-material-article` (two claims plus an unflagged absolute "Every"), `any-skeleton-article` (three claims), `embed-article` (unverified number "2").
  - Drafts: `three-hold-article` (unverified numbers and absolutes), `three-split` (claims "undefined" and unverified numbers), `grok-bot-recipes` (head post has no media), `skill-md` (covers must list backlog keys; more than one all-caps word in the head), `studio-jobs` (media must be a list of `{ path, alt }`, not `reel`), `agents-board-article`, `voice-article`.
- Pipeline docs: `docs/x-content-pipeline.md` (commands: `check`, `plan`, `scout`, `prove`, `review`, `remix`, `advance`, `pause`, `approve`, `run`), `docs/x-story-authoring.md`, `api/_lib/x-content/{quality,verify,reel,review,queue}.js`.
- `approve`, `run`, `advance --ship` and the `/api/cron/x-content` tick are the owner gate: they publish to X.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
npm run -s x:content -- check 2>&1 | grep -v '^note' | sort | uniq -c | sort -rn | head -60
python3 - <<'PY'
import json,collections
q=json.load(open('data/x-content/queue.json'))
items=q['items'] if isinstance(q,dict) and 'items' in q else q
print(collections.Counter(i.get('status') for i in items))
PY
npm run -s check:announce
curl -s https://three.ws/render-lab -o /dev/null -w '%{http_code}\n'
npx playwright --version; which ffmpeg
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Triage `render-lab-sheet` first because it may be a product defect, not a content defect. Run `npm run x:content -- prove render-lab-sheet` with a headed or traced browser (or `scout https://three.ws/render-lab`), find why 24 renders at 256px do not appear in 45 s (lane cold start, a selector change, a real failure of `src/render-lab.js`). If the page is broken, write a failing test beside the module's tests, fix it, rerun the proof. If only the scenario is stale, update the scenario in the queue item.
2. For every stale-proof item, rerun `npm run x:content -- prove <id>` (films against production, writes `data/x-content/proofs/<id>.json` and `public/x-media/<id>/reel.mp4`) then `npm run x:content -- review <id>` (lint, live fact checks, AI editor). If a live fact no longer holds, fix the copy and claims to what production now shows rather than bypassing the check. Rebuild derived heads with `npm run x:content -- remix <id>` where the item has a `head`.
3. Fix the claim errors by editing the item (never by loosening `quality.js` or `verify.js`): each claim must quote the post text exactly, each number and absolute in the copy must be declared in `claims` with evidence drawn from the brief (`npm run announce:kit -- --id <id> --brief-only` prints the real `evidenceCandidates`), or be cut from the copy. For the draft items: attach real media as `{ path, alt }` entries (capture with `npm run announce:media` or `npm run x:content -- prove`), fix `skill-md` covers to real backlog keys from `data/announce-plan` (build it with Step 0 rank command), remove the extra all-caps word, and decide per item whether it ships (move to `review`) or stays `draft` with a one-line `note` explaining what is missing.
4. Rebuild the announcement backlog so the next batch is ready: run `npm run announce:rank -- --probe --write`, `npm run announce:plan`, then `npm run announce:kit -- --batch 2 --capture` (needs a model: `gcloud auth application-default login` is enough; with none, use `--brief-only` and hand-written drafts at `data/announce-plan/drafts/<id>.json`). Run `npm run check:announce` and `npm run x:content -- review --status review` on the result.
5. Add a regression test beside `tests/x-content.test.js` that fails when the committed queue has any `review`/`approved` item with a stale proof or review older than the configured freshness window, using the queue's own validator (so a future stale item is caught by `npm test`, not discovered at publish time). If the freshness window logic makes that flaky in CI, assert on item shape instead and document why.
6. Update `docs/x-content-pipeline.md` with the "stale proof" recovery recipe you used, and add a `data/changelog.json` entry only if a user-visible production fix landed (task 1).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run -s x:content -- check` exits 0 with no `error` lines for `review` or `approved` items, and every remaining `draft` has a `note` naming what is missing.
- [ ] `npm run check:announce` passes, and `data/x-content/proofs/<id>.json` shows a run from today for every item that was stale.
- [ ] `npx vitest run tests/x-content.test.js tests/announce-factory.test.js` passes.
- [ ] No item moved to `approved` by this order and nothing posted: `git diff data/x-content/queue.json | grep '"status": "approved"'` shows no newly approved items; `intel-globe` is still `paused`.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No model credentials for drafting or the AI editor | Chain is Vertex Claude, Groq, OpenRouter, OpenAI, NVIDIA (`api/_lib/x-content/llm.js`). Use `gcloud auth application-default login` (approved GCP credits). Without any, run `--brief-only` and write drafts by hand; review's lint and live checks run with no model. |
| No headless browser or ffmpeg for proof reels | `npx playwright install chromium`; install ffmpeg from the OS package manager. Reels film against production with plain GETs. |
| A post's feature is genuinely broken on production | Fix the product (test first) or drop the item to `draft` with a note. Never film around a defect. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Publishing is the owner's step: `npm run x:content -- approve`, `run`, `advance --ship` and the cron tick post to X (external channel). This order must stop before any of them and list the ready item ids in the final report. Any item whose copy names a crypto project other than $THREE needs owner approval before it is committed.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/749-plan-x-content-queue-clear-validator-errors.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `749-plan-x-content-queue-clear-validator-errors.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/announcement-factory.md` (section "Finishing a batch")

~~~~markdown
## Finishing a batch

```bash
npm run check:announce                          # media, alt text, length, voice, uniqueness, the coin gate
npm run x:content -- review --status review     # lint, live fact checks, the AI editor, recorded per item
npm run x:content -- run --dry-run --id <id>    # the exact calls that would go to X
npm run x:content -- approve --status review    # the owner gate, for the whole batch
```

`approve` is the owner's step, and it is a gate rather than a switch: it moves an item to
`approved` only while a passing review record covers the exact bytes in the queue right now, and
prints why it is holding anything it refuses. The queue's approval policy can also release a post
itself, but only one that was filmed against the product, tags no one, sits in a listed tier and
passed on the editor's own verdict, and only after a veto window in which
`npm run x:content -- pause <id>` takes it back; `npm run x:content -- advance --ship` runs the
whole line (film, review, policy release, publish) and says what stopped anything it held. After
that the Cloud Scheduler tick (`/api/cron/x-content`, every 15 minutes) sends each item at its slot,
re-checks every link first, and records what it sent. An approved post reaches production either
with the next deploy or, with bundles enabled, straight away
(see [Publishing without a deploy](./x-content-pipeline.md#publishing-without-a-deploy)).

So a week of announcements is four commands:

```bash
npm run announce:kit -- --batch 2 --capture
npm run check:announce
npm run x:content -- review --status review
npm run x:content -- approve --status review
```
~~~~

### `docs/announcement-factory.md` (section "The factory")

~~~~markdown
## The factory

```bash
npm run announce:kit -- --count 3          # the next three planned slots
npm run announce:kit -- --batch 2          # a whole week
npm run announce:kit -- --id labor-market  # one surface
npm run announce:kit -- --brief-only       # gather facts, call no model
npm run announce:kit -- --capture          # also shoot the frames
npm run announce:kit -- --include-gated    # include owner-gated media
npm run announce:kit -- --dry-run          # write nothing
```

[`scripts/announce-kit.mjs`](../scripts/announce-kit.mjs) runs five steps per slot.

**1. The brief** ([`api/_lib/announce/brief.js`](../api/_lib/announce/brief.js)) gathers every
checkable fact about the surface: the rendered text of the live route, the changelog entries that
mention it, its docs, and its README. It emits `evidenceCandidates`, each one a check the verifier
can already run (`page` contains this sentence, `file` contains this line). Two rules make those
candidates trustworthy rather than decorative: a page fact must be a whole sentence of the rendered
page, and a file fact must be a literal substring of the file on disk, because that is what
[`verify.js`](../api/_lib/x-content/verify.js) matches against. Facts are harvested from the
page's `main` element rather than the whole body, so a claim never comes out of the header menu
that sits above every page's own first word. The counters a page leads with are collected
separately, because a tile (`ENTRIES 152`) and a summary line (`152 entries across 15 sections`)
are not sentences and the whole-sentence rule would drop exactly the fact the `number` pattern
exists to lead on. Sentences carrying a banned dash
glyph are dropped rather than rewritten, since the quote has to match character for character.

**2. The media recipe** goes into [`data/announce-media.json`](../data/announce-media.json), and
`npm run announce:media` shoots it from the live route with provenance written beside the pixels.
A recipe can ask for a five second loop, but the capture has the last word: it takes two frames a
second apart, and when they are identical it writes the still and records `animated: false` in the
manifest. Nothing upstream can make that call, because the description of a page about motion
generation reads exactly like the description of a page that moves.
A hand-authored pack can ship a committed card instead of a captured shot, declared on its queue
item as `posts[].media[]` with its own alt text. `npm run check:announce` accepts either source and
still fails a pack whose image carries no alt text, because that is the artifact the publisher
actually sends.

A surface with no route (115 of the 316 planned announcements are a package, a worker, or a
service) gets a title card instead: [`api/_lib/announce/card.js`](../api/_lib/announce/card.js)
typesets its real name, its real description, the command a developer really runs, and the tools it
really exposes, in the site's own fonts, and the same capture engine renders it. A post with no
image measured 0.875x against the account median, so "this one ships without an image" is not an
option.

**3. The draft** ([`api/_lib/announce/draft.js`](../api/_lib/announce/draft.js)) is written by the
model chain (Claude on Vertex AI, then gpt-oss-120b on Groq, Claude through OpenRouter, OpenAI,
NVIDIA NIM) from the brief and nothing else. The prompt keeps a floor of 100 characters and the
queue's `maximumLength` as the wall, and tells the model that the first 280 characters are what a
reader sees rather than steering it into a short band. It is then held against every gate the queue enforces: the voice lint, the editorial lint,
the claims ledger, the evidence list, and the account's own archive. Findings are handed back to
the model verbatim and it writes again, up to three attempts. A draft that still fails is written
to `data/announce-plan/drafts/<id>.rejected.json` instead of into the queue.

**Writing one by hand.** Drop a file at `data/announce-plan/drafts/<id>.json` in the same shape the
model returns (`post`, `thread`, `telegram`, `alt`, `claims`, `mentions`, `why`, `headline`) and the
factory prefers it, running it through exactly the same checks. `--redraft` ignores it.

**4. The pack** is `docs/announcements/<id>.md` plus `<id>.post.txt`, the format
`npm run check:announce` gates and a human approves from: the slot, the lane, the audience, the
tracked links, the claim table with its evidence, the media and its alt text, the post, the reason
it is written that way, and the longer Telegram register.

**5. The queue item** goes into [`data/x-content/queue.json`](../data/x-content/queue.json), with
`textFrom` pointing at the pack's `.post.txt`, so the bytes that were reviewed are the bytes that
ship. It carries the slot's tier, because the publisher gives each tier a slot of its own, and the
draft's feature probes, because the review bar refuses an item that cannot prove its feature works. It lands at `review` when the queue validator finds nothing wrong with it and at `draft` when
something is still missing, which is almost always the frame: capture it, re-run the same command,
and it moves up. The status is the validator's verdict, not the factory's opinion.
~~~~

### `docs/announce-voice.md` (whole file)

~~~~markdown
# The announcement voice

**Status:** the contract every post in the queue is written and reviewed against, and the file
the AI editor is handed with each one. **Last measured against the live account:** 2026-09-29.

three.ws has shipped more than 400 surfaces and posted about roughly 60 of them. The backlog is
inventory, not a roadmap, and working it down means writing a lot of announcements. The failure
mode that threatens is not running out of features. It is that 300 posts written quickly all start
to sound like the same machine wrote them, and an audience that smells a template stops reading the
ones that matter.

## Where the numbers come from

The X API, read for the account's own head posts, by the learning loop in
[`api/_lib/x-content/outcomes.js`](../api/_lib/x-content/outcomes.js). Run
`npm run x:outcomes -- --refresh` and it prints the table these rules were taken from, measured
again today, so a claim here can be re-checked rather than believed. The queue ranks with the same
table on every tick.

An earlier version of this file was derived from a scrape
([`data/x-archive/trythreews-2026-08-14.json`](../data/x-archive/trythreews-2026-08-14.json)).
That scrape was taken before X had loaded the like counts of the account's largest posts, so 56 of
214 posts were dropped as having no likes, the three strongest posts among them. Two of the rules it
produced were the wrong way round, and both are corrected below.

## What the numbers actually say

Median likes of head posts published from 2026-08-10 to 2026-09-28 (53 posts; replies inside a
thread are not counted as posts):

| Signal | Median likes | Posts | What it means for a draft |
|---|---|---|---|
| Video | **149** | 14 | The strongest format, and the one people save: 11 bookmarks a post against 4 for a photo. Film the feature. |
| Photo | 101 | 25 | A still is the fallback when a feature has nothing that moves. |
| No media | 80 | 14 | The floor. |
| Over 280 characters | **140** | 21 | Say the whole thing. The account is on X Premium, and its long posts do about twice the rest. |
| 180 to 280 characters | 76 | 16 | |
| 100 to 179 characters | 75 | 7 | The band the old contract aimed every post at. It measures no better than the one above it. |
| Under 100 characters | 55 | 9 | A one-liner is missing the mechanism. |
| Tags one account | **134** | 17 | Tag the partner a feature really runs on. Never tag one it does not. |
| Tags no one | 75 | 25 | |
| A thread | 133 | 34 | The head states the point; the replies carry the detail and the link. |
| A single post | 80 | 19 | |
| Media and no link in the head | 173 | 9 | A link in the head measured about a third less reach (9,574 impressions against 6,035). Nine posts is a small sample, so the queue alternates and keeps measuring. |
| Media and a three.ws link in the head | 121 | 29 | |

These overlap: a partner announcement is usually long, filmed, and tagged. Read them as direction,
not as multipliers to stack.

One comparison matters more than the rest. In September the posts this pipeline wrote had a median
of 63 likes and 2,851 impressions, and the posts written by hand had 112 and 5,386. The pipeline's
posts were short, still, and linked in the head. That gap is what this contract exists to close.

## The five rules

1. **Film the feature.** A post's media is a reel of the feature being used, made by
   `npm run x:content -- prove <id>` from the scenario the post carries. The reel is a passing
   end-to-end run against production, so it cannot show anything the product did not do. A feature
   with nothing to film gets a frame of the real product from `npm run announce:media`. Nothing
   ships with a stock graphic, and nothing ships with no media.
2. **Write until the reader could use it.** 100 characters is the floor: under it a draft says
   that a thing exists and not how it works. There is no target ceiling. The wall is the queue's
   `quality.maximumLength`. The first 280 characters are all a reader sees before "Show more", so
   the strongest true statement goes first and the post has to stand on those 280 alone.
3. **Every claim is checkable, and checked against the product.** Every number and every absolute
   (first, only, every, never) sits inside a claim with evidence. The strongest evidence is the
   run itself: a number the scenario read off the screen, a text it waited for, or an answer it got
   from the server. If the run did not see it, the post does not say it.
4. **Tag only what is true.** `@solana` when it settles on Solana. `@IBM` when it runs on
   watsonx. A tag we cannot defend costs more than it is worth, and a post that tags anyone is
   approved by a person, never by policy.
5. **Link the surface, once.** One link, to the page the post is about. It may sit in the head or
   in the first reply; the queue measures both.

## House choices

These are decisions, not measurements, and the gate enforces each one:

- **No hashtags.**
- **No emoji.** The account's hand-written posts do use them, and the data cannot separate their
  effect from the partner news they usually sit in. The queue leaves them out so that a run of
  scheduled posts never reads as decorated.
- **No em-dashes or en-dashes.** Use a period, a comma, a colon, or parentheses.
- **No launch-deck openers.** "Introducing" opened one post in 214.

## Banned openings

These are the tells that make a post read as generated. None of them appear in our best posts and
the gate rejects all of them:

> Introducing. We're excited to announce. We're thrilled. Say hello to. Meet the new. Big news.
> Today we're launching. Ever wondered. What if you could. Imagine a world where. Game-changer.
> Revolutionary. Seamless. Unlock the power of. Take your X to the next level. The future of X is
> here. And the best part? Let that sink in. Here's the kicker.

Also banned as structure, not just as phrases:

- **The rhetorical-question opener.** "What if your agent could trade for you?" Just say what it does.
- **The one-word-sentence drumbeat.** "Fast. Simple. On-chain." It reads as copywriting, and this
  audience discounts copywriting.
- **The thread that withholds.** Do not make the first post a teaser for the second. Lead with the
  strongest true statement.
- **Adjective stacking.** "A powerful, seamless, next-generation platform." Cut every adjective
  that a reader could not disagree with.

## What to write instead

Open with the mechanism or the number. The strongest posts in the archive do exactly this: they
state a specific, surprising, checkable fact in the first line and let the reader decide it is
impressive.

Three patterns for the opening, which is the part a reader sees before "Show more":

**The number lead.** Open on a figure the run read off the screen.

> Seven autonomous agents have scored 832,142 pump.fun launches on three.ws. 86% win rate on the
> top one. Every trade on the floor is live: three.ws/activity

**The mechanism lead.** Open on how it works, because the how is the interesting part.

> A sentence or a selfie becomes a rigged 3D agent holding its own custodial @solana wallet, a
> persona, and a voice. It walks and emotes on arrival: three.ws/genesis

**The correction lead**, for a feature that contradicts an assumption the reader holds.

> Most "AI agent wallets" are a key in someone's env file. Guardian makes an agent wallet
> recoverable and inheritable: name a guardian, set the timelock, and the wallet survives the
> agent. three.ws/guardian

## Uniqueness, enforced

Announcing 300 features means 300 posts that must not blur together. Two mechanical checks in
`npm run check:announce`:

- **No opening clause is reused.** The first eight words of every pack are compared against every
  other pack. A repeat fails.
- **No pack reuses another pack's lead structure twice in a row.** The pattern (number lead,
  mechanism lead, correction lead) rotates.

Neither check can make a post good. Both stop the corpus from converging on one shape, which is
what makes a run of announcements read as automated.

## The pack

One file per feature in `docs/announcements/<slug>.md`, holding everything a post needs and
nothing it does not. See [`genesis.md`](./announcements/genesis.md) for the worked example. Every
pack carries:

- **The claim**, and the evidence for it, with a link to where it can be checked.
- **The post**, in this voice.
- **The media**, by shot id from [`data/announce-media.json`](../data/announce-media.json), with
  its alt text. Alt text is a requirement, not a courtesy: a post whose whole payload is an image
  is unreadable to a screen reader without it.
- **The Telegram variant.** The community channel takes plain text and a different register: more
  detail, no character ceiling worth worrying about, no tagging.
- **The changelog entry**, ready to paste into `data/changelog.json`.
- **Its state**, mirrored in `data/announcements.json` (generated by `npm run announce:rank`, so it is gitignored; run that first if you do not have it).

## What this file does not decide

Who releases a post. That is the queue's `approval` setting, described in
[the pipeline doc](./x-content-pipeline.md#who-approves-a-post): the owner, or the policy for posts
that were filmed, tag no one, and passed review on the editor's own verdict.
~~~~

