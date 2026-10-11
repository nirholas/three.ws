# Changelog

All notable changes to HQ are documented here.

## [Unreleased]

### Changed

- **Now a three.ws app**: rebranded to HQ for three.ws (titles, metadata, manifest, header, story cards), package renamed to `three-ws-hq`
- **$THREE panel**: replaces the previous single-protocol panel with a live $THREE market signal from the three.ws API (`/api/three-signal`, origin configurable with `VITE_THREE_API_ORIGIN`)
- **Storage keys**: browser storage keys and the IndexedDB name now use the `hq` prefix
- **Host bridge**: iframe commands use the `host:` prefix and the allowed origins are three.ws and localhost

### Removed

- Legacy single-product docs, agent prompt files and CI workflow templates

## [2.4.1] - 2026-08-01

### Fixed

- **Derivatives panels were empty or half-empty in production**: Binance and Bybit both refuse requests from US egress IPs, which is where Cloud Run runs. Long/Short Ratio and Liquidations had no working source at all, and Funding Rates and Open Interest were down to Hyperliquid alone. All four now use OKX's keyless public API as a shared failover lane (`api/_okx-derivatives.js`)
- **OKX liquidations never returned data**: the request omitted the `instFamily` parameter OKX requires, so the lane failed silently with error 50015 even where it was reachable
- **Long/Short Ratio lost most of its board to rate limiting**: OKX's statistics endpoints reject bursts, so requests are now paced, retried once on a throttle response, and no longer fetched twice for the same data. Recovers all 10 tracked symbols instead of 1

### Added

- **Venue Spread panel**: the same asset quoted on Coinbase, Kraken and OKX at the same moment, with the gap between cheapest and dearest in basis points, sort and divergent-only controls, and severity colouring. New `/api/venue-spread` route
- **Unit tests** for the protocol health scoring model, the venue spread calculation, and the OKX account-split derivation, wired into `npm run test:data`

## [2.4.0] - 2026-08-01

### Added

- **Protocol Health panel**: composite 0-100 health score for the top 75 DeFi protocols (TVL scale, 7d momentum, 1d stability, chain diversification, listing maturity, mcap/TVL sanity) with category filter and score/TVL/7d sort controls. New `/api/protocol-health` route derives scores from DeFiLlama, cached 15 minutes
- **Fee Compare panel**: cross-chain fee calculator showing the live USD cost of a transfer, swap, or complex contract call on all 7 gas-tracked chains, with transaction-type and batch-size controls and cheapest-chain highlighting
- **Bitcoin Network panel** (`/api/btc-network`): live fee tiers, mempool backlog, congestion level, hashrate, and difficulty retarget progress from mempool.space
- **Exploit Ledger panel** (`/api/exploit-ledger`): structured hack database from DeFiLlama with 90-day/1-year loss totals, per-incident amounts, techniques, and chains, plus an all/bridges filter; complements the RSS-based Exploit Alerts panel with hard numbers
- **Sector Rotation panel** (`/api/sector-rotation`): market-cap-ranked crypto sectors with 24h momentum from CoinGecko categories, advancing/declining counts, and sortable by change or market cap
- **`/api/health` endpoint**: service health for Cloud Run monitoring and uptime checks; reports process vitals, configured integrations (booleans only), and reachability of the keyless upstream data lanes
- **README**: the repository now has a real front page covering setup, testing, desktop packaging, and deployment

### Fixed

- **Complete market data on the fallback lane**: `/api/coingecko-markets` and `/api/coingecko-global` now fall back to CoinPaprika (full market shape: 24h change, market cap, volume, logos, BTC dominance) before the prices-only DeFiLlama lane. On Cloud Run, where CoinGecko blocks GCP egress IPs, tickers previously rendered without 24h change or market caps
- **Time-rotted test**: `cyber-threats` aggregation test used hardcoded February 2026 dates that aged out of the handler's recency window; mocks are now relative to the clock
- **Repo hygiene**: removed committed debug dumps and screenshots from the repository root

## [2.3.4] - 2026-02-16

### Fixed

