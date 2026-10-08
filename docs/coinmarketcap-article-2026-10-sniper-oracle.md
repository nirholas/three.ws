---
venue: CoinMarketCap Community (Articles Management > Add a new article)
account: three.ws (official)
categories: Solana, AI, Trading
assets: THREE
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
format_notes: |
  CMC caps the title and the meta description at 191 characters each. The body editor
  offers H2 and H3 only and has no table support (a markdown table pastes as one
  run-on line), so every list below is plain lines. No performance, profit, return or
  win-rate claim is made for any trading strategy or arm anywhere in the body; the one
  historical trade mentioned is described by its execution facts only, with its return
  deliberately left out. Owner directive: positive framing only, so the body describes
  capabilities, design choices and what is rolling out, and carries no incident
  narratives or limitation sections. Opening sections are written for newcomers; the
  technical depth sits in the middle and end. Cover art: 640x360 or that proportion,
  under 10 MB.
accuracy_notes: |
  Live figures (4,356 registered agents, 15,170 holders, the 10 percent revenue-share
  pool) were read from https://three.ws/api/three-token/stats on 2026-10-08 and are
  labelled with that date. The sniper pipeline, triggers, guardrails, sizing floor,
  exit order, ladder and house-money behaviour, firewall behaviour, custody audit,
  solvency model, alerts, the public experiments page, the Oracle feedback bridges and
  the first live trade's execution facts (2026-07-19, 0.05 SOL, 0.05 percent impact,
  protected route landing in 1,709 ms, firewall score 100, roughly nine days of
  scanning, the arming config) come from docs/agent-sniper.md and
  workers/agent-sniper/README.md; that trade's return is deliberately omitted. The
  sniper runs as the agent-sniper Cloud Run service built by
  workers/agent-sniper/cloudbuild.yaml. Earned-autonomy tiers, unlocks, knowledge packs
  and the untouchable safety floor come from docs/sniper-autonomy.md. The optimizer and
  evolution loops are described as shadow or dry-run by default, which matches
  docs/agent-sniper.md and the 2026-10-01 switch to shadow recorded in
  docs/ops/sniper-fleet-review-2026-10-01.md; the body never claims they are applying
  changes. Spend-policy fields come from api/_lib/agent-trade-guards.js and the bridge in
  workers/agent-sniper/executor.js. Oracle model facts (three heads, base rates,
  held-out AUCs on 74,211 launches, the 11.4 percent rug rate and its stability, the
  27.958993 SOL empty-curve floor, at_floor duds, n/(n+200) shrinkage, the 200-row
  feature rule, the promotion gate thresholds, the six-hour refit, the 2-minute model
  TTL, the 351-sample smart-money bucket, the 45-point serial-rugger ceiling, the npm
  package API) come from docs/oracle-model.md, docs/oracle.md and
  packages/oracle-model/README.md. The Oracle worker loops, arming gates, size-scaling
  formula, backtest and receipts surfaces, Telegram feed, coin pages and x402 feeds come
  from docs/oracle.md. The four Oracle MCP tools (oracle_top_plays, oracle_coin,
  oracle_arm_watch, oracle_watch_status) are in api/_mcp/tools/oracle.js. The vitals
  model, CLI output, HTTP gating and package facts come from docs/agent-vitals.md and
  packages/agent-vitals/README.md; the declared loops and their freshness windows from
  api/_lib/sniper-loops-health.js; stall diagnoses from api/_lib/sniper-stall.js.
  Rolling-out items (house-money ladder handling, token-account close on full exit, the
  oracle_crossing graduated and dead-curve checks) are committed per
  docs/ops/sniper-fleet-review-2026-10-01.md but the live agent-sniper image dates from
  2026-09-29, so the body describes them only as rolling out with the next worker
  release and describes the crossing trigger's live checks as youth and score
  freshness. Dedicated Oracle and trading MCP servers are described as on the roadmap per
  docs/oracle-trading-mcp-plan.md. Partner designations and statuses come verbatim from
  docs/partners.md and docs/listings.md: OpenAI Select Partner, IBM Business Partner
  (with the independent-tools distinction from docs/ibm.md), AWS Partner with the
  Marketplace listing described as coming, Google Cloud for Web3 Startups member,
  Alibaba Cloud International Marketplace listing live, NVIDIA Inception member,
  HackerNoon publishing partnership, Quicknode Startup Program accepted. The LLM chain
  rungs (NVIDIA Nemotron, Qwen) come from api/_lib/llm.js. No partner is described as
  endorsing three.ws.
---

# CoinMarketCap article: inside the three.ws sniper fleet and Oracle model

Paste-ready for the CoinMarketCap form.

## Title (173 characters)

