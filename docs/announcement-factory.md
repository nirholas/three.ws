# The announcement factory

three.ws has shipped 429 surfaces and posted about roughly 50. The other 322 are not a roadmap,
they are inventory that already works and that nobody outside the repository has ever been told
about. This is the machinery that works that backlog down without a person writing each
announcement from scratch, and without the output reading like 300 posts from one template.

It sits between two things that already existed: the
[announcement ledger](./announcements/README.md), which scores what is worth announcing, and the
[X content pipeline](./x-content-pipeline.md), which publishes a reviewed queue on a human cadence.
The gap between them was the whole job: deciding when each surface goes out, gathering the facts
that make a post checkable, and writing the thing.

```
announce:rank  ->  announce:plan  ->  announce:kit  ->  announce:media  ->  x:content review  ->  approve  ->  cron posts
  what is        when it goes        brief, draft,      the frame from     lint, live facts,     owner      Cloud Scheduler,
  worth it       out, in what        pack, queue        the live route     the AI editor         decides    every 15 minutes
                 shape
```

Nothing in this chain posts. Publishing still requires a passing editorial review and the owner
setting an item's status to `approved`.

---

## The calendar

```bash
npm run announce:rank -- --probe --write   # rebuild the ledger and probe every route
npm run announce:plan                      # print the next 30 slots
npm run announce:plan -- --write           # data/announce-plan/plan.json + CALENDAR.md
npm run announce:plan -- --batch 3         # one week's batch in full
npm run announce:plan -- --hold-gated      # date only what the factory can pack on its own
```

[`scripts/announce-plan.mjs`](../scripts/announce-plan.mjs) turns the ranked backlog into dated
slots. Three things decide the schedule, and all three are read from files that already govern
publishing rather than chosen here:

| Decision | Where it comes from |
|---|---|
| How many posts a day, at what times, and which tier owns each one | The `cadence.slots` table of [`data/x-content/queue.json`](../data/x-content/queue.json), which is the same table the publisher fills from: T3 at 04:00 UTC, T2 at 12:00, T1 at 20:00. With no table declared, the times are derived from the daily cap, minimum gap and quiet hours instead, and a slot whose jitter window could land inside quiet hours is dropped rather than promised. |
| What order, and which shape | The ledger's scores, then rotation: no more than `maximumSameLaneInARow` of one audience, no more than `maximumSamePatternInARow` of one post shape, from the same queue file. |
| Which tier a surface is | What it is: a flagship (T1) is a `token`-lane surface or one that legitimately names a partner, proof of work (T3) is a package, worker or service, whose frame is a typeset card rather than a route, and everything with a page behind it is a feature (T2). The tier travels into the queue item, because the publisher gives each tier a slot of its own and an item with no tier is treated as a T2 feature. |
| Which one jumps the queue | [`data/announce-priority.json`](../data/announce-priority.json), the mirror image of the deferrals. A surface listed there enters the sequencer ahead of the backlog and takes the earliest slot its own tier owns, with the reason recorded beside it. The pin buys position only: the cadence, the tier discipline and the lane and shape rotation are unchanged, and the pack still goes through review and approval like any other. |
| Which ones need owner approval first | Any surface in the `crypto` section of [`data/pages.json`](../data/pages.json) renders live third-party market data, so a frame of it falls under the operating rules' coin gate. Those slots carry `mediaGate: "owner-approval"` and the factory skips them unless asked. |

The plan is a pure function of the ledger and the start date, so it is regenerated rather than
maintained. A surface already queued, already carrying a pack, or listed in
[`data/announce-deferred.json`](../data/announce-deferred.json) is dropped from it.

**Gated surfaces are held out of the dated calendar.** `--hold-gated` (which `announce:kit` passes
for you unless you ask for `--include-gated`) lifts every owner-gated surface out of the schedule
and lists it in a "Held for owner approval" table in `CALENDAR.md` instead. Dating them promises
slots the factory cannot fill on its own, and because the gated surfaces score highest they take
the flagship slot every day, which is how the packable backlog ended up weeks behind slots it
could have had. Clearing a frame puts that surface back in the next plan.

**Deferrals.** The ledger is rebuilt from the repository on every run, so it cannot remember a
judgement someone made by looking at a captured frame. `data/announce-deferred.json` is where that
judgement lives, with the reason, and it is committed for exactly that reason.

