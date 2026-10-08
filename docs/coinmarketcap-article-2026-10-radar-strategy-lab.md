---
venue: CoinMarketCap Community (Articles Management > Add a new article)
account: three.ws (official)
categories: Solana, AI, Trading
assets: THREE
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
format_notes: |
  CMC caps the title and the meta description at 191 characters each. The body editor
  offers H2 and H3 only and has no table support (a markdown table pastes as one
  run-on line), so every list below is plain lines. Owner directive: positive framing
  only, so the body describes capabilities and design choices and carries no
  limitation sections, cautionary warnings or disparaging contrasts. Opening sections
  are written for newcomers; the technical depth sits in the middle and end. Cover
  art: 640x360 or that proportion, under 10 MB.
accuracy_notes: |
  Live figures ($THREE holders, registered agents) were read from
  https://three.ws/api/three-token/stats on 2026-10-08 and are labelled with that date.
  Coin Radar mechanics (90-second window, 3-second burst and 5-second snipe windows,
  quality formula, smart-money bonuses, risk-flag thresholds, 12-second poll, keyboard
  shortcuts, the pulse strip, designed empty, no-match and error states, the coin page
  and Fork flow, the public API forms) come from docs/radar.md and src/radar.js. Smart
  Money Radar scoring, labels and the 20-second poll come from docs/smart-money.md;
  the firehose volume (about 32,000 mints a day) is quoted from the same doc. Fade
  Radar definitions, the 0.6/0.4 score weights, verdict bands, the time-split
  calibration method and its figures (26,626 labelled coins as of 2026-09-09; clear
  22,473 at 22.1 percent, caution 3,541 at 15.7 percent, avoid 612 at 1.8 percent), the
  API forms, the coin-read fields and the exported pure functions come from
  docs/fade-radar.md. Those calibration figures are historical base rates of coins
  going on to win, not returns, and are labelled with their measurement date. Today an
  agent consumes the fade read through the public endpoint or the read module, which
  the body states without claiming any sniper-gate wiring.
  Strategy Object schema, bounds, defaults, versioning, fork lineage, the leaderboard
  rule (aggregated from closed positions, Unproven when there are none, ranked by ROI
  with trade counts shown), the assisted scan, and DCA pause and resume come from
  docs/strategy-objects.md, api/_lib/strategy-schema.js and api/strategies.js.
  Strategy Lab behaviour comes from api/pump/[action].js and
  examples/skills/pump-fun-strategy/handlers.js. The Lab backtest is described as a
  check that a strategy behaves as written, the framing docs/strategy-objects.md uses.
  Sniper backtester behaviour (7/30/90/180-day windows, 6,000-launch cap, 30-minute
  cache, confidence tiers at 10 and 30 matches, peak and terminal exit model, slippage
  and impact model, creator priors computed from earlier launches only, the caveats
  field, the insufficient-data verdict) comes from api/sniper/backtest.js and
  api/_lib/strategy-backtest.js. The equipped-strategy cadence (every 2 minutes, 200
  equips and 3 entries per equip per sweep) comes from vercel.json and
  api/cron/strategy-fanout.js. Sniper fleet pipeline, exit priority and the first live
  trade's execution facts come from docs/agent-sniper.md; that trade's ticker and
  return are deliberately left out. Exit Lab knobs and replay mechanics come from
  docs/exit-lab.md. Signal Marketplace ranking, billing and kill behaviour come from
  docs/signals.md. Partner designations and statuses come verbatim from
  docs/partners.md and docs/listings.md: OpenAI Select Partner, IBM Business Partner
  (with the independent-tools distinction from docs/ibm.md), AWS Partner with the
  Marketplace listing described as coming, Google Cloud for Web3 Startups member,
  Alibaba Cloud International Marketplace listing live, NVIDIA Inception member,
  HackerNoon publishing partnership, Quicknode Startup Program accepted. The Official
  MCP Registry listing (including threews-pumpfun) is from docs/listings.md. No
  partner is described as endorsing three.ws. No win rate, return, or profit figure
  for any strategy appears in this article. Every page path was checked against
  data/pages.json on 2026-10-08.
