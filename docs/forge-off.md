# Forge-Off: community voting on the Forge

Forge-Off turns the passive "Fresh from the Forge" strip on [/forge](/forge)
into a live, competitive board. Every public creation can be upvoted, the strip
can be re-sorted from newest to most-voted, and the top model each week is
crowned into a permanent hall of fame that feeds the [Sketchfab
showcase](/docs/sketchfab).

It is **auth-free**, like the rest of the Forge: one vote per browser, no login.
A vote is keyed to the same anonymous browser id (`forge:cid`) the Forge already
uses to scope "Your creations", so a visitor's own upvotes light up across the
strip without an account.

## For visitors

On the "Fresh from the Forge" section of [/forge](/forge):

- **Upvote**: each card has an upvote pill (chevron + count). Tap it to vote,
  tap again to remove your vote. The count is the whole community's; the filled
  state is only yours. The button is optimistic and reconciles against the
  server tally, so a double-tap or a slow network never leaves it wrong.
- **Fresh / Top this week**: a toggle in the section header. *Fresh* is the
  historical newest-first, visual-first strip. *Top this week* is the Forge-Off
  board: the most-voted public models created during the current Forge-Off week
  (Monday→Monday UTC), highest first.
- **The weekly winner**: every Monday the top-voted model of the week just
  ended is crowned permanently. Later votes never rewrite a past week's winner.

The same strip and voting appear on the signed-in [/forge-studio](/forge-studio)
surface.

## API

### Cast or remove a vote

```
POST /api/forge-vote
Content-Type: application/json
x-forge-client: <stable browser id>

{ "creation_id": "<uuid>", "vote": true }     # upvote
{ "creation_id": "<uuid>", "vote": false }    # remove your vote
```

Response:

```json
{ "ok": true, "creation_id": "<uuid>", "vote_count": 5, "voted": true }
```

- `vote_count` is the fresh authoritative tally (recomputed from the vote table,
  never a drifting counter).
- `voted` is *your* state after the call.
- Voting is idempotent: a second upvote from the same browser is a no-op.
- A missing or shared (`anon`) client id is rejected `400 no_client_id`: a real
  vote needs a real, unique voter so the tally means something.
- Votes are only accepted on public, finished, non-rejected creations. Anything
  else returns `404 not_votable`.
- An invalid `creation_id` returns `400 invalid_creation`.

Rate limit: 120 votes / 10 min per IP (the one-vote-per-creation primary key
already caps real influence; this just blunts carpet-voting).

### Read the board

```
GET /api/forge-gallery?scope=community&sort=top&window=week&limit=24
x-forge-client: <stable browser id>   # optional, resolves your `voted` flags
```

- `sort=fresh` (default): newest, visual-first.
- `sort=top`: ranked by `vote_count` desc, `created_at` desc.
- `window=week`: with `sort=top`, narrow to the current Forge-Off week.
- Each returned creation carries `vote_count` and, when a client id is sent,
  `voted`. An anonymous read is CDN-cacheable; a voter-aware read is `private`,
  and the response varies on `x-forge-client`, so the edge never hands the
  anonymous copy to a browser that sent a client id.
- The read is CORS-open to any origin: it is the same public catalogue the
  standalone AR studio (npm: `3d-ar-studio`) shows as its Community tab from
  whatever page embeds it. Rate limiting is the control, not the origin.

## How it fits together

```
visitor taps upvote
      │  POST /api/forge-vote  (voter = hashed forge:cid)
      ▼
forge_votes  ──(recompute)──►  forge_creations.vote_count
      │                               │
      │  GET ?sort=top&window=week     │  Mon 00:07 UTC
      ▼                               ▼
"Top this week" board          api/cron/forge-off-crown
                                       │  writes the week's winner
                                       ▼
                               forge_board_winners  ──►  Sketchfab showcase
```

The [Sketchfab showcase cron](/docs/sketchfab) reads `forge_board_winners` and
`vote_count` to decide what to distribute to the official three.ws Sketchfab
account. Before Forge-Off shipped, nothing wrote votes or crowned winners, so
that pipeline's strongest tier was starved; voting + the weekly crown feed it.

