# Fix the agent launch funnel by auto-drafting a coin plan and instrumenting each step

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/276-plan-launch-funnel-default-coin-path.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 64 of 100 inside the tier). **Area:** launch. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The funnel experiment measured 2 of 788 new agents ever launching a coin, only 26.4 percent have a wallet at all, and `agent_token_plans` has zero rows, so the launch feature is effectively unused. The research recommendation is to make the coin path the default instead of an opt-in tool buried in a menu. Without per-step instrumentation the drop-off point cannot even be measured.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Planner UI `src/agent-token-plan.js` (497 lines) and API `api/_lib/agent-token-plan.js` (372 lines), routes in `api/agents/tokens/[action].js` and `api/pump/[action].js`.
- No auto-draft on agent creation, no per-step funnel events found.
- Mainnet launch itself is an owner-gated mint (CLAUDE.md gate 1).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -rn "agent_token_plans" api src --include=*.js | head
grep -rn "token-plan\|tokenPlan" src/create-agent.js src/agent-home.js 2>/dev/null | head
ls api/_lib/migrations | grep -i token_plan
grep -n "track(" src/agent-token-plan.js | head
```

Also read `docs/research/launchpad-landscape-2026-09.md` item 4 and the experiment's own SELECT queries (pinned windows) to re-measure the baseline before changing anything.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Re-run the experiment queries read-only against production data and record the new baseline in the experiment doc's results section.
2. Test first (`tests/agent-token-plan-draft.test.js`): creating an agent (with wallet) auto-creates a draft plan row with a sensible name/symbol derived from the agent and persona, idempotently; creating without a wallet provisions the custodial Solana wallet first (reuse the existing wallet-provision path) or records a pending draft.
3. Auto-draft on agent creation and surface the draft on the agent home as the primary next step card (skeleton while loading, empty/error states, hover/focus/active), showing the one-tap "review and launch" path that stops at the confirmation screen.
4. Instrument each step as an allowlisted analytics event (`src/analytics.js` and its allowlist test `tests/analytics-event-allowlist.test.js`): plan_viewed, plan_edited, wallet_funded, launch_confirm_opened, launch_submitted, launch_succeeded.
5. Add a funnel read endpoint or admin query that reports step counts, used by the experiment doc.
6. Devnet only for verification. Update the experiment doc with the change and the follow-up measurement date; add a changelog entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/agent-token-plan-draft.test.js` passes; allowlist test passes with the new events.
- [ ] Creating a new agent in a real browser shows the draft card without any console error; the funnel query returns non-zero `plan_viewed` after the visit.
- [ ] The experiment doc contains the updated baseline numbers with the pinned query timestamps.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Wallet missing for most agents | Provision the custodial Solana wallet at creation using the existing path; do not add a new wallet system |
| Analytics allowlist rejects events | Add the names to the allowlist and its test in the same change |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The final mainnet launch/mint step is a hard gate: render recipient, amount and chain and stop for explicit yes/no every time. Build and verify the confirmation screen on devnet only; do not launch on mainnet in this order.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/276-plan-launch-funnel-default-coin-path.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `276-plan-launch-funnel-default-coin-path.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/experiments-agent-launch-funnel.md` (whole file)

~~~~markdown
# Experiment: how many new agents ever launch a coin?

