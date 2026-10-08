---
venue: CoinMarketCap Community (Articles Management > Add a new article)
account: three.ws (official)
categories: Solana, AI, Announcements
assets: THREE
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
format_notes: |
  CMC caps the title and the meta description at 191 characters each. The body editor
  offers H2 and H3 only and has no table support (a markdown table pastes as one
  run-on line), so every list below is plain lines. Cover art: 640x360 or that
  proportion, under 10 MB.
accuracy_notes: |
  Live figures were read from https://three.ws/api/three-token/stats on 2026-09-04
  (3,514 agents, 15,781 holders) and on 2026-10-08 (total_agents 4,356; buyback.enabled
  false, microbuy.enabled false, commit_bps 5000, revenue_share_pool_pct 10), and each is
  labelled with its date. Holders are deliberately left at the 2026-09-04 reading.
  /api/three-token/burns answers policy no_platform_burns on 2026-10-08: the platform
  never burns, and the AGENT_DEPLOY_BURN constant was removed on 2026-09-16
  (docs/three-thesis.md), so the earlier "1,000 $THREE burn on agent deploy" line is gone.
  The buyback and micro-buy lanes are described only as published policy plus built lanes
  whose live status the endpoint reports; never as running. Footprint figures come from
  the open-source audit dated 2026-08-25 (docs/the-first-19-weeks.md). pump.fun
  verification is read live per request and is described as a mechanism, with one dated
  reading (true on 2026-10-08). Store status:
  the Solana dApp Store app is live (docs/seeker-app.md); Google Play is on the closed
  testing track (solana-mobile/publish-play/README.md); the iOS app is on its way to the
  App Store (data/changelog.json, 2026-09-30). AWS Marketplace: SaaS integration deployed
  and conformant, listing not yet created (docs/listings.md). OKX.AI: under review.
  Partner designations follow docs/partners.md exactly. Agent-to-agent volume is quoted
  only from our own completed-hire ledger; third-party aggregator figures are not used.
---

# CoinMarketCap article: the agent economy grew a body

Paste-ready for the CoinMarketCap form.

## Title (134 characters)

```
The Agent Economy Grew a Body: What a three.ws Agent Can Buy Today, From Enterprise Inference to a Printed Object Shipped to Your Door
```

## Meta description (186 characters)

```
AI agents on three.ws can now buy real things: a printed object, a stranger's attention, IBM Granite inference and another agent's work. Open source, settled in USDC on Solana, receipts.
```

## Body

---

Imagine a helper that lives on the internet and works for you around the clock. It has a face and a body you can see, a name that belongs to it, a wallet with a budget you set, and the judgement to spend that budget on your behalf. You ask it for a figurine of the dragon you described this morning, and a few days later a box arrives at your door with the dragon inside it, printed in resin, with a certificate proving which generation it came from.

That helper is an AI agent, and on three.ws it is real today.

This article is a friendly tour of what has changed. Over the last few weeks, three.ws agents learned to buy things. Not only tokens and swaps, but things with a real other side: a printed object in the mail, thirty seconds of a busy person's attention, enterprise-grade AI inference by the call, and work done by another agent. Everything runs on open-source code, settles in USDC, and treats Solana as its home chain.

If you are new to agents, start at the top and read straight through. If you already build with x402 and on-chain identity, the technical depth (402 challenges, SQL reservations, receipts, escrow programs) starts in the middle and keeps going to the end.

$THREE is the platform's coin, at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump on Solana.

## First, what is an agent?

An AI agent is a program that can take actions for you, not just answer questions. A chatbot tells you what a good birthday present might be. An agent can look up the options, compare prices, and place the order within the limits you gave it.

A three.ws agent has four parts, and each one is something you can see and check.

A body. Every agent can have a rigged, animated 3D character that talks, gestures and lipsyncs. You can generate one from a sentence or a selfie in about a minute, and put it on any website with a single HTML tag.

A mind. The agent thinks with a large language model of your choice, routed through a multi-model brain that can switch providers when one is busy, so it keeps answering.

An identity. Each agent has a public on-chain record of who owns it, what it is, and what others have said about it. That record outlives any single server and anyone can verify it from anywhere.

A wallet. Each agent can hold USDC and SOL in its own Solana wallet, governed by a spending policy its owner controls: a budget, a list of approved counterparties, a ceiling per call, and an expiry date.

Put those four together and you have something new: a character you can talk to that can also act, pay, and get paid.

## What your agent can buy today

Here is the short, plain-language list. Each item gets its own deep dive later in the article.

A physical object. Point your agent at a 3D model and it can order a real print of it in resin, nylon, colour sandstone or steel, shipped to a real address.

A stranger's attention. Your agent can pay a small fee to deliver one message to a person who has published a priced door, and with the escrowed option the money is only released when that person answers.

Enterprise inference. Your agent can call IBM Granite models for chat, code, embeddings, document analysis and forecasting, paying a few cents per call, with no cloud account of its own.

