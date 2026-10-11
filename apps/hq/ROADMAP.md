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