Published 2026-09-30. Status: concluded. Spend: $0. Index of every experiment: [/experiments](https://three.ws/experiments).

## The question

three.ws lets anyone create an AI agent and then launch a coin for it. A launched coin is where an agent starts to earn creator fees and where most of the platform's on-chain activity begins. So the question that decides whether the product works is not "how many agents are created" but: **of the agents people create, how many go on to launch a coin, and where does everyone else stop?**

A research pass on 2026-09-28 ([launchpad landscape](research/launchpad-landscape-2026-09.md)) reported 788 agents and 3 launches in 30 days. This write-up re-measures that funnel over a fixed, re-runnable window and adds the stages around it.

## Method

- **Window:** the 30 UTC days from 2026-08-31 00:00 to 2026-09-30 00:00 (end exclusive). The prior 30 days (2026-08-01 to 2026-08-31) are measured the same way for comparison. The window is pinned to fixed timestamps, not to `now()`, so re-running the queries later returns the same counts unless rows were hard-deleted since.
- **Tables:** `agent_identities` (every agent, including ones later soft-deleted), `pump_agent_mints` and `fixed_supply_launches` (every coin launched through three.ws), and `agent_token_plans` (the saved launch plan an agent can carry before it launches).
- **Network:** Solana mainnet unless a row says otherwise. Devnet rehearsals are counted on their own line.
- **Two figures are live state, not history.** An agent's wallet is provisioned when it first needs one, and an agent can be deleted later, so "holding a wallet" and "still live" describe those agents as they are when the query runs. The wallet count read 207 on the first run on 2026-09-30 and 208 on the re-run the same morning; it can only rise from here. Every other figure is fixed by the window.
- **Sample:** every row in the window, no sampling.
- **Tooling:** SELECT-only queries run against the production database on 2026-09-30. Every query is in the appendix.

## Spend

$0. This experiment is a measurement of what creators already did; nothing was bought, launched or paid for to run it.

## Result

| Stage, 2026-08-31 to 2026-09-30 | Count |
|---|---|
| Agents created | 788 |
| Distinct people who created them | 454 |
| Of those agents, still live (not deleted) | 744 |
| Of those agents, holding a Solana wallet address (live state, see Method) | 208 |
| Of those agents, launched a coin on mainnet (by 2026-09-30) | 2 |
| Of those agents, launched a devnet rehearsal coin | 0 |
| Coins launched on mainnet in the window (by any agent) | 3, from 3 agents and 3 people |
| Token plans ever saved (all time, any network) | 0 |

- **2 of 788 new agents launched a coin: 0.25%.** One of the three coins launched in the window came from an agent created before it.
- **208 of 788 new agents (26.4%) have a wallet address at all.** A coin launch signs with the agent's own custodial wallet, so roughly three in four new agents are not yet in a state where a launch could happen.
- **The token plan has never been saved.** The `agent_token_plans` table is empty. The object built to carry an agent from "created" to "launched" has not been used once.
- **Creation is growing while launches are not.** The prior 30 days had 509 agents from 315 people. Agents created rose 55% (509 to 788), while mainnet launches by calendar month went from 7 in August to 3 in September.

All-time context: 90 mainnet coins from 58 people and 65 agents since the first launch on 2026-05-13.

| Month | Mainnet coins | People who launched |
|---|---|---|
| 2026-05 | 26 | 5 |
| 2026-06 | 7 | 6 |
| 2026-07 | 47 | 38 |
| 2026-08 | 7 | 7 |
| 2026-09 (to 09-30) | 3 | 3 |

The re-measure differs slightly from the landscape doc (454 creators here, 452 there) because that pass used a rolling window ending when it was read on 2026-09-28, while this one uses the fixed window above.

## What we got wrong

- **We read agent creation as traction.** 788 agents a month looks like growth, and it is the number the home page shows. Measured against launches it is a 0.25% conversion, and launches are falling while creation rises. The number we celebrated was not the number that mattered.
- **We built the bridge and nobody crossed it.** The token plan shipped on 2026-08-11 (migration `20260811130000_agent_token_plans.sql`) to carry an agent from creation to launch. Zero plans have been saved. We did not measure whether creators ever reach the screen that saves one, so we cannot yet say which step loses them.
- **We did not know most new agents cannot launch.** Only 26.4% of new agents hold a wallet address, and a launch needs one. Nothing on any dashboard showed this until this measurement. While writing this we also found that our own [/analytics](https://three.ws/analytics) method note claimed every new agent gets a wallet; it was corrected the same day.
- **July was not the start of a trend.** 47 launches in July looked like momentum. August and September together produced 10.

## What we changed because of it

Changed already:

- **The funnel is now tracked daily in public.** [/analytics](https://three.ws/analytics) charts agents created, agents with a wallet and coins launched side by side over 30 days, 90 days or all time, with the method for each, so this ratio is watched instead of rediscovered.
- **A launch no longer has to start from a blank form.** `npx three-ws launch` hands a prefilled coin to `/launch` for the owner to sign ([CLI docs](cli.md)). It was built on 2026-09-29 and reaches creators once the `three-ws` package is published to npm, which is still pending.
- **Creators can see what a launched coin earns.** Per-agent creator earnings are now public on the agent profile and coin page, so the reason to launch is visible before launching.

Will change next, and re-measure with these same queries once it ships:

- **One default "launch my agent's coin" path** that drafts the token plan from the agent's identity and 3D render and asks for one confirmation (item 4 of the landscape doc's plan).
- **Instrument each step** between "agent created", "wallet provisioned", "plan saved" and "coin launched", so the next version of this write-up can say where people stop instead of only that they stop.

## Appendix: the queries

Every figure above comes from one of these SELECT statements, run against the production database on 2026-09-30. They use fixed timestamps, so anyone with read access can re-run them and get the same answer.

**Agents created in the window, the people who created them, and how many are live or hold a wallet** (788, 454, 744, 208):

```sql
select count(*) as agents_created, count(distinct user_id) as creating_users,
       count(*) filter (where deleted_at is null) as still_live,
       count(*) filter (where coalesce(meta->>'solana_address','') <> '') as with_solana_wallet
from agent_identities
where created_at >= '2026-08-31T00:00:00Z' and created_at < '2026-09-30T00:00:00Z';
```

**Of those agents, how many launched a coin** (2 mainnet, 0 devnet):

```sql
select count(distinct a.id) filter (where m.network = 'mainnet') as agents_launched_mainnet,
       count(distinct a.id) filter (where m.network = 'devnet') as agents_launched_devnet
from agent_identities a
join pump_agent_mints m on m.agent_id = a.id and m.created_at < '2026-09-30T00:00:00Z'
where a.created_at >= '2026-08-31T00:00:00Z' and a.created_at < '2026-09-30T00:00:00Z';
```

**Coins launched in the window, by network** (3 mainnet coins, 3 agents, 3 people):

```sql
select l.network, count(*) as coins, count(distinct l.agent_id) as agents, count(distinct l.user_id) as users
from (
  select network, agent_id, user_id, created_at from pump_agent_mints
  union all
  select network, agent_id, user_id, created_at from fixed_supply_launches
) l
where l.created_at >= '2026-08-31T00:00:00Z' and l.created_at < '2026-09-30T00:00:00Z'
group by l.network order by l.network;
```

**Token plans ever saved** (no rows, so 0):

```sql
select network, status, count(*) as plans,
       count(*) filter (where created_at >= '2026-08-31T00:00:00Z' and created_at < '2026-09-30T00:00:00Z') as plans_in_window
from agent_token_plans
where created_at < '2026-09-30T00:00:00Z'
group by network, status order by network, status;
```

**The prior 30 days, for comparison** (509 agents, 315 people):

```sql
select count(*) as agents_created, count(distinct user_id) as creating_users
from agent_identities
where created_at >= '2026-08-01T00:00:00Z' and created_at < '2026-08-31T00:00:00Z';
```

**Mainnet coins by month** (the monthly table):

```sql
select to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM') as month,
       count(*) as mainnet_coins, count(distinct user_id) as users
from pump_agent_mints
where network = 'mainnet' and created_at < '2026-09-30T00:00:00Z'
group by 1 order by 1;
```

**All-time mainnet coins** (90 coins, 58 people, 65 agents, first on 2026-05-13):

```sql
select count(*) as mainnet_coins, count(distinct user_id) as users, count(distinct agent_id) as agents,
       min(created_at) as first_launch
from pump_agent_mints
where network = 'mainnet' and created_at < '2026-09-30T00:00:00Z';
```

Derived figures: 2 / 788 = 0.25%; 208 / 788 = 26.4%; (788 - 509) / 509 = 55%.
~~~~

### `docs/research/launchpad-landscape-2026-09.md` (whole file)

~~~~markdown
# Launchpad landscape, September 2026: where three.ws can improve

Research date: 2026-09-28. Competitors are named by placeholder (Competitor A, B, ...) per the repo convention for research docs; the key and the source list were delivered to the owner in the session that produced this file. pump.fun and Meteora are named because three.ws integrates them as launch rails. Our own numbers come from the production database and the Cloud Run service config, read the same day.

## Bottom line

1. **Our problem is conversion, not reach.** 788 agents were created in the last 30 days and 3 coins were launched. The token plan, built to bridge that gap, has never been saved once.
2. **The two strongest 2026 plays are already built and switched off.** The native Meteora lane prices every agent coin in $THREE on mainnet (the quote-asset pattern that took one new launchpad to about $24M in 30-day revenue within weeks), and the $THREE buyback engine has run 82,208 times since June 19 and skipped every time because `THREE_BUYBACK_ENABLED` is not set.
3. **The native lane needs anti-sniper protection before it goes live.** Its fee schedule is flat. Every serious launchpad ships a fee that starts near 99% and decays over seconds, and a Meteora partner config is fixed once created on-chain, so this has to land first.
4. **Nobody ties agent tokens to real revenue.** On the largest agent launchpad, economic output and token value correlate at roughly zero. We have x402 per-call revenue, custodial agent wallets and 3D embodiment: the stack to close that gap and show it.
5. **Robinhood Chain: fix our screener, don't build a launchpad there.** `/markets/robinhood` indexes two launchpads, one halted in July and one whose domain now redirects elsewhere, and misses the chain's leading launchpad (about $14.3M in 7-day fees).

## Our own numbers

| Funnel stage, last 30 days | Count |
|---|---|
| Avatars created (34,234 Avatar Studio, 9,961 forge; about one per owner, largely guest sessions) | 44,529 |
| Selfie reconstructions | 164 |
| Agents created | 788, by 452 users |
| Coins launched through three.ws | 3 |
| Token plans saved (all time) | 0 |

All-time: 90 mainnet coins from 58 creators since 2026-05-13 (May 26, June 7, July 47, August 7, September 3). The native Meteora lane and the anonymous x402 launch door have 0 launches each.

| Built | State in production | Evidence |
|---|---|---|
| Native Meteora lane, $THREE-quoted on mainnet | Hidden: no `NATIVE_LAUNCH_CONFIG_KEY` | `quoteMintFor()` in `api/_lib/native-launch/config.js` |
| $THREE buyback (`run-three-buyback`, `api/_lib/token/buyback.js`) | Off: `THREE_BUYBACK_ENABLED` unset | 82,208 `skipped / disabled` rows in `three_buyback_runs`; revenue seen 0 |
| Fee Bridge (creator fees to an X handle in USDC, 20% buys $THREE) | Held by owner since 2026-09-17 | `FEE_BRIDGE_ENABLED` unset, page unrouted |
| pump.fun agent-payments (`handlePay` `create`) | Likely broken for new mints | pump.fun stopped new tokenized-agent launches on 2026-07-02 |

## The market in September 2026

**Solana launchpads, 30-day protocol revenue:** pump.fun about $45M (curve plus its AMM), Competitor A about $24M (launched August, coins priced against other assets, about 60% of revenue buys and burns its coin), Competitor B about $7M (a 2025 leader that fell to about 3% share), Meteora DBC about $0.24M protocol cut, and a long tail under $0.2M each. Two 2025 launchpads are effectively dead, one after a class action and its founder's arrest.

**Agent and creator launchpads:** the category peaked near $20B in January 2025 and sits near $4B. What survived is real agent commerce (Competitor J's escrowed agent-to-agent jobs) and perpetual creator royalties (Competitor E). Two agent platforms were sued over promised buybacks and insider allocation. pump.fun shut its agent-revenue buyback mode for fragmenting attention. The closest product to ours (Competitor K: no-code agents with 3D avatars) burns its coin for compute credits with a 10% bonus, and lost trust when deployer-linked wallets sniped about 40% of its launch.

**Fee routing to social handles:** Competitor I launched on 2026-09-15 with the same design as our held Fee Bridge (80% of creator fees to an X handle, 20% buys its coin), paid out about $1.44M in two weeks, and drew backlash for paying people who never opted in.

**Robinhood Chain:** the leading launchpad earned about $14.3M in 7-day fees with an ETH bonding curve, a locked pool and a snipe tax that decays over about five seconds. A major DEX's zero-fee launchpad arrived in August. Chain fees fell about 88% from the September 4 peak, and the wallet gas subsidy ended 2026-09-29. One operator extracted about $18.4M across 53 launches by exempting their own wallets from the snipe tax. No embodied or 3D agent product exists there.

## What the winners have in common

1. A programmatic buyback of the platform coin, shown on a live public counter (50-80% of revenue).
2. The quote asset used as a product lever: pricing launches in an asset turns every buy into demand for it.
3. Fees flowing to holders, not only creators.
4. Anti-sniper protection by default.
5. One opinionated default launch, not a menu.

## Recommendations, ranked

"Owner" marks steps that move funds, sign on mainnet, or change production.

### Tier 1: turn on what is already built

1. **Decaying anti-sniper fee on the native lane, then mainnet.** Exponential fee schedule from about 99% to the 1% base in `api/_lib/native-launch/config.js`, proven on devnet, then the mainnet partner config and `NATIVE_LAUNCH_CONFIG_KEY` (**Owner**).
2. **Turn on the $THREE buyback and publish it.** Live public counter with a link to every buy, fed by `three_buyback_runs`; `THREE_BUYBACK_ENABLED` once the treasury has revenue (**Owner**). Worded as programmatic and non-guaranteed.
3. **Ship the Fee Bridge with consent as the differentiator.** Public claim page per handle, opt-in and opt-out, the agent as a possible recipient (**Owner**: currently held).

### Tier 2: fix the funnel

4. **One default "launch my agent's coin" path.** Auto-draft the token plan from the agent's identity and 3D render, show the free devnet rehearsal, one confirm.
5. **Revenue-backed agents.** Public per-agent P&L (x402 revenue kept apart from trading volume, paying callers, buybacks), a badge only for real paid calls, Daily Match ranked on revenue.
6. **Holder rewards for agent coins,** paid by the agent's wallet, opt-in, framed carefully.
7. **A $THREE compute sink:** pay for credits in $THREE with a bonus.
8. **The agent hosts its own coin live** on Living Stages.
9. **Retire or fix the tokenized-agent path.**

### Tier 3: Robinhood Chain

10. **Fix `/markets/robinhood` coverage** for the launchpads that carry the chain's volume today.
11. **Rug-risk flags on every coin page, both chains:** early-block supply concentration, tax-exempt wallets, the creator's past launches.
12. **Phantom first in the Robinhood Chain buy panel.**

## What not to do

- Don't promise buybacks or revenue to holders.
- Don't add launch modes.
- Don't build a launchpad on Robinhood Chain.
- Don't route fees to people without their consent.
~~~~