```
Inside the three.ws Solana Sniper Fleet: AI Agents That Trade From Their Own Wallets, an Oracle Model Published With Its Weights, and Health Checks That Confirm They Can Act
```

## Meta description (190 characters)

```
How three.ws agents trade Solana launches from their own wallets, with an on-chain safety firewall, a hash-chained decision ledger, an Oracle model anyone can run, and can-act health checks.
```

## Body

---

Imagine giving your AI agent its own wallet and a simple set of instructions: watch new coins as they launch, buy the ones that match my rules, sell when my exit conditions are met, and write down every decision so I can check your reasoning later. That is what the sniper fleet on three.ws does, every day, on Solana.

This article is a friendly tour of how it works. We start in plain language for anyone new to on-chain trading, then go deeper: how each trade passes a chain of safety checks, how the Oracle conviction model that guides many of the agents is built and published so anyone can download and test it, and how we check whether each agent is genuinely ready to act right now. Everything described here is open source, and every page mentioned is live.

$THREE is the platform's coin, at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump on Solana.

## The short version

If you only read one section, read this one.

Every agent on three.ws has its own Solana wallet. The owner decides whether that wallet may trade, and on what terms.

The sniper is the part of three.ws that lets an agent trade new coins on its own. It watches launches the moment they happen and judges each one against rules the owner wrote.

Before an agent buys anything, the system rehearses the trade on chain: it simulates buying the coin and then selling it back, to prove the coin can actually be sold.

Every decision is written to a public ledger, chained together with cryptographic hashes so the history cannot be quietly rewritten, and periodically anchored on Solana itself.

The Oracle is a scoring model that rates each new launch from 0 to 100. Its weights are published as a free package, so anyone can run it on their own computer and check our numbers.

A health system asks a simple question about every agent: can it act right now? If not, it names the one thing to fix.

## A few words you will see

pump.fun is a Solana launchpad where anyone can create a coin in seconds. Tens of thousands of coins launch there every day.

A bonding curve is the pricing formula a new pump.fun coin trades on before it has a regular market. When enough people buy, the coin graduates (migrates) to a regular automated market.

Sniping means buying a coin very early, often within seconds or minutes of launch.

An arm is one strategy in the fleet: one agent, one wallet, one set of rules.

The Oracle score is a number from 0 to 100 describing how strong the on-chain evidence for a launch looks, sorted into named tiers.

The ledger is the public, tamper-evident record of every decision an agent makes.

x402 is an open payment standard that lets software pay for an API call with a small stablecoin payment, with no account or subscription.

## What the sniper fleet is

### One wallet per agent

Every three.ws agent has its own custodial Solana wallet. The private key is stored encrypted at rest in an AES-256-GCM secret box and is only ever decrypted inside the one file of the worker that signs transactions. The Agent Sniper lets that wallet trade on its own: it watches pump.fun launches as they happen, judges each new coin against a strategy the owner armed, runs an on-chain safety simulation before committing a lamport, buys from the agent's own wallet, manages the position to an exit, and writes every decision to a hash-chained ledger anyone can audit.

### Many strategies, side by side

The fleet is several of these strategies, called arms, running side by side against the same launches, so deliberately different rule sets can be compared on a public scoreboard. Some use hard rules, some are gated on Oracle conviction, some hand the entry decision to a language model, and one rides the window right after a coin migrates off its bonding curve. The worker runs on Google Cloud as its own Cloud Run service, built by Cloud Build.

## How a snipe happens, gate by gate

A snipe is not one decision. It is a chain of gates, and a coin has to clear every one before a single lamport moves.

### Triggers: watching the launch feed

The worker is a long-lived process holding the pump.fun new-mint feed open, deliberately a continuously running service rather than a scheduled job, because launches are measured in seconds.

Alongside the new-mint trigger sit several others: a first-claim trigger (the first time a creator claims their fees), an intel-confirmed trigger from the Coin Intelligence Engine that reads each coin's first ninety seconds, alpha and radar variants, a graduation-ride trigger that buys at migration and sells into pump.fun's five-minute post-migration buyback window, and the oracle-crossing trigger covered below.

### Entry scoring and the safety band

Entry scoring is a pure function with no network or database access, which makes it fast, deterministic and easy to test. The coin must be quoted in SOL, sit inside the strategy's market-cap band, pass creator-history checks, and carry socials (a website, an X account or a Telegram) if the strategy asks for them. Every skip is recorded with a reason, so an owner sees why a coin was passed over, not only which coins were bought.

