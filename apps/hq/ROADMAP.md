# HQ - DeFi Dashboard Roadmap

> Last updated: 2026-11-13

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
- [x] Typed bridge data commands with correlation ids, panel data with freshness timestamps, early `hq:ready` (`hq-bridge-protocol.ts`, `src/hq-host.js`)

### three.ws Agent Integration
- [x] DeFi agent tools API: 8 data tools plus `portfolio_risk`, with natural-language routing and narration (`api/agent-tools.js`)
- [x] MCP server over the same tools (`packages/hq-mcp`)
- [x] Compound alert rules (up to 4 price/funding/gas clauses, all/any) with legacy alert migration (`PriceAlertsPanel`, `alert-rules.ts`)
- [x] Alert-to-action: an opted-in rule hands a reversible proposal to the owner's agent in Autopilot; never signs or moves funds
- [x] LLM routes survive model retirement: ordered Groq model list (`api/_groq.js`) and OpenRouter free-tier fallback for narration
- [x] Dashboard templates (7 built-in presets)
- [x] Custom template save/load
- [x] Variant system (full vs tech)
- [x] PWA + offline support
- [x] Tauri desktop app
- [x] 27+ 3D globe layers (legacy geopolitical)

## Shipped from the 2025 plan (verified 2026-11-15)

### DeFi Globe Layers
- [x] Validator/node geographic distribution layer (`api/validator-nodes.js`)
- [x] TVL heatmap by region (protocol HQ-based) (`api/tvl-geo.js`)
- [x] Exchange & regulatory map layer (`src/config/crypto-exchanges.ts`, `src/config/crypto-regulation.ts`, rendered by `src/components/DeckGLMap.ts`)
- [x] Cross-chain bridge flow arcs (`api/bridge-flows.js`)
- [x] Whale activity pulse layer (`src/components/WhaleMonitorPanel.ts`)

### On-Chain Data Integration
- [x] The Graph subgraph integration (Uniswap, Aave, Compound) (`api/subgraph-uniswap.js`, `api/subgraph-aave.js`, `api/subgraph-compound.js`, `src/components/OnChainPanel.ts`)
- [x] Lending rate comparison panel (cross-protocol) (`src/components/LendingRatesPanel.ts`)

### Real-Time Data
- [x] WebSocket real-time price feeds (`src/services/websocket-prices.ts`)
- [x] Connection status indicator (`ws-status` header badge in `src/App.ts`)

### Advanced Analytics
- [x] MEV & mempool monitoring panel (`src/components/MevMonitorPanel.ts`)
- [x] Token unlock & vesting schedules (`src/components/TokenUnlocksPanel.ts`)
- [x] Cross-chain bridge health monitor (`src/components/BridgeMonitorPanel.ts`)
- [x] Historical TVL time-series charts (d3) (`api/historical-tvl.js`, `src/utils/d3-timeseries.ts`)
- [x] Whale alert & large transaction monitor (`src/components/WhaleMonitorPanel.ts`)
- [x] Governance & DAO proposal tracker, Snapshot (`api/governance.js`, `src/components/GovernancePanel.ts`)
- [x] Airdrop eligibility tracker (`src/components/AirdropTrackerPanel.ts`)

### AI Agent Integration
- [x] three.ws agent context sharing over the host bridge (`src/services/hq-bridge.ts`, `src/services/hq-bridge-protocol.ts`)
- [x] Natural language DeFi queries (`routeQuestion` in `api/agent-tools.js`)
- [x] Portfolio risk analysis agent tool (`portfolio_risk` in `api/agent-tools.js`, `api/_portfolio-risk.js`)
- [x] Automated alert-to-action workflows (Autopilot proposals in `src/services/alert-rules.ts`)

### Protocol-Specific Dashboards
One data-driven framework (`api/protocol-dashboard.js`, config table `api/_protocol-dashboards.js`, `src/components/ProtocolDashboardPanel.ts`), Solana protocols first via a picker over `/api/top-protocols` filtered to Solana.
- [x] Uniswap deep analytics: pool depth, fee revenue, LP fees versus impermanent loss (`uniswap-lp` block)
- [x] Aave utilization, supply and borrow rates (`lending-rates` block)
- [x] Maker/Sky ecosystem dashboard (slug `sky-lending`)
- [x] Lido staking analytics (`lido-staking` block)
- [x] Eigenlayer restaking monitor: TVL, fees and token breakdown (`token-breakdown` block)
- [x] Hyperliquid derivatives analytics (`hyperliquid-markets` block)

### Advanced Features
- [x] Custom alert rule builder, compound conditions (`src/services/alert-rules.ts`)
- [x] Cross-venue price discrepancy monitoring (`api/venue-spread.js`)
- [x] On-chain oracle deviation monitoring, Pyth on Solana first plus Chainlink on Ethereum (`api/oracle-deviation.js`, `src/components/OracleMonitorPanel.ts`)
- [x] Cross-chain fee comparison calculator (Fee Compare panel)
- [x] Protocol health scoring system (`api/protocol-health.js`)
- [x] DeFi risk heatmap: contract, oracle, governance, liquidity and market risk, unknown shown as no data (`api/risk-heatmap.js`, `src/components/RiskHeatmapPanel.ts`)
- [x] Dune query integration, opt-in with `DUNE_API_KEY` (`api/dune-query.js`, `src/components/DuneQueryPanel.ts`)

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

## Open (as of 2026-11-15)

- [ ] Aave account health factors (needs per-account positions, no free public source)
- [ ] Governance proposal data from Tally, and live proposal counts feeding the risk heatmap governance column
- [ ] Oracle monitor feeds beyond Pyth SOL/BTC/ETH and Chainlink ETH/BTC/LINK on Ethereum
- [ ] On-chain activity metrics from measured data (`api/chain-activity.js` still estimates daily transactions for some chains)
- [ ] Live price flash animations
- [ ] NFT floor price tracker
- [ ] AI-powered trade signal generation for agents
- [ ] Server-side alert evaluation, so a rule fires while no HQ tab is open
- [ ] DEX aggregator swap execution from HQ
- [ ] Multi-chain portfolio tracking via three.ws agent wallets
- [ ] Time-series charts for every DeFi metric (only TVL history is charted)