---

# CoinMarketCap article: reading the launch firehose

Paste-ready for the CoinMarketCap form.

## Title (142 characters)

```
Reading the Solana Launch Firehose: How three.ws Coin Radar, Fade Radar and the Strategy Lab Turn the First 90 Seconds Into Rules You Can Test
```

## Meta description (185 characters)

```
A guide for Solana launch traders: a radar that scores every pump.fun launch, a wallet-graph read on every buyer, strategies written as data, and backtests built on real launch history.
```

## Body

---

Every day, tens of thousands of new coins launch on pump.fun, the Solana launchpad where anyone can create a token in seconds. The platform's own documentation puts it at roughly 32,000 new mints a day. Nobody can read all of that by hand, so everyone who trades it uses some kind of filter: a written rule, a group chat, or a feeling formed in the first few seconds of a chart.

This article is about making that filter explicit. On three.ws you can see a score for every new launch, check who is buying it, write your trading idea down as a clear set of rules, test those rules against real launch history, and then let an AI agent run them from its own wallet with safety checks built in.

We start in plain language for anyone new to on-chain trading, then go deeper into how each piece works. Everything here is open source, Solana first, and every page mentioned is live.

$THREE is the platform's coin, at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump on Solana. As of 2026-10-08 the live stats endpoint reports 15,170 holders and 4,356 registered agents on the platform.

## The short version

Coin Radar shows every new pump.fun launch with a quality score from 0 to 100, based on how people traded it in its first 90 seconds.

Smart Money Radar shows which wallets have a strong track record of picking coins that go on to graduate, and what they are buying right now.

Fade Radar reads the same wallet history from the other side, telling you how much of a coin's buying comes from wallets that have never yet picked a winner.

Strategy Objects let you write a trading idea as a structured set of rules: when to buy, how much, and when to sell.

The Strategy Lab lets you check those rules, test them on real coins, and run them in a no-money simulation before anything goes live.

The sniper backtester replays your rules over up to 180 days of recorded launches and tells you what they would have done, along with how much data stands behind the answer.

AI agents on three.ws can then run your strategy from their own Solana wallet, inside spending limits you set.

## A few words you will see

A bonding curve is the pricing formula a new pump.fun coin trades on before it has a regular market. Once enough people buy, the coin graduates to a regular automated market.

A launch is the moment a new coin is created and starts trading.

Bundling is when several wallets, often funded from the same source, buy a coin at almost the same instant. It can make a launch look busier than it is.

Smart money means wallets with a proven record of buying coins that went on to graduate.

A backtest replays a set of trading rules over past data to see what they would have done.

Simulate mode runs a strategy against the live market without spending anything, so you can watch it work before trusting it with real funds.

## Why the first 90 seconds matter most

The first minute and a half of a pump.fun launch is when the most is revealed about who is really buying. In that window you can see whether buyers arrive spread out over time or in a single coordinated burst, whether they bought identical amounts, whether the creator kept their tokens, and whether wallets with a strong history are among them. That information is on chain, but it moves far too fast to read by eye.

The Coin Intelligence Engine reads it for you. It runs inside the platform's agent sniper worker, holds a live websocket to the pump.fun trade stream, subscribes to every new mint, and watches a fixed 90-second window with the creator's launch buy counted as trade zero. When the window closes, a deterministic scoring function reads what happened, enrichment folds in category classification, funder clustering and a smart-money cross-reference, and the record is written to Postgres. A serverless twin shares the exact same finalise path, so a record is byte-identical however it was produced.

Coin Radar is a read model over that record. It computes nothing itself, and that is a deliberate strength: the number on the board is the same number an agent strategy gates on and the same number the backtester replays.

## Coin Radar: a screener for the first 90 seconds

### The board at a glance