**Pins.** The same problem in the other direction: the ledger scores a surface on what it can
measure from a description, a route and a directory, so a surface can be worth posting this week
and still sit ninety slots down the calendar. `data/announce-priority.json` records that
judgement, and `CALENDAR.md` prints the pinned surfaces and their reasons in an "Asked for next"
table. Remove the entry once the surface is packed, since a packed surface leaves the plan anyway.

**What counts as a surface.** The inventory is re-derived from `data/pages.json`, `packages/*`,
`workers/*` and `services/*` on every run. Most of `data/pages.json` is content: the `learn`
section alone holds 436 documentation and tutorial pages, and announcing each one would drown the
features. The five pages in there that carry `showcase: true` are products rather than documents
(`/awesome`, `/3d`, `/crypto`, `/crypto-api`, `/docs/world`), so `showcase` is the admission rule:
a content page carrying it is inventory, a content page without it is content. Two of those five
render live third-party market data, which is why the coin gate matches the `/crypto` path
namespace and not only the `crypto` section.

## Lanes and patterns

`lane` is the audience and comes from where the surface lives: `token` for the crypto section,
`labs` for the labs section, `developer` for build, agent tools, machine, packages, workers and
services, `community` for the rest.

`pattern` is the shape of the post, and each surface offers a ranked list so the sequencer can
change shape without changing which surface is next:

| Pattern | When it is offered | What the drafter is told |
|---|---|---|
| `clip` | The surface has a route and something moves on it | The media is a loop. Write what the loop cannot say. |
| `number` | Its own description carries a measured number | Lead with the number and what it counts. |
| `correction` | Its description contradicts an assumption a reader would hold | Lead with the assumption, then the fact that replaces it. |
| `walkthrough` | Any surface a visitor can act on | Lead with the first move and what comes back. |
| `mechanism` | Always available, and the default | Lead with how the thing works. |

A package, a worker, or a service is never offered `clip`: a loop has to be a loop of something
running, and those have no route.

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
A surface with no route (115 of the 316 planned announcements are a package, a worker, or a
service) gets a title card instead: [`api/_lib/announce/card.js`](../api/_lib/announce/card.js)
typesets its real name, its real description, the command a developer really runs, and the tools it
really exposes, in the site's own fonts, and the same capture engine renders it. A post with no
image measured 0.875x against the account median, so "this one ships without an image" is not an
option.

**3. The draft** ([`api/_lib/announce/draft.js`](../api/_lib/announce/draft.js)) is written by the
model chain (Claude on Vertex AI, then OpenRouter, OpenAI, NVIDIA NIM) from the brief and nothing
else. It is then held against every gate the queue enforces: the voice lint, the editorial lint,
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

## What the model is not allowed to do

| Rule | Enforced by |
|---|---|
| Invent a fact | The drafter sees only the brief, and every claim must cite one of its `evidenceCandidates`, copied exactly |
| Invent evidence | `draftFindings` rejects any evidence object that is not one of the candidates |
| State a number with nothing behind it | `claimProblems`: every number, ordinal and absolute must sit inside a declared claim |
| Ship a post with nothing proving the feature works | Every item declares at least one probe in `probes`, drawn from the routes and endpoints in the brief, and review runs them live |
| Tag an account the feature does not run on | Every `@mention` needs a recorded reason, and the reviewer confirms the account is real and public |
| Write hype, a hashtag, an emoji, a dash, a teaser, or a rhetorical opener | `copyProblems` and `languageProblems` |
| Repeat something @trythreews already posted | Similarity against the scraped archive and the rest of the queue |
| Describe an image that does not show what it says | The AI editor, which sees the frame and the alt text |

## Finishing a batch

```bash
npm run check:announce                          # media, alt text, length, voice, uniqueness, the coin gate
npm run x:content -- review --status review     # lint, live fact checks, the AI editor, recorded per item
npm run x:content -- run --dry-run --id <id>    # the exact calls that would go to X
npm run x:content -- approve --status review    # the owner gate, for the whole batch
```

`approve` is the only step that is the owner's, and it is a gate rather than a switch: it moves an
item to `approved` only while a passing review record covers the exact bytes in the queue right
now, and prints why it is holding anything it refuses. After that the Cloud Scheduler tick
(`/api/cron/x-content`, every 15 minutes) sends each item at its slot, re-checks every link first,
and records what it sent.

