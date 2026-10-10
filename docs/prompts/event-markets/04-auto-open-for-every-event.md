# 04. Auto-open a market for every event

Read `docs/prompts/event-markets/README.md` first.

## The problem

Markets only work if they exist the moment an event is announced. A person opening each one by hand means most events never get one.

## Build

Check for the contract in `api/_lib/event-markets/`. If absent, create the minimal seam from the README first.

1. `api/_lib/event-markets/sources/`: one adapter per event source that lists upcoming and live events with their entrants from our own tables: Arena tournaments, the `/play` platform event, launch cohorts and seasons, program rounds, bounties. Each adapter returns normalized `{ sourceKind, sourceRef, title, startsAt, endsAt, entrants[] }`.
2. `api/cron/event-markets-open.js`: for every event without a market, create one: slug, title phrased as a question ("Who wins X?"), outcomes from entrants with their images and profile refs, `opens_at` now, `locks_at` at event start or a documented fraction into it, `resolves_at` at event end, and the matching resolution rule. Idempotent on `(source_kind, source_ref)`.
3. Late entrants: when an event gains an entrant before lock, add the outcome and keep existing picks intact. After lock, never change outcomes.
4. Too few entrants (under two) or an event with no defined winner: skip and record why in a log table so the owner can see skipped events.
5. Admin view `/admin/event-markets` (or the admin pattern in use): events with and without markets, skipped reasons, a button to open or void one by hand.
6. Emit an `event_market.opened` record the announcement brief can read (a row in an outbox table, not an in-process call), so the two features stay independent.

## Docs and wiring

`docs/event-markets.md` section "Which events get a market", `vercel.json` cron, scheduler sync, `STRUCTURE.md`, changelog entry tagged `feature`.

## Acceptance

- Run the cron against production data on a spare local port (see the local API testing note in your memory index) and show a market created for each live event type, with correct entrants.
- Run it twice: no duplicates.
- A late entrant appears as an outcome before lock and not after.
- `npm test` green.
