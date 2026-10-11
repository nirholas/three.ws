# HQ - Development Guidelines

This document serves as a comprehensive guide for all contributors and AI agents developing HQ.

## Project Description

HQ is a real-time DeFi and crypto market intelligence dashboard for [three.ws](https://three.ws): a visually rich command center with an interactive 3D globe, live market data, protocol analytics, and AI-powered analysis. It runs standalone and can be embedded in a host page via iframe.

> **Important for agents:** HQ was originally built as a geopolitical intelligence dashboard, but has since been repurposed as a **DeFi crypto dashboard** for three.ws. The 3D globe UI remains, and some legacy world-events layers (conflict, military, etc.) still exist in the codebase, but the product's mission is now **DeFi, crypto markets, protocol analytics, and blockchain data**. Prioritize DeFi features over legacy geopolitical ones.

**License**: MIT

## Tech Stack

- **Frontend**: Vite 6 + vanilla TypeScript (no React, no framework)
- **3D Map**: deck.gl 9.2 + MapLibre GL 5.16 (WebGL globe)
- **Charts**: d3 7.9 (mobile SVG fallback + data visualizations)
- **AI/ML**: @xenova/transformers (client-side NER, content classification)
- **Desktop**: Tauri v2 (macOS/Windows native app)
- **API**: Vercel Serverless Functions (JavaScript, deployed on Vercel)
- **Caching**: Upstash Redis (edge caching for API routes)
- **Analytics**: @vercel/analytics
- **Testing**: Playwright (E2E + visual regression), Node test runner (unit)
- **Package Manager**: npm

## Architecture

```
HQ is a single-page application with a monolithic orchestrator pattern.
There is NO component framework - all UI is pure DOM manipulation via TypeScript classes.

App.ts (3,940 lines) - The orchestrator. Initializes everything, manages state, 
                        coordinates all panels and services. This is the entry point.

DeckGLMap.ts (3,524 lines) - The WebGL 3D globe. Contains ALL map layers (27+),
                              camera control, click handlers, popups, clustering.

All other components are TypeScript classes that create/manage their own DOM elements.
Services fetch data and return typed objects. No state management library.
```

## Directory Structure

```
HQ/
├── api/                    # Vercel Serverless Functions (52 routes)
│   ├── _cors.js            # CORS helper (shared)
│   ├── _ip-rate-limit.js   # Rate limiting helper
│   ├── _upstash-cache.js   # Redis cache helper
│   ├── acled.js             # ACLED protest data
│   ├── acled-conflict.js    # ACLED conflict data
│   ├── ais-snapshot.js      # Maritime vessel AIS data
│   ├── arxiv.js             # arXiv AI papers
│   ├── classify-batch.js    # AI batch classification (Groq)
│   ├── classify-event.js    # AI event classification (Groq)
│   ├── climate-anomalies.js # Open-Meteo climate data
│   ├── cloudflare-outages.js # Internet outage detection
│   ├── coingecko.js         # Crypto market data
│   ├── country-intel.js     # AI country analysis (Groq)
│   ├── cyber-threats.js     # Multi-source IOC aggregation
│   ├── earthquakes.js       # USGS earthquake feed
│   ├── etf-flows.js         # Crypto ETF flow data
│   ├── finnhub.js           # Stock market data
│   ├── firms-fires.js       # NASA satellite fire detection
│   ├── gdelt-doc.js         # GDELT news intelligence
│   ├── gdelt-geo.js         # GDELT geolocation events
│   ├── github-trending.js   # GitHub trending repos
│   ├── groq-summarize.js    # AI summarization (Groq)
│   ├── hackernews.js        # Hacker News top stories
│   ├── macro-signals.js     # 7-signal macro composite
│   ├── openrouter-summarize.js # AI summarization (OpenRouter)
│   ├── opensky.js           # Military flight tracking
│   ├── polymarket.js        # Prediction market data
│   ├── risk-scores.js       # Country Instability Index
│   ├── rss-proxy.js         # RSS feed batch proxy
│   ├── stablecoin-markets.js # Stablecoin health data
│   ├── stock-index.js       # Global stock indices
│   ├── yahoo-finance.js     # Yahoo Finance fallback
│   ├── data/                # Static data endpoints
│   ├── eia/                 # Energy Information Agency
│   ├── pizzint/             # Pentagon Pizza Index
│   ├── wingbits/            # Aircraft enrichment
│   └── youtube/             # YouTube live/embed proxy
├── data/                   # Static JSON data files
├── docs/                   # Documentation
├── e2e/                    # Playwright E2E tests
│   ├── map-harness.spec.ts  # Visual regression (golden screenshots)
│   ├── runtime-fetch.spec.ts # API route smoke tests
│   └── keyword-spike-flow.spec.ts # Feature flow test
├── public/                 # Static assets (icons, manifests)
├── scripts/                # Build/packaging scripts
│   ├── ais-relay.cjs        # AIS WebSocket relay server
│   └── desktop-package.mjs  # Tauri packaging script
├── src/
│   ├── App.ts               # Main orchestrator (3,940 lines)
│   ├── main.ts              # Entry point
│   ├── components/          # UI component classes (48 components)
│   │   ├── DeckGLMap.ts      # 3D WebGL globe (3,524 lines)
│   │   ├── NewsPanel.ts      # News feed panel
│   │   ├── MarketPanel.ts    # Market data panel
│   │   ├── MacroSignalsPanel.ts # 7-signal radar
│   │   ├── CIIPanel.ts       # Country Instability Index
│   │   ├── CascadePanel.ts   # Infrastructure cascade
│   │   ├── PredictionPanel.ts # Polymarket predictions
│   │   ├── ETFFlowsPanel.ts  # Crypto ETF flows
│   │   ├── StablecoinPanel.ts # Stablecoin health
│   │   └── ...               # 38 more panel/component classes
│   ├── config/              # Static configuration
│   │   ├── feeds.ts          # 100+ RSS feed registry with tier scoring
│   │   ├── bases-expanded.ts # 220+ military base coordinates
│   │   ├── military.ts       # Military aircraft callsign patterns
│   │   ├── pipelines.ts      # Oil/gas pipeline routes
│   │   ├── countries.ts      # Country metadata + risk config
│   │   ├── markets.ts        # Market configuration
│   │   ├── panels.ts         # Panel layout configuration
│   │   ├── geo.ts            # Geographic presets + regions
│   │   ├── variant.ts        # Variant feature flags
│   │   └── ...               # More config files
│   ├── services/            # Data fetching services (78 files)
│   │   ├── live-news.ts      # RSS fetching + processing
│   │   ├── markets.ts        # Crypto/stock market data
│   │   ├── cyber-threats.ts  # IOC aggregation
│   │   ├── country-instability.ts # CII calculation
│   │   ├── clustering.ts     # News clustering algorithm
│   │   ├── threat-classifier.ts # ML threat classification
│   │   ├── entity-extraction.ts # NER from headlines
│   │   ├── signal-aggregator.ts # Multi-signal fusion
│   │   ├── hotspot-escalation.ts # Dynamic escalation scoring
│   │   ├── focal-point-detector.ts # Cross-signal detection
│   │   └── ...               # 68 more service files
│   ├── styles/              # CSS stylesheets
│   ├── types/               # TypeScript type definitions
│   │   └── index.ts          # All shared types
│   ├── utils/               # Utility functions
│   └── workers/             # Web Workers
│       ├── analysis.worker.ts # Background analysis
│       └── ml.worker.ts       # ML inference worker
├── src-tauri/              # Tauri desktop app config
├── tests/                  # Node.js unit tests
├── index.html              # SPA entry HTML
├── settings.html           # Settings page
├── vite.config.ts          # Vite configuration (proxies, PWA)
├── tsconfig.json           # TypeScript configuration
└── vercel.json             # Vercel deployment config
```

## Variant System

HQ has two build variants controlled by `VITE_VARIANT`:

| Variant | Value | Focus |
|---------|-------|-------|
| **Full** (default) | `full` | DeFi crypto dashboard - all data layers enabled |
| **Tech** | `tech` | AI/startup focused - tech hubs, AI labs, startup ecosystems |

```bash
npm run dev          # Default (full) variant
npm run dev:tech     # Tech variant
npm run build:full   # Production build (full)
npm run build:tech   # Production build (tech)
```

## Development

### Prerequisites

- Node.js 18+
- npm

### Getting Started

```bash
npm install
npm run dev          # Starts Vite dev server on :5173
```

### Environment Variables

Create a `.env` file with:

```env
# Required for full functionality
GROQ_API_KEY=            # Groq API key (AI summarization + classification)
OPENROUTER_API_KEY=      # OpenRouter API key (fallback summarization)
ACLED_API_KEY=           # ACLED API key (conflict/protest data)
ACLED_EMAIL=             # ACLED account email
FINNHUB_API_KEY=         # Finnhub API key (stock data)

# Upstash Redis (API response caching)
UPSTASH_REDIS_REST_URL=  # Upstash REST endpoint
UPSTASH_REDIS_REST_TOKEN= # Upstash REST token

# Optional
VITE_VARIANT=full        # Build variant: full | tech
VITE_ENABLE_AIS=         # Enable AIS vessel tracking
VITE_ENABLE_CYBER_LAYER= # Enable cyber threat map layer
VITE_OPENSKY_RELAY_URL=  # Custom OpenSky relay URL
VITE_WS_RELAY_URL=       # Custom WebSocket relay URL
VITE_DESKTOP_RUNTIME=    # Set to 1 for Tauri desktop builds
VITE_MAP_INTERACTION_MODE= # Map interaction mode
```

### Scripts

```bash
npm run dev              # Development server (:5173)
npm run dev:tech         # Development server (tech variant)
npm run build            # Production build
npm run typecheck        # TypeScript type checking (tsc --noEmit)
npm run preview          # Preview production build

# Testing
npm run test:e2e         # Run all Playwright E2E tests
npm run test:e2e:full    # E2E tests (full variant)
npm run test:e2e:tech    # E2E tests (tech variant)
npm run test:e2e:visual  # Visual regression tests
npm run test:e2e:visual:update  # Update golden screenshots
npm run test:data        # Unit tests (Node test runner)
npm run test:sidecar     # API route tests

# Desktop (Tauri)
npm run desktop:dev      # Tauri development mode
npm run desktop:build:full   # Build desktop app (full)
npm run desktop:build:tech   # Build desktop app (tech)
```

### Important Notes

- **Never** modify `App.ts` or `DeckGLMap.ts` without understanding the full file - they are 3,900+ and 3,500+ lines respectively
- API routes in `api/` are **plain JavaScript** (not TypeScript) - they run as Vercel Serverless Functions
- All client code in `src/` is **TypeScript**
- There is **no React, no framework** - components are vanilla TS classes that manipulate the DOM directly
- The `_` prefix on API files (`_cors.js`, `_upstash-cache.js`, `_ip-rate-limit.js`) means they are helper modules, not routes
- RSS feeds are proxied through `vite.config.ts` in dev and through `api/rss-proxy.js` in production

### Code Patterns

#### Components

All components follow this pattern:

```typescript
export class SomePanel {
  private container: HTMLElement;
  
  constructor(parentElement: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'some-panel';
    parentElement.appendChild(this.container);
    this.init();
  }
  
  private async init(): Promise<void> {
    // Fetch data, build DOM
  }
  
  public update(data: SomeType): void {
    // Re-render with new data
  }
  
  public destroy(): void {
    this.container.remove();
  }
}
```

#### Services

Services are plain async functions:

```typescript
export async function fetchSomeData(): Promise<SomeType[]> {
  const response = await fetch('/api/some-endpoint');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data;
}
```

#### API Routes (Vercel Serverless)

```javascript
// api/some-route.js
import { corsHeaders, handleCors } from './_cors.js';
import { getCachedData, setCachedData } from './_upstash-cache.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  
  const cached = await getCachedData('some-key');
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }
  
  // Fetch from upstream API
  const data = await fetch('https://api.example.com/data');
  const json = await data.json();
  
  await setCachedData('some-key', json, 300); // 5 min TTL
  res.json(json);
}
```

## Host page integration

HQ is a standalone app. When it runs inside an iframe on an allowed origin (`https://three.ws`, `https://www.three.ws`, or localhost during development), `src/services/hq-bridge.ts` activates a `postMessage` bridge. HQ emits `hq:*` events to the parent page, and the parent can send `host:*` commands (`host:apply-template`, `host:toggle-panel`, `host:fly-to-country`, `host:set-theme`, `host:request-state`, `host:show-panel`). Outside an iframe the bridge is a no-op.

```typescript
// HQ -> host page
window.parent.postMessage({ type: 'hq:event', payload: {...} }, '*');
```

## Git Workflow

- Default branch: `main`
- Commit messages: prefix with gitmoji
- PR descriptions should reference what changed and why
- Visual regression tests must pass (update snapshots if intentional changes)

## Terminal Management

- **Always use background terminals** (`isBackground: true`) for every command so a terminal ID is returned
- **Always kill the terminal** after the command completes, whether it succeeds or fails - never leave terminals open
- Do not reuse foreground shell sessions - stale sessions block future terminal operations in Codespaces
- In GitHub Codespaces, agent-spawned terminals may be hidden - they still work. Do not assume a terminal is broken if you cannot see it
- If a terminal appears unresponsive, kill it and create a new one rather than retrying in the same terminal

## Editor & Preview

- **Do NOT open files in the editor or preview pane** - it consumes significant processing power in Codespaces
- Never use "open file", "show preview", or similar editor commands - read file contents via tools instead
- Do not launch browser previews or live servers for visual inspection unless the user explicitly requests it

## Do Not

- **Do not introduce React or any UI framework** - this project is intentionally vanilla TypeScript
- **Do not split App.ts into multiple files** unless you have a complete plan for all 3,940 lines
- **Do not change API route signatures** without updating the corresponding client service
- **Do not remove the variant system** - `full` and `tech` variants serve different audiences
- **Do not commit API keys** - use `.env` for all secrets
