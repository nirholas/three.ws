# HQ gets data-driven protocol dashboards (Solana first), an oracle deviation monitor and a DeFi risk heatmap

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/746-plan-hq-protocol-dashboards-and-risk-heatmap.md`.

**Priority:** P2, new capability with clear value (score 44 of 100 inside the tier). **Area:** hq. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

HQ (`apps/hq`) is the DeFi intelligence dashboard with a 3D globe. Its roadmap promises protocol-specific dashboards (Uniswap, Aave, Maker/Sky, Lido, Eigenlayer, Hyperliquid), Chainlink oracle discrepancy monitoring, Dune query integration and a DeFi risk heatmap (smart contract, oracle and governance risk). None of these exist: the generic building blocks do (`api/protocol-health.js`, `api/top-protocols.js`, `api/subgraph-{uniswap,aave,compound}.js`, `api/lending-rates.js`, `api/venue-spread.js`, `api/governance.js`, `api/funding-rates.js`), and the roadmap also lists many items as open that have in fact shipped, so the plan misleads. Hand-coding six bespoke dashboards would be mediocre and EVM-centric. The right solution is one data-driven protocol dashboard framework, configured per protocol, with Solana protocols first (the platform's home chain), plus the oracle monitor and a risk heatmap built on it.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Shipped but still unchecked on `apps/hq/ROADMAP.md`: the Q1 globe layers (`api/validator-nodes.js`, `api/tvl-geo.js`, `api/bridge-flows.js`, `src/config/crypto-exchanges.ts`, `src/config/crypto-regulation.ts`, `WhaleMonitorPanel.ts`), on-chain data (`api/subgraph-aave.js`, `api/subgraph-compound.js`, `api/subgraph-uniswap.js`, `OnChainPanel.ts`, `LendingRatesPanel.ts`), real-time prices (`src/services/websocket-prices.ts`), and the Q2 analytics (`MevMonitorPanel.ts`, `TokenUnlocksPanel.ts`, `BridgeMonitorPanel.ts`, `GovernancePanel.ts`, `AirdropTrackerPanel.ts`, `historical-tvl.js`, `src/utils/d3-timeseries.ts`). The ROADMAP checkboxes are stale for these.
- Not present: `grep -rli "dune" apps/hq/src apps/hq/api` is empty; no Chainlink oracle feed monitor (Chainlink is mentioned only in `venue-spread.js`, `lending-rates.js` text and alert copy); no risk heatmap (`grep -ri "riskheatmap" apps/hq` is empty); no Maker/Sky, Lido, Eigenlayer or Hyperliquid dashboard (the names appear only in `src/config/protocol-geo.ts`, `airdrops.ts`, `token-vesting.ts`, `funding-rates.js`, and `src/components/details/ProtocolDetail.ts`).
- Panel mechanics: panels register in `src/config/panels.ts` and `src/config/variants/full.ts`, lazy-load through `this.lazyFactories` in `src/App.ts` (see `protocol-health` at line 2206), and detail views live in `src/components/details/`. Data routes are Vercel-style handlers in `apps/hq/api/*.js` with `_upstash-cache.js`, `_cors.js` and `_cache-telemetry.js` helpers. Node tests: `apps/hq/tests/*.test.mjs` wired through `npm run test:data` in `apps/hq/package.json`.
- HQ is a standalone app (own `package.json`, Cloud Run deploy in `apps/hq/docs/deploy-cloud-run.md`, owner-gated). It is not served at three.ws/hq.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd apps/hq
grep -n "\[ \]" ROADMAP.md | head -60
ls api | grep -iE "subgraph|protocol|oracle|risk|dune|lido|maker|eigen|hyper"
ls src/components | grep -iE "protocol|oracle|risk|heatmap"
grep -rli "dune\|riskheatmap\|chainlink" src api | head
npm run typecheck 2>&1 | tail -5
npm run test:data 2>&1 | tail -8
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Reconcile the roadmap first. Update `apps/hq/ROADMAP.md` so every item verified shipped in Step 0 is checked with its file path, and move genuinely open items under a single "Open" list. Add the date. Do this before building so the document is true.
2. Protocol dashboard framework. Add `apps/hq/api/protocol-dashboard.js` (`?slug=<defillama slug>`), built on the keyless DeFiLlama endpoints already used by `api/top-protocols.js` and `api/protocol-health.js`: TVL by chain, TVL history, fees and revenue, yields and pools for the protocol, token price and market cap, plus protocol-specific blocks declared in a config table (`apps/hq/src/config/protocol-dashboards.ts`). Add the matching `ProtocolDashboardPanel` and a detail view, lazily registered like `protocol-health`. The config table, not code branches, defines each protocol's blocks.
3. Seed the config Solana first: the leading Solana protocols by DeFiLlama TVL read at runtime (do not hardcode a ranking; the config lists slugs and which blocks apply, and the panel offers a picker populated from `GET /api/top-protocols` filtered to chain Solana). Then the roadmap's protocols as config entries: Uniswap (pool depth and fee revenue via `api/subgraph-uniswap.js`, LP profitability as fees versus impermanent loss over a selectable window), Aave (utilization, supply and borrow rates, health-factor distribution via `api/subgraph-aave.js`), Maker/Sky, Lido (stake, validators, rate), Eigenlayer (restaked TVL by operator), Hyperliquid (open interest, funding, volume through the existing `api/funding-rates.js` lanes). Each block states its source and freshness in the UI.
4. Oracle deviation monitor: `apps/hq/api/oracle-deviation.js` compares on-chain oracle feed values (Chainlink feeds read via public RPC `latestRoundData` for EVM, Pyth on Solana through its public price service) against exchange mid prices from the existing `venue-spread.js` lane, flags deviation above a configurable basis-point threshold and stale rounds (age over the feed heartbeat). Panel `OracleMonitorPanel`. Solana (Pyth) feeds are the first-class lane.
5. Risk heatmap: `apps/hq/api/risk-heatmap.js` and `RiskHeatmapPanel`, a protocols by risk-dimension matrix. Dimensions and sources, all real: smart contract risk (age since listing, audit count and exploit history from `api/exploit-ledger.js` and the DeFiLlama hacks dataset), oracle risk (oracle used, from the protocol metadata, and live deviation from task 4), governance risk (admin-key and timelock presence where DeFiLlama exposes it, recent proposal activity from `api/governance.js`), liquidity risk (TVL concentration and 7d outflow from `api/protocol-health.js`), and market risk. Unknown is a visible state (hatched cell with "no data"), never a guessed score. Document the methodology in the response `methodology` field, as `protocol-health.js` does, and label it a heuristic, not advice.
6. Dune integration: only if a free path exists. Dune's API needs a key; implement `apps/hq/api/dune-query.js` as an opt-in, read-only proxy for saved public query ids, disabled with a clear "add DUNE_API_KEY in settings" state when the key is absent (see `src/services/runtime-config.ts` and `RuntimeConfigPanel.ts` for how optional keys are surfaced). Do not add a paid dependency to the default build.
7. Tests (test-first for the scoring and the deviation maths): `apps/hq/tests/protocol-dashboard.test.mjs`, `oracle-deviation.test.mjs`, `risk-heatmap.test.mjs` in the style of `protocol-health.test.mjs`, covering score bounds, unknown handling, stale-round detection, and basis-point math. Add them to the `test:data` script. Add Playwright coverage in `apps/hq/e2e/` for the three new panels (loading skeleton, populated, error with retry, empty state), and run `npm run typecheck`, `npm run build`.
8. UI standards for every new panel: skeleton loading, designed empty and error states with a retry action, hover, focus and active states on every control, keyboard operable picker, and a real-browser run of `npm run dev` in `apps/hq` with a clean console and successful network calls. Capture the observations in the report.
9. Docs: `apps/hq/README.md` panel table, `apps/hq/CHANGELOG.md`, and a `data/changelog.json` entry only when HQ is next deployed (the HQ deploy is owner-gated; leave the Cloud Run command ready in the report).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `cd apps/hq && npm run typecheck && npm run test:data` pass, including the three new test files (shown failing before the code existed).
- [ ] `grep -c "\[ \]" apps/hq/ROADMAP.md` drops by the number of verified-shipped items, and every checked item cites a path that exists.
- [ ] In a real browser the protocol dashboard renders for at least one Solana protocol and one EVM protocol from live data, the oracle monitor shows live Pyth and Chainlink rows with ages, and the heatmap shows unknown cells honestly. No console errors.
- [ ] `GET /api/protocol-dashboard?slug=<slug>`, `/api/oracle-deviation`, `/api/risk-heatmap` return 200 JSON locally with a `methodology` or `sources` field.
- [ ] No API key is required for the default build; the Dune panel shows its disabled state without a key.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A protocol is not in the free DeFiLlama dataset | Show the block as "no data from the free sources" with the reason; do not fabricate values |
| Subgraph endpoints need an API key | The existing `api/subgraph-*.js` routes already handle this; reuse their pattern and degrade the block, not the dashboard |
| Public RPC rate limits for oracle reads | Use the existing `_upstash-cache.js` TTL cache and the circuit breaker in `src/utils/circuit-breaker.ts`; a stale cached read is shown with its age |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

These dashboards name crypto projects other than $THREE (Uniswap, Aave, Maker/Sky, Lido, Eigenlayer, Hyperliquid, Chainlink, Pyth, Dune and the Solana protocols read at runtime). Existing HQ code already does this, but any commit whose diff names them needs the owner's explicit approval first: ask once, batched at the end. Runtime-supplied protocol slugs are fine; do not hardcode a third-party token mint or contract address in committed source beyond public oracle feed identifiers that must be configured. The HQ Cloud Run deploy is owner-gated and is not part of this order.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/746-plan-hq-protocol-dashboards-and-risk-heatmap.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `746-plan-hq-protocol-dashboards-and-risk-heatmap.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `apps/hq/ROADMAP.md` (whole file)

~~~~markdown
# HQ - DeFi Dashboard Roadmap

> Last updated: February 2026

## Vision

HQ is the world's first **spatial DeFi intelligence platform** - combining a 3D globe, real-time market data, and AI-powered analysis into a command center for DeFi power users. It runs standalone or embedded in a host page, and provides the visual intelligence layer for AI agent-driven DeFi workflows.

## Completed ✅

### DeFi Market Data
- [x] Crypto prices (BTC/ETH/SOL + 20 tokens) via CoinGecko
- [x] DeFi yields browser (DeFiLlama)
- [x] Chain TVL rankings
- [x] DEX volume tracking
- [x] DEX trending tokens
- [x] Funding rates (Binance + Hyperliquid)
- [x] Open interest tracking
- [x] Long/short ratios
- [x] Liquidation monitoring
- [x] Gas tracker (7 chains: ETH, ARB, Base, OP, Polygon, BSC, AVAX)
- [x] Exchange flow heuristic
- [x] BTC ETF flow tracking
- [x] Stablecoin market health
- [x] Fear & Greed index
- [x] Top protocols by TVL
- [x] Protocol revenue/fees
- [x] DeFi global stats
- [x] Token trending topics (NLP extraction from 30 RSS feeds)
- [x] $THREE signal panel (three.ws API)

### Analytics & Intelligence
- [x] DeFi Scanner (multi-signal opportunity detection)
- [x] Social sentiment analysis
- [x] Market movers (top gainers/losers)
- [x] Morning briefing (AI-generated daily summary)
- [x] Category breakdown (DEX, lending, derivatives, etc.)
- [x] Wallet tracker (read-only, multi-chain)
- [x] Compare Protocols tool
- [x] Price alerts (client-side)
- [x] TradingView chart integration
- [x] Hack/exploit alerts

### Infrastructure
- [x] Host page iframe bridge (postMessage)
- [x] Dashboard templates (7 built-in presets)
- [x] Custom template save/load
- [x] Variant system (full vs tech)
- [x] PWA + offline support
- [x] Tauri desktop app
- [x] 27+ 3D globe layers (legacy geopolitical)

## In Progress 🚧

### DeFi Globe Layers (Q1 2025)
Transform the 3D globe into DeFi's only spatial intelligence platform:
- [ ] Validator/node geographic distribution layer
- [ ] TVL heatmap by region (protocol HQ-based)
- [ ] Exchange & regulatory map layer
- [ ] Cross-chain bridge flow arcs
- [ ] Whale activity pulse layer

### On-Chain Data Integration (Q1 2025)
Move from aggregator-only to direct protocol data:
- [ ] The Graph subgraph integration (Uniswap, Aave, Compound)
- [ ] Lending rate comparison panel (cross-protocol)
- [ ] On-chain activity metrics (daily active addresses, tx count by chain)

### Real-Time Data (Q1 2025)
- [ ] WebSocket real-time price feeds (Binance streams)
- [ ] Live price flash animations
- [ ] Connection status indicator

## Planned 📋

### Q2 2025 - Advanced Analytics
- [ ] MEV & mempool monitoring panel
- [ ] Token unlock & vesting schedules
- [ ] Cross-chain bridge health monitor
- [ ] Historical time-series charts for all DeFi metrics (d3)
- [ ] Whale alert & large transaction monitor
- [ ] Governance & DAO proposal tracker (Snapshot + Tally)
- [ ] Airdrop eligibility tracker
- [ ] NFT floor price tracker (optional layer)

### Q3 2025 - AI Agent Integration
- [ ] Deep three.ws agent context sharing
- [ ] Natural language DeFi queries ("what's the best USDC yield right now?")
- [ ] AI-powered trade signal generation
- [ ] Portfolio risk analysis agent tool
- [ ] Automated alert-to-action workflows

### Q4 2025 - Protocol-Specific Dashboards
- [ ] Uniswap deep analytics (pool depth, fee revenue, LP profitability)
- [ ] Aave utilization dashboard (real-time supply/borrow rates, health factors)
- [ ] Maker/Sky ecosystem dashboard
- [ ] Lido staking analytics
- [ ] Eigenlayer restaking monitor
- [ ] Hyperliquid derivatives analytics

### Future - Advanced Features
- [ ] DEX aggregator integration (swap execution from HQ)
- [ ] Multi-chain portfolio tracking (via three.ws agent wallets)
- [ ] Custom alert rule builder (compound conditions)
- [ ] Dune Analytics query integration
- [x] Cross-venue price discrepancy monitoring (Venue Spread panel + `/api/venue-spread`, 2026-08)
- [ ] Chainlink oracle price discrepancy monitoring (on-chain oracle feeds specifically)
- [x] Cross-chain fee comparison calculator (Fee Compare panel, 2026-08)
- [x] Protocol health scoring system (Protocol Health panel + `/api/protocol-health`, 2026-08)
- [ ] DeFi risk heatmap (smart contract risk, oracle risk, governance risk)

## Architecture Improvements

- [ ] Extract DeckGLMap.ts into modular layer system
- [ ] Split App.ts orchestrator into feature modules
- [ ] Add TypeScript to API routes
- [ ] Implement API versioning
- [ ] Add comprehensive unit test coverage
- [ ] Migrate types to domain-specific files
- [ ] WebSocket connection pool management
- [ ] Service worker push notifications for alerts

## Legacy (Geopolitical) - Maintenance Mode

The following features are inherited from HQ's geopolitical intelligence origins. They remain functional but are not the development priority:
- Conflict/protest tracking (ACLED)
- Military base mapping
- Flight tracking (OpenSky)
- Vessel tracking (AIS)
- Nuclear facility mapping
- UCDP events
- Country Instability Index
- Infrastructure cascade
- Displacement flows
- Sanctions mapping

These layers are gated behind the `full` variant and can be toggled off. They may be deprecated in a future version if they create maintenance burden.

## Success Metrics

1. **Coverage**: >90% of top 100 DeFi protocols have data in HQ
2. **Latency**: <5 second time-to-first-meaningful-paint for any panel
3. **Uniqueness**: 5+ features no other DeFi dashboard offers (globe layers, spatial intelligence)
4. **Integration**: Full three.ws agent tool coverage for all HQ data
5. **Reliability**: <1% error rate on API routes, graceful degradation on failures
~~~~