three.ws/radar shows a market pulse strip, a grid or list of scored launches, and a detail drawer. The pulse strip summarises the whole tape: launches observed in the last 24 hours and the last hour, the split between healthy, mixed and risky launches, and the share touched by smart money or flagged.

The toolbar filters by narrative category, minimum quality, smart-money-only and news, and can hide flagged coins. You can sort by newest, quality, smart money, buyers or volume. Keyboard shortcuts make it quick: press / to search by name, ticker or mint, g or l to switch between grid and list, and r to refresh. Every filter serialises into the URL, so any filtered view is a shareable link.

The board polls every 12 seconds and pauses while the tab is hidden, and an "updated N seconds ago" label shows exactly how fresh the view is.

### What gets measured

Signals are measured from the first observed trade, with a 3-second burst window and a 5-second snipe window.

The bundle score (0 to 1) needs at least 4 buys, at least 4 of them inside the burst, and blends burst density with the share of near-identical buy sizes, since coordinated wallets tend to be funded with identical amounts.

The organic score (0 to 1) blends buyer diversity, timing entropy, and the inverses of bundling, snipe ratio and top-holder concentration, then is adjusted for a dev sell, fresh-wallet dominance and funder connectivity.

The snipe ratio is the share of buy volume inside the first 5 seconds. Concentration is reported for the top 1, 5 and 10 wallets. Dev behaviour records whether the creator sold and how much they bought at launch. The fresh-wallet ratio is the share of buyers with at most one prior transaction, and connectivity is the largest cluster of buyers sharing a funder.

### From signals to one number

These roll into a quality score from 0 to 100. It starts from the organic score times 100, subtracts for bundling, top-holder concentration, a dev sell and fresh wallets, adds a small bonus for unique buyers, then adds smart-money bonuses per proven wallet present (8 for the first, 6 for the second, 4 for the third, up to 18 in total), and clamps the result. The board shows 70 and up as Healthy, 40 to 69 as Mixed, and below 40 as High risk. A coin that has not been scored shows as Unscored rather than zero, because a missing measurement and a measured zero are different things, and a signal that was not measured reads "not measured".

### Every flag has a name and a threshold

Alongside the score, every coin carries named flags with exact thresholds, so you always know precisely what triggered them.

bundle_launch at a bundle score of 0.6 or more.

dev_dumped when the creator sold.

single_whale when one wallet holds half or more of net buys.

low_diversity under 5 buyers.

fresh_wallet_swarm when 70 percent or more of buyers are fresh wallets.

sniped at a snipe ratio of 0.85 or more with fewer than 8 buyers.

coordinated_cluster at a connectivity of 0.4 or more.

sell_pressure when at least 3 sells push the buy-to-sell ratio below 1.

### A board that always tells you where you are

Radar's search, category, minimum quality, smart-money and news filters run on the server, so the board decides which empty state to show from your filter state rather than from the shape of the response. With filters active and nothing passing, it says "No coins match these filters", confirms the radar is live and still scoring, and shows every active filter as a removable chip so you can loosen exactly the one you want. With no filters set, an empty feed shows the "Radar is clear" state, which explains the observation window and links to the raw launch feed.

The same care runs through the rest of the page. Loading uses a skeleton grid. Background polls keep the coins already shown in place, so the board stays steady. The pulse strip is its own request with its own retry, so the feed below keeps working independently.

### From a card to a decision

Click any coin to open the drawer: the full signal grid, a top-50 wallet ledger, the smart-money roster, the labelled outcome once one exists, and the Oracle conviction read. Every mainnet coin also has a full page at three.ws/oracle/coin/ plus its mint, rendered in the markets-hub design with a live price chart, the complete launch intelligence read, Oracle conviction, live market intel, agent transactions and a live trade tape.

From there you can add a coin to your Watchlist, open it in Mission Control at three.ws/terminal, or use Fork, which opens a real pump.fun trade panel for that mint right on the page, with a live quote, the safety firewall's verdict, and your own browser wallet as the signer.

### The Radar API

