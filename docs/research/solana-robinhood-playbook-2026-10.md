# Solana and Robinhood Chain, October 2026: what the leaders do, and how three.ws does it better

Research date: 2026-10-08. Competitors are named by placeholder per the repo convention for research docs. The placeholders here are local to this file (R1, R2 on Robinhood Chain; S1, S2 on Solana) and do not map to the letters in the two September docs. The key and the source list were delivered to the owner in the session that produced this file. Robinhood, pump.fun, Meteora and Phantom are named because three.ws integrates them as venues or rails. Market numbers come from DefiLlama pulls taken that day and from protocol-reported figures relayed by the trade press, so treat them as approximate. Our own state was checked against this repo the same day.

Companion to [launchpad-landscape-2026-09.md](launchpad-landscape-2026-09.md) (launchpads, ranked fixes) and [competitor-teardown-2026-09.md](competitor-teardown-2026-09.md) (one agent launchpad, packaging). This doc covers what those did not: agents, consumer apps, distribution, and Robinhood Chain beyond launchpads.

## Bottom line

1. **The open lane on both chains is the same one: an agent that earns real revenue, has a body, and can act on more than one venue.** On Solana, pump.fun shut its revenue-buyback agent mode after about 3.5 months, and genuine agent commerce over x402 is estimated at only about $1.6M a month. On Robinhood Chain, the agent layer is two token launchers (R2, R3). Robinhood's own agent products are custodial and closed to outside agents. Nobody ships an embodied agent with a wallet on each chain, measured revenue, and a link to the user's Robinhood Crypto account. We have most of that already.
2. **The market just validated two things we built and left switched off.** pump.fun now pays creator fees to holders several times an hour (Holder Rewards, Sep 12). Since Oct 3 it also prices coins against a third-party token and pays those rewards in that token. Those are our holder-rewards item and our $THREE-quoted lane. Both are still dark: the native lane fee is flat (`api/_lib/native-launch/config.js:80`), and no holder-rewards or buyback page exists.
3. **The 2026 growth winner on Solana is social copy-trading on a phone, not a pro terminal.** S1 went from about 17% to 46% of Solana terminal spot volume in two months, with one-tap copying of a public portfolio. We have copy trading, Ghost Copy, Duels and Quests, but they are scattered. None of them is a single "follow this agent" button on the agent's profile and in the Seeker app.
4. **Our Robinhood Chain surface is three months stale where it matters.** `/markets/robinhood` indexes NOXA (shut down 2026-07-13) and The Odyssey (`api/_lib/robinhood.js:613`). It misses R1, which carries about $86.5M in 30-day fees and is the chain's #2 fee earner, and it misses pump.fun's Robinhood Chain trading. The September doc flagged this. It has not shipped.
5. **Credibility beats size on value accrual.** pump.fun committed 50% of revenue for a year through an irreversible contract and has bought back about $476M. S3 ran a discretionary buyback of $70M+ while its token fell about 89%, then proposed ending it. Whatever $THREE does should be a locked, partial, publicly counted rule, never a promise.

## Robinhood Chain in October 2026

Arbitrum Orbit L2, chain 4663, ETH gas, mainnet since 2026-07-01. Transactions are sequenced first-come, first-served, so paying more does not let you jump the queue. ERC-4337 (paymasters, session keys) is first-class.

| Metric (DefiLlama, 2026-10-08) | Value |
|---|---|
| TVL | $1.05B |
| Stablecoins | $1.07B |
| DEX volume | $1.09B 24h, $45.2B 30d |
| Fees | $3.1M 24h, $226M 30d |

DefiLlama keeps a volume-boosting category for the chain, so the volume figures are partly wash.

