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
accuracy_notes: |
  The only live figures are the registered-agent count (4,356) and the $THREE holder
  count (15,170), both read from https://three.ws/api/three-token/stats on 2026-10-08
  and labelled with that date. Price, market cap and volume move, so the draft points
  at the endpoint instead of quoting them. No returns, win rates, copier counts or
  trader scores are quoted anywhere: every number that describes a mechanism (the
  copyable bar of 5 closes, 24 hours and 0.1 SOL; the 900 second drip ceiling; the
  starter caps; the 25 traders per network attested daily; the 2 minute entry skew;
  the 500 trade replay cap; the 80/15/5 fee split; the 1 percent mirror trade fee;
  the Trader Score weights) comes from docs/copy-trading.md, docs/trader-passport.md,
  docs/ghost-copy.md, docs/alpha-drip.md, docs/trade-receipts.md, docs/copy-coach.md,
  docs/signals.md, and was checked against the implementation in
  api/_lib/trader-stats.js, api/_lib/copy-eligibility.js, api/_lib/copy-engine.js,
  api/_lib/ghost-copy.js, api/_lib/alpha-drip.js, api/_lib/alpha-drip-stats.js,
  api/_lib/trade-receipt.js, api/_lib/token/config.js, api/copy/executions.js,
  api/cron/trader-score-attest.js, api/cron/copy-fanout.js and the migration
  api/_lib/migrations/20260903235500_copy_alpha_drip.sql. Ghost-copy does NOT model
  slippage or fees; the article says so and repeats the platform's own framing that
  the replay is a ceiling. SOL appears only as the unit trade sizes are denominated
  in on the home chain, never as a promoted asset. Every page path in the closing
  list exists in data/pages.json; per-trader profile URLs are described as reached
  from /leaderboard rather than listed, because they are parameterised routes.
---

# CoinMarketCap article: copy trading you can audit

Paste-ready for the CoinMarketCap form.

## Title (147 characters)

```
Copy Trading You Can Audit: Why three.ws Made the Track Record the Product, With On-Chain Trader Passports, Honest Ghost-Copy and Trade Receipts
```

## Meta description (189 characters)

```
Most copy trading sells a leaderboard screenshot. three.ws sells a record you can check on Solana: losses kept, self-dealing excluded, and delayed reveals that can never delay the record.
```

## Body

---

Every copy-trading product makes the same pitch. Here is a trader. Here is their number. Press the button and their next trade is your next trade.

The number is the product, and the number is almost always a screenshot. A green percentage on a card, a ranked list, a follower count. What it rarely comes with is any way to check it. Which trades does it include? Which did it leave out? Was the record built over months or in one afternoon? Did the trader buy coins they launched themselves and call the result skill? When the follower count went up, did the trader start selling the signal to some followers earlier than others?

three.ws took the opposite position. The track record is not marketing for the copy button. The track record is the product, and the copy button is a feature hanging off it. That decision shaped every surface described below: how the record is computed, what the API is and is not able to say, which rows are written at which moment, and which failure modes the code was written specifically to make impossible.

$THREE is the platform's coin, at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump on Solana. It appears in this story in two places, as the currency performance fees settle in and as the tier system a leader can use to price early access to their own calls, and both are explained mechanically below.

Everything here runs on Solana first. The ledgers, the attestations, the replays and the copy engines are Solana-native, on mainnet and devnet.

## The three ways a track record lies

Before the mechanics, the threat model. Copy trading has a small number of classic failure modes, and each surface on three.ws exists because of at least one of them.

### Cherry-picking

The simplest lie is selection. Show the trades that worked, omit the ones that did not. A record built this way can be made of entirely real transactions and still be fiction, because the fiction is in what was left out.

### Deleted or hidden losers

A close cousin: survivorship. The losing positions existed, but they quietly stop counting. An account is reset, a bad week falls outside the window being advertised, a losing strategy is retired and its history goes with it.

### Manufactured records

The more sophisticated lie is a record that is complete and real and still means nothing. A trader launches a coin, trades it against their own supply, and books the profit. A curve is minted in one burst of dust-sized trades. Two accounts owned by the same person copy each other to inflate follower counts and collect their own performance fees.

### Front-running the people who follow you

The last failure mode is not about the record at all. It is about what happens after the record attracts followers. A leader with a thousand copiers has something valuable: the moment of their next trade. If that moment is sold quietly to some followers ahead of others, or if the followers are filling into the leader's own exit, the record can be perfectly honest and the product built on it can still be extractive.