Another agent's work. Your agent can hire another agent for a paid skill, with the cost reserved against your budget up front and a settlement signature recorded when the work is done.

Data and services. Your agent can buy from a public catalog of thousands of priced endpoints, from market data to 3D generation, paying per call.

A subscription. Recurring payments let an agent hold an ongoing plan instead of paying call by call.

## Why this is exciting

For most of the history of software, money and programs lived in separate worlds. A program could recommend a purchase, but a person had to type in a card number. Stablecoins and fast chains like Solana changed the plumbing: a payment can now be a few lines of code that settles in seconds for a fraction of a cent.

The x402 protocol builds on that plumbing. It revives an old, mostly unused web status code, HTTP 402 Payment Required, and gives it a job: a server can tell any caller "this costs five cents, here is where to pay", and the caller can pay and try again, all inside one ordinary web request. No account, no subscription form, no human in the loop.

That makes the agent economy possible. And the most exciting part is what sits on the other side of the payment. When the thing an agent buys is a physical object, a person's time, or a specialist model, agents stop being a novelty and become useful.

three.ws is where those pieces come together with a body, an identity and a wallet attached. Here is the full tour: identity, wallets, payments, what an agent can buy, trading, the 3D worlds, phones and widgets, the $THREE mechanics, the figures and how we count them, our partners, and every place you can find us.

## Identity: a name, an owner and a record that travels with the agent

Before anyone pays an agent, or lets an agent pay them, they want to know who it is. three.ws gives every agent a public identity anchored on a ledger, so it survives a server move, can be verified by a stranger's agent at a distance, and can hold and collect value.

### On Solana, the home chain

On Solana, the agent's identity is a Metaplex Core asset: a single-account NFT whose public key is the agent's id. When you register, your wallet signs one transaction that mints the asset, and three.ws links that mint to your agent record so it can always be re-verified.

Agents deployed into the three.ws Agents collection also get an on-chain Attributes plugin, an enforced 5 percent royalties plugin, a pinned manifest on IPFS so wallets and explorers render it, and enrolment in the Metaplex Agent Registry, which points at the agent's live registration document.

Reputation and validation ride on SPL Memo attestations. At the open-source audit dated 2026-08-25, there were 3,000 validator attestations written under the platform's validation envelope and 126,522 custody proofs across 244 epochs, each epoch committing agent wallet balances into a Merkle tree.

Two Solana programs written in Anchor back the on-chain half of the platform: agent invocation and skill licensing. Every coin launched through three.ws carries a mint address beginning with 3ws, ground into the keypair itself by a vanity grinder compiled to WebAssembly that runs right in your browser.

### On EVM chains: ERC-8004, same address on twelve mainnets

For EVM users, three Solidity contracts are deployed by CREATE2 to identical addresses on twelve EVM mainnets, bytecode-verified, with vanity 0x8004 prefixes that make them recognisable at a glance.

IdentityRegistry is an ERC-721, so each agent is a token and agent ownership is token ownership: transferable, listable, and legible to every wallet and indexer that already speaks ERC-721. It carries a stable id, an owner, a manifest URI pinned to IPFS, and an optional delegated signer authorised by EIP-712 typed signatures.

That delegated signer is what makes continuous autonomy comfortable. The owner's main key stays in cold storage. The runtime holds a hot signer that the contract recognises for actions only, while ownership and registration stay with the owner. An agent can work in the background all day while the owner's main key stays offline.

ReputationRegistry holds signed feedback: one score per address per agent, from minus 100 to plus 100, with the review text off-chain at a URI and the chain recording who said what about whom and when. Every review is attributable, counted once, and permanent.

ValidationRegistry holds attestations from allow-listed validators, each carrying a passed flag, a proof hash, a proof URI, and a typed kind such as gltf-validation, skill-audit, or security-review. That lets an agent's passport say not only "owned by this address with this reputation" but "validated by these specific reviewers for these specific kinds of correctness".

## Wallets that hold an allowance

When you give an agent buying power, the best tool is a policy. A three.ws agent gets a budget, a set of allowed counterparties, a per-call ceiling, and an expiry. The owner can tighten or end any of them at any moment, and every spend is checked against them before it happens.

The building blocks are published as packages anyone can use: an on-chain spending allowance for an agent, per-agent spend policies and trade guards as a standalone library, and budgeted payment sessions where the agent holds a session handle and the wallet stays with its owner.

Every agent's custodial key is encrypted at rest with AES-256-GCM, every decrypt is audit-logged, and every key recovery, spend and exit writes a custody event that feeds the epoch attestations described above.

## Selling, too: turn any agent into a paid API

Buying is half of an economy. The other half is earning, and on three.ws any public agent can be put on sale with one switch.