| Category | Leader and what it does |
|---|---|
| Lending | The largest lending market (about $610M) powers Robinhood Earn, a USDG yield product at about 7%. Distribution comes through Robinhood's own app. |
| Perps | R4 (about $114M TVL) pays 2x points to Robinhood Wallet users. R5 is built with Robinhood Crypto. |
| Launchpad | R1 earns $86.5M in 30-day fees with an ETH bonding curve, a locked pool and a snipe tax that decays over seconds. Its weekly fees fell 68% from Sep 17 to Oct 1, after the wallet gas waiver ended on Sep 29. |
| Agents | R2 reports 5,600+ agents, $200M+ agent volume and about $1.1M in 30-day fees (1% fee in USDG), 6.6x its fees on its home chain. R3 launches agent tokens paired against other assets and earns about $2.3M in 30-day fees. |
| NFTs, social, gaming | NFTs are early and speculative. One social trading app. Gaming has nothing we could verify. |

**Robinhood's own agent stack sits in Robinhood Crypto, not on the chain:**
- **Trading MCP** (`agent.robinhood.com/mcp/trading`) works with Claude, ChatGPT, Cursor and others. The agent can read every account but trades only from a dedicated Agentic account, and it cannot transfer, stake or lend crypto.
- **HOOD Summit (Sep 29)** reported 150K+ agentic accounts and about 30M tool calls a day. It announced in-app Robinhood Agents, Loops (always-on strategies) and Agent Apps, a third-party marketplace open only to agents Robinhood hosts. There is no public listing program.
- **Crypto Trading API** (`trading.robinhood.com`, US only) signs each request with an Ed25519 key and covers quotes, holdings, buying power and orders. There is no sandbox.

**Gaps an entrant can fill:**
- No agent spans the custodial account and the chain.
- No agent-to-agent payment rail native to the chain.
- No credible trust tooling. One operator extracted about $18.4M across 53 launches by exempting their own wallets from the snipe tax.
- Retention dropped once users had to pay their own gas.

## Solana in October 2026