Each section below names the failure mode it addresses and the mechanism that addresses it.

## Where the record comes from

The single source of truth for every "how good is this trader" number on three.ws is one per-position ledger. Each row is a round-trip: an entry and an exit, the exact SOL in and out taken from the chain, the hold window, the realized profit or loss, and the on-chain buy and sell signatures that prove every one of those numbers. If a metric cannot be traced back to a transaction, the platform does not compute it.

The arithmetic over that ledger lives in one pure function with no database and no network access. It takes an array of positions and returns the metrics deterministically. The leaderboard, the trader profile, the Proof tab, the copy-trading verification badge and the daily on-chain attestation all defer to that same function, which is how the code guarantees that the leaderboard and the profile can never disagree about a trader. There is no second implementation to drift.

A few honesty rules are built directly into it.

Closed losers are counted. There is no flag, query parameter, or window that removes a losing round-trip from the computation. This is the direct answer to survivorship.

SOL amounts are exact, read from the chain. Dollar figures are an enrichment layered on top, and if the price feed is down they degrade to null rather than to an estimate. The platform will not print a dollar figure it could not source.

Round-trips on coins the trader's own account launched are split out of the credited record and reported separately as self-dealing. They are not hidden and they are not credited: the excluded count and the excluded profit are both published. You cannot pump a token you launched and call it a track record.

Snipe hit rate, the share of entries landing within five minutes of a coin's on-chain birth, is computed only over launches whose creation slot the platform can actually prove. It is the most commonly faked flex in on-chain trading, so it is the metric held to the strictest evidence standard.

### The Trader Score

The headline number on the leaderboard is a 0 to 100 Trader Score. Its weights are named in the source rather than hidden behind a model: 30 percent win rate, 22 percent profit factor, 26 percent signed realized profit and loss, 12 percent consistency, 10 percent drawdown, with a penalty of up to 10 percent for near-flat in-and-out churn (a heuristic that is labelled as a heuristic). Until a trader has 14 closed round-trips, the score is regressed toward a neutral value slightly below the midpoint, so a short lucky streak cannot outrank a long record.

### The mirror leaderboard

The custodial mirror at /mirror has its own ranking, built from the same closed positions plus the confirmed trade ledger. Its weighting is published in full in the copy-trading documentation. The parts that matter for honesty: a trader with fewer than eight closed round-trips has their return and win-rate contributions damped proportionally, so a one-trade fluke counts for one eighth of its face value. A 50 percent win rate contributes nothing, because a coin flip is not an edge. Followers can add at most 20 points, so popularity cannot manufacture a record. And sorting by raw profit and loss shows the losers at the bottom of the list, where they belong, rather than dropping them.

An agent with no history returns zeros and nulls, never a placeholder.

## Who you are allowed to copy

A record has to be real before anyone can subscribe to it. Two gates run before a copy subscription is written, and neither is a judgement of whether the trader is good.

The first gate refuses self-copying. You cannot copy an agent you own. A self-copy would route the performance fee back to its own owner while inflating that leader's public copier count, copied volume, and the "earned for being copied" figure the leaderboard shows as social proof. The endpoint refuses it outright, and the fan-out job that writes copy intents checks again at execution time, so a subscription that predates the rule cannot keep firing. Self-follow edges are also excluded from every public follower count. Mirroring between two agents you own still works as a strategy; it simply no longer buys leaderboard score.

The second gate requires a real, closed, on-chain record, measured only on the network being copied. The floor is three numbers:

At least 5 closed round-trips, because a leader with no settled trades has no record to judge.

At least 24 hours between the first and last close, which blocks a curve minted in a single burst.

At least 0.1 SOL gross deployed across those closes, which blocks a record built from dust.

Open positions and simulated fills count for nothing toward any of these. A leader who falls short gets a checklist of exactly which criterion is unmet, what it needs, and what they currently have.

The important design choice is what this gate does not ask. A losing leader with a real record is copyable. The bar asks whether the record is real, never whether it is good. That is deliberate: a platform that only lets you see and copy winners is curating, and curation is a form of cherry-picking.

## The Trader Passport: a record other apps can verify without trusting us

Everything so far is verifiable one trade at a time: every closed position on a trader's profile links to the Solana transaction it came from. The Trader Passport is the second layer, and it exists because "trust our database" is not a credential.

Once a day, a scheduled job walks the top 25 traders on the all-time leaderboard on each network, re-derives each trader's metrics with the exact code the profile page uses, and commits the result to Solana as a signed SPL Memo attestation. The credential kind is threews.tradescore.v1. The subject is the trader's Solana wallet. The issuer is the three.ws attester key that signs the memo transaction.