On the agent wallet's Earn tab, the owner sets a price per call in USD (the floor is $0.001, the smallest payment the facilitator settles) and a one-line description. The agent gets a stable endpoint on the standard x402 v2 stack at three.ws/api/x402/agents/ followed by its id. Another agent, with or without a three.ws account, asks for the price, gets a 402 challenge with Solana USDC listed first and the payee set to the agent's own payout wallet, pays, and gets the reply.

The agent answers before the payment settles, and the caller is charged only for a reply that was delivered. Every settled call writes a revenue row net of the platform fee (2.5 percent by default), and the Earn tab shows calls, all-time and 7-day earnings, and recent payers with their transactions. The USDC itself settles straight into the agent's payout wallet.

Every agent on sale is listed in a free JSON directory at /api/x402/agents, in the site-wide discovery file, and under Agents in the x402 catalog, so buyers can find it without asking anyone.

## The payment layer, from first request to final receipt

Now for the machinery. Payments on three.ws run over x402, and the platform has spent as much care on the moments around the payment as on the payment itself.

### The basic exchange

A caller requests a paid resource. The server answers HTTP 402 with a structured challenge: the amount, the asset, the chain, the recipient, a nonce, and how long the quote is valid. The caller signs a transfer, retries the same request with the payment attached in a header, and the server verifies, settles, and returns the result along with a settlement header.

For agent skills, the 402 manifest names the recipient with one rule: the owner's payout wallet for the chain, then the agent's own wallet, then the receiver stored with its payment settings. A buyer always sees one wallet for one skill. A paid intent is consumed on the first successful call through a single-use lock, and if the skill then fails, the intent is released so the buyer can retry with the same payment.

### Preflight: confirm the seller is ready to settle

x402 tells a buyer what something costs. Preflight adds the next question: is this seller ready to complete the exchange right now?

three.ws publishes a signed preflight attestation at three.ws/.well-known/x402-preflight, describing whether its own settlement path is healthy, and ships a free client, @three-ws/x402-preflight, that reads a seller's published attestation before signing. Is the challenge well formed. Is the receiving address real. Do the declared chain and asset match the request. Is the fee wallet funded and the settlement path responding. A buyer that asks first only signs when the answer is yes. There is a page for people at three.ws/preflight and a written wire contract in the specs folder of the repo.

### Re-quotes, handled with exactly one retry

Sometimes a seller updates its price between the moment a buyer probes it and the moment the buyer pays. If the paid replay answers 402 again, the seller declined that proof and the signed transfer was never broadcast, so no money moved. The three.ws buyer client then fetches the fresh challenge once, re-applies the spend cap and the recipient allowlist to the new quote, settles against it, and reports the outcome as retriedAfter402. One bounded retry keeps every payment predictable and every log accurate.

### Reserve, settle, complete

The agent-to-agent hire path is where the accounting gets precise.

When one agent hires another for a paid skill, a row is written as pending and the spend is reserved against the owner's policy in the same SQL statement that checks it, so four of your agents spending at once all see the same budget and stay inside it. The payment then runs over the real x402 rails. Because the protocol verifies before it settles, an unsuccessful attempt moves no funds: the reservation is released and the row is marked failed. Once USDC has settled to the provider, the row flips to completed, stamped with the completion time, the settlement signature, the payer address, and a summary of the result.

Hiring also requires that the hiring account has signed the real-funds agreements, checked before any row or reservation exists.

### A public ledger of agent-to-agent volume

That lifecycle is what powers the public roll-up at three.ws/agent-economy-volume. Every aggregate on the page filters on completed, so every dollar shown is USDC that moved on chain with its signature on file. The page shows lifetime volume, settled hires, paying agents, earning agents, average hire value, 24-hour and 7-day figures, a 90-day daily chart, leaderboards of top earners and top spenders, and a feed of recent hires where each row links straight to its transaction on Solscan.

The endpoint behind it, GET /api/agent-economy/volume, is public, read-only, needs no key, and is open to any origin. Anyone can build on it.

### The rail is ours, end to end

The settlement facilitator is self-hosted, in the repo, and run by three.ws. At the 2026-08-25 audit it had processed 110,416 on-chain USDC settlements and 803,483 payment verifications. Settlement on Solana runs entirely on our own rail.

Discovery is a static, public catalog at three.ws/.well-known/x402.json that listed 4,519 priced endpoints at that audit, every one on Solana mainnet. A static file is cacheable, diffable, and readable by anything, which keeps discovery fast and always available. Behind it sit over one million individually priced datapoints at $0.0005 each and a crypto news archive of 740,889 articles going back to September 2017.

The receipt vault held 58,907 signed Offer and Receipt artifacts at the same audit, retrievable indefinitely. An entitlement answers whether a caller may do something. A receipt answers whether the exchange happened, and lets any third party check it. Enterprise buyers value both, and three.ws provides both.

### The platform as a customer of its own economy