## Implementation

| Piece | Where |
|---|---|
| Vote / board store logic | [api/_lib/forge-store.js](../api/_lib/forge-store.js): `castVote`, `removeVote`, `listShowcase` (sort/window/voter), `forgeOffWeekStart` |
| Vote endpoint | [api/forge-vote.js](../api/forge-vote.js) |
| Board read | [api/forge-gallery.js](../api/forge-gallery.js) (`scope=community`) |
| Weekly crowning cron | [api/cron/forge-off-crown.js](../api/cron/forge-off-crown.js) (`7 0 * * 1`) |
| UI (vote button, Fresh/Top toggle) | [src/forge-showcase.js](../src/forge-showcase.js) and its `/forge-studio` twin [src/forge-studio/forge-showcase.js](../src/forge-studio/forge-showcase.js) |
| Schema | [migration 20260625120000_forge_board.sql](../api/_lib/migrations/20260625120000_forge_board.sql): `forge_votes`, `forge_creations.vote_count`, `forge_board_winners` |

A creator deleting their own creation (`DELETE /api/forge-creation?id=`, the
two-tap delete on a "Your creations" card) takes its `forge_votes` rows with
it; a past week's `forge_board_winners` row survives with its creation
reference cleared, so the hall of fame never loses a week.

Backfill a past week's winner (owner): `GET /api/cron/forge-off-crown?week=YYYY-MM-DD`
(add `&dry_run=1` to preview). Authorized with `CRON_SECRET`.

## Themed events and daily windows

Beyond the weekly board, Forge-Off can run a themed event: a run of consecutive
UTC days, each with a theme, its own board and its own winner, plus an overall
winner. Events are config, not code: add an object to
[data/forge-off-events.json](../data/forge-off-events.json)
(`slug`, `title`, `summary`, `starts_at`, `ends_at`, `days[]` of
`{ date, theme, surface, surface_href }`, `prizes_note`). The loader in
`api/_lib/forge-off-events.js` validates it at boot: slugs are lowercase,
days must be consecutive UTC dates from `starts_at`, `ends_at` must be the end
of the last day, and `surface_href` must be a same-site path. Day boundaries are
UTC midnights built from epoch milliseconds, so they never shift with DST.

The shipped event, `ibm-forge-off-open`, uses the proposed week of 2026-11-09 to
2026-11-13. Move the dates in the config when the organizers confirm them.

### Windows on the board read

```
GET /api/forge-gallery?scope=community&sort=top&window=day
GET /api/forge-gallery?scope=community&sort=top&event=<slug>
GET /api/forge-gallery?scope=community&sort=top&event=<slug>&day=<n>
```

`window=day` is the current UTC day. `event` alone is the whole event window,
`event` plus `day` is one day. An unknown slug is `404`, a malformed slug or
day is `400`. `window=all` and `window=week` are unchanged.

### Event endpoint

`GET /api/forge-off/event?slug=<slug>` (slug optional: the live event, else the
next upcoming, else the latest ended) returns the config, `phase`
(`upcoming`, `live`, `ended`), `live_day`, each started day's top 3, and the
overall leader with event-wide `total_votes` and `entries`. The overall winner
is the creation with the most votes made anywhere in the event window (there is
no login, so there is no per-person sum).

### Landing page

[/forge-off](/forge-off) and `/forge-off/<slug>`: the live day's theme with a
countdown to the day's close, a make-one button to the day's surface (the Forge
day prefills the prompt), the day's board with the same vote endpoint, overall
standings, collapsed past days, and share buttons. With no live or upcoming
event it shows the standing weekly board.

### Crowning

`api/cron/forge-off-event-crown` runs daily at 00:07 UTC. A closed day is
crowned into `forge_event_winners` (migration
`20261105020000_forge_event_winners.sql`, apply with `npm run db:migrate` after
`npm run db:status`) with the day's theme, and the overall winner is crowned
once the event has ended. First crowning wins and is never rewritten. The weekly
crown cron is untouched. `?dry_run=1` previews; `?now=<ISO UTC>` replays a
moment.