The memo commits more than the score. It commits the headline figures (score, closed round-trips, distinct coins, win rate, realized profit and loss, maximum drawdown) and the provenance behind them: how many self-dealing round-trips were excluded, the snipe hit rate and its sample size, and which window, day and network were committed. A consumer of the credential sees what was excluded, not only what was credited.

The job is idempotent per wallet, network, window and UTC day: re-running it returns the existing signature instead of broadcasting a duplicate. If the attester key is missing, the job reports which wallets it would have attested rather than failing silently.

### Verification that reads no three.ws database

The passport API hands out the credential to anyone, with no account and no key. Its companion verify endpoint is the interesting part. It reads no three.ws database at all. It fetches the transaction from a Solana RPC node and re-checks five things: that the transaction exists at confirmed commitment and did not fail, that it invoked the SPL Memo program, that the memo parses and satisfies the threews.tradescore.v1 schema, that the committed subject wallet is an account of that transaction, and that the signer matches the attester you pinned and the subject matches the wallet you asked about.

Every failed check is listed by name, so a negative verdict always says why. An RPC node that cannot be reached returns an error, not a false negative, because an unanswered question is not a verdict.

And you do not need that endpoint either. The same five checks run against any Solana RPC with one transaction fetch and a JSON parse. That property is what makes the credential portable: a competing terminal, a wallet, or an independent dashboard can render a verified trader badge from a three.ws record while trusting only the chain and a pinned attester public key.

### Age and drift are part of the document

A signed snapshot has a failure mode of its own: it goes stale and keeps looking authoritative. The passport answers that structurally. Every response reports the credential's age in days, and alongside the anchored figures it re-derives the live figures and reports a drift block showing which fields have moved since signing, and by how much. The documentation asks integrators to show the age and to show the drift or the live number, because presenting an old anchored score as current is exactly what the API was built to prevent.

A wallet that has not been attested yet gets the same document shape with the credential set to null and a plain reason (no agent yet, no closed trades yet, not yet in the daily attested set), so an integration never has to branch on two response shapes.

On the trader profile, reached from /leaderboard, the Proof tab renders all of this directly: the signed credential, a committed versus live comparison for every headline metric, the daily attestation history, and a button that runs the chain verification live and shows the verdict, including a red one if a check fails.

## Trade receipts: why the trade happened, using only what was known at the time

A track record tells you whether a trader made money. It does not tell you whether you understand the edge, and an edge you do not understand is one you will abandon at the first drawdown.

Every autonomous entry on three.ws already passes through a chain of real gates, and each gate writes a row: the trigger that started the entry, the Oracle conviction score and its four pillars, the trade firewall's on-chain checks (mint and freeze authority, venue, a simulated buy-then-sell round trip, holder concentration, price impact), an LLM judge's vote and thesis, an adversarial risk review, paid sentiment and rug-pull reads settled over x402 with links to their payment transactions, launch intel, and every leg of the trade itself with its rationale and signature.

A trade receipt joins those rows to one trade and lines them up against its entry time. It is not a story written afterwards, and the rules that prevent it from becoming one are enforced in the receipt model itself, so no page or tool can skip them.

Evidence recorded after the exit is dropped entirely. It could not have caused the trade.

Evidence recorded while the position was open is kept but labelled "seen while holding". A sentiment read taken two minutes into a hold is real context, but it is not why the agent bought. In the code, anything within two minutes after the recorded entry counts as pre-entry, to absorb clock skew between gates; anything later is during the hold.

The LLM judge's verdict is shown only when it existed before the entry. A post-hoc justification from a model is exactly the kind of after-the-fact story receipts are meant to rule out.

Every block shows its time relative to the entry, so the order of events is visible rather than implied.

Paper fills stay labelled as paper and carry no transaction links. Private or deleted agents have no public receipts. A database outage returns a service error, never a "not found", so an outage can never masquerade as an absence of evidence.

The receipt is reachable from the "why" link on every closed trade on a trader profile, on every trade share page, over a public HTTP endpoint, and as an MCP tool, so an AI agent can vet a leader the same way a person does: read the record, then read why its recent trades were taken.

## Ghost-copy: what would have happened to your money, and why that number is a ceiling

A leaderboard row says an agent made a certain amount of SOL. It does not say what would have happened to your budget, at your per-trade cap, with your capital locked in positions you could not afford to hold at the same time. Ghost-copy, at /ghost-copy, answers that question with no account, no wallet, and no signature.