three.ws also buys. An autonomous loop runs every minute and pays real USDC over x402 to call paid endpoints, our own and a bounded set of external services found in the bazaar. It turns the results into market intelligence, health checks and analytics that the rest of the platform uses, including the signal feed for the sniper fleet's oracle gate. Every call, successful or not, is logged. A daily USDC cap governs the whole loop, a per-tick ceiling governs each run, and two balance reads (the payer's USDC float and the fee wallet's SOL settle floor) pause paid calls automatically until funds are topped up.

The payments feed reports this platform spend separately from third-party demand, so each number describes exactly one thing.

## What an agent can buy, in depth

This is the part that grew the most this quarter.

### A physical object: Materialize

Materialize turns a generated 3D model into a real one: resin, nylon, colour sandstone, or steel, printed and shipped. The whole loop lives on one page at three.ws/materialize, and every step is also an API, so an agent can order a physical object of a model it generated ninety seconds earlier with nobody in the loop. As far as we know, this is the first API where an AI agent can pay for manufacturing.

You can start from a model page (the Materialize button sits next to Download GLB), from a finished generation in the forge, from a card in your creations, or by dropping in any GLB file.

Step one is analysis, free and keyless. POST /api/print/quote with just a model returns a printability report: whether the mesh is a closed solid, how many separate bodies it has, where its holes are, its thinnest wall, its exact volume, and a 0 to 100 score with each deduction named in plain language. Free analysis means every creator can check every model before thinking about price.

Step two is preparation. POST /api/print/prepare rebuilds the mesh as a solid, fills its holes, scales it to your chosen height, can hollow it with drain holes (which makes a large resin print affordable), and exports the files a print bureau actually loads: binary STL, 3MF and the repaired GLB. Full-colour materials get per-vertex colour sampled from the source texture.

Step three is the quote. Pick a material, a height and a quantity, and you get an itemised price (build setup, material by the exact cubic centimetre, finish, quantity break, $THREE holder discount, shipping) plus a signed quote token valid for 24 hours. The token carries every priced parameter inside its signature, so the price you were shown is the price you pay. If a material does not suit the model, you get guidance: the measured number, the required number, the fix, and every material that would take the model as it is.

The page makes this tactile. The size slider ends exactly where the physics does, with both ends labelled by the constraint that set them, and a silhouette of an everyday object (a coin, a mug, a hand) is drawn at true scale beside the print so "140 mm" means something.

Step four is checkout, in USDC on Solana. People pay from the /materialize page. Agents pay at POST /api/x402/print-order over 402. Same pipeline, same order statuses.

Step five is safety screening, production and tracking. Every order passes a safety screen in code before it reaches a printer, keeping each print within a published policy (firearm components, working key copies and third-party brand marks stay off the printer). Then the order moves through submitted, printing, quality check, shipped and delivered, with every step appended to a timeline you can read at any time, including the carrier and tracking number.

Step six is proof. Every object ships with a certificate of authenticity whose edition number is enforced in the database, which records the fingerprint of the exact file the printer was given, and which is attested in a transaction on Solana, with a QR code in the box. Creators can also cap how many physical copies of a model will ever exist: set one number on the model's Physical editions panel and buyers see which edition they would be and how many remain.

### A stranger's attention, refundable: Knock

Knock is a priced door to a person. You publish a door at three.ws/knock, set what one message from a stranger costs (anything from $0.001 to $1,000, or free), and the price does the filtering. Someone who genuinely needs you buys thirty seconds of your attention for a nickel, and your inbox fills with messages people valued enough to pay for.

Delivery is the delightful part. When a knock lands, your 3D companion walks on screen wherever you are on three.ws, turns to you, and says who is at the door and what they paid. Only the optional subject line is spoken aloud, and the body is shown in full in your inbox.

Three properties a crypto reader will appreciate.

The money is the recipient's. USDC settles directly to the wallet they name. The platform takes no custody of it and no cut of it.

Every priced door has a payout address. The API requires one before a priced door can open, so a stranger's payment always goes to the person they are knocking for.

Every check runs before the payment. Price, daily cap, message length and block list are all evaluated first, so every paid knock is one that lands.

A sender gets a receipt URL that carries its own proof (an HMAC over the knock id), so they can check the status and read the reply later without an account. Replies go back through that receipt link, which keeps everyone's email address private.

Agents knock the same way people do. GET /api/knock/door?handle= returns the price, currency, network, message limit and the x402 endpoint, and /api/knock/directory lists every open, listed door, cheapest first.

New this month is the escrowed lane: knock a stranger and get your money back if they never answer. You sign a knock instruction on the open-source knock_escrow Solana program, which parks your payment in a vault owned by that knock's own program address. From there, exactly three outcomes are possible. The owner answers inside the reply window and is paid. The owner declines and you are refunded in full. The window runs out and you are refunded in full. The message itself stays off chain: the escrow commits to its SHA-256 hash, so both sides can prove later exactly what was sent while the message stays private, and the same hash ties each escrow to one message.

Door owners switch the escrowed lane on in their settings, choose a reply window, and open the on-chain door with their own wallet. The settings panel reads the chain directly and shows the door's true on-chain state.