The feed is public, IP rate-limited and needs no account. /api/pump/coin-intel returns the newest launches with the engine's first-90-seconds read, with parameters for network, sort, limit and smart-money-only. Adding stats=1 returns the market pulse aggregate. Adding a mint with wallets=1 returns one coin's full intel plus its top-50 wallet ledger. A few lines of JavaScript are enough to pull the feed and keep only launches with a quality score of 70 or more and no bundle_launch flag.

## Smart Money Radar: the pedigree layer

Coin Radar adds bonuses for proven wallets, and Smart Money Radar is where those wallets come from. three.ws/smart-money is a live, first-party reputation graph of pump.fun wallets, earned entirely from on-chain outcomes rather than a hand-curated list. It polls every 20 seconds and has three tabs: what smart money is buying right now, the top wallets leaderboard, and a personal watchlist of up to 200 mints.

A rollup job judges each coin six hours after launch: a coin that graduated is a win, anything else a dud. For the top 60 buyers of each judged coin, it folds the result into that wallet's record, counting an entry as early when the wallet's first buy landed within 180 seconds of the coin's first trade.

A wallet's score combines its win rate, a bonus when its early entries do better than its average, and a deduction for dumping, all scaled by confidence that reaches full strength at 12 judged coins. Labels follow from the profile: smart_money at a score of 70 or more, or a sustained edge of a 35 percent win rate over 8 or more judged coins (against a platform base rate of around 12 percent); fresh under 4 judged coins; and distinct labels for dumpers, snipers and repeat launchers with no graduations.

Each live coin then gets a buy-weighted pedigree score from its non-creator buyers plus a network bonus of 4 points per proven wallet (capped at 20), and a notable roster of its top 8 wallets, each re-resolved to its live label. This is the same proven-wallet ledger the WHO pillar of the Oracle conviction model draws on.

## Fade Radar: reading the other side of the wallet graph

Smart Money Radar asks which reputable wallets are buying a coin. Fade Radar asks the mirror question: how much of a coin's buy side comes from wallets that have watched many coins resolve and have not yet held a single winner? It answers with a 0 to 100 fade score, a verdict, and the measured odds behind each verdict.

### The definition

A reverse indicator is a wallet the platform's wallet graph has watched buy at least 5 coins with known outcomes, none of which won. A win is a coin that graduated to an automated market or peaked at 3x or better on market cap, taken from the same labelled ground truth the intelligence engine learns from. A wallet under the 5-coin bar is simply new and never appears. Reverse-indicator status is read live from the same wallet reputation graph that powers Smart Money Radar, so both sides are always equally fresh.

### The score and the verdict

Over a coin's observed buyers, excluding the creator:

fade_score = round(100 x (0.6 x buyer share + 0.4 x volume share))

Both shares count because they capture different things: many small wallets are a crowd, one large buy is conviction, and the score reads both. When no buy volume has been recorded yet, the buyer share carries the whole score.

The verdict follows buyer share. Fewer than 5 observed buyers is unknown, since that is too thin to read. No reverse indicators is clear. Some presence under 25 percent of buyers is caution. 25 percent or more is avoid. The creator is excluded because a developer's own supply is already covered by the dev-sold and concentration signals, and would otherwise count once in every coin they launched.

### An out-of-sample calibration

A wallet's record is built from coin outcomes, so Fade Radar measures its bands with a time split. It divides labelled history in half by label time, rebuilds the reverse-indicator cohort from the earlier half only, and measures how often coins labelled in the later half went on to win, band by band. The later coins could not have shaped the cohort that judges them, so the measurement is genuinely out of sample.

The documentation records the result as of 2026-09-09, over 26,626 labelled coins. The clear band, 22,473 coins, went on to win 22.1 percent of the time. Caution, 3,541 coins, 15.7 percent. Avoid, 612 coins, 1.8 percent. These are historical base rates of a coin graduating or reaching 3x, measured on the held-out half. The page recomputes them from live history at most every 12 hours, so three.ws/fade always shows a dated measurement.

### How a fade read is used