Above every strategy sits a fleet-wide market-cap floor and ceiling that a strategy can narrow but never widen. A coin whose market cap cannot be confirmed is skipped: the sniper only buys what it can price. pump.fun's Mayhem-mode tokens are excluded on every path by owner rule. That flag is not carried in the launch feed, so the worker reads it straight from the coin's on-chain bonding curve with one cached RPC read per mint, and if the curve cannot be read, the coin is skipped.

### The firewall proves the exit before the entry

Before broadcasting a buy, the executor runs a real simulated buy followed by a real simulated sell on chain. This round trip is the heart of the safety stack: it proves, before any money moves, that the coin can be sold again.

The classification is leg-aware. A revert on the sell leg is the honeypot shape (you can get in but not out), and that is a hard block. A revert on the buy leg usually means the price moved past the quoted slippage or the payer could not fund the probe, which says nothing about sellability, so it is recorded as a warning. A separate authority audit checks the coin's freeze and mint authorities.

The probe is sized to the wallet doing the buying, because sellability is a property of the coin, not of the probe size. A wallet that cannot fund even the minimum probe records the safety as unproven, and each strategy chooses its firewall level: block aborts on a block verdict or on unproven safety, and warn proceeds with a lowered confidence score.

### Execution and sizing

One file in the worker signs. The key is decrypted, the versioned transaction is signed and broadcast with the strategy's slippage and priority fee, and an idempotency lock guarantees one buy per mint per strategy. Before that moment, the executor walks its hard guardrails: a global kill switch, a per-agent kill switch, the daily budget, the open-position cap, a stop-loss that the database refuses to let be set to zero, a price-impact breaker checked against a fresh quote, and a platform-wide limit on buys per minute.

Sizing adapts to the wallet. A buy that would overrun the day's remaining budget is clamped to what is left, and a wallet holding less than its configured trade size trades at what it can afford after leaving headroom for fees. There is an operational floor of 0.012 SOL: below that, the wallet could not fund the safety simulation, so the arm waits for funding instead of looping on simulations it cannot pay for.

### Spend policy and session keys

The sniper also answers to the same per-agent spend policy that governs withdrawals, x402 payments and discretionary trades across three.ws: a rolling 24-hour USD ceiling, a per-transaction ceiling, a per-counterparty ceiling and an optional withdrawal allowlist. These are opt-in, and once set they apply on every path.

Owners can layer natural-language rules on top, which a pure evaluator enforces and which can only ever tighten the numbers, never loosen them. Scoped session keys let an owner grant narrow authority, for example permission to spend only on one strategy against one mint. Inside the sniper, the strategy's own lamport caps sit underneath all of this as the innermost backstop, so the policy is layered from the outside in.

### Exits, the ladder and house money

A sweep re-quotes every open position against its bonding curve, or against the automated market after graduation, and updates each position's high-water mark. A pure function then decides exits in strict order: stop-loss first, then signal-flip, then trailing stop, then take-profit, then timeout. It has no clock and no I/O, so a backtest and the live worker agree on exactly when a position closes.

The trailing stop arms only once a position has been above breakeven, so a position that has not yet been green is governed by the stop-loss alone. That rule was set by measuring the fleet's first 90 trades.

The laddered exit is the most distinctive policy in the fleet. At a configured multiple (2x by default in the research policy) it sells enough to recover the original stake, and lets the rest ride as a moon bag on the trailing stop, with a configurable moon-bag floor that always keeps a share of the position riding on a profitable exit. Every field of the strategy, from the ladder multiple to the moon-bag floor, is settable through the strategy API, and an explicit null returns a clearable field to its default behaviour.

### The decision ledger and custody audit

Every trade appends an entry to the agent's decision ledger: the trigger, the firewall verdict and score, the price impact, the size, a plain-language rationale, a falsifiable prediction and a mechanically computed confidence. Entries are hash-chained, each carrying the hash of the one before, so the history cannot be silently rewritten.

A reconciliation job closes each prediction against its real outcome, then anchors the chain head on Solana through an SPL Memo, so anyone can verify the history independently through a public verify endpoint for each agent. Custody is audited too: key recovery, the spend and the exit each write a custody event, and every wallet's balance is committed into the platform's custody attestation Merkle tree each epoch.

### The first live trade

The fleet's first live trade, on 2026-07-19, illustrates the pipeline working end to end on mainnet. The platform's own agent, named three, bought a brand-new launch on a new-mint trigger with 0.05 SOL. The firewall's round trip returned allow with a score of 100, the price impact was 0.05 percent against a 10 percent ceiling, and the transaction landed on a protected route in 1,709 milliseconds. Its strategy (0.05 SOL per trade, a 0.2 SOL daily budget, a $5k to $25k band, socials required, firewall on block) had scanned launches for roughly nine days before one coin cleared every gate, exactly the selectivity the gate chain is built for. Both signatures and the ledger entry are public.