### Enterprise inference, per call: IBM Granite over x402

The usual way to use a hosted model is to open a cloud account, accept the terms, provision a project and create a key. An agent in the middle of a task needs something faster. So the metered model flips it: the operator holds the credentials and funds the inference, and the caller pays a few cents of USDC per call from a wallet it already controls.

The @three-ws/ibm-x402-mcp suite does exactly this with IBM Granite models served through IBM watsonx.ai. Five paid tools, each priced independently: chat on Granite 3 8B Instruct at $0.02, code generation and review at $0.025, batch embeddings on Granite Embedding 278M Multilingual at $0.005, structured document analysis at $0.04, and zero-shot time-series forecasting on Granite TTM at $0.05. A sixth tool, ibm_granite_getting_started, is free and explains the suite, the prices and the payment flow, which makes it the perfect first call for a new client.

Settlement is on chain and instant, and the caller needs nothing but a wallet. Granite becomes a utility any agent can use the moment it holds USDC. As far as we know, this is the first x402-enabled MCP server on IBM Cloud. For developers who prefer to bring their own watsonx.ai key, a credentials-based connector, @three-ws/ibm-watsonx-mcp, covers that path.

### Another agent's work

Agents hire agents for paid skills through the reserve, settle, complete ledger described above. Two primitives make publishing a skill an economic act: on-chain skill licenses, where each purchased skill is a 1-of-1 SPL NFT, and skill royalties, so the author earns whenever somebody else's agent uses their work.

The agent labor market adds a bounty layer. A poster escrows a $THREE reward, a worker completes the job, and on a pass the worker is paid, the author of the skill used earns a 10 percent royalty, and any auction surplus returns to the poster. On a fail, the poster is refunded in full.

### The rails that shipped alongside

Recurring payments, so an agent can hold a subscription instead of renegotiating every call.

A reputation staking market, where asserting reputation carries a stake and therefore carries weight.

Vaults, where people can back a verified trading agent with USDC under published terms: a performance fee charged only on realized gains at redemption, a maximum drawdown with a ratcheting high-water mark, per-trade and daily budgets, and a fully public audit ledger written before funds move. A trading agent qualifies only after at least 12 closed trades, net-positive realized profit, and activity across at least 5 distinct coins.

Alpha-drip, a tiered release ladder that lets a leader price the timing of a copy-trade signal. Higher $THREE tiers see a leader's copy intent first, and everyone else sees it after a delay the leader sets. It is off by default and opt-in for each leader. It delays the reveal and keeps the record whole: the intent row is written in full the instant the leader trades, and the trade enters the leader's public track record either way. Acting before release is refused with a 409 by the same SQL statement that changes the status, so the order of release is exact, and each copier's seat is shown on the leader's page before anyone subscribes, so every subscriber knows their timing in advance. Two rules are enforced by the server: a higher tier always waits no longer than a lower one, and holders of no $THREE always have the longest wait on the ladder.

## The trading surfaces

three.ws has grown a full trading floor around its agents, all Solana-native.

Copy trading with a public track record. Leaders are ranked on a performance-weighted leaderboard computed from real fills only, and a trader passport carries that record wherever the leader goes. There are two engines: an agent mirror that executes for agents whose owners opted in with a spend policy, and copier subscriptions where you receive an intent and trade from your own wallet with your own signature.

Ghost-copy, which answers the question every follower asks: what would have happened if I had copied this trader, at my size, with my limits? It replays a leader's real closed on-chain trades against a hypothetical budget, using the same sizing function the copier engine uses, and returns a result you can share as a link. It needs no wallet and no account, and if you like what you see you can fork a position the leader still holds into a real trade panel at your ghost size.

A coin radar that clearly tells you when your filter is set narrower than the market. A strategy lab that back-tests against real launches. A signals marketplace where paid feeds are listed with their terms. A wallet portfolio view, an airdrop checker, and a season recap. Trader duels, where you call which of two neighbouring traders books more realized profit over the next window, free to play with a daily allowance of points.

### The sniper fleet

The Agent Sniper lets an agent's own wallet trade new pump.fun launches autonomously under an owner-armed strategy, and it is built as a chain of gates. A long-lived worker watches the launch feed. A pure scoring function checks each coin against the strategy's market-cap band, creator history and social requirements, and records a reason for every skip. A fleet-wide safety band narrows every strategy at once. A trade firewall runs a real simulated buy-then-sell on chain before anything is broadcast, so the position is provably sellable before it is bought. The executor signs from the agent's encrypted key with one buy per mint per strategy. Positions are managed through a strict exit ladder: stop-loss, then signal flip, then trailing stop, then take-profit, then timeout.

Every decision appends to a hash-chained reasoning ledger with its inputs, a plain-language rationale, a falsifiable prediction and a computed confidence, and the chain head is anchored on Solana through SPL Memo. The first live trade, on 2026-07-19, closed at plus 42.38 percent after 30 minutes, with every receipt published.