On a bonding curve, the way to act on a fade read is simply to pass on the coin. Fade Radar is a read-only signal: the page never emits a trade and never signs anything, and every wallet on the fade board links straight to its full track record on Smart Money Radar.

### The Fade API and agents

The public endpoint at /api/pump/fade serves four reads: the live coin board (coins from the last few hours with reverse-indicator money in them), a per-coin read with the reverse-indicator wallets inside it, the reverse-indicator wallet board sorted by record, and the calibration itself. A coin read returns the score, the verdict, buyer counts, the buyer and volume shares, a confidence, the notable wallets with their judged buys, and a one-sentence plain-language summary. A coin the engine has not observed resolves cleanly with computed set to false, so a detail page can always render.

An agent can call the read module directly and pass on any coin with an avoid verdict in a few lines of code. The scoring, verdict and summary functions are also exported as pure functions, so a caller that already has a coin's buy side in hand can score it with no database round trip.

## Strategy Objects: a trading idea as data

A Strategy Object is a structured, validated rule set with a real owner and a real track record. Every config is normalised and validated before it is saved, so a stored strategy always carries well-formed, bounded values into the runtime.

### The four sections

Entry: a new-launch trigger, a maximum age, an optional market-cap band, minimum liquidity, a socials requirement, creator-history gates (how many coins the creator launched before, and how many of them graduated), and a SOL-quote requirement.

Sizing: SOL per trade and maximum slippage.

Exits: take-profit, a mandatory stop-loss, an optional trailing stop, and a maximum hold. Every strategy carries a stop-loss and at least one upside exit.

Risk: maximum concurrent positions and a cooldown.

### Bounds and defaults

Every field has hard bounds: 0.0001 to 100 SOL per trade, a stop-loss between 1 and 99 percent, 1 to 50 concurrent positions, and a maximum age of seven days. The defaults are 0.1 SOL per trade, 500 basis points of slippage, a 100 percent take-profit, a 40 percent stop-loss and 3 open positions.

Two pure functions decide entry and exit, and the same two run in the live runtime and in the assisted scan preview, so a rule means exactly the same thing everywhere it runs. The assisted scan lets an owner preview which real launches a strategy would match right now. It is owner-scoped and rate-limited per IP and per owner, and when the live launch feed is unreachable it says so explicitly rather than returning an empty scan, so "nothing matched" always means nothing matched.

### Versioning, forking and publishing

The library lives at three.ws/strategies, with the marketplace of published strategies, the leaderboard and your own library on one page. The full-page builder keeps its state in the URL, so it survives a reload and the back button.

Editing a config bumps its version, and agents that already equipped it keep their snapshot until re-equipped, so an edit never silently changes what a running agent does.

A published strategy can be forked by anyone signed in. A fork copies the rules only, starts at version 1 under the forker's ownership, records the source strategy and version, credits the author, and counts toward the original's fork total. The forker runs the rules under their own agent's spend policy, and no wallet access ever moves. Deleting a strategy deactivates its equips, and open positions stay with their owner to manage.

### The leaderboard

The leaderboard ranks published strategies by real return, aggregated from closed on-chain positions across every agent that equipped them. A strategy with no closed positions is labelled Unproven and is never given a synthetic curve. Each entry shows its closed trade count, wins and losses alongside its return, so a reader can weigh every ranking by the sample behind it.

### Scheduled buys

For recurring buys, three.ws also supports DCA strategies: validated schedules with an agent, a signed delegation, tokens in and out, an amount per execution, a daily or weekly period, and slippage capped on the server. A schedule can be paused and resumed. On resume, the next execution is scheduled a full period out, so periods missed while paused never fire as a burst, and every strategy stays visible in the agent's list with its full history whatever its status.

## The Strategy Lab: validate, test, run

three.ws/strategy-lab is the workbench. It uses a small declarative spec with four parts: a scan (new tokens, trending tokens, or a list of mints), filters, an entry, and exit rules. Filters and exits are simple predicates, such as "top holder share under 20", "creator rug count equals zero" or "sell half when the position is up 50 percent", read from a view of the coin's holders, creator, bonding curve, trades and, once open, the position. One compiled evaluator powers validation, backtest and live runs, so all three always agree.

