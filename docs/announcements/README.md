# Announcement packs

One file per feature we are announcing, plus the exact bytes that get posted.

As of the 2026-08-09 scrape, three.ws had 409 inventoried surfaces, 47 announced on their own, 77 mentioned in
passing and 285 never announced. The never-announced ones are not a roadmap, they are inventory that
already works, and the historical audit that established this lives in
[announcement-coverage.md](../announcement-coverage.md). Working that backlog down is what this
directory is for.

**Which pack to make next** is not decided in this directory. Use the
[marketing command center](../../marketing/growth/README.md) for the scheduled campaign, owner, audience,
call to action, and measurement plan. Run `npm run announce:rank -- --probe` when the current repository inventory needs
to be re-scored, then build the selected evidence pack here.

## How a pack gets made

```bash
npm run announce:rank -- --probe --write   # what to announce next, and why
npm run announce:plan                      # when each one goes out, in what shape
npm run announce:kit -- --count 3 --capture   # brief, frame, draft, pack, queue item
npm run check:announce                     # gate the pack before anyone reads it
```

`announce:plan` and `announce:kit` are the [announcement factory](../announcement-factory.md),
which does steps 1 to 4 below for a whole batch at a time: it gathers the checkable facts, shoots
the frame (or typesets a title card for a surface with no route), has the model chain draft the
post from those facts alone, holds the draft against every gate the queue enforces, and writes the
pack plus its queue item. A pack written by hand is still a pack: drop the draft at
`data/announce-plan/drafts/<id>.json` and the factory runs it through the same checks.

The steps below are what each of those stages does, and they are worth reading before trusting the
output of any of them.

1. **Rank.** [`scripts/announce-rank.mjs`](../../scripts/announce-rank.mjs) re-derives the
   inventory from `data/pages.json`, `packages/`, `workers/` and `services/`, reads the announced
   status out of the coverage audit, probes each route, scores what is left, and writes
   `data/announcements.json`. That ledger is generated, not committed, so this is the
   command that creates it. The score's weights come from the
   engagement archive, not from taste; the sources are named in
   [announce-voice.md](../announce-voice.md).
2. **Capture.** Add a shot to [`data/announce-media.json`](../../data/announce-media.json) and run
   `npm run announce:media`. It drives the real route in a real Chromium and writes to
   `public/announce/img/` with provenance (route, commit, time, sha256) beside the pixels. Shots
   marked `auth` sign in with the QA account so the frame shows the working product rather than
   its sign-in gate. A pack written by hand may instead ship a committed card, declared on its
   queue item as `posts[].media[]` with alt text; the gate accepts either, and neither may go out
   without alt text.
3. **Write.** One `<slug>.md` pack and one `<slug>.post.txt` holding the post itself. The `.txt`
   exists so the bytes the gate checks are the bytes `post-tweet.mjs` sends; a post quoted only
   in prose drifts from the file that ships.
4. **Gate.** `npm run check:announce` enforces media, alt text, length, voice, cross-pack
   uniqueness, and the coin gate.

**Ranking is a hypothesis; the capture is the test.** Two of the first batch's highest-scoring
surfaces were deferred once their frames were looked at: `/genome` sells an empty stud market and
`/portfolio` is an address input with nothing in it. The reasons are recorded on their entries in
the ledger, which is why the capture step comes before the writing step.

## The coin gate

A frame captured from a live trading surface bakes whatever tickers were on screen into a
committed file, and the operating rules require owner approval before committing anything that
references a crypto project other than `$THREE`. `check:announce` fails such a pack, and the
affected files are kept out of the tree by `.gitignore` until approval is recorded on the shot as
`thirdPartyMarketDataApproved`.

## Posting

Nothing here posts. Publishing to an external channel is owner-gated every time. A finished pack
becomes an item in the [X content queue](../x-content-pipeline.md): its post names the pack file in
`textFrom`, so `npm run x:content:check` fails if the queued text drifts from the reviewed bytes,
and its media points at the captured frame. Preview exactly what would be sent:

```bash
npm run x:content -- run --dry-run --id <slug>
```

The queue publishes an item only after the owner sets it to `approved`. For a one-off post outside
the queue, `node scripts/post-tweet.mjs --file docs/announcements/<slug>.post.txt --dry-run` still works.

## Packs

The `Stage` and `Announced externally` lines inside each pack are written by `announce:kit` at drafting time and are
not updated when the post goes out. The queue item's `status` in
[`data/x-content/queue.json`](../../data/x-content/queue.json) is the source of truth for what shipped, and
this table mirrors it.

| Pack | Surface | Queue status |
|---|---|---|
| [activity-mcp.md](./activity-mcp.md) | `@three-ws/activity-mcp` | posted (slot 2026-09-21) |
| [assistant.md](./assistant.md) | [`/assistant`](https://three.ws/assistant) | posted (slot 2026-09-22) |
| [avatar-mcp.md](./avatar-mcp.md) | `@three-ws/avatar-mcp` | posted (slot 2026-09-21) |
| [awesome.md](./awesome.md) | [`/awesome`](https://three.ws/awesome) | posted 2026-10-12 as queue item `awesome`, with copy rewritten after this pack |
| [aws-builder-center-authorization-spine.md](./aws-builder-center-authorization-spine.md) | AWS Builder Center article | posted (sent by hand 2026-09-10, queue item `aws-authorization-spine` retired as posted) |
| [data-desk.md](./data-desk.md) | [`/data-desk`](https://three.ws/data-desk) | drafted, no queue item yet |
| [forge-max.md](./forge-max.md) | [`/forge-max`](https://three.ws/forge-max) | posted (slot 2026-09-18) |
| [forged.md](./forged.md) | [`/forged`](https://three.ws/forged) | drafted, no queue item yet |
| [galaxy.md](./galaxy.md) | [`/galaxy`](https://three.ws/galaxy) | posted (slot 2026-09-22) |
| [genesis.md](./genesis.md) | [`/genesis`](https://three.ws/genesis) | withdrawn 2026-11-04: Genesis had already been posted several times |
| [knock.md](./knock.md) | [`/knock`](https://three.ws/knock) | posted (by hand 2026-09-21) |
| [materialize.md](./materialize.md) | [`/materialize`](https://three.ws/materialize) | posted (slot 2026-09-19) |
| [open-source-friday.md](./open-source-friday.md) | [`/rig-doctor`](https://three.ws/rig-doctor) | posted (queue item `rig-doctor`) |
| [openai-partner-benefits.md](./openai-partner-benefits.md) | [`/openai`](https://three.ws/openai) | queued, in `review`, awaiting approval to post |
| [product-demo.md](./product-demo.md) | [`/tour`](https://three.ws/tour) | drafted, no queue item yet |
| [text-to-3d.md](./text-to-3d.md) | free text-to-3D lane (test record) | posted (queue items `text-to-3d`, `free-characters`) |
| [three-token-mcp.md](./three-token-mcp.md) | `@three-ws/three-token-mcp` | posted (slot 2026-09-18) |
| [walk.md](./walk.md) | [`/walk`](https://three.ws/walk) | drafted, no queue item yet |
