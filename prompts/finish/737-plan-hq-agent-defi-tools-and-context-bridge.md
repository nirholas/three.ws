# Connect HQ to three.ws agents: context bridge, DeFi query tools, compound alert rules and alert-to-action

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/737-plan-hq-agent-defi-tools-and-context-bridge.md`.

**Priority:** P2, new capability with clear value (score 49 of 100 inside the tier). **Area:** hq. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

HQ's roadmap calls for deep three.ws agent integration: agents that share context with the dashboard, answer natural-language DeFi queries, analyze portfolio risk, and turn alerts into actions. Today the only link is the postMessage bridge `apps/hq/src/services/hq-bridge.ts` (6 host commands, 7 events, none of which carry panel data or accept a query), price alerts that live only in the browser (`PriceAlertsPanel.ts`, `localStorage`), and an HQ app that is not served inside three.ws. Meanwhile the platform already has the pieces: `packages/intel-mcp`, `packages/alerts-mcp`, `packages/portfolio-mcp`, `packages/autopilot-mcp` and the autopilot create_alert action. The work is to expose HQ's real data as agent tools, let an agent drive and read the dashboard through the bridge, and wire alert rules to autopilot so a fired alert becomes a proposed, owner-confirmed action. Doing this on the Solana lane first keeps it aligned with the home chain.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `apps/hq/src/services/hq-bridge.ts` (380 lines): origin allowlist (`https://three.ws`, `https://www.three.ws`, localhost ports, `*.vercel.app` preview wildcard, which contradicts the repo's no-Vercel rule and should be removed), events `hq:ready`, `hq:template-changed`, `hq:panel-toggled`, `hq:country-selected`, `hq:signal-detected`, `hq:market-update`, `hq:notification`, commands `host:apply-template`, `host:toggle-panel`, `host:fly-to-country`, `host:set-theme`, `host:request-state`, `host:show-panel`. No command returns panel data or accepts a query.
- Host side: `grep -rln hq-bridge src` finds no three.ws page that embeds HQ and speaks this bridge (the matches in `src/*.js` are unrelated `postMessage` code), so the bridge has no first-party consumer.
- `apps/hq/src/components/PriceAlertsPanel.ts` (327 lines): single-condition price alerts stored in `localStorage`, no server delivery, no compound rules. `PortfolioDNAPanel.ts` and `WalletTrackerPanel.ts` (read-only, multi-chain) exist; there is no risk analysis tool.
- Platform pieces to reuse: `packages/intel-mcp`, `packages/alerts-mcp`, `packages/portfolio-mcp`, `packages/autopilot-mcp`, `api/_lib/autopilot.js` (`create_alert`, `generate_proposals`, `dryRunProposal`), `pump_alert_rules` table, `api/_lib/agent-wallet.js`.
- HQ data routes are in `apps/hq/api/*.js` (yields, TVL, funding, liquidations, whale monitor, protocol health, venue spread, governance, wallet tracker). HQ runs standalone with its own tests (`npm run test:data` in `apps/hq/package.json`) and an owner-gated Cloud Run deploy.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -n "host:\|hq:" apps/hq/src/services/hq-bridge.ts | head -40
grep -rln "hq-bridge\|hq:ready\|host:apply-template" src apps/hq/src | head
grep -n "vercel.app" apps/hq/src/services/hq-bridge.ts
ls packages/intel-mcp/src packages/alerts-mcp/src 2>/dev/null
grep -n "create_alert" api/_lib/autopilot.js | head -5
ls apps/hq/e2e apps/hq/tests
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Harden the bridge first (bug fix, test-first): remove the `*.vercel.app` wildcard from `isAllowedOrigin` in `apps/hq/src/services/hq-bridge.ts` (the repo does not use Vercel previews; production and preview are on Google Cloud). Write a test beforehand in `apps/hq/tests/hq-bridge.test.mjs` (extract `isAllowedOrigin` into a pure module such as `src/services/hq-bridge-origins.ts` so Node can import it) that fails today for `https://evil.vercel.app` and passes for `https://three.ws` and the localhost ports. Wire the test into `test:data`. Also confirm the allowlist matches the `frame-ancestors` in `apps/hq/vercel.json` and `scripts/cloudrun-server.mjs`.
2. Typed request/response over the bridge. Add commands `host:get-panel-data` (panel key, returns the panel's last loaded data with a freshness timestamp), `host:run-query` (a structured DeFi query, see task 3), `host:get-portfolio-risk` and events `hq:panel-data`, `hq:query-result`, `hq:error`, each message carrying a correlation id so concurrent requests are matched. Validate every payload with a schema (reject unknown keys, size cap) and answer `hq:error` with a reason for malformed input. Panels expose data through a small registry (`src/services/panel-data-registry.ts`) populated by the panels that already hold fetched data (yields, TVL, funding rates, liquidations, whale monitor, protocol health, venue spread). Tests for correlation, size caps and rejected shapes.
3. DeFi query tools. Create `apps/hq/api/agent-tools.js` exposing the real HQ data as a documented tool set (`top_yields`, `chain_tvl`, `protocol_health`, `funding_rates`, `liquidations`, `venue_spread`, `whale_activity`, `gas`), each with a JSON schema, Solana-lane parameters first (chain filter default Solana for yields and TVL tools), and returning data plus source and freshness. Then add natural-language handling: a server function that takes a question ("what is the best USDC yield on Solana right now?"), uses the platform's existing LLM proxy (`grep -rn "openrouter-summarize\|groq-summarize" apps/hq/api` shows HQ's own summarize routes; reuse the one already configured, no new paid API) with tool calling restricted to the tool set above, and returns the answer plus the tool calls and rows it used. The answer must be grounded in tool output; if no tool covers the question it says so. Tests with recorded real tool responses are not allowed as fakes: test the tool layer against live keyless upstreams in an opt-in script, and unit-test argument validation and schema conformance offline.
4. Platform side: expose the same tools to three.ws agents. Either add them to `packages/intel-mcp` as a new `hq_*` tool group that calls the deployed HQ API base from an env var, or create `packages/hq-mcp` (0.1.0, layout of `packages/portfolio-mcp`) if intel-mcp's scope would be muddied. Pick by reading `packages/intel-mcp/README.md`. Register in `scripts/test-mcp-all.mjs`, add its README, a `STRUCTURE.md` row, and make `npm run test:mcp` pass. Portfolio risk analysis tool: `analyze_portfolio_risk` takes a wallet address (Solana first, EVM supported), reads balances through the existing `WalletTrackerPanel` data route, and returns concentration, stablecoin share, protocol exposure and the matching `protocol-health` grades. It is read-only.
5. Compound alert rule builder in HQ: replace the single-condition model in `PriceAlertsPanel.ts` with rules of the form AND/OR groups over price, 24h change, funding rate, TVL change, gas, and liquidation volume conditions, each with a cooldown. Evaluate client-side as today, and add an opt-in "deliver through three.ws" toggle that creates the same rule server-side through `packages/alerts-mcp` or `POST` to the existing alert rule API (`grep -rn pump_alert_rules api | head`) when the user is signed in to three.ws, so alerts survive closing the tab. Migrate existing `localStorage` alerts without losing them. UI standards: hover, focus and active states, an empty state ("no rules yet, build one"), validation errors inline, skeleton loading, keyboard accessible.
6. Alert-to-action: when a server-side rule fires, allow the owner to attach an action template that becomes an autopilot proposal through `api/_lib/autopilot.js` (`generate_proposals` / the proposal table), never an auto-executed one. Only reversible kinds can be attached (`create_alert`, `briefing`). Anything that moves funds must stay a proposal that requires the owner's confirmation under the existing `require_confirm` policy. Tests: a fired rule produces a proposal row with provenance, and a `wallet_transfer`-kind template is rejected at attach time.
7. Embedding: add an HQ embed route inside three.ws only if HQ is deployed to a known origin; otherwise provide the host-side helper `src/hq-host.js` (a small client that creates the iframe, performs the origin check and exposes `getPanelData`, `runQuery`) with a docs page `docs/hq-agent-integration.md`, and a demo section on an existing agent page that renders when `HQ_ORIGIN` is configured. Do not add a placeholder iframe that points nowhere.
8. Tests and verification: `apps/hq/tests/*.test.mjs` added to `test:data`; `tests/hq-host.test.js` in the root suite; Playwright coverage in `apps/hq/e2e/` for the rule builder. Run `cd apps/hq && npm run typecheck && npm run test:data && npm run build`, `npm run test:mcp` and `npm test` at the root, and exercise the rule builder and a bridge round trip in a real browser against `npm run dev` in `apps/hq`. Update `apps/hq/ROADMAP.md` (check the items completed), `apps/hq/README.md`, `apps/hq/CHANGELOG.md`, `docs/hq-agent-integration.md`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -n "vercel.app" apps/hq/src/services/hq-bridge*.ts` returns nothing, and the origin test passes (shown failing first).
- [ ] A bridge round trip in a real browser returns `hq:panel-data` for `host:get-panel-data` with a correlation id, and `hq:error` for a malformed payload.
- [ ] `GET /api/agent-tools` (local HQ dev server) lists the tools with JSON schemas, and a Solana-filtered yields call returns live rows.
- [ ] The natural-language route answers a Solana yield question with the tool rows it used, and returns "no tool covers this" for an unrelated question.
- [ ] `npm run test:mcp` is green and includes the new or extended MCP package; `analyze_portfolio_risk` returns a result for a real public Solana address.
- [ ] A fired server-side rule produces an autopilot proposal and never executes one; a fund-moving template is refused at attach time.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No LLM key in HQ's environment for the natural-language route | Use the platform's configured proxy per the self-unblock playbook (`.env.local`, then GCP Vertex Gemini under the standing credit approval); the tool endpoints work without it and are verified separately |
| HQ has no deployed origin for the host to embed | Ship the host helper and docs, verify against the local `npm run dev` origin, and list the HQ deploy as the owner step. Do not point an iframe at a guessed URL |
| MCP package scope unclear | Decide by reading `packages/intel-mcp/README.md`; default to a separate `packages/hq-mcp` |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The tool set, risk analysis and rule templates reference crypto projects other than $THREE (DeFi protocols and chains read from live data). Any commit whose diff names a specific third-party project in code, tests or docs needs the owner's explicit approval first: ask once, batched at the end. Alert-to-action never signs or sends funds; if a task seems to require a real transfer, stop at the proposal and leave execution to the existing owner-confirmed autopilot flow. The HQ Cloud Run deploy is owner-gated.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/737-plan-hq-agent-defi-tools-and-context-bridge.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `737-plan-hq-agent-defi-tools-and-context-bridge.md`, the commit SHAs, and one sentence on what shipped.
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