## Who decides: rules, the Oracle and models

### Rules arms

Rules arms run the gate chain above at different levels of strictness: different bands, different creator-history requirements, different socials and dev-dump settings, different exits. They are the steady baseline the rest of the fleet is compared against.

### Oracle arms, paying for intelligence over x402

Oracle arms require a minimum Oracle conviction score before buying, and the bar moves per coin. The sniper pays the platform's own intelligence endpoint one cent of USDC per call over x402 for a live market read on each coin it is watching. A bearish read raises that coin's bar and a bullish one lowers it. Macro signals from the platform's autonomous x402 loop widen or tighten the bar too, based on overall SOL and pump.fun market sentiment. Both adjustments are clamped.

In other words, the trading engine is a paying customer of the intelligence engine. That is the agent-to-agent economy running in production: one piece of software buying a signal from another piece of software with a real stablecoin payment, settled on chain.

### The oracle-crossing trigger

Most triggers judge a coin at launch, when the Oracle has only just started to collect evidence. The oracle-crossing trigger waits for the evidence instead. A watcher polls the Oracle's conviction table and buys a coin the first time its score crosses the strategy's bar (50 by default), provided the coin is young (90 minutes by default) and the score is fresh. Each strategy gets one attempt per coin, every candidate passes through the same buy chokepoint as every other trigger (Mayhem gate, firewall round trip, budgets, market-cap clamps), and an explicit x402 rug-pull check sits on top.

### Model arms and the judgment ledger

Model arms ask a language model, reached through the platform's LLM failover chain, for a structured decision: buy or not, a confidence and a thesis in plain words. The arm acts only above a confidence bar (0.6 by default). Every verdict, buys and skips alike, is later scored against what the coin actually did, so a model's judgment can be measured before its trades even close, and that judgment ledger is public. The essential rails (Mayhem exclusion, the firewall, budgets, concurrency, fee headroom, spend policy) apply to model arms exactly as to rules arms, at the one chokepoint every buy passes through.

### The risk officer

A second model, an adversarial risk officer told to assume each proposed trade is a bad one and argue why, ships in shadow mode. It records what it would have vetoed and changes nothing until an owner arms it, so its judgment builds a visible track record first.

## Earned autonomy: room the arms earn

Two loops can tune the fleet without a human in the seat. The optimizer proposes bounded changes to each arm's own knobs (take-profit, stops, hold time, entry thresholds, trade size) from its realized record. The evolution loop scores arms against the ground-truth base rate with Wilson confidence bounds and moves the fleet's fixed daily budget toward stronger arms. The optimizer never touches budget, and evolution never touches a per-arm knob.

Both run in shadow by default: they record what they would change and mutate nothing until an owner opts in, so their calls build a visible record first, and every applied change is logged to the agent's Reasoning Ledger.

### The four tiers

How much room an arm gets is earned from its own realized record, recomputed from scratch on every run. Probation narrows the bounds, halves the step size and caps trade size at 0.05 SOL. Standard is the default for arms with too few trades to judge. Trusted, earned with a positive net result and an average edge of at least half a percent over 12 or more real trades, widens the bounds, multiplies the step by 1.75 and unlocks five more fields: the model's confidence bar, both edges of the market-cap band (widened outward only) and the two take-initials ladder settings. Autonomous, earned with an average edge of at least 5 percent over 40 or more real trades, opens the widest bounds, a 2.5x step and every tunable field.

The tier is decided on realized net result plus average per-trade edge rather than win rate, so the room goes to the arm whose record is strongest in actual lamports. Because it is recomputed every run, the room is rented rather than owned.

### More knowledge for proven arms

Tiers also decide how much a model arm is told before it decides. At base depth the judge receives the launch brief and a market-realness read. The informed depth adds the ground-truth base rate, the learned signal weights retrained every 15 minutes and the arm's own record. The full depth adds the conditional win-rate table per signal bucket and the model's own calibration. Every line is read from real database rows.

### What no tier can touch

Earned autonomy widens the space an arm may search. It never removes the floor under it. At every tier the firewall round trip, Mayhem exclusion, price-impact and slippage caps, fee headroom, the daily loss cap, the open-position cap, the fleet budget ceiling and the kill switch stay out of reach, enforced at the buy chokepoint. A hard stop-loss survives every tier: its range can widen to 65 percent but it can never be unset. A unit test asserts that no safety field appears in any tier's writable set.

Models and loops propose; the deterministic pipeline disposes.

### The Oracle and the fleet learn from each other

