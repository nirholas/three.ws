# 03. Auto-resolution from our own data

Read `docs/prompts/event-markets/README.md` first.

## The problem

A market is only trusted if it settles by a rule everyone could read in advance, from data anyone can inspect, with no human picking the winner. Our events already produce that data. Nothing reads it back into a market.

## Build

Check for the contract in `api/_lib/event-markets/`. If absent, create the minimal seam from the README first.

1. `api/_lib/event-markets/resolvers/`: one module per `source_kind`, each exporting `describe(rule)` (plain-language rule for the UI) and `resolve(market)` returning `{ winnerOutcomeId, evidence }` or `{ pending: true }` or `{ void: true, reason }`.
   - `arena_tournament`: final standings of the tournament (read `docs/trading-arenas.md` and the data behind `api/arena-og.js`).
   - `event_leaderboard`: rank 1 at window end from `api/play/event-leaderboard.js` logic, using its own tiebreak.
   - `launch_cohort`: highest metric (volume, holders or market cap, chosen in `resolution_rule`) among the cohort's launches, from our launch records only.
   - `build_round`: winner of a program round once judging data exists.
   - `bounty`: the submission the bounty owner accepts.
2. Evidence: every resolution stores the inputs it read (ids, values, timestamps) in the market row so anyone can audit why it resolved the way it did. The market page shows it.
3. Lifecycle cron: lock at `locks_at`, resolve at or after `resolves_at`, retry while `pending`, void on a documented timeout. Idempotent: running twice never double-settles. Register it in `vercel.json` crons and sync with the scheduler script as the repo does for other crons.
4. Ties: define and document the rule per source kind (split, tiebreak or void). Never leave a market stuck.
5. Disputes: an admin `override` route that requires a written reason, is logged, and shows on the market page. The default path never needs it.
6. Settlement of points: on resolve, award or deduct points per the contract, once, in one transaction.

## Docs and wiring

`docs/event-markets.md` section "How markets resolve" with one paragraph per source kind. `STRUCTURE.md` row, changelog entry tagged `feature`.

## Acceptance

- Run each resolver against a real finished event in our data and show the evidence it stored.
- Re-running the cron on a resolved market changes nothing.
- A tie, a no-data event and a cancelled event each end in the documented state.
- Tests with fixtures taken from real records. `npm test` green.