So a week of announcements is four commands:

```bash
npm run announce:kit -- --batch 2 --capture
npm run check:announce
npm run x:content -- review --status review
npm run x:content -- approve --status review
```

## The schedule is public, the timing is not

This repository is public, so the queue is public: anyone can read which surface is announced on
which day, and read the copy before it goes out. That is tolerable for what this backlog contains,
because every one of these surfaces already shipped and is already live on three.ws. There is no
unreleased information in a pack. What is worth protecting is the *moment*, which is what lets
somebody camp a post, reply-farm it, pre-empt it, or trade the attention spike around a token-lane
announcement.

Until 2026-09-17 the moment was public too. The jitter was `sha256(item id)`, and the id is in the
committed queue, so the exact minute of every queued post was computable by anyone, days ahead.

It now comes from `X_CONTENT_SCHEDULE_SEED`, an HMAC key that lives only in the production
environment:

| Knowable from the repository | Decided by the seed |
|---|---|
| The day an item is eligible | The minute inside its window |
| That the account posts up to three times a day in a handful of anchor windows | Which of the day's items takes which anchor, and therefore the order |

The seed keeps every property the cron needs: stable per item, so a preview, a retry and the real
tick all agree, and a half-sent thread resumes at the same moment it was going to use. With no seed
configured the behaviour is exactly what it always was, so local previews and the tests are
unaffected; `npm run x:content -- plan` says out loud when it is printing unseeded placeholder
times rather than the real schedule.

```bash
# Generate one and put it on the service (once):
openssl rand -hex 32
gcloud run services update three-ws-api --region us-central1 --update-env-vars X_CONTENT_SCHEDULE_SEED=<value>
```

Rotating the seed reshuffles every unpublished item's minute and order, which is a reasonable thing
to do and costs nothing. It does not move anything to a different day.

**What this does not hide** is the copy itself. If an announcement is genuinely market-moving
(a launch, a partnership, a listing), it should not sit in a public queue for a week beforehand
whatever the timing defence says: post it from a pack that is written and committed the same day,
or hold it out of this pipeline entirely.

## Credentials

The factory needs a model for the drafting step and the editorial review. It uses the shared chain
in [`api/_lib/x-content/llm.js`](../api/_lib/x-content/llm.js): Claude on Vertex AI first (the
standing Google Cloud approval), then `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `NVIDIA_API_KEY`.
On a workstation, `gcloud auth application-default login` is enough. Everything else (ranking,
planning, briefs, media capture, packing, the whole gate) runs with no model at all:
`npm run announce:kit -- --brief-only` is the offline half.

`X_CONTENT_SCHEDULE_SEED` is separate and belongs on the Cloud Run service, not in a checkout: see
the section above.

## Where things live

| Path | Role |
|---|---|
| [scripts/announce-plan.mjs](../scripts/announce-plan.mjs) | The calendar |
| [scripts/announce-kit.mjs](../scripts/announce-kit.mjs) | The factory |
| [api/_lib/announce/plan.js](../api/_lib/announce/plan.js) | Slot times, lanes, patterns, rotation |
| [api/_lib/announce/ledger.js](../api/_lib/announce/ledger.js) | Ledger, backlog, deferrals, plan persistence |
| [api/_lib/announce/brief.js](../api/_lib/announce/brief.js) | Evidence gathering |
| [api/_lib/announce/draft.js](../api/_lib/announce/draft.js) | Drafting and the rejection rules |
| [api/_lib/announce/card.js](../api/_lib/announce/card.js) | Title cards for surfaces with no route |
| [api/_lib/announce/kit.js](../api/_lib/announce/kit.js) | Pack rendering |
| [api/_lib/x-content/llm.js](../api/_lib/x-content/llm.js) | The model chain, shared with the editor |
| `data/announce-plan/` | Generated: the plan, the calendar, briefs, hand-written drafts |
| [data/announce-deferred.json](../data/announce-deferred.json) | Surfaces held back, with the reason |
| [data/announce-priority.json](../data/announce-priority.json) | Surfaces asked for next, with the reason |
| [docs/announcements/](./announcements/) | The packs themselves |
| [tests/announce-factory.test.js](../tests/announce-factory.test.js) | The rules above, as tests |