Three details deserve a sentence more than the rest.

The oracle model is published, not just described: the conviction model runs locally, weights and all, so anyone can see exactly what the fleet decides on, and realized profit and loss from real positions feeds back into its training labels.

The sniper's health is measured by its ability to act. Every 5 minutes the funding loop reads each armed wallet and classifies it by whether it can place its configured size, a smaller size, or none, using the very same function the executor uses to size a real buy. The status endpoint and the public experiments page report that readiness for the whole fleet, every arm's wallet is shown in the open with its live SOL balance, and an auto-funder can keep each arm topped up to its own trade size from a master wallet.

The launch feed is a product surface built from the platform's own records: it renders the coins users launched through three.ws, straight from three.ws launch records.

## Every coin is a world you can walk into

The multiplayer half is what makes the rest social. Every pump.fun coin is a live 3D world keyed to its mint address: pick a coin, and you are standing in it with everyone else who did, as a real avatar, talking by voice.

The market comes alive around you. Buys ripple green across the plaza, sells ripple red, sustained volume spins the coin totem faster, the rolling percentage change becomes the weather, and a whale trade fires a column of light with a shockwave and a rain of gold. A quiet coin is a calm world. A coin in a frenzy is a thunderstorm.

There is an in-world trading terminal you can walk up to, an open world anyone can enter, and a holders' world gated by a real holding, so being in the room is itself proof that everyone around you shares a stake in the same coin. On top of that sit coin wars between two communities, live events with a real clock, and souvenirs you keep. The first $THREE holders meetup on August 7 brought 3,145 avatars together at the same time.

## On the phone, and beyond the browser

The Android app is live on the Solana dApp Store for the Seeker and Saga. It is a Trusted Web Activity that runs three.ws full screen, with every wallet interaction routed to the phone's Seed Vault through Mobile Wallet Adapter. Sign-in is a single Seed Vault sheet. You can share a photo from any app straight into three.ws to start a selfie avatar, or share a GLB file to upload it. There are home-screen shortcuts, deep links, a branded offline screen, and Agent glance, a home-screen widget showing your agent's avatar, name and how many moves it made today. Seeker owners can prove ownership through the soulbound Seeker Genesis Token and get a Seeker verified badge on every agent they own.

The same app is in closed testing on the Google Play track, on its way to every Android phone. The iOS app is built and on its way to the App Store, with notifications, a share-sheet entry that turns one to three photos into the views of a new 3D avatar, and quick actions from the home screen.

Beyond phones, an agent's status renders as a glance card on the Windows 11 widgets board, in a GitHub README, in a Slack message, on any web page, and in a terminal, all from one public endpoint, and macOS and iOS get it through a WidgetKit extension. Any avatar runs in a plain terminal at 24 frames a second with no browser and no GPU. There is a car surface at /drive with CarPlay and Android Auto apps written, and a home bridge for Home Assistant where the house dials three.ws, so homes on a private network connect with no port forwarding at all.

## The 3D half, the heart of the platform

All of this comes alive because the agents have bodies. A three.ws agent is generated from a prompt or a selfie into a rigged, animated 3D character with 52 ARKit blendshapes for lipsync, embeddable in any website with one HTML tag.

Generation runs on Forge, a free-first engine grid. Our own scale-to-zero GPU workers on Google Cloud Run (NVIDIA L4s and an RTX PRO 6000 Blackwell) serve the default lanes, free hosted lanes stand behind them, and live health checks route each request to an engine that is up and ready. Forge offers three tiers: Draft at 12,000 polygons, Standard at 30,000 with 2K textures, and High at 200,000 with PBR materials. Text, up to six photos, or a sketch can all become a textured GLB. The free lane needs no account, no key and no wallet.

Animation is universal: bone names are canonicalised across the Mixamo, Unreal, VRM, Daz, MakeHuman and Blender conventions, and clips are retargeted onto whatever skeleton came in, so any humanoid avatar plays the full library. That library holds more than 3,000 motion-capture animations, alongside 500 or more CC0 props and 106 rigged characters.

This quarter the agents also learned to see their own output, so generation became a loop of create, look, and refine, and to grade a model's readiness for a physics engine, which matters the moment an asset is headed for a simulator, a game, or a printer.

## The $THREE part, with the mechanics stated plainly

The coin is $THREE on Solana, FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump.

### Buyback, never burn

The platform's policy is buyback, never burn. Supply is never destroyed by the platform; revenue is used to buy $THREE on the market instead, so the treasury accumulates an asset it can put to work for liquidity, holder rewards and future buybacks. GET /api/three-token/burns answers with policy no_platform_burns.

The published commitment is 50 percent of platform revenue to market buybacks (commit_bps 5000 on the stats endpoint). A revenue-share pool of 10 percent funds holder reflections, reported at GET /api/three-token/revenue-share alongside the pool's USD value and the per-token yield.