Three bridges connect the Oracle to the fleet. Realized results train the Oracle: each traded coin's real outcome is preferred over the chart label wherever it exists. The optimizer uses the Oracle: it buckets each arm's realized results by the conviction the coin had at entry and tunes the arm's minimum Oracle score toward the band where it performs. And calibration measures, per conviction band, how realized results compare with the band's claim, writing a bounded correction factor (between 0.7 and 1.3, held at 1.0 until a band has enough real trades) published at /api/oracle/calibration and applied through entry thresholds rather than onto the score itself.

The direction of every bridge is the same: real, realized money is the ground truth.

## The Oracle model, published with its weights

The Oracle watches every pump.fun launch for its first ninety seconds and scores it from 0 to 100. Its defining feature is openness: the weights, the holdout results and every refit decision are public, and the model can be downloaded and run by anyone.

### What the score claims

The score is a ranking line anchored to fixed probabilities, not a percentage. A score of 86 claims a 45 percent chance, not 86. The tiers are anchored like this: Prime (86 and up) claims at least 45 percent, Strong (72 and up) at least 25 percent, Lean (56 and up) at least 12 percent, Watch (34 and up) at least 5 percent, and below that is Avoid. Only Prime and Strong are act signals, which keeps the engine selective. On the bootstrap model's holdout, every populated tier observed at or above the probability it claims, and the live model card at /api/oracle/model?view=card republishes that table on every refit.

### Three questions and give-back risk

The model fits three questions, called heads, over one shared design matrix. Win: did the coin run, and is a first-sight holder still up? (base rate 2.94 percent). Rug: is that holder down more than half? (11.36 percent). Moon: did it run at all, by graduating or peaking at 3x? (9.51 percent). On 74,211 held-out launches the model had never seen, the published AUC (a ranking-quality measure where 0.5 is a coin flip and 1.0 is perfect) is 0.840 for win, 0.918 for rug and 0.892 for moon.

The score anchors on win, a coin that runs and holds. Three heads also make a uniquely useful number possible, give-back risk: one minus P(win) divided by P(moon). Given that a coin like this runs, how often does it hand the run back? It is published on every verdict and indexed, so the feed can be sorted by it.

### Labels that measure the coin

A model is only as good as the outcomes it learns from, so the Oracle's labels are built to measure the coin itself. An empty pump.fun bonding curve is worth a fixed amount in SOL: 30 virtual SOL against 1,073,000,191 virtual tokens over a one-billion supply works out to 27.958993 SOL. A rule written in dollars would move with the price of SOL, so the labels use two ratios from the same market-cap reading, which makes SOL's price cancel out.

Retained value is the last market cap divided by the all-time high. The hold multiple is the all-time-high multiple times retained value: what a first-sight holder would have. Moon is graduated or a 3x peak, rug is not graduated with a hold multiple of 0.5 or less, and win is a moon with a hold multiple of at least 1. Both ratios backfill exactly from stored columns, so the whole corpus was relabelled in one migration.

Under this rule the rug rate is 11.4 percent, and it holds within two points from an hour to three days after launch, exactly as a property of the coin should. Coins that never moved and sit at the empty curve are recorded separately as duds (the at_floor flag) rather than counted as rugs. Every row carries a label version, and the fitter trains on the price-independent version only.

### Features in four pillars

The model's features fall into four pillars.

WHO: the creator's launch record, the size of the dev buy, whether the dev sold, and how many proven smart-money wallets bought.

HOW: organic demand, bundling, the snipe ratio, buy-timing entropy and holder concentration.

WHAT: the narrative category, deliberately weighted lightly.

MOVE: unique early buyers, the buy and sell ratio, early volume, buy sizes and market cap at first sight.

Every signal is optional when scoring. A missing signal lands in the model's own fitted null bucket, which carries real information (a coin nobody has sold yet is telling you something) instead of being treated as zero.

### How the model is fitted

Several signals are genuinely non-monotone, so the model uses buckets rather than straight-line slopes: one bucketed logistic regression per head, fitted by stochastic gradient descent with L2 regularisation, a deterministic seed and time-ordered rows. It trains on the oldest 75 percent and reports AUC, precision at depth and per-band reliability on the newest 25 percent, for every head. One shared module serves both the command-line fitter and the production job, so they always agree on what the model is.

Every weight is then shrunk toward zero by n divided by n plus 200, where n is the rows in that bucket. A 200-row bucket keeps half its weight, a 2,000-row bucket keeps 91 percent, and a 34-row bucket keeps 15 percent, so a thin bucket cannot reverse a verdict on its own. Shrinkage happens before evaluation, so the published holdout numbers describe exactly the weights that ship.

A feature whose runner-up bucket holds fewer than 200 rows is set aside by name in the fit report and on Oracle Lab, and the next refit picks it up automatically once its data arrives in volume. Rare signals with plenty of rows are kept, because rare can be strong.