You pick a leader, type a budget, and pick a window (24 hours, 7 days, 30 days, or all time). The replay runs the leader's real closed on-chain round-trips against a wallet that does not exist.

### What makes the number honest

The sizing is the production engine. Each ghost order is sized by the same function the live copy fan-out job uses to size real copy intents. A ghost result is not a marketing figure; it is what the copy engine would have generated, including every refusal.

Profit and loss per trade comes from exact lamports, the realized result divided by the entry quote, not from a stored percentage that could have drifted. A position that cannot be priced from chain data is dropped and counted, and the count is printed. It is never estimated.

The ghost wallet runs out of money. Capital in an open copy is unavailable until that position closes, so a leader running many positions at once cannot be copied on a small budget without skips. Every skip is listed with a machine reason and a plain sentence.

Losses count. Nothing is filtered.

Positions the leader has not closed yet are marked at the leader's own last on-chain quote and reported as unrealized, in a separate table, never folded into the realized headline.

### What it does not model, stated on the page

Ghost-copy does not model slippage, priority fees or latency. The documentation and the replay response both say so plainly: a real copier's fills land after the leader's, not at the same price, so the replay is the ceiling of the outcome, not the outcome. That sentence is not tucked into a footnote. Every replay response carries an "honesty" array of plain sentences, which the page renders verbatim: that it is paper only and no fee was charged, that every replayed trade is a real on-chain round-trip with losses included, how many of the leader's trades were not copied and why, how many positions are still open, the slippage ceiling warning, and that past results do not predict future results. If positions were unpriceable, or if the window held more than the 500-trade replay limit, those facts are appended too. The documentation is blunt about clients: one that renders the summary without the honesty sentences is misrepresenting the result.

The data layer is written so that an outage cannot produce a flattering lie either. An empty result means "this leader has no settled record in this window", and the page renders it as a designed empty state. A database failure is surfaced as a failure, so the page can never confidently tell a visitor that a trader has no record when it simply could not read one.

The one live action on the page is optional and one coin at a time: on a position the leader still holds, a Fork button opens the real trade panel at your ghost size, and your own wallet signs it. It never happens as part of a replay.

## The Copy Coach: one small, careful first step

For someone who has never copied anyone, three.ws has a guided path at /copy-coach. It is worth describing because of what it refuses to do.

Step one shows a real win: the most recent public trade that closed up 25 percent or more in the last 14 days, with its signed buy and sell transactions and its trade receipt, placed directly beside the same agent's full 30-day record. When that record is negative, the page says so in plain words: the win is real, and it still came from an agent that lost money. If no qualifying win exists in the window, the page says that instead of reaching further back.

Step two is ghost-copy, with each leader marked copyable or not against the real eligibility bar. A losing replay gets a red verdict.

Step three is one small real copy, and its limits are enforced by the server, not by a slider: 0.05 SOL per copied trade, a 0.2 SOL daily budget, at most 2 open copies, a required automatic pause on leader drawdown set at 25 percent or tighter, a required safety check on every copied coin, and an explicit risk acknowledgement. A request past any cap is refused with a plain reason and nothing is written. Even then, nothing is spent at confirmation: each copied entry arrives as an intent that only trades if you sign it from your own wallet.

The coach also answers questions through the platform's LLM failover chain, grounded in a fact sheet the server rebuilds from real rows. Every answer passes a validator that refuses any reply promising returns, any reply containing a number the fact sheet does not hold, any reply naming a coin outside the facts other than $THREE, and any off-platform link. A refused answer, or a model chain that is down, is replaced by a deterministic guide. Asked for a guarantee, the coach says there are none.

## Two engines, two risk profiles

"Copy trading" on three.ws is two separate engines, and which one you use matters.

### The agent mirror (custodial)

At /mirror, one of your agents follows another public agent, and when the leader's trade confirms on-chain, the platform builds, signs and broadcasts a real trade from your agent's own custodial Solana wallet. There is no dry-run flag and no shadow mode.

Every mirrored order goes through the same guard sequence as every other agent trade: kill switch, per-trade cap, rolling daily budget, the agent's natural-language spend policy, a price-impact breaker, the rug and honeypot firewall (a block verdict refuses the mirror), on-chain balance headroom, and an idempotency claim in the custody ledger before anything is signed. Slippage is capped at 300 basis points. A new follow never backfills: only trades the leader makes after you follow are ever mirrored, so a follower is never filled into a position the leader opened before the follow existed. A mirrored trade carries the platform's 1 percent trade fee, built into the same transaction. One kill switch halts every mirror for an agent instantly.

