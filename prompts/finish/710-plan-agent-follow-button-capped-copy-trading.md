# Add a Follow button with a spend cap on agent pages and narrate each copied trade with the 3D agent

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/710-plan-agent-follow-button-capped-copy-trading.md`.

**Priority:** P2, new capability with clear value (score 58 of 100 inside the tier). **Area:** trading. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Copy trading exists (`api/copy/*`, `src/copy-panel.js`) but it is mounted only on the trader page. A visitor viewing a trading agent cannot follow it in one tap, set a spend cap, or watch the avatar explain each trade. Making follow a first-class action on agent pages turns every agent page into a conversion surface.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/copy-panel.js` exports `mountCopyPanel`, used only at `src/trader.js` line 465. `api/copy/{subscriptions,...}.js` and tests `copy-*.test.js` exist.
- Missing: Follow button on `pages/agent-detail.html` and `src/agent-detail.js`, a cap prompt at tap, per-trade narration by the avatar.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
grep -rn "mountCopyPanel" src pages -l; ls api/copy; ls tests | grep -i copy
grep -n "copy" src/agent-detail.js | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first (`tests/copy-follow-cap.test.js`): a subscription requires a cap greater than zero and at most the platform maximum; a copied trade exceeding the remaining cap is skipped and logged; unfollow stops mirroring immediately.
2. Add a Follow control to `src/agent-detail.js` that opens a compact dialog (cap in USDC, per-trade max, stop-loss if supported by the API) and posts to the existing subscriptions route. Solana agents only in the first cut.
3. Narration: when a mirrored trade fires, emit an event that the agent embed speaks and animates (use the existing agent-3d `speak` and gesture API) with the real trade details; falls back to a text toast when no avatar is mounted.
4. States: skeleton, signed-out prompt, empty ("You are not following anyone"), error with actionable message, hover/focus/active, keyboard dialog.
5. Docs: `docs/copy-trading.md` section, changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/copy-follow-cap.test.js` passes.
- [ ] In a real browser against `npm run dev`, following an agent with a devnet or paper cap creates a subscription row and the next mirrored trade is narrated.
- [ ] No console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No live trades to mirror | Use the existing paper/simulation mode of the copy engine; do not trade mainnet funds. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/710-plan-agent-follow-button-capped-copy-trading.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `710-plan-agent-follow-button-capped-copy-trading.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/research/solana-robinhood-playbook-2026-10.md` (whole file)

~~~~markdown
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
~~~~