### Smart money, fitted from data

Smart money is fitted, not assumed. Launches where two or three proven wallets bought inside the observation window went on to a survivable win 55 percent of the time, with zero rugs, across 351 samples. Because the fitted model now carries that evidence directly, the expert overlay's own smart-money and creator-history terms stand down automatically whenever the active model includes the fitted feature, so the same evidence is never counted twice.

One hand-set rule remains, because it is a product guarantee rather than a probability estimate: a creator with three or more launches and no graduations can never score above 45, so a serial launcher with no track record never presents as Strong.

### How a new version earns the right to ship

A refit runs every six hours and has to pass a promotion gate that can say no. Every training epoch must have run. The scoring head's AUC must be at least 0.70 and must beat the live model by at least 0.004. No other head may fall by more than 0.01. No more than three features may be lost. And every populated tier must still earn at least 70 percent of the probability it claims. The gain bar sits above zero on purpose: two fits on nearly identical data differ by a few thousandths from shuffle order alone, and the gate is built so that the live model only changes for a real improvement, which keeps every published score and track record reproducible.

Every candidate is stored, including the refused ones with the reason, in a public model registry at /api/oracle/model?view=registry. A registry that keeps every decision, promotions and refusals alike, is a record rather than a highlight reel.

### Where the weights live

Promoted weights live in the database and load into every scoring process with a two-minute refresh, so a promotion is live platform-wide within one scoring cycle and with no deploy. A bootstrap copy ships in the container, and every stored verdict records the model version that produced it, so any score can be traced to its exact weights and recomputed offline.

### Run it yourself

The weights are published on npm as @three-ws/oracle-model. One request of about 32KB downloads the live model, and after that there is no network, no key, no rate limit and no telemetry.

An explain method shows the arithmetic term by term, so you can add the log-odds up by hand. A verify method takes outcomes you collected and returns AUC, Brier score and a reliability curve on your data. A diff method compares two versions bucket by bucket, also served at /api/oracle/model?view=diff. You do not need to take our word for how the Oracle ranks launches: download it and measure it.

### Receipts the Oracle publishes

The Oracle grades itself in public. The backtest endpoint at /api/oracle/backtest joins what the engine scored against what happened and returns results per tier with 95 percent Wilson confidence intervals, a calibration ladder in bands of ten, an exact Brier score and a monotonicity check, reporting the trained event and the holder-honest win side by side. The wins gallery at /api/oracle/wins defaults to the called tiers, and the agent leaderboard at /api/oracle/leaderboard requires a minimum number of resolved actions. Conviction is snapshotted whenever it moves by three points or more, so every sparkline shows real signal.

### The Oracle worker and arming your own agent

A single long-lived process runs three independent loops: scoring every 15 seconds, the agent loop every 3 seconds, and settlement every 60 seconds.

Any agent owner can arm an agent at three.ws/oracle/arm with a full risk envelope: minimum score and tier, narrative categories, per-trade size, a daily budget, an open-position cap, an optional smart-money requirement, size scaling and Telegram alerts. Simulate is the default, recording realistic actions while spending nothing. Size can scale with conviction up to 1.5 times the base, always under a hard per-trade ceiling, and every action streams to the public trading floor at three.ws/activity in under five seconds.

### The Oracle everywhere else

The same score powers a public Telegram channel that posts each coin the first time it crosses the feed floor, plus a daily digest at 08:00 UTC. Every mainnet coin has a full page at three.ws/oracle/coin/ plus its mint, fusing conviction with live market data from six sources read in parallel (DexScreener, the pump.fun API, GeckoTerminal, GoPlus, Birdeye and CoinGecko), and a "since the call" strip once the coin's outcome resolves.

### The Oracle over MCP and x402

The Oracle's read API is free and keyless, and four Oracle tools live inside the main three.ws MCP server today: oracle_top_plays, oracle_coin, oracle_arm_watch and oracle_watch_status. Any MCP-capable assistant can read the board, inspect a coin and manage an agent's watch.

The premium intel feeds are x402 endpoints at one cent of USDC per call, settling on Solana or Base and catalogued in the x402 bazaar so any paying agent on the open web can buy them. There is no mock path: if the upstream market sources do not answer, the endpoint returns 503 before settlement and the buyer is never charged. Every signal sold is one a real market produced.

## Health checks built around whether an agent can act

A running process is the first thing any health check confirms. For an agent that holds money, the more useful question is whether it can act right now, and if not, what single thing would let it. That is the question the three.ws vitals model is built to answer.

### Vitals and capabilities

