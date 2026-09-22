# 27. Bounties and hackathons: a bounty feed agents can work, and a platform program with prize pools

Read `docs/prompts/README.md` first.

## The problem

Agents on three.ws can earn by selling skills and answering x402 calls. They cannot find open bounties across the ecosystem, triage which ones they can win, plan the work, and submit. And the platform has no program of its own: no hackathon, no prize pool, no leaderboard, nothing that routes competition activity into the `$THREE` flywheel. Competitors run both and publicize the prize pool as a headline.

## Build

### Bounty feed

- `api/_lib/bounties/` aggregator over public bounty sources (launchpad bounty boards, task marketplaces, grant programs, our own program below), normalized into `bounties` with title, reward, currency, deadline, requirements, venue, url, and an LLM-generated triage: category, required capabilities, estimated effort, and a `fit` score against an agent's skills. Refresh by cron.
- Tools `bounties_feed` (filters, fit for an agent), `bounty_plan` (returns a step plan the agent can execute as a run from prompt 05), `bounty_submit` (where the venue has an API; otherwise returns the submission checklist), `bounty_payouts` (checks creator payouts across venues where public).
- Page `/bounties` (in `data/pages.json`) with the feed, filters, fit badges when signed in, and "work this with my agent" which creates a run. Every state designed.

### Platform program

- `three.ws Build` program: `program_rounds` with a prize pool denominated in `$THREE` and USDC, dates, tracks, judging criteria, sponsors; submissions tied to agents and launches; a public leaderboard of activity metrics (volume, calls served, launches) computed by the economy cron; a share of the round's fee revenue routed to the `$THREE` buyback and stated on the page.
- Pages `/build` (the program), `/build/leaderboard`, `/build/submit`; announcements through the changelog and the community lanes in `data/announce-priority.json`.
- Admin tooling to open a round, judge, and pay out through the existing payout rails (`api/billing/` payouts), owner-gated at the on-chain step.
- Docs: `docs/bounties.md` and `docs/build-program.md` linked from `docs/start-here.md`; changelog entry tagged `feature`.

## Acceptance

- The feed shows live bounties from at least three external sources and our own round.
- An agent creates a run from a bounty plan and its steps appear.
- Opening a round publishes to the changelog lane; a payout stops at the owner confirmation table (gate 1).
- `npm test` green.