| Area | What the leaders ship | Evidence |
|---|---|---|
| Launchpad | pump.fun: fee splits across up to 10 wallets, transferable fee ownership, Holder Rewards in the quote token, Custom Pairs against third-party tokens (Oct 3), a mobile app, livestreams, and a 50% revenue buyback locked for one year. | $58.2M revenue in August, about 41% of Solana app revenue, but annualizing at about a third of 2025. |
| Failed experiment | pump.fun Tokenized Agents (an agent's revenue auto-bought its token) was killed after about 3.5 months for "PVP dynamics". | Directly relevant to our revenue-backed agents item. |
| Agent payments | x402 on Solana carries about 70% of x402 volume. Batch settlement went live around Oct 1 to 7. Pay.sh (Google Cloud and the Solana Foundation) lets agents pay per request with no API key. | Real agent commerce is estimated at about $1.6M a month. The rest is bots and MEV. |
| Agent identity | The Solana Agent Registry (solana.com/agent-registry) works with ERC-8004. Registering costs about 0.009 SOL, and it includes a feedback and reputation registry. | Separate from the Metaplex Agent Registry we already write to. |
| Agent wallets | Squads-based smart accounts with TEE-held keys and spend limits. A major wallet's MCP server signs, transfers and swaps. Phantom ships an MCP server in preview. | Our agent keys are server-side, AES-GCM encrypted. |
| Consumer | S1: tokenless social copy-trading, $14.6M revenue in August, #3 in US iPhone Finance. Phantom: perps, prediction markets, a debit card. S4: tokenized collectible packs, about $85M cumulative. Wallet-embedded distribution lifted one app's fees 129% in a week. | Terminal share is moving from S2 (about 44.6% down to under 30%) to S1. |
| Distribution | Multi-level referrals (30/3/2% is common), Solana Foundation Frontier Traders campaigns, Seeker device airdrops and seasons. | Seeker has about 150K users and 200+ dApps. |
| Security | The largest Solana exploit of 2026 (about $270M, Apr 1) came from social engineering of developers: a cloned repo and a fake TestFlight build. It was not a contract bug. | Directly relevant to a platform that holds agent keys. |

## Where we stand

| Capability | Leaders have it | three.ws today | Path |
|---|---|---|---|
| Holder rewards from fees | pump.fun, live | Read-only field from pump.fun (`api/pump/[action].js`); our own is not built | Build, owner flag |
| Launches quoted in the platform coin | pump.fun Custom Pairs, R3 | $THREE lane built and tested on devnet, fee flat, no mainnet config | Anti-sniper, then owner |
| Locked, counted buyback | pump.fun | Engine built, `THREE_BUYBACK_ENABLED` unset, no public page | Build page, owner flag |
| Social copy on mobile | S1 | Copy trading, Ghost Copy, Duels, Quests on separate pages; Solana Mobile app live on the dApp Store | Package |
| Agent registry | Solana Agent Registry | Metaplex Agent Registry only (`api/_lib/agent-registry.js`) | Build |
| x402 batch settlement, Pay.sh listing | Leading facilitators | x402 live on Solana; self-hosted facilitator off; no batch settle | Build |
| Blinks for commerce | Wallet-embedded apps | One memo blink (`api/actions/avatar.js`) | Build |
| Robinhood Chain screener | n/a | Indexes two dead or minor launchpads | Fix |
| Robinhood Chain in hosted MCP and the x402 network list | n/a | `hood-mcp` exists as a standalone package; hosted `api/_mcp*` has no Robinhood tools; 4663 not in `api/_lib/x402/revenue-networks.js` | Wire |
| Robinhood Crypto account link | Robinhood's own Trading MCP | None | Build |
| Gas sponsorship on 4663 | Robinhood (ended Sep 29) | None | Build |
| Compressed NFTs for avatars | Common | None; Metaplex Core mints default to devnet | Build |
| Smart-account or TEE custody | Leading agent wallets | Server-side keys | Longer term |

## How we do it better

### 1. Revenue-backed agents that work where pump.fun's version did not

pump.fun's Tokenized Agents failed because every agent became its own buyback game: one more launch mode competing for the same attention. Its Holder Rewards works because it is a single default that pays people without asking them to trade. Combine the working half of each:

- One launch path (Genesis), quoted in $THREE.
- Holder rewards for an agent's coin are paid from the agent's measured x402 and skill revenue, not from trading fees. They are opt-in, paid in $THREE or SOL, and every payout links to its transaction.
- The agent's public profile shows revenue kept apart from trading volume, the number of paying callers, and payouts. That is the "real revenue" proof no one else on either chain can show.

This is campaign items 5 and 6 with one change: pay out the way pump.fun's live mechanic does (several times an hour, with a minimum balance) instead of designing our own schedule.

### 2. "Follow this agent", one tap, on the phone

S1 won by turning a public portfolio into a follow button. Our version is better because the thing you follow has a body and explains itself:
- A Follow button on every agent profile and in the Seeker app wraps the existing copy-trading engine, with a spend cap set at the moment you tap.
- The 3D agent narrates each trade it makes, so followers see why, not only what.
- Duels and Quests become the seasons layer. Referrals already exist (`api/_lib/referrals.js`), so the season leaderboard can pay referral tiers too.

### 3. The cross-venue agent Robinhood will not build

Robinhood's agent stack is closed to outside agents, and its chain agents have no body and no revenue. The opening is an agent that holds a Solana wallet and a 4663 wallet, and can also connect to the owner's Robinhood Crypto account:

- **Robinhood Crypto connector.** The owner pastes their own Crypto Trading API key. Their agent can read holdings and quotes and trade crypto inside a spend cap. Each order gets a receipt and the 3D agent narrates it. Crypto only, by design.
- **Robinhood Chain in our hosted MCP.** Port the `hood-mcp` tools (quotes, swaps, launch watch, USDG transfer) into `api/_mcp`, so any Claude or ChatGPT user gets them from the connector they already have.
- **x402 on 4663 in USDG.** Add the chain to the revenue network list. `robinhood/hood402` already exists, so this is wiring work.
- **Gas sponsorship.** An ERC-4337 paymaster sponsors an agent's first actions on 4663. Retention collapsed when Robinhood's 90-day gas waiver ended; we can sponsor exactly the actions that lead to revenue and nothing else.

Solana leads every one of these. The connector and MCP tools ship Solana-first where a Solana equivalent exists.

### 4. Trust as the product on Robinhood Chain

The chain's volume is memes plus wash, and its biggest insider extraction came from snipe-tax exemptions. We already planned rug-risk flags. Ship them on the corrected screener first:
- early-block supply concentration
- tax-exempt wallets
- the creator's past launches

That makes `/markets/robinhood` the only screener on the chain worth trusting, which costs less than competing with R1 and earns more attention.

### 5. Join the standards early, then make our agents the best-documented ones on them

- Register every on-chain agent on the Solana Agent Registry as well as Metaplex. It interoperates with ERC-8004, which we already write on Base and BSC, so one agent carries a single identity across chains.
- Write the registry's feedback records from real x402 receipts. Reputation there becomes paid-call history, not reviews.
- Settle x402 in batches once our facilitator is on, and list our paid endpoints on Pay.sh, which also matches our Google Cloud priority.
- Add Blinks for "buy this agent's coin", "hire this agent" and "tip this agent", so a three.ws agent can be acted on from inside any wallet or post that renders Blinks.

### 6. Value accrual for $THREE that survives a bad month

Copy pump.fun's structure, not its size: a fixed share of platform revenue, committed for a stated period, with a public counter linking every buy. It must be worded as programmatic and non-guaranteed. Pair it with the $THREE compute sink (pay for credits in $THREE with a bonus), which creates demand that does not depend on the coin's price.

## Ranked plan

"Owner" marks steps that move funds, sign on mainnet, change production flags, or publish externally. Everything else can be built and verified now.

| # | Work | Effort | Gate |
|---|---|---|---|
| 1 | Fix `/markets/robinhood`: index R1 and pump.fun's Robinhood Chain coins, drop NOXA, add rug-risk flags | 2-3 days | Commit names other projects (Owner) |
| 2 | Decaying anti-sniper fee on the native $THREE lane, proven on devnet | 2 days | Mainnet config (Owner) |
| 3 | Agent revenue holder rewards plus the public buyback counter page | 4-5 days | Enable flags (Owner) |
| 4 | Follow-this-agent: one button on profiles and in the Seeker app, wrapping copy trading with a spend cap | 3-4 days | None |
| 5 | Robinhood Chain tools in the hosted MCP, 4663 USDG in the x402 network list | 2-3 days | None |
| 6 | Solana Agent Registry dual registration, with feedback written from x402 receipts | 2-3 days | Mainnet registration fees (Owner) |
| 7 | Robinhood Crypto connector (owner-supplied API key, spend-capped, crypto only) | 4-5 days | Live order test (Owner) |
| 8 | Commerce Blinks: buy coin, hire, tip | 2 days | None |
| 9 | x402 batch settlement on our facilitator, Pay.sh listing | 3 days | Listing is external (Owner) |
| 10 | ERC-4337 paymaster on 4663 for revenue-leading agent actions | 3 days | Fund the paymaster (Owner) |
| 11 | Compressed NFT mint for avatars and agents | 3 days | Mainnet (Owner) |
| 12 | Smart-account or TEE custody option for agent wallets | Multi-week | Design review |

**Time-sensitive:** Arbitrum and Robinhood Chain's Founder House Singapore runs Oct 23 to 25 with up to $300K, including reported funding for AI-agent projects. These terms come from secondary sources. Items 3, 5 and 7 together are a strong application, and applying is an external action, so it is owner-gated.

## What not to do

- Don't build a launchpad on Robinhood Chain. R1's fees fell 68% in two weeks once users paid their own gas.
- Don't add a per-agent buyback launch mode. pump.fun tried it and removed it.
- Don't run a discretionary buyback or promise returns to holders.
- Don't build anything paired against or trading stock tokens. Robinhood work here is crypto only.
- Don't quote chain volume as traction. A meaningful share of it is wash.
- Don't let any of this pull Solana work behind Robinhood Chain work. Every Robinhood item above rides on infrastructure that already serves Solana first.