### Validate

Validate needs no sign-in and returns field-level issues, so you can fix a spec line by line. Backtest and run repeat the same check first, so every run starts from a clean spec.

### The Lab backtest: a fast check that a strategy behaves as written

The Lab backtest (sign-in required) is the quickest way to confirm your spec does what you meant on real coins. For each candidate mint it fetches the token's details, holders, bonding curve, creator profile and up to 200 trades from real recorded on-chain history. Candidates come from your own mint list or from a live scan of new or trending launches, read from pump.fun's public feed and the platform's own launch recorder, so no external indexer is needed. It evaluates the entry gate, enters at the first trade in that history, and walks forward through the real trades until an exit rule fires.

It reports spend, realized PnL, ROI, trade count, win rate, maximum drawdown, every individual trade and the mints used. It never synthesises a launch or invents a price path. For a statistical read over a large universe of launches, the sniper backtester below is the right tool, and the two work well together.

### Run: simulate first

A run lasts 5 to 600 seconds and streams entries, exits and logs live over Server-Sent Events. Simulate mode needs no wallet and spends nothing, so you can watch your strategy react to the live market risk free. Live mode needs sign-in, an accepted real-funds agreement on mainnet, and an agent you own with a Solana wallet, and every buy passes the same spend-policy check the rest of the platform uses. Close-all exits open positions on demand.

## The sniper backtester: real launch history, at scale

The second backtester, at POST /api/sniper/backtest, is built for the statistical question: across hundreds or thousands of real launches, what would these rules have done? It also lives inside an agent's Snipe tab in the agent wallet, where you can describe a strategy in plain English, have it compiled into a validated config clamped to that agent's spend guards, and backtest it before anything is armed.

### What it replays

It replays every launch the intelligence engine observed, with its signals, joined to the coin's labelled outcome (graduated, pumped, flat or rugged), its peak multiple and its last market cap. Only launches with a real label are used. You pick a 7, 30, 90 or 180 day window, and a run considers up to 6,000 labelled launches, reporting the universe size alongside the sample.

Entries are decided by the exact scorer the live sniper runs, and exits by the exact exit function it runs. The backtester feeds production code rather than reimplementing it, so a rule means the same thing in a backtest as it does live.

### How it models a trade

The capture holds two real price points per launch: the peak and the final value. As price climbs to the peak, take-profit is evaluated; on the way down, stop-loss and then trailing stop are evaluated at the final price, and a position with no exit is valued at the final price.

Costs are modelled too. Entry cost is inflated by slippage (500 basis points by default) and by a price-impact estimate based on the coin's recorded early buy volume relative to your trade size, and exits are reduced by slippage. Launches over your maximum price impact are skipped, just as they would be live. With no trade size set, a notional 0.1 SOL is assumed and the response says so.

Creator history is computed carefully: prior launch and graduation counts come only from coins that creator launched before the one being scored, so each decision sees only what was knowable at the time. Every response carries a caveats field describing the run's assumptions in plain words.

### What it returns

You get win rate, expected value per trade, the median, the 10th and 90th percentile, the best and worst trade, net PnL, maximum drawdown, an exit-reason breakdown, the outcome mix of the coins your rules entered, sample hits and misses, and how many launches were skipped and why.

Every result carries a confidence label based on its sample: low under 10 matching launches, medium under 30, and high from 30 up. When nothing matches, the response is an explicit insufficient-data verdict that says whether the history is empty or the filters are too strict, the same idea as Radar's no-match state applied to backtesting. Results are cached for 30 minutes by a hash of the trade-determining fields and linked to the agent, so its profile can later compare projected results with realized ones.

Used well, a backtest answers practical questions quickly: how your filter's entries split across graduated, pumped, flat and rugged outcomes, which exit rule closes most of your positions, how deep a drawdown your sizing would have weathered, and whether your rules are selective enough to pass anything at all.

