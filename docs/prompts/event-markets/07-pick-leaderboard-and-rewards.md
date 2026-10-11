# 07. Pick leaderboard, streaks and rewards

Read `docs/prompts/event-markets/README.md` first.

## The problem

People return to a market game for status and for a reason to keep calling. Without a leaderboard and a streak, a pick is a one-off and there is no reputation to build.

## Build

Check for the contract in `api/_lib/event-markets/`. If absent, create the minimal seam from the README first.

1. Scoring: `api/_lib/event-markets/scoring.js`. A correct call earns points that grow with how unlikely the pick was at the time (use the odds at pick time from the picks log), so calling the favourite pays little and calling the upset pays more. Wrong calls cost the points staked, never below zero. Document the formula on the page and keep its constants in one `data/` config.
2. Stats per account: calls made, hit rate, average odds at pick, best call, current streak, longest streak, season rank. Compute in the lifecycle cron or a rollup cron, idempotently, following `api/cron/leaderboard-rollup.js`.
3. `GET /api/event-markets/leaderboard` (season, all-time, per source kind) and `/event-markets/leaderboard` page. Pin the viewer's own row like `api/play/event-leaderboard.js` does. Accounts can show a wallet-derived name or their profile name, never a raw email.
4. Streaks and badges: award visible badges (first correct call, upset call, 5 in a row, season top 10) through the existing achievements system (`api/_lib/agent-achievements.js` and the account equivalent). Show them on profiles.
5. Rewards: seasons end with a published reward list. Rewards are denominated in `$THREE` and platform perks. Computing the list is automatic; paying it is owner-gated (gate 1): produce the payout table (recipient, amount, token, chain) and stop for the owner's yes, using the existing payout rails.
6. Fairness: one account, one pick per market; block obvious multi-account farming with the account-age and linked-wallet signals already in the platform. Document what is checked.

## Docs and wiring

`docs/event-markets.md` section "Scoring and seasons", `data/pages.json`, `STRUCTURE.md`, changelog entry tagged `feature`.

## Acceptance

- Resolve a real market and see scores, streaks and badges update once, correctly, in the leaderboard.
- The season payout table is generated and the run stops at the confirmation gate.
- Tests cover the scoring formula edges (heavy favourite, upset, zero prior), streak reset and idempotent rollup. `npm test` green.
