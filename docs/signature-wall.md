# Signature wall

A persistent graffiti wall near spawn (-14, -2) in the $THREE /play world. Anyone
standing at it presses F, confirms a name and an optional line of up to 80
characters, and their signature appears for everyone in the room. Built for
Community Meetup #3; spec in `docs/event-readiness/23-signature-wall.md`.

## Rules
- Signed-in wallets sign once, ever (idempotent server-side, claimed with HSETNX).
  Guests sign once per browser-tab session, with a nudge that signing in makes it
  permanent.
- Names are capped at 24 characters, lines at 80. Control and invisible characters
  are stripped, links and addresses are refused, and the same slur filter as world
  chat (`containsHateSlur`) runs on the name, the line and both joined.
- Wallet addresses are never stored in the rendered record, never returned.

## Store
Upstash Redis (the same `getRedis()` as the rest of `api/`), no SQL migration:
a hash `sigwall:sigs` (id to record), a zset `sigwall:idx` scored by sequence
number, a counter, and claim keys for idempotency. It is a small append-mostly
log with rank reads, which is what a zset does natively.

## API
- `GET /api/play/signature-wall?offset=&limit=` newest-first page, `?since=<no>`
  everything newer (oldest first), `?id=` one record. Returns `{ total, signatures }`.
- `POST /api/play/signature-wall` `{ name, line, playPass? | session? }` returns 201
  `{ ok, signature, total }`; 400 `name_required` / `no_links` / `not_allowed`;
  401 `pass_invalid`; 409 `already_signed` (with the existing signature); 429.
- `DELETE /api/play/signature-wall?id=` owner only, see `docs/event-readiness/LIVE-OPS.md`.
- `GET /api/play/signature-wall-og[?id=]` 1200x630 share card (wall or one signature).

## Overflow design
The wall shows one density-sized page at a time (8 big tiles when nearly empty up
to 128 small ones), cycling through every page by rank with the newest page
returning after every three older ones, and the three newest names are pinned in a
strip at the top. Redraw is incremental (a signature lands in exactly one slot,
`no % pageSize`), and the client holds only the newest page plus a six-page LRU,
so memory is flat at 10 or 5,000 signatures.

## Live propagation
After a successful POST the client sends a contentless `sigwall-ping`; WalkRoom
rebroadcasts `sigwall` (3 s per-client cooldown) and every client in range re-reads
`?since=`. Reads are coalesced; a 20 s poll covers a missed ping.

## Files
`api/play/signature-wall.js`, `api/play/signature-wall-og.js`,
`api/_lib/signature-wall-store.js`, `src/game/signature-wall*.js` (+ `.css`),
tests `tests/play-signature-wall.test.js`, `tests/signature-wall-layout.test.js`,
`tests/signature-wall-data.test.js`.