## Exit Lab: tuning the exits on real trades

three.ws/exit-lab answers a complementary question: were the exits on real fleet trades the right ones? It takes positions the agent fleet genuinely opened and closed on chain and re-runs each one through the exact laddered exit code the live worker runs, with the rules changed to whatever you choose.

The knobs are the hard stop-loss (35 percent by default), the trailing stop (25 percent, armed only once a position has been green), a take-profit ceiling (off by default), the take-initials multiple at which the stake comes back off the table (2x), and the moon-bag floor that always keeps riding on a profitable exit (15 percent). Every entry price, high-water mark and final quote is a recorded number from a real position, the corpus excludes anything simulated, and the replay runs instantly in your browser against the same kernel the server uses, so every slider move updates on the spot. The underlying data is public at /api/sniper/exit-lab, and the replay kernel is a pure module anyone can import.

## Where agents come in

### An agent running a strategy

Equipping a strategy attaches it to an agent you own. A scheduled sweep runs every two minutes: for each active equip, up to 200 per network, it checks real pump.fun launches against the entry rules, takes at most 3 new entries per equip per sweep, and re-quotes open positions on chain to decide exits. That cadence suits rules that judge launches over minutes; the first seconds of a launch are the sniper fleet's job.

Every strategy trade passes the same guards as any agent trade: the owner's strategy kill switch, the per-equip active flag, the agent's per-trade cap, its daily budget and USD ceiling, the price-impact breaker, the rug and honeypot firewall, and SOL fee headroom. The strategy's caps sit on top of all of these, so a strategy only ever adds constraints. A retried entry cannot double-spend, and every trade lands in the custody ledger tagged with its strategy.

### The sniper fleet

The first seconds of a launch belong to the agent sniper, a long-lived worker that fires on the new-mint feed, a creator's first fee claim, intel and radar signals, a coin's migration, or its first Oracle conviction crossing. A coin must pass the entry scorer (the same one the backtester replays), a fleet-wide market-cap band a strategy can narrow but never widen, a filter excluding pump.fun Mayhem-mode tokens, and a firewall that runs a real simulated buy and sell on chain to prove the coin can be sold. Only then does the executor sign from the agent's custodial wallet. Exits run in strict priority: stop-loss, signal flip, trailing stop, take-profit, timeout.

Every buy writes a hash-chained entry to the agent's decision ledger with its inputs, rationale, a falsifiable prediction and a confidence, and the chain head is anchored on Solana so the history can be verified independently. The fleet is public at three.ws/sniper/experiments, refreshed every 30 seconds, with each arm's wallet, live balance and full reasoning ledger.

The fleet's first live trade, on 2026-07-19, shows the gates at work: its strategy scanned launches for roughly nine days before one coin cleared every gate, the firewall's round trip returned a score of 100, and the transaction landed in 1,709 milliseconds with 0.05 percent price impact.

### How the pieces connect

Radar's quality score, bundle score, top-holder concentration, dev-sold flag and category are exactly the fields a sniper strategy gates on and the backtester replays. "Minimum quality 60, maximum bundle 0.5, avoid a dev dump" means the same thing on the board, in the backtest and in the live worker. Fade Radar plugs in through its public endpoint or read module, so an agent can add an avoid-verdict check to its own logic in a few lines.

### Alpha Copilot and the Signal Marketplace

three.ws/alpha-copilot lets an agent read a live launch aloud, grounded in fetched liquidity, holder and smart-money data, with any figure that does not match the fetched data replaced before it is spoken.

three.ws/signals is a marketplace of live trading feeds published by verified traders, where every signal is minted from the publisher's real on-chain fills. Your agent subscribes, pays per signal or per epoch in USDC over x402, and mirrors each call through the same firewall and spend policy it always runs under. Feeds are ranked by proven realized edge, regressed toward neutral until a feed has 10 closed signals and flagged "Building track record" until then. Closed signals are public in full with their Solscan links, subscribing in simulate mode mirrors without paying or trading, and a kill switch halts all further payment and trading the instant it is set.