### Copier subscriptions (non-custodial)

On the Copy Trading tab of /dashboard, the platform never holds your keys. When a leader trades, the fan-out job writes a sized, safety-checked intent for you to act on from your own wallet. Marking an intent as acted records history and moves no funds. Intents expire after 30 minutes by default, so your inbox never offers an actionable copy of a coin that has long since moved. Exit intents only go to copiers who actually acted on the matching entry.

Subscriptions carry their own guardrails, and one of them acts while you are already copying: a drawdown circuit breaker. If the leader's worst peak-to-trough loss on realized equity crosses the limit you set, your subscription pauses itself and new entries stop. Exits still come through, because withholding a sell would strand you in the exact leader the breaker just fired on. Resuming while the leader is still past your limit is refused.

## Alpha-drip: the delay is disclosed, and the record is never delayed

This is where front-running enters the picture, so it is worth being precise.

A leader's edge decays in seconds. By the time a call reaches a thousand followers, the thousandth fill is not the fill the leader got. Alpha-drip is how a leader on three.ws can price that honestly: holders of $THREE in higher tiers are shown the copy intent first, and everyone else after a delay the leader sets. It is off by default. A leader who never touches it releases every signal to every copier at the same moment.

### The reveal is delayed; the record is not

The central rule is written into the database migration, the library header, and the documentation in the same words: a drip delays the reveal, never the record.

Mechanically, when a leader trades, the fan-out job writes the copy intent row in full for every copier at that moment, coin and size included, with one extra field: the time it becomes visible to that copier. The trade lands in the leader's public track record, their passport and the leaderboard at the moment it happens, regardless of any ladder. There is no setting that hides a trade, and the configuration schema has no field that could express one. What a ladder controls is when a given copier is shown the coin and the size, and nothing else.

Until a copier's reveal time passes, the API masks the coin, the name, the planned size, the leader's entry size, the safety snapshot and the leader's transaction on the way out, and returns a locked row with a countdown. When the countdown reaches zero, the row unlocks in place and becomes an ordinary intent with its full 30-minute act window, because the expiry is pushed out to match the delay.

### Race-proof, not merely hidden

Masking a field in the interface is not enforcement. Acting on an intent before your tier's reveal is refused by the server with a 409 response, "not released", and the release time. The check lives inside the same SQL statement that changes the intent's status, so there is no window between "is this released?" and "mark it acted" for a fast client to slip through.

Telegram alerts follow the same seat. An instant seat is notified when the intent is written; a delayed seat is notified on release, so a push notification cannot leak the coin ahead of the copier's own reveal.

### The rules a leader cannot break

Two rules are enforced by the server and mirrored in the editor, so a leader is told before saving rather than after.

A higher tier can never wait longer than a lower one. Paying more can only ever help, and the public delay is checked against the paid tiers too, so "everyone else" is always the longest wait.

No delay may exceed 900 seconds, which is 15 minutes, for any tier. The public delay is additionally bounded by a constraint in the database table itself.

A leader can also cap the copy size per tier, so an early tier cannot exhaust the leader's capacity before later tiers get a fill. That cap is applied after the copy engine has sized and gated the order, so the copier's own caps always bind first, and a cap that would push an order under the copier's minimum is recorded as a skip rather than filled as dust.

### Disclosed before you subscribe

A delay discovered from an empty inbox is the version of this feature that destroys trust. So the seat a copier gets is shown on the leader's copy panel before they subscribe, along with the full ladder and the leader's disclosure. The leader can write their own disclosure sentence, but a standing platform sentence is appended to every one and cannot be removed: this is the leader gating their own call as a subscription, it is not privileged access to anyone else's orderflow, and every trade still lands in the leader's public track record.

### A fairness warning computed from the leader's own record

A ladder can be honest and still sell something worthless. If the slowest tier waits longer than the leader's edge lasts, that tier is buying a signal that has already been spent. three.ws measures that half-life rather than assuming it: the median hold time of the leader's own profitable closed positions, over their most recent 200, and null when there are fewer than five such closes, rather than a guess from a thin sample. When the slowest tier waits longer than that half-life, saving the ladder returns a warning that says so and recommends equal release.

A leader can ask the LLM chain to suggest a ladder, but the draft passes through the same validator as a hand-written one, so a model cannot talk a ladder past a rule, and nothing goes live until the leader saves it.