- **Windows sidecar crash**: Strip `\\?\` UNC extended-length prefix from paths before passing to Node.js - Tauri `resource_dir()` on Windows returns UNC-prefixed paths that cause `EISDIR: lstat 'C:'` in Node.js module resolution
- **Windows sidecar CWD**: Set explicit `current_dir` on the Node.js Command to prevent bare drive-letter working directory issues from NSIS shortcut launcher
- **Sidecar package scope**: Add `package.json` with `"type": "module"` to sidecar directory, preventing Node.js from walking up the entire directory tree during ESM scope resolution

## [2.3.3] - 2026-02-16

### Fixed

- **Keychain persistence**: Enable `apple-native` (macOS) and `windows-native` (Windows) features for the `keyring` crate - v3 ships with no default platform backends, so API keys were stored in-memory only and lost on restart
- **Settings key verification**: Soft-pass network errors during API key verification so transient sidecar failures don't block saving
- **Resilient keychain reads**: Use `Promise.allSettled` in `loadDesktopSecrets` so a single key failure doesn't discard all loaded secrets
- **Settings window capabilities**: Add `"settings"` to Tauri capabilities window list for core plugin permissions
- **Input preservation**: Capture unsaved input values before DOM re-render in settings panel

## [2.3.0] - 2026-02-15

### Security

- **CORS hardening**: Tighten Vercel preview deployment regex to block origin spoofing (`defisEVIL.vercel.app`)
- **Sidecar auth bypass**: Move `/api/local-env-update` behind `LOCAL_API_TOKEN` auth check
- **Env key allowlist**: Restrict sidecar env mutations to 18 known secret keys (matching `SUPPORTED_SECRET_KEYS`)
- **postMessage validation**: Add `origin` and `source` checks on incoming messages in LiveNewsPanel
- **postMessage targetOrigin**: Replace wildcard `'*'` with specific embed origin
- **CORS enforcement**: Add `isDisallowedOrigin()` check to 25+ API endpoints that were missing it
- **Custom CORS migration**: Migrate `gdelt-geo` and `eia` from custom CORS to shared `_cors.js` module
- **New CORS coverage**: Add CORS headers + origin check to `firms-fires`, `stock-index`, `youtube/live`
- **YouTube embed origins**: Tighten `ALLOWED_ORIGINS` regex in `youtube/embed.js`
- **CSP hardening**: Remove `'unsafe-inline'` from `script-src` in both `index.html` and `tauri.conf.json`
- **iframe sandbox**: Add `sandbox="allow-scripts allow-same-origin allow-presentation"` to YouTube embed iframe
- **Meta tag validation**: Validate URL query params with regex allowlist in `parseStoryParams()`

### Fixed

- **Service worker stale assets**: Add `skipWaiting`, `clientsClaim`, and `cleanupOutdatedCaches` to workbox config - fixes `NS_ERROR_CORRUPTED_CONTENT` / MIME type errors when users have a cached SW serving old HTML after redeployment

## [2.2.6] - 2026-02-14

### Fixed

- Filter trending noise and fix sidecar auth
- Restore tech variant panels
- Remove Market Radar and Economic Data panels from tech variant

### Docs

- Add developer X/Twitter link to Support section
- Add cyber threat API keys to `.env.example`

## [2.2.5] - 2026-02-13

### Security

- Migrate all Vercel edge functions to CORS allowlist
- Restrict Railway relay CORS to allowed origins only

### Fixed

- Hide desktop config panel on web
- Route World Bank & Polymarket via Railway relay

## [2.2.3] - 2026-02-12

### Added

- Cyber threat intelligence map layer (Feodo Tracker, URLhaus, C2IntelFeeds, OTX, AbuseIPDB)
- Trending keyword spike detection with end-to-end flow
- Download desktop app slide-in banner for web visitors
- Country briefs in Cmd+K search

### Changed

- Redesign 4 panels with table layouts and scoped styles
- Redesign population exposure panel and reorder UCDP columns
- Dramatically increase cyber threat map density

### Fixed

- Resolve z-index conflict between pinned map and panels grid
- Cap geo enrichment at 12s timeout, prevent duplicate download banners
- Replace ipwho.is/ipapi.co with ipinfo.io/freeipapi.com for geo enrichment
- Harden trending spike processing and optimize hot paths
- Improve cyber threat tooltip/popup UX and dot visibility

## [2.2.2] - 2026-02-10

### Added

- Full-page Country Brief Page replacing modal overlay
- Download redirect API for platform-specific installers

### Fixed

- Normalize country name from GeoJSON to canonical TIER1 name
- Tighten headline relevance, add Top News section, compact markets
- Hide desktop config panel on web, fix irrelevant prediction markets
- Tone down climate anomalies heatmap to stop obscuring other layers
- macOS: hide window on close instead of quitting

### Performance

- Reduce idle CPU from pulse animation loop
- Harden regression guardrails in CI, cache, and map clustering

## [2.2.1] - 2026-02-08

### Fixed

- Consolidate variant naming and fix PWA tile caching
- Windows settings window: async command, no menu bar, no white flash
- Constrain layers menu height in DeckGLMap
- Allow Cloudflare Insights script in CSP
- macOS build failures when Apple signing secrets are missing

## [2.2.0] - 2026-02-07

Initial v2.2 release with multi-variant support (World + Tech), desktop app (Tauri), and comprehensive geopolitical intelligence features.