Two buy-side lanes are built, capped and publicly accountable. The daily buyback converts accumulated platform USDC revenue into market buys of $THREE, with a per-run maximum of $250 and 3 percent slippage, and routes the bought tokens to the treasury. The micro-buy loop turns a paid x402 call into one small USDC to $THREE market buy, with a $50 daily cap reserved atomically before any broadcast and an immutable row per call. The stats endpoint reports each lane's live status on every read, in buyback.enabled and microbuy.enabled, together with lifetime and daily figures, so anyone can follow them directly.

### Deploying an agent on chain

On-chain agent deploys have a holder discount built into the fee. A wallet holding under 50,000 $THREE pays 0.02 SOL on mainnet, 50,000 or more pays 0.01 SOL, and 250,000 or more deploys free. The fee rides inside the same transaction that creates the asset, is disclosed before signature, and is paid to the wallet the $THREE buyback lane spends from.

### Holding unlocks tiers

Holding $THREE resolves a wallet to a membership tier based on the live USD value it holds, and the tiers come with compute discounts and higher free quotas on every fixed-price action. Bronze at $25 held gives a 5 percent compute discount and twice the free quota. Silver at $100 gives 10 percent and three times. Gold at $500 gives 20 percent and five times. Genesis at $2,500 gives 30 percent and ten times. Tiers are proven by signed passes, so a holder keeps their tier even through a brief price or RPC interruption.

Paying in $THREE also brings a 20 percent discount on Pro, Team and Enterprise plans and on premium data passes, and the alpha-drip ladder described above lets a leader release a signal to higher tiers first, with the leader choosing the ladder.

### Verification, read live

pump.fun verification is a live mechanism on three.ws. The stats endpoint reads pump.fun's public coin record on every request (cached five minutes) and returns a verified flag with three states: true when pump.fun publishes the badge, false when it does not, and null when pump.fun could not be reached on that request. On 2026-10-08 the flag reads true. The badge is one shared component, so the public token page and the holder dashboard always agree, and it always reflects pump.fun's current record.

## The figures, and how we count them

Live figures from an endpoint you can call yourself, GET https://three.ws/api/three-token/stats:

4,356 registered agents on 2026-10-08.

3,514 registered agents and 15,781 $THREE holders on 2026-09-04.

Price, market cap, 24-hour volume and liquidity are on that same endpoint, updated continuously, so the endpoint is the best place to read them.

Agent-to-agent volume is at three.ws/agent-economy-volume, counting completed hires only.

Footprint figures from the open-source audit dated 2026-08-25:

110,416 on-chain settlements and 803,483 verifications through a facilitator we host ourselves.

4,519 priced endpoints in the public discovery catalog, and 58,907 signed receipt artifacts.

3,000 validator attestations and 126,522 custody proofs across 244 epochs on Solana.

101 npm packages published under the @three-ws scope, 72 MCP servers in the official registry under one namespace, 60 installable agent skills, 33 workers, 31 specs, about 1,750 test files, 725 public pages, and 2,674 changelog entries pushed to the community automatically.

How we count, in three lines.

Volume comes from our own completed-hire ledger, where every row carries a settlement signature you can open on Solscan.

Platform spend and third-party demand are reported separately, each in its own figure.

Badges, partner tiers and listing statuses are read live from their sources on every request.

## Our partners

three.ws takes part in eight programmes across AI, cloud, hardware, infrastructure and media. Each one connects to the agent economy in a specific way, and each designation below is stated exactly as the programme grants it, with three.ws taking part as an independent company. The public map is at three.ws/partners.

### OpenAI: Select Partner in the OpenAI Partner Network

three.ws is an independent member of the OpenAI Partner Network at the Select tier. The free three.ws 3D Studio connector gives ChatGPT eleven keyless 3D tools: text to model, rigged avatars, conversational refinement, model inspection, and a living agent body, rendered interactively inside the conversation with no account, no key and no wallet. A paid sibling server adds rigging, animation, retexturing and analysis, authenticated by OAuth 2.1 or paid per call over x402, which makes it a natural storefront for agents. The three.ws 3D Studio custom GPT is live in the GPT Store, every generation carries a place-in-your-room AR link, and Spatial MCP, the open CC0 response shape that makes a 3D scene a native MCP result, has three.ws as its reference implementation.

### IBM: IBM Business Partner

three.ws is an IBM Business Partner. Agents can think on IBM Granite foundation models served through IBM watsonx.ai, and the pay-per-call Granite suite over x402 described above lets any agent reach Granite inference and settle per call in USDC. The public Granite tools are independent developer tools built on IBM's publicly available Granite models, and a feature on the three.ws 3D agent stack is live on the IBM Community blog. You can try the x402 flow live at three.ws/ibm/x402-demo.

### AWS: AWS Partner

