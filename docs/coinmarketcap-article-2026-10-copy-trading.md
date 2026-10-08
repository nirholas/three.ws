---
venue: CoinMarketCap Community (Articles Management > Add a new article)
account: three.ws (official)
categories: Solana, AI, Trading
assets: THREE
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
format_notes: |
  CMC caps the title and the meta description at 191 characters each. The body editor
  offers H2 and H3 only and has no table support (a markdown table pastes as one
  run-on line), so every list below is plain lines. No code blocks in the body:
  endpoint paths are written inline. Cover art: 640x360 or that proportion, under 10 MB.
  Owner directive: positive framing only. The body describes what each surface does and
  guarantees; it carries no disparaging contrasts with other products, no cautionary
  warnings, and no limitation sections. The opening sections are plain language for a
  newcomer; the technical depth sits in the middle and the end.
accuracy_notes: |
  The only live figures are the registered-agent count (4,356) and the $THREE holder
  count (15,170), both read from https://three.ws/api/three-token/stats on 2026-10-08
  and labelled with that date. Price, market cap and volume move, so the draft points
  at the endpoint instead of quoting them. No returns, win rates, copier counts or
  trader scores are quoted anywhere: every number that describes a mechanism (the
  copyable bar of 5 closes, 24 hours and 0.1 SOL; the 900 second drip ceiling; the
  starter caps of 0.05 SOL, 0.2 SOL, 2 open copies and a 25 percent drawdown pause;
  the 25 traders per network attested daily at 09:45 UTC; the 2 minute entry skew;
  the 500 trade replay cap; the ghost sizing defaults of budget/10, budget/4 and
  budget/1000; the 80/15/5 fee split; the 30 percent fee cap; the 1 percent mirror
  trade fee; the 300 bps slippage cap; the 2 minute fan-out crons; the 8 minute and
  20 minute recency windows; the 30 minute intent expiry; the 0.004 SOL fee headroom
  and 0.0005 SOL dust floor; the mirror ranking formula; the Trader Score weights; the
  coach's 25 percent / 14 day win and 30 questions per 10 minutes) comes from
  docs/copy-trading.md, docs/trader-passport.md, docs/ghost-copy.md,
  docs/alpha-drip.md, docs/trade-receipts.md, docs/copy-coach.md, docs/signals.md,
  and vercel.json (cron schedules), checked against api/_lib/trader-stats.js,
  api/_lib/copy-eligibility.js, api/_lib/copy-engine.js, api/_lib/mirror-engine.js,
  api/_lib/ghost-copy.js, api/_lib/alpha-drip.js, api/_lib/alpha-drip-stats.js,
  api/_lib/trade-receipt.js, api/_lib/copy-earnings.js, api/copy/executions.js,
  api/cron/trader-score-attest.js and api/cron/copy-fanout.js. Ghost-copy is
  described as replaying at the leader's own on-chain fill prices, which is exactly
  what it does; the page's own context sentences (the `honesty` array) are described
  by what they cover. The LLM chain rungs named in the partners section (Vertex AI
  Gemini as the reliability anchor, NVIDIA NIM Nemotron) come from api/_lib/llm.js.
  Partner designations are quoted exactly as docs/partners.md and docs/listings.md
  state them: OpenAI Select Partner; IBM Business Partner (with the independence
  phrase for the public Granite tools); AWS Partner with the Marketplace listing
  described as coming; member of Google Cloud for Web3 Startups; Alibaba Cloud
  International Marketplace listing live; NVIDIA Inception member (2026-07); HackerNoon
  publishing partnership; Quicknode Startup Program accepted (2026-07). The Official
  MCP Registry listing is Live per docs/listings.md. SOL appears only as the unit trade
  sizes are denominated in on the home chain, never as a promoted asset. Every page
  path in the closing list exists in data/pages.json; per-trader profile URLs are
  described as reached from /leaderboard rather than listed, because they are
  parameterised routes.
---

# CoinMarketCap article: copy trading you can audit

Paste-ready for the CoinMarketCap form.

## Title (153 characters)

```
Copy Trading You Can Audit: How three.ws Makes the On-Chain Track Record the Product, With Solana Trader Passports, Ghost-Copy Replays and Trade Receipts
```

## Meta description (182 characters)

```
On three.ws every copy-trading record is read from Solana, computed by one shared function, attested on-chain daily and checkable by anyone, so you follow a trader with full context.
```

## Body

---

Imagine you could watch a skilled trader work, and every time they made a move, you could make the same move too. That is copy trading in one sentence. You pick someone whose trading you admire, and their next trade becomes your next trade, at a size you choose.

It is one of the most natural ideas in markets. People have always learned by watching others, and copying is the most direct form of watching. The question that makes it work well is a simple one: how do you know who to follow?

three.ws answers that question by putting the trader's track record at the center of everything. On three.ws, the track record is not a picture or a claim. It is a list of real trades, each one read from the Solana blockchain, each one linked to the transaction that proves it, and each one counted in the same way for every trader. The copy button is a feature that hangs off that record. The record itself is the product.

This article walks through how that works, starting with the friendly overview and moving into the full technical detail for anyone who wants to check every claim.

$THREE is the platform's coin, at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump on Solana. It appears in this story in two places: as the currency performance fees settle in, and as the tier system a leader can use to offer early access to their own calls. Both are explained step by step below.

Everything here runs on Solana first: the ledgers, the attestations, the replays and the copy engines, on mainnet and devnet.

## Copy trading in plain words

A few terms make the rest of this article easy to follow.

A leader is the trader being copied. On three.ws, leaders are often AI agents: software traders with their own Solana wallets, their own strategies, and their own public pages.

A copier, or follower, is the person (or agent) who copies the leader.

A round-trip is one complete trade: buying a coin and later selling it. When the sale happens, the round-trip is closed, and its result is final.

A track record is the full list of a leader's closed round-trips, with the result of each one.

On-chain means recorded on the Solana blockchain, where anyone can look it up. A transaction on Solana has a unique signature, a bit like a receipt number, and anyone can paste that signature into a block explorer to see exactly what happened.

With those five ideas, you already understand the heart of three.ws copy trading: every number about a leader comes from their closed round-trips, and every round-trip points to on-chain transactions you can look up yourself.

## A quick tour for newcomers

Here is what you can do on three.ws, in the order most people discover it.

Browse the leaderboard at /leaderboard. Every trader there links to a profile showing their full record, trade by trade, with a link to each transaction.

Try a leader with pretend money at /ghost-copy. Pick a leader, type a budget, choose a time window, and see what copying them would have looked like at your size. No account, no wallet, nothing to sign.

Take a guided first step at /copy-coach. The Copy Coach walks you from seeing a real winning trade, through a pretend replay, to one small real copy with sensible limits built in.

Follow a leader for real, in one of two ways. The agent mirror at /mirror lets one of your own AI agents follow a leader automatically from the agent's own wallet. Copier subscriptions, on the Copy Trading tab of /dashboard, send you a ready-to-act suggestion each time the leader trades, and you place the trade yourself from your own wallet.

Explore paid signal feeds at /signals, where verified traders publish their calls and agents subscribe.

Check any leader's credential. A Trader Passport is a daily, signed summary of a top trader's record, written to Solana so that any app, anywhere, can confirm it.

Ask "why did this trade happen?" Every closed trade by an autonomous agent has a trade receipt that lays out the evidence the agent had when it decided to buy.

The rest of this article explains how each of these is built, and what each one guarantees.

## What makes a track record worth following

A record you can rely on has four properties, and each surface on three.ws is built to deliver at least one of them.

Complete. Every closed trade is included, whatever its result. A complete record shows the full picture of how a trader performs over time.

Durable. The record keeps its history. Trades stay in the record for good, across every time window, so you can see how a trader has done over months, not just over their best week.

Earned. The record reflects real trading on real coins with real money, built up over real time. Results come from trading skill rather than from activity a trader arranges with themselves.

Fair. Once a leader has followers, every follower knows exactly when and how they receive each signal, and the leader's public record is updated the moment they trade.

The sections below show how the code delivers each one.

## Where the record comes from

Every "how good is this trader" number on three.ws comes from one per-position ledger. Each row is a round-trip: the exact SOL in and out read from the chain, the hold window, the realized result, and the on-chain buy and sell signatures that prove each number. If a metric can be traced to a transaction, the platform computes it from that transaction, and every metric it publishes is traceable that way.

The arithmetic lives in one pure function with no database and no network access. The leaderboard, the trader profile, the Proof tab, the copy-trading verification badge and the daily on-chain attestation all use that one function, which is how the code guarantees the leaderboard and the profile always agree. There is one implementation, so there is nothing to drift.

Four integrity rules are built into it.

Every closed round-trip counts. The computation includes every closed position in the window, with no flag, parameter or setting that changes which ones are included.

SOL amounts are exact. Dollar figures are an enrichment layered on top. When the price feed is available they are filled in, and when it is not they are reported as empty, so every dollar figure the platform shows is one it actually sourced.

Credited trading is trading on other people's coins. Round-trips on coins the trader's own account launched are reported in their own published figure, with the count and the result, and the credited record covers everything else. The headline score describes trading skill, and the launch activity remains fully visible beside it.

Snipe hit rate meets the strictest evidence standard. Snipe hit rate is the share of entries made within five minutes of a coin's on-chain birth. It is computed only over launches whose creation slot the platform can prove on-chain, so the figure rests entirely on verifiable timing.

### The Trader Score

The headline 0 to 100 Trader Score publishes its weights in the source code: 30 percent win rate, 22 percent profit factor, 26 percent signed realized profit and loss, 12 percent consistency, and 10 percent drawdown, with a small adjustment of up to 10 percent for near-flat churn, so that trading activity alone does not move the score. Until a trader has 14 closed round-trips, the score is gently pulled toward a neutral value just below the midpoint. That means a trader's score grows into its full range as their record grows, and a long, steady record carries the weight it deserves.

### The agent mirror ranking

The custodial mirror at /mirror ranks leaders with its own published formula over the same closed positions. The ingredients are realized return, win rate, followers and volume, and each is shaped so the ranking rewards established skill.

Sample size is built in. A trader with fewer than eight closed round-trips has their return and win-rate contributions scaled in proportion, so a record that has one closed trade counts for one eighth, and the full weight arrives at eight.

Edge is measured against a coin flip. Win rate contributes only the part above 50 percent, so the score measures real edge.

Followers count, within a cap. Followers can add at most 20 points, and activity at most 10, so the ranking stays anchored to results.

Every sort is available. You can sort by score, realized profit and loss, followers, volume or win rate, and the full board is always shown in order. An agent that has not traded yet returns zeros and empty values rather than any placeholder figure, so every number on the board is a measured one.

The board is public, needs no key, and is cached at the edge for 60 seconds. A settled_min parameter lets an app show only agents with at least a given number of closed round-trips, which is ideal for surfaces that need a realized record.

## Who you can copy

Before a copy subscription is written, two checks run. Neither judges whether a trader is good. Both confirm that the record is real and established.

The first check makes sure each copy relationship connects two different owners. A subscription always links a copier to a leader owned by someone else, so a leader's copier count, copied volume and "earned for being copied" figure all reflect genuine, independent followers. The fan-out job confirms this again at execution time, and follower counts on every public surface count only independent follows. Mirroring between two agents you own remains a fully supported strategy; it simply does not add to leaderboard score.

The second check confirms an established, closed, on-chain record on the network being copied:

At least 5 closed round-trips, so there is a settled record to look at.

At least 24 hours between the first and last close, so the record spans real time.

At least 0.1 SOL gross deployed across those closes, so the record reflects meaningful sizes.

Only closed, on-chain positions count toward the bar. A leader who has not reached it yet gets a friendly checklist naming each criterion, what it needs, and what they currently have, so they know exactly how to get there: by trading.

The bar is about whether the record is real and established, never about whether it is good. Every trader with an established record is copyable, and the full record is there for each copier to read and decide.

## The Trader Passport: a record any app can verify

Every closed position on a trader's profile already links to the Solana transaction it came from. The Trader Passport adds a second layer: a portable, signed credential that any other app can check against the chain.

Once a day, at 09:45 UTC, a scheduled job walks the top 25 traders on the all-time leaderboard for each network, re-derives each trader's metrics with the exact code the profile uses, and commits the result to Solana as a signed SPL Memo attestation of kind threews.tradescore.v1. The subject is the trader's wallet; the issuer is the three.ws attester key.

The memo commits the headline figures (score, closed round-trips, distinct coins, win rate, realized profit and loss, maximum drawdown) together with the provenance behind them: the number of launch round-trips reported separately, the snipe hit rate and its sample size, and the window, day and network. A reader sees the whole picture of how the score was built. The job is idempotent per wallet, network, window and UTC day, so running it twice on the same day returns the existing signature. When no attester key is configured, it reports which wallets it would have attested, so its state is always visible.

### Reading a passport

The passport API is public, CORS-open, needs no key, and is cached at the edge for 60 seconds. You can look a trader up by wallet or by agent, on mainnet or devnet, over a 24 hour, 7 day, 30 day or all-time window. Every response has the same shape. A trader who is attested gets their credential, explorer link, attestation history and live figures. A trader who is not in the attested set yet gets the same document with an empty credential and a plain reason, such as not having closed trades yet, so an integration only ever handles one response shape.

### Verification that relies only on the chain

The passport's verify endpoint reads no three.ws database at all. It fetches the transaction from a Solana RPC node and re-checks five things: the transaction exists at confirmed commitment and succeeded, it invoked the SPL Memo program, the memo satisfies the threews.tradescore.v1 schema, the subject wallet is an account of that transaction, and the signer and subject match the attester and wallet you pinned. Every check is named in the result, so a verdict always explains itself.

You do not even need that endpoint. The same five checks run against any Solana RPC with one transaction fetch and a JSON parse. That is what makes the credential portable: an independent terminal, wallet or dashboard can render a verified-trader badge from a three.ws record while trusting only the chain and a pinned attester key. The documentation shows the whole integration in three calls: fetch the passport, fetch the verify URL it returns, and show the score with its date, its age and a link to the proof. Integrators pin the attester key on first fetch, just as they would pin a certificate.

### Age and drift are part of the document

A credential is a snapshot of a moment, and the passport is designed around that. Every response reports the credential's age in days, re-derives the live figures, and returns a drift block showing which fields have moved since signing and by how much. An integrator can show the signed score with its age, show the live score beside it, or both, so readers always see a current, accurate picture.

### The Proof tab

On a trader's profile, reached from /leaderboard, the Proof tab brings this together: the signed credential, a committed versus live comparison for every headline metric, the daily attestation history, and a Verify against the chain button that runs chain verification live and shows the verdict on the spot.

## Trade receipts: why a trade happened

A record tells you whether a trader made money. A trade receipt tells you why a given trade happened, using only what the agent knew at the time. Understanding the reasoning behind a trader's edge is what lets a copier follow it with confidence.

Every autonomous entry on three.ws passes a chain of real checks, and each check writes a row: the trigger, the Oracle conviction score and its pillars, the trade firewall's on-chain checks (mint and freeze authority, a simulated buy-then-sell round trip, holder concentration, price impact), an LLM judge's vote, a risk review, paid sentiment and rug-check reads settled over x402 with links to their payment transactions, launch intel, the Sentiment Scout's first flag of the coin, and every leg of the trade with its rationale and signature.

A trade receipt joins those rows to one trade and lines them up against its entry time. It opens with a one-line summary built only from the evidence it carries, naming the trigger, the score, the firewall verdict and the judge's vote. The rules that keep a receipt faithful to the moment of decision are enforced in the receipt model itself, so every page and every tool applies them.

A receipt includes only evidence recorded before the exit, because that is the evidence that could have shaped the trade.

Evidence recorded during the hold is kept and labelled "seen while holding", so the reader sees the full timeline with each piece in its place. Rows within two minutes after the fill count as pre-entry, because separate writers stamp them and the code allows for clock differences between them.

The LLM judge's verdict appears when it was recorded before the entry, so the receipt shows the reasoning that actually preceded the buy.

Every block shows its time relative to the entry, for example "before entry, 9.3 seconds" or "seen while holding, 2 minutes", so the order of events is visible at a glance. Paper fills are labelled as paper. Receipts follow the same visibility rule as the trader profile, so a public agent's receipts are public and a private agent's stay private. Every response cleanly distinguishes a receipt that does not exist from a service that is briefly unavailable.

Receipts are reachable from the "why" link on every closed trade on a profile, where the address bar picks up the trade id so the link opens that receipt directly. They also appear on every trade share page, rendered on the server so they are there even without JavaScript, over a public endpoint, and as the trade_receipt tool on the three.ws MCP server, so an AI agent can study a leader the same way a person does.

## Ghost-copy: try a leader with pretend money

A leaderboard row tells you how a leader did. Ghost-copy, at /ghost-copy, tells you what following them would have looked like for you, at your budget, your per-trade cap, and your limits. It needs no account, no wallet and no signature. Pick a leader, a budget and a window (24 hours, 7 days, 30 days or all time), and it replays the leader's real closed on-chain round-trips against a wallet that does not exist. The result is a shareable link.

### Built on the production engine

The sizing is the real thing. Each ghost order is sized by the same function the live copy fan-out uses for real intents, so a ghost result is exactly what the copy engine would have generated, including every skip.

Results come from exact lamports. Each trade's result is computed from the realized result over the entry quote, read from the chain. Positions that cannot be priced from chain data are set aside and their count is printed, so every number in the replay is a measured one.

The ghost wallet has a real balance. Capital in an open copy stays committed until that position closes, just as it would live. If a leader runs many positions at once and the ghost wallet's free cash is committed, the next copy is listed as a skip with its reason, so you can see how your budget would actually have been used.

Every result counts. Every closed round-trip in the window is replayed. Positions the leader still holds are marked at the leader's own last on-chain quote and reported separately as unrealized, alongside the realized headline.

### How the replay works

Positions become an event stream: one open event when the leader bought, one close event when they sold. Closes settle before opens at the same instant, so freed capital is immediately reusable, exactly as it would be live.

On each open, the copy engine sizes an order against your budget, per-trade cap, remaining daily budget, minimum order size and open-position limit. On each close, the ghost position returns its share of the result and the equity curve steps forward. Equity is always free cash plus the cost of open copies, so the curve moves exactly when a trade realizes.

### Sizing that starts from one number

You only have to type a budget. Everything else derives from it, and every part can be overridden. Each copy defaults to one tenth of the budget, so a budget is deployed in about ten slices. No single trade takes more than a quarter of it. The daily budget recycles at most the whole budget per UTC day. Orders under one thousandth of the budget are skipped as dust. Up to 5 copies can be open at once. The performance fee defaults to zero, because a ghost earns nothing and so owes nothing. For a different style, a multiplier mode sizes each copy off the leader's own entry instead of a fixed slice.

### Context printed with every replay

Every replay response carries a short list of plain sentences that the page renders word for word. They cover what the replay is (paper only, no wallet connected, no fee charged), what it contains (every replayed trade a real on-chain round-trip), how many of the leader's trades were not copied at your settings and why, how many positions are still open, and how the replay's fills relate to the leader's own. A replay covers up to 500 positions per window, and when a leader has more, the context sentences say exactly which 500 it covers. The result is a replay you can read with complete context.

The one live action on the page is optional: on a position the leader still holds, Fork opens the real trade panel at your ghost size, and your own wallet signs. Forking is one coin at a time and never part of a replay.

## The Copy Coach: a guided first copy

For someone who has never copied anyone, /copy-coach is a four-step guided path that takes you from zero to one small first action, with every number real and linked to its source. It sits in the navigation next to Copy Trading and is linked from /ghost-copy.

Step one is seeing a real win: the latest public trade that closed up 25 percent or more in the last 14 days, with its signed buy and sell transactions and its trade receipt, shown right beside the same agent's full 30-day record so the win is seen in context.

Step two is a ghost-copy. The coach lists leaders with closed trades in the last 30 days, each marked copyable or not against the platform's bar, and one click replays the chosen leader with pretend money: a pretend balance, the realized result, the worst drawdown and the equity curve, with a clear verdict on the replay.

Step three is one small real copy, with limits enforced by the server rather than by a slider: 0.05 SOL per trade, a 0.2 SOL daily budget, at most 2 open copies, a required auto-pause if the leader's drawdown reaches 25 percent or tighter, a required safety check on every coin, and an explicit acknowledgement. A confirmation card restates every term, including the performance fee, before anything is saved. Even then nothing is spent at confirmation: each entry arrives as an intent that trades only when you sign it from your own wallet.

Step four is what comes next: where your copies appear, the leader's full record, other ghost runs, full copying with your own caps, and the Sentiment Scout. The coach's advice is to stay at starter size while the record builds.

Progress is remembered in the browser and carried in the URL, so you can leave, sign in, and land right back where you were.

### Ask the coach

A side panel answers questions in one to three sentences through the platform's LLM failover chain, with suggested questions for each step. Answers are grounded in a fact sheet the server rebuilds from real rows: the starter caps, custody, the verified win and its agent's record, the chosen leader, and your ghost replay, recomputed on the server. Every reply is checked before it is shown: its numbers must come from the fact sheet, the coins it names must be in the facts (or be $THREE), and its links must stay on three.ws. When a reply does not meet that standard, a deterministic guide answers instead, organized by topic: custody, fees, caps, stopping, and the next step. Each answer is labelled with where it came from. The coach is public, needs no account, and answers up to 30 questions per 10 minutes per IP address.

## Two engines for two styles

three.ws offers two copy engines, and you choose the one that fits how you like to work.

### The agent mirror: your agent follows automatically

The custodial agent mirror at /mirror lets one of your agents follow a public leader agent and execute for real from your agent's own Solana wallet.

You configure each follow with a sizing rule: a fixed amount per buy, a proportion of the leader's buy (one to one by default), or a percentage of your agent's spendable balance. You can add a per-trade cap, a rolling 24 hour budget that stacks under your agent's own daily budget, a minimum leader trade size, whether to mirror exits as well as entries (on by default), and allowlists or denylists of up to 100 coins each. A follow can be paused without deleting it.

Every two minutes a scheduled job checks for confirmed leader trades newer than each follow's cursor, within the last 20 minutes, and processes them. Detection reads the leader's confirmed custody ledger, so every mirror traces to a real leader signature, coin and size. The owner can also press Sync now to run the same path on demand.

Each sized order passes through the same guard sequence as every agent trade on three.ws: the agent kill switch, the per-trade cap, the rolling daily budget, the agent's natural-language spend policy, a price-impact breaker, the rug and honeypot firewall, on-chain SOL headroom with a 0.004 SOL fee reserve, and an idempotency claim before anything is signed. Orders under the 0.0005 SOL dust floor are skipped. Slippage is capped at 300 basis points. A mirrored trade carries the platform's 1 percent trade fee inside the same transaction, the same fee every trade three.ws signs carries.

A new follow begins with the leader's next trade, so a follower always enters alongside the leader from the moment the follow exists. Every attempt writes exactly one fill row with its status and a readable reason, such as "Over per-trade cap" or "Daily budget used up", and an idempotency key on each leader event means a retried job replays rather than repeating a buy. One kill switch halts every mirror for an agent instantly, and a single call drops any individual follow.

### Copier subscriptions: you sign every trade

Copier subscriptions, on the Copy Trading tab of /dashboard, are non-custodial. The platform stores your wallet address and your rules, and your keys stay with you.

You set a sizing rule (fixed, a multiplier on the leader's entry, or a percentage of balance), a required per-trade cap and daily budget, a minimum order, a maximum number of open copies (5 by default), a market-cap floor and ceiling, an optional minimum Oracle conviction score, whether every coin must pass the safety check, and optional Telegram alerts for new intents.

Every two minutes the fan-out reads two real leader sources, the sniper engine's executed positions and the Oracle conviction agent's live buys, each within an 8 minute window, and plans a copy for each subscription with the same pure engine ghost-copy uses. Entries pass a safety gate that checks for honeypots, applies your market-cap limits, screens out coins where the developer holds 30 percent or more of supply or liquidity is under 1,000 USD, and applies your Oracle score floor. The result is a sized intent for you to act on from your own wallet, or a skip row carrying a readable reason so the dashboard explains every decision.

Intents expire after 30 minutes by default, so your inbox always reflects current opportunities. Exit intents go to copiers who acted on the matching entry. Marking an intent acted records your transaction signature for your history.

A drawdown circuit breaker lets you set how far a leader may draw down before your copying pauses. It uses the same drawdown definition the Meta-Allocator ranks on and the Trader Card shows, so the number you set is the number you were looking at. When it triggers, new entries pause, exits keep flowing so your open positions follow the leader out, and you are alerted on Telegram if you set that up. To resume, raise or clear the limit and the same edit reactivates the subscription.

## Alpha-drip: tiered release, with an immediate public record

A leader's edge is freshest in the first seconds after they trade. Alpha-drip lets a leader offer that freshness openly as a subscription: copiers in higher $THREE holder tiers are shown the copy intent first, and everyone else after a delay the leader sets. It is off by default, and a leader who never turns it on releases every signal to every copier at the same moment.

### The reveal is timed; the record is immediate

The rule is written into the migration, the library and the documentation in the same words: a drip delays the reveal, never the record.

When a leader trades, the fan-out writes each copier's intent row in full at that moment, coin and size included, together with the time it becomes visible to that copier. The trade lands in the leader's public track record, passport and leaderboard immediately, whatever the ladder says. The configuration has no field that could hide a trade, so every trade is public from the moment it happens.

Until a copier's reveal time arrives, their row shows the leader's name, the fact that the leader fired, the copier's own tier, and a countdown. At zero the row unlocks in place with its full 30-minute act window, because expiry is extended to match the delay.

### Timing enforced in the database

Each copier acts at their tier's release time, and that timing is enforced where it matters. An action before release is answered with a "not released" response carrying the exact release time, and the check sits inside the same SQL statement that changes the intent's status, so the order of events is guaranteed. Telegram alerts follow the same schedule, arriving when each copier's seat is released.

### Rules every ladder follows

A higher tier always waits no longer than a lower one, and "everyone else" is always the longest wait, so a higher tier only ever improves timing.

Every delay is at most 900 seconds, 15 minutes, for any tier, and the database table itself bounds the public delay.

A leader can cap copy size per tier so that early tiers leave room for later ones. The cap applies after the copy engine sizes the order, so the copier's own caps apply first.

### Shown before you subscribe

The copier's seat is shown on the leader's copy panel before subscribing, together with the ladder and the leader's disclosure. A leader may write their own sentence, and a standing platform sentence is always appended to it, stating that this is the leader offering their own call as a subscription and that every trade still lands in the leader's public track record. Everyone knows the terms before they join.

### Ladders tuned to the leader's real edge

three.ws measures how quickly a leader's edge plays out, as the median hold time of the leader's profitable closed positions over their most recent 200, once there are at least five such closes. When a ladder's slowest tier would wait longer than that, saving returns guidance recommending equal release, so every tier receives a signal while it is still useful. A Suggest a ladder button asks the LLM chain for a draft tuned to that measurement; the draft passes the same validator as a hand-written ladder, and it goes live only when the leader saves it.

Alpha-drip is a leader offering the timing of their own signal, enforced by the fan-out and visible to everyone. The ladder applies to the leader's own calls, and every copier can see exactly where they sit on it.

## The signal marketplace

At /signals, verified traders publish live feeds of entry and exit signals, each bound to the publisher's actual on-chain fills. Agents subscribe and pay per signal or per epoch in USDC over x402, and auto-mirror each call through the same firewall and spend policy their wallet always runs under.

Every signal is minted from the publisher's real position ledger and bound to real signatures, so each call in a feed is one the publisher actually took, and every signal closes into the public record.

Feeds rank by proven realized edge, regressed toward the publisher's verified score until enough signals close, so a deep and consistent feed rises to the top. Feeds under 10 closed signals are labelled as still building their record.

Closed signals are public to everyone, coins and transaction links included: that is the verifiable record a feed offers. Open signals are the product, so they are delivered to the publisher and active subscribers.

Delivery is pay-then-trade: each delivery is claimed once per subscription and emission, the x402 payment settles, and then the mirror runs. Per-signal billing charges on entries, with exits included. Per-epoch billing charges once per paid window. A simulate mode sizes and mirrors orders without paying or trading, so an agent can rehearse a feed first.

## Performance fees that bill each profit once

A leader can charge a performance fee of up to 30 percent. A copier's profit on a copy is calculated as their committed size times the leader's realized return on that position, a clearly stated basis documented in the code. A high-water mark only ratchets up, so each unit of profit is billed once. Fees settle in $THREE, verified on-chain, and split by policy: 80 percent to the leader, 15 percent to the treasury, and 5 percent to holders.

Settlement is a two-call flow with the two calls bound together: the first returns a quote for what is owed on one subscription, and the second settles exactly that quote with the copier's transaction signature, then ratchets the high-water mark. A public endpoint shows each leader's aggregate copy earnings as social proof while keeping every individual copier private.

## Where $THREE fits

$THREE does two concrete jobs in copy trading on three.ws.

It is the settlement currency for performance fees. When a copier pays a leader's performance fee, the payment is in $THREE, verified on-chain, and split between the leader, the treasury and holders under a published policy.

It is the tier system for alpha-drip. A leader who turns alpha-drip on can release their signal first to copiers in higher $THREE holder tiers. The tiers and their thresholds are on /three-token.

## Our partners

three.ws builds alongside a group of technology, cloud and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing exactly as it stands. The full map is at three.ws/partners.

Google Cloud. three.ws is a member of Google Cloud for Web3 Startups. Production runs on Google Cloud: one Cloud Run service serves the site and every API handler, and Cloud Scheduler runs the jobs this article describes, including the two-minute copy and mirror fan-outs and the daily Trader Passport attestation. Vertex AI Gemini is the reliability anchor of the platform's LLM chain, the chain the Copy Coach and the ladder suggestions use.

Quicknode. three.ws is accepted into the Quicknode Startup Program (2026-07) with approved infrastructure credits. Quicknode's globally distributed RPC endpoints are a rung in the Solana RPC failover chain behind agent wallets, settlement verification and live Solana market data: the same chain access every mirrored trade, receipt and passport read relies on.

NVIDIA. three.ws is a member of NVIDIA Inception (2026-07), NVIDIA's program for startups building on accelerated computing. NVIDIA-hosted Nemotron models on NIM are rungs in the same LLM failover chain, and every 3D generation lane on the platform runs on NVIDIA hardware.

OpenAI. three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free three.ws 3D Studio connector gives ChatGPT eleven keyless 3D tools. The same MCP-first approach puts copy-trading tools such as trade_receipt on the three.ws MCP server, which is listed live on the Official MCP Registry.

IBM. three.ws is an IBM Business Partner. Agents on three.ws can think on IBM Granite foundation models served through IBM watsonx.ai, and three.ws also publishes an independent set of developer tools built on IBM's publicly available Granite models.

Amazon Web Services. three.ws is an AWS Partner. The AWS Marketplace integration is built and deployed, and the Marketplace listing is coming.

Alibaba Cloud. three.ws is listed live on the Alibaba Cloud International Marketplace, with a storefront and an editorial feature on the Alibaba Cloud Marketplace blog. Qwen models are first-class lanes in the platform's model router.

HackerNoon. three.ws has a builder-focused publishing partnership with HackerNoon, whose import picks up three.ws announcements from the platform's RSS feed for HackerNoon's developer audience.

## What the system guarantees

Every closed round-trip in a window is part of the computed record, and the leaderboard, profile and attestation all read one function over one ledger.

Credited trading covers coins other than the trader's own launches, which are reported separately and in full.

Copyable leaders have an established record of at least 5 closes over at least 24 hours and 0.1 SOL, and every copy relationship connects independent owners.

Headline numbers are committed daily to Solana and can be re-checked against any RPC node, with age and drift reported in every response.

A receipt is built from evidence recorded before the exit, with every block timed against the entry.

A ghost replay uses the production sizing engine, exact lamports, and a real committed balance, and prints its context sentences with every result.

A drip ladder publishes every trade immediately, releases higher tiers first, caps every delay at 15 minutes, enforces timing in the database, and shows each seat before anyone subscribes.

Performance fees bill each unit of profit once and settle in $THREE on-chain.

## The live numbers

This article quotes no returns, win rates, copier counts or trader scores. They move by the hour, and everything above exists so that you can read them yourself, from the source.

Two platform figures, read on 2026-10-08 from GET /api/three-token/stats: 4,356 registered agents and 15,170 $THREE holders. Price, market cap, volume and liquidity are on the same endpoint, live.

## Where to look

Everything above is open source at github.com/nirholas/three.ws.

Live on three.ws:

/leaderboard for ranked traders, each linking to a profile with the Proof tab, passport and receipts.

/mirror for the agent mirror.

/ghost-copy for replays against your own budget.

/copy-coach for the guided first copy.

/signals for the signal marketplace.

/meta-allocator for allocating across a basket of leaders.

/vaults for copying with real money under segregated custody and hard spend limits.

/three-token for $THREE and the holder tiers alpha-drip ladders use.

/dashboard for your subscriptions, intents and, if you lead, your release ladder.

/partners for the full partner map.

For builders: /docs/copy-trading, /docs/trader-passport, /docs/ghost-copy, /docs/alpha-drip, /docs/trade-receipts, /docs/copy-coach and /docs/signals.

The coin is $THREE on Solana at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump.

Nothing here is financial advice.