Preconditions are declared as vitals, with needs edges between them, and actions are declared as capabilities that require every vital they depend on. For the sniper there are six vitals.

Armed: the owner has not disabled the arm or engaged its kill switch.

Solvency: the wallet can fund one entry at the executor's own sizing rule.

RPC: a Solana endpoint answers, so quotes and broadcasts are possible.

Feed: a launch candidate has been seen in the last 30 minutes, which on pump.fun indicates the upstream feed is flowing.

Deploy freshness: the running image is under seven days old.

Cognition: a real completion comes back through the model chain, for arms that use a model.

Entering a position needs armed, solvency, feed, RPC and, for model arms, cognition. Exiting needs only RPC.

### Exit stands on its own

That second edge is one of the most important decisions in the model. Exiting deliberately depends on neither the feed nor a model, so an operator always knows whether open positions can be managed, independently of anything affecting entries. Deploy freshness likewise feeds only cognition, and only for arms that use a model.

### Root causes, with a fix attached

Attesting the graph returns the root blocker, and marks everything behind it "blocked downstream, not probed", which saves the timeouts of rediscovering something already known. Every vital carries its remedy built from the probe's own data: a solvency finding comes with the exact SOL amount and address, a deploy-freshness finding with the redeploy command. The work queue is deduplicated by cause but not by fix, ordered by blast radius.

### Unknown stays unknown

A probe that throws, times out or returns nothing is recorded as unknown, and a capability with an unreadable precondition reports "cannot say" rather than "cannot act". An unread balance is not a balance of zero, and one slow RPC call never pages someone about a healthy fleet. The same rule propagates through the graph: only a block that traces back to something genuinely down makes a capability unable.

### When the filters are the answer

When every precondition is up and an arm has not attempted an entry in a while, the report says so plainly: can act, stalled. That tells an operator the infrastructure is fine and the arm's own entry filters are the thing to look at. A companion stall diagnosis names the specific condition from data the scoreboard already holds, each a rule the executor genuinely enforces, such as a market-cap band that does not overlap what a trigger sees at that moment (a launch is worth roughly $2k when the new-mint trigger fires) or a trade size larger than the daily budget.

### A built-in honesty check

The vitals model checks itself against the position ledger. If the graph ever says an arm cannot act while the ledger shows it attempted an entry within the last hour, the report prints a contradiction stating that the vitals model needs correcting, not the arm. The record of what an agent actually did always gets the final vote over a model of what it can do.

### Solvency as a first-class state

Every five minutes the funding loop reads the balance of every armed wallet and the master wallet that funds them, and classifies each as funded, shrunk (can trade below its configured size) or starved (cannot place an entry yet). It makes that call with the same sizing function the executor calls on a real buy, and a unit test sweeps the whole balance range to assert the two always agree.

The status endpoint at /api/sniper/status carries a solvency block, the platform health endpoint names the fix, and the homepage engine pill reflects solvency as well as liveness. The snapshot also prices the fix: a deficit figure says what it would cost to bring every wallet to its own refill target, and a flag says whether the funding master can cover it alone. Fleet and funding-master alerts deduplicate hourly, and simulate mode never pages.

### Loops measured by the work they write

The fleet's background learning loops are declared in one place, each with the freshest row it should have produced and the maximum age that row may reach, from 30 minutes for Oracle scoring to 26 hours for the optimizer and evolution. Health is measured by the rows each loop writes, and each entry explains why that loop matters downstream.

### Use it on your own agents

The vitals engine is published on npm as @three-ws/agent-vitals: zero dependencies, framework-agnostic, Node 18 or later, Apache-2.0, and usable on any autonomous agent, not only trading ones. On three.ws it runs as an operator command (npm run agent:vitals, with a JSON mode and a flag to skip the model probe) and an ops-gated HTTP endpoint at /api/agents/vitals. The endpoint is gated because its output names wallet addresses, funding amounts and deploy commands, and over HTTP the model probe is opt-in, since a dashboard left polling should not spend tokens on every refresh.

## Design principles for anyone running trading agents

Ask whether an agent can act, and probe each precondition against the real system it depends on. Scope capabilities so exiting never depends on whatever decides entries. Call the executor's own function instead of re-deriving its thresholds. Measure background work by the rows it writes. Treat unknown as unknown. Let the record of what an agent did overrule your model of what it can do. And publish your model, so anyone can check it.

## Watch it all in public

The fleet's public scoreboard at three.ws/sniper/experiments refreshes every 30 seconds with no login. Each arm shows its Solana wallet, linked to Solscan, and its real-time SOL balance read from the chain, and the funding master's address and balance are published in the same view. Every arm has a ledger link to the agent's full Reasoning Ledger: each buy decision with its trigger, price impact, firewall verdict and, for model arms, the thesis and confidence at the moment it decided, plus the reconciled outcome. The judgment ledger on the same page scores every model verdict, buys and skips, against what each coin did.

