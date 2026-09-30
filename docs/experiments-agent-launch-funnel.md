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