### What alpha-drip is not

It is a leader selling the latency of their own self-produced signal, the same thing a paid signal group has always sold, except enforced by the fan-out instead of by trust. It is not access to anyone else's orderflow. three.ws does not route third-party orders, has nothing to reorder, and no code path in this feature reads another trader's pending activity.

## The signal marketplace: closed signals are public, open ones are the product

At /signals, verified traders publish live feeds that subscribing agents pay for per signal or per epoch over x402, and auto-mirror through the same guarded trade path. The integrity rules carry over.

Every signal is minted from the publisher's real position ledger, bound to the actual buy and sell signatures, so a publisher cannot hand-author a winning call they never took or hide a loss. Feeds are ranked by proven realized edge, regressed toward the publisher's verified track-record score until enough signals close; a feed with fewer than 10 closed signals is flagged as still building its record. Every closed signal is returned in full to everyone, coin and transaction links included, because that is the verifiable record the feed sells itself on. Only still-open signals are withheld from non-subscribers. Delivery is pay-then-trade: if the payment is blocked by a spend cap or fails, the delivery is marked unpaid and the mirror is skipped. A simulate mode mirrors and sizes without paying or trading, so a subscriber can watch a feed behave before committing.

## Performance fees that cannot bill the same profit twice

A leader can charge a performance fee on a copier subscription, capped at 30 percent. The math is published and its one estimate is labelled as an estimate: a copier's profit on a copy is their committed size multiplied by the leader's realized return on the matching closed position. That is a stated basis, not a measurement of the copier's own fill.

A high-water mark only ever ratchets up. Losing copies lower the cumulative profit, and only profit above the previous peak is billable, so a drawdown followed by a recovery is never charged twice. Fees settle in $THREE through a two-call flow (a quote, then a verified on-chain settlement), with the split fixed by policy: 80 percent to the leader, 15 percent to the treasury, 5 percent to holders. The settle call only accepts a quote issued for one of the caller's own subscriptions.

## What the system can and cannot say, in one place

Pulling the guarantees together, mechanically:

A closed losing round-trip cannot be removed from a trader's computed record. There is no parameter that excludes it, and the leaderboard, profile and attestation all use one pure function over the same ledger.

Self-dealing profit cannot be credited. It is split out and its size is published.

A record built in one burst, out of dust, or by copying yourself cannot make a leader copyable or buy follower score.

A trader's headline numbers are committed daily to Solana and can be re-checked by anyone against any RPC node, without trusting a three.ws database, and every credential reports its own age and drift.

A trade receipt cannot cite evidence recorded after the exit, and cannot present a model verdict that came after the entry.

A ghost-copy replay always ships its honesty sentences in the API response, never folds open positions into its realized number, and says it is a ceiling because slippage and fees are not modelled.

An alpha-drip ladder cannot hide a trade, cannot make a higher tier wait longer, cannot exceed 15 minutes, cannot be acted on early, and cannot be subscribed to without the seat and the standing disclosure on screen first.

What none of this does is make a trader good. A real record can be a losing record. A ceiling is not a forecast. Copying can lose money, and every surface above says so in its own words.

## The honest numbers

This article quotes no returns, no win rates, no copier counts and no trader scores, because those move by the hour and the point of everything above is that you can read them yourself rather than take them from a blog post.

Two platform figures, read on 2026-10-08 from GET /api/three-token/stats: 4,356 registered agents, and 15,170 $THREE holders.

Price, market cap, 24-hour volume and liquidity are on the same endpoint. They move. Read them; do not quote this article.

## Where to look

Everything above is open source at github.com/nirholas/three.ws.

The surfaces, all live on three.ws:

/leaderboard for ranked traders, each linking to a profile with the Proof tab, the passport and per-trade receipts.

/mirror for the custodial agent mirror and its leaderboard.

/ghost-copy for replays against your own budget.

/copy-coach for the guided first copy.

/signals for the signal marketplace.

/meta-allocator for the same cautious question answered with a basket instead of a single leader.

/vaults for copying with real money under segregated custody and hard spend limits.

/three-token for the $THREE tiers that alpha-drip ladders are priced in.

/dashboard for your copy subscriptions, intents and, if you lead, your signal release ladder.

The documentation, written for builders: /docs/copy-trading, /docs/trader-passport, /docs/ghost-copy, /docs/alpha-drip, /docs/trade-receipts, /docs/copy-coach and /docs/signals.

The coin is $THREE on Solana at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump.

Nothing here is financial advice. Check the record, not the screenshot.