Next door, three.ws/exit-lab replays positions the fleet genuinely opened and closed through the exact exit code the live worker runs, with the rules changed to whatever you choose. Every price point is a recorded number, and the replay runs instantly in your browser against the same kernel the server uses.

## What is rolling out next

A set of trading refinements is committed and rolling out with the next worker release. Once the take-initials ladder returns the stake, the remaining bag becomes house money: its take-profit is measured from the ladder price, the maximum hold no longer applies, and it frees its open-position slot so a runner keeps riding on its trailing stop. Each full exit closes the coin's token account so its rent returns to the wallet. And the oracle-crossing trigger also checks that a coin is still on its curve with more than 40 SOL of market cap.

The adversarial risk officer is built and recording shadow verdicts, ready for owners to arm. Dedicated MCP servers for the Oracle and for arming trading agents are on the roadmap, building on the four Oracle tools already in the main three.ws MCP server. And the six-hourly refit keeps testing new Oracle versions against held-out data, promoting one only when it beats the live model, with every decision on the public registry.

## Our partners

three.ws is built alongside a set of cloud, AI, infrastructure and media programmes, listed in full at three.ws/partners. Each designation below is the programme's own, and three.ws remains an independent company in all of them. Several connect directly to the systems in this article.

Google Cloud. three.ws is a member of Google Cloud for Web3 Startups, and production runs on Google Cloud. The sniper worker is its own Cloud Run service built by Cloud Build, the main API runs on Cloud Run, and the jobs described above (the six-hourly Oracle refit, the reconciliation that anchors ledgers on chain, the optimizer and evolution runs) are scheduled on Cloud Scheduler. Vertex AI provides the platform's Gemini lanes.

Quicknode. three.ws was accepted into the Quicknode Startup Program in 2026-07 with approved infrastructure credits. Server-side Solana calls across the platform run through an RPC failover chain, and Quicknode is a rung in that chain, adding capacity and redundancy behind agent wallets, x402 settlement verification and live market data, the same kind of calls the sniper's quotes, simulations and broadcasts depend on.

NVIDIA. three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. NVIDIA Nemotron models are rungs in the platform's LLM failover chain, the same chain the model arms reason through and the vitals cognition probe checks. Every 3D generation lane on three.ws also runs on NVIDIA hardware.

OpenAI. three.ws is an OpenAI Select Partner in the OpenAI Partner Network, as an independent member at the Select tier. The MCP-first design that puts the Oracle's tools inside the main three.ws MCP server is the same design behind the free three.ws 3D Studio connector for ChatGPT, which gives ChatGPT eleven keyless 3D tools.

IBM. three.ws is an IBM Business Partner. Alongside that, the platform publishes an independent set of developer tools built on IBM's openly available Granite models, including Granite TimeSeries forecasting, which renders a live token's price history with a forward forecast as a walk-around 3D sculpture inside three.ws/play.

Amazon Web Services. three.ws is an AWS Partner. The AWS Marketplace SaaS integration is built and deployed, and the Marketplace listing is coming. Once it is live, subscribing will link an AWS account and issue an x402 access key, the same rail the Oracle's paid intel feeds use.

Alibaba Cloud. The three.ws listing on the Alibaba Cloud International Marketplace is live, and Alibaba Cloud Marketplace published an editorial feature introducing the platform. Qwen models are first-class lanes in the three.ws model router and appear in the LLM failover chain.

HackerNoon. three.ws has a builder-focused publishing partnership with HackerNoon for feature articles, tutorials and developer guides, with posts imported from the three.ws announcements feed.

Beyond the programmes, the three.ws MCP servers, including a pump.fun server, are published on the Official MCP Registry, and pump.fun published a feature article about the platform on the official $THREE coin page.

## Where to look

The fleet's public scoreboard, with every arm's wallet, live balance and reasoning ledger, is at three.ws/sniper/experiments. The Oracle feed is at three.ws/oracle, arming is at three.ws/oracle/arm, and the model itself, weights, holdout and every refit decision included, is rendered at three.ws/oracle-lab. Exit replays are at three.ws/exit-lab, the live trading floor is at three.ws/activity, and the partner map is at three.ws/partners.

Live platform figures, read on 2026-10-08 from https://three.ws/api/three-token/stats: 4,356 registered agents, 15,170 $THREE holders and a 10 percent revenue-share pool. Price and volume are on the same endpoint and update continuously.

Everything above is open source under Apache-2.0 at github.com/nirholas/three.ws.

Nothing here is financial advice.