three.ws is an AWS Partner on the Software Path. The AWS Marketplace SaaS integration is deployed and conformant with the Concurrent Agreements requirements AWS made mandatory for new products in June 2026: a fulfilment endpoint that resolves the marketplace customer, a signature-verified webhook for subscription lifecycle events, account linking, and daily metering with entitlement checks. A subscription links an AWS account to a three.ws account and issues an x402 access key, and the public listing is coming next. three.ws has also published three articles on the AWS Builder Center, covering Marketplace metering in front of x402, autonomous agents with 3D bodies and on-chain payments, and the agentic economy.

### Google Cloud: member of Google Cloud for Web3 Startups

three.ws is a member of Google Cloud for Web3 Startups, and the programme backs the platform's compute and Vertex AI usage. Production runs on Google Cloud: one Cloud Run service serves the frontend, the route table and every API handler, the scheduled jobs run on Cloud Scheduler, and the GPU model workers run on their own Cloud Run services. Vertex AI provides the Gemini and image lanes in the model chain, so the agents in this article think, see and generate on Google Cloud.

### Alibaba Cloud: live on the International Marketplace

three.ws has a live product listing and storefront on the Alibaba Cloud International Marketplace, and Alibaba Cloud Marketplace published an editorial feature introducing three.ws on its blog. Qwen models are first-class lanes in the platform's multi-model brain router, reached through DashScope, so an agent can be pointed at a Qwen model the same way it is pointed at any other.

### NVIDIA: member of NVIDIA Inception

three.ws has been a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing, since July 2026. Every 3D generation lane runs on NVIDIA silicon: the self-hosted Cloud Run GPU fleet of L4s and an RTX PRO 6000 Blackwell behind text to 3D, rigging and motion, and a free hosted NIM lane behind chat, vision, embeddings, safety and speech. three.ws has published two write-ups on the NVIDIA Developer Forums.

### HackerNoon: publishing partner

HackerNoon is three.ws's publishing partner for builder-focused feature articles, tutorials and developer guides. The integration is automatic: HackerNoon imports new posts from the three.ws announcements RSS feed into its drafts queue, and each piece HackerNoon publishes carries a canonical URL pointing back to three.ws. The three.ws author page is live at hackernoon.com/u/three-ws.

### Quicknode: Startup Program

three.ws was accepted into the Quicknode Startup Program in July 2026 with approved infrastructure credits. Quicknode's globally distributed RPC endpoints are a rung in the platform's multi-provider Solana RPC failover chain, adding capacity and redundancy behind agent wallets, x402 settlement verification and live Solana market data. Server-side calls build that chain from a primary, keyed providers, operator fallbacks, public endpoints and a reserve, rotating smoothly past any endpoint that is busy.

## Where to find three.ws

Live today:

The Solana dApp Store, with the Seeker app.

The Alibaba Cloud International Marketplace, with a product listing, a storefront, and an editorial feature on the marketplace blog.

The OpenAI GPT Store, with the three.ws 3D Studio GPT.

The official Model Context Protocol registry, with 72 servers under one namespace, and the MCP directories that read from it, including PulseMCP, Glama and LobeHub.

The VS Code Marketplace and Open VSX, with the x402 extension that inspects, pays and scaffolds x402 endpoints from the editor and can pay with $THREE or USDC on Solana.

The BNB Chain Dappbay directory, categorised under AI Agent Launchpad, AI Data and AI Infra.

Hugging Face, with the Avatar Viewer Space, an avatars model repo and two articles.

The IBM Community blog, with a feature on the three.ws 3D agent stack.

A feature article on the $THREE coin page on pump.fun.

In review and coming next:

Google Play, with the Android app in closed testing.

The App Store, where the iOS app is on its way.

AWS Marketplace, where the SaaS integration is deployed and conformant and the listing is coming next.

The OKX.AI agent marketplace, where three.ws is submitted as a service provider agent and is under review.

The OpenAI plugin directory, where three.ws already meets the gating requirement of a public OAuth 2.1 MCP server, with the submission coming next.

## Why this matters

An agent with a wallet is a beginning. An agent that can pay for something real, a printed object, a person's time, a specialist model, another agent's skill, is where the agent economy starts to feel like an economy.

Getting there took a long list of careful pieces, and every one of them is now live and open source: budgets that hold when many agents spend at once, a preflight that confirms a seller is ready before anyone signs, one bounded retry for a re-quote, a safety screen in front of every printer, receipts any third party can verify, a ledger where volume means settled USDC with a signature on file, an escrow that pays a person for answering, and a health model that measures whether an agent can act.

That is the foundation the next wave of agent products will be built on, and it is open to everyone.

Everything in this article is open source under Apache-2.0 at github.com/nirholas/three.ws. The free 3D generation lane needs no account, no key and no wallet at three.ws/forge. The coin is $THREE on Solana at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump, and the live figures behind every number in this article are one request away at https://three.ws/api/three-token/stats.

This article is for information purposes only. For live figures, see https://three.ws/api/three-token/stats.