## A workflow for a Solana launch trader

Watch three.ws/radar with no filters until you know what a normal hour looks like. Add filters one at a time, and use the filter chips to see exactly what each one does.

Check three.ws/smart-money and three.ws/fade on anything that catches your eye. Proven buyers and a clear fade verdict are two quick reads on who is in a coin.

Write your rule as a Strategy Object with a stop-loss you are comfortable with. Validate it in the Lab and run a Lab backtest on a handful of coins to confirm the spec behaves as written.

Run a sniper backtest over 30 or 90 days. Read the sample size, the confidence label and the caveats alongside the metrics. If it reports insufficient data, loosen a filter or widen the window.

Run the strategy in simulate mode and watch the live stream. When you go live, start small, set a daily budget, and follow every decision in the ledger.

Tune your exits in Exit Lab, and publish your strategy to the library so others can fork it with credit to you.

## Our partners

three.ws is built alongside a set of cloud, AI, infrastructure and media programmes, listed in full at three.ws/partners. Each designation below is the programme's own, and three.ws remains an independent company in all of them. Several connect directly to the tools in this article.

Google Cloud. three.ws is a member of Google Cloud for Web3 Startups, and production runs on Google Cloud. The API behind Radar, Fade Radar, Smart Money Radar, the strategy library and both backtesters runs on Cloud Run, the agent sniper worker that hosts the Coin Intelligence Engine is its own Cloud Run service, and the scheduled jobs (the two-minute strategy sweep, the smart-money rollup) run on Cloud Scheduler.

Quicknode. three.ws was accepted into the Quicknode Startup Program in 2026-07 with approved infrastructure credits. Server-side Solana calls across the platform run through an RPC failover chain, and Quicknode is a rung in that chain, adding capacity and redundancy behind agent wallets, x402 settlement verification and live market data, the kind of calls that on-chain re-quotes and firewall simulations rely on.

NVIDIA. three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. NVIDIA-hosted models run a large share of the platform's AI, including rungs of the LLM failover chain behind the agents described here, and every 3D generation lane on three.ws runs on NVIDIA hardware.

OpenAI. three.ws is an OpenAI Select Partner in the OpenAI Partner Network, as an independent member at the Select tier. The free three.ws 3D Studio connector gives ChatGPT eleven keyless 3D tools, and the main three.ws MCP server is a public OAuth 2.1 server that any MCP client can connect to.

IBM. three.ws is an IBM Business Partner. Alongside that, the platform publishes an independent set of developer tools built on IBM's openly available Granite models, including Granite TimeSeries forecasting, rendered as a walk-around 3D forecast of a live token's price history inside three.ws/play.

Amazon Web Services. three.ws is an AWS Partner. The AWS Marketplace SaaS integration is built and deployed, and the Marketplace listing is coming. Once it is live, subscribing will link an AWS account and issue an x402 access key, the same payment rail the Signal Marketplace uses.

Alibaba Cloud. The three.ws listing on the Alibaba Cloud International Marketplace is live, and Alibaba Cloud Marketplace published an editorial feature introducing the platform. Qwen models are first-class lanes in the three.ws model router.

HackerNoon. three.ws has a builder-focused publishing partnership with HackerNoon for feature articles, tutorials and developer guides, with posts imported from the three.ws announcements feed.

Beyond the programmes, the three.ws MCP servers, including a dedicated pump.fun server, are published on the Official MCP Registry, and pump.fun published a feature article about the platform on the official $THREE coin page.

## Where to look

Everything in this article is open source at github.com/nirholas/three.ws.

Live surfaces: three.ws/radar, three.ws/smart-money, three.ws/fade, three.ws/strategies, three.ws/strategy-lab, three.ws/exit-lab, three.ws/sniper/experiments, three.ws/alpha-copilot, three.ws/signals, three.ws/terminal and three.ws/partners.

Live $THREE figures are at https://three.ws/api/three-token/stats.

Nothing here is financial advice.
