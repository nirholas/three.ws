/**
 * Intel entry point - DeFi-only dashboard surface.
 *
 * Renders inside a Shadow DOM so it can be embedded in a host page
 * at /intel without CSS/JS collisions with the host page.
 *
 * No 3D globe, no deck.gl, no MapLibre - purely panel-based.
 */

import { inject } from '@vercel/analytics';

inject();

// ── Scoped styles (defined first so they're available at boot) ───────
const INTEL_STYLES = `
  :host {
    all: initial;
    display: block;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    color: #e0e0e0;
    background: #0a0a0a;
  }

  .intel-app {
    min-height: 100vh;
    background: #0a0a0a;
    color: #e0e0e0;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    padding: 0;
    margin: 0;
  }

  .intel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    backdrop-filter: blur(12px);
    background: rgba(10,10,10,0.9);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .intel-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .intel-logo {
    font-size: 15px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.5px;
  }

  .intel-subtitle {
    font-size: 11px;
    font-weight: 500;
    color: #14b8a6;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    padding: 2px 8px;
    border: 1px solid rgba(20,184,166,0.3);
    border-radius: 4px;
  }

  .intel-header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .intel-status {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    padding: 2px 8px;
    border-radius: 3px;
    background: rgba(255,255,255,0.05);
  }

  .intel-status-ok {
    color: #4caf50;
    background: rgba(76,175,80,0.1);
  }

  .intel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 12px;
    padding: 16px 20px;
    max-width: 1800px;
    margin: 0 auto;
  }

  .intel-grid > .panel {
    background: #111827;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px;
    overflow: hidden;
  }

  .intel-light {
    background: #f5f5f5;
    color: #1a1a2e;
  }
  .intel-light .intel-header {
    background: rgba(245,245,245,0.95);
    border-bottom-color: rgba(0,0,0,0.08);
  }
  .intel-light .intel-logo { color: #1a1a2e; }
  .intel-light .intel-grid > .panel {
    background: #fff;
    border-color: rgba(0,0,0,0.08);
  }

  @media (max-width: 768px) {
    .intel-grid {
      grid-template-columns: 1fr;
      padding: 8px;
      gap: 8px;
    }
    .intel-header {
      padding: 8px 12px;
    }
  }
`;

// ── Shadow DOM host ──────────────────────────────────────────────────
const root = document.getElementById('intel-root');
if (!root) throw new Error('Missing #intel-root element');

const shadow = root.attachShadow({ mode: 'open' });

// Inject scoped styles into the shadow root
const styleSheet = document.createElement('style');
styleSheet.textContent = INTEL_STYLES;
shadow.appendChild(styleSheet);

// Main container inside shadow DOM
const container = document.createElement('div');
container.className = 'intel-app';
shadow.appendChild(container);

// ── Header ───────────────────────────────────────────────────────────
const header = document.createElement('header');
header.className = 'intel-header';
header.innerHTML = `
  <div class="intel-header-left">
    <span class="intel-logo">◆ HQ</span>
    <span class="intel-subtitle">Intel</span>
  </div>
  <div class="intel-header-right">
    <span class="intel-status" id="intel-status">Connecting…</span>
  </div>
`;
container.appendChild(header);

// ── Panel grid ───────────────────────────────────────────────────────
const grid = document.createElement('div');
grid.className = 'intel-grid';
container.appendChild(grid);

// ── Panel loader ─────────────────────────────────────────────────────
// Each panel is lazy-loaded to keep the initial bundle small.
// We use the same Panel base class from HQ components.

interface IntelPanelDef {
  id: string;
  load: () => Promise<{ destroy(): void }>;
  priority: number; // 1 = load immediately, 2 = load after first paint
}

const INTEL_PANELS: IntelPanelDef[] = [
  // Tier 1: Core DeFi data - load immediately
  {
    id: 'three-signal',
    priority: 1,
    load: async () => {
      const { ThreeSignalPanel } = await import('./components/ThreeSignalPanel');
      return new ThreeSignalPanel();
    },
  },
  {
    id: 'crypto-news-feed',
    priority: 1,
    load: async () => {
      const { CryptoNewsPanel } = await import('@/components/CryptoNewsPanel');
      return new CryptoNewsPanel();
    },
  },
  {
    id: 'crypto-trending',
    priority: 1,
    load: async () => {
      const { CryptoTrendingPanel } = await import('@/components/CryptoTrendingPanel');
      return new CryptoTrendingPanel();
    },
  },
  {
    id: 'defi-yields',
    priority: 1,
    load: async () => {
      const { DefiYieldsPanel } = await import('@/components/DefiYieldsPanel');
      return new DefiYieldsPanel();
    },
  },
  {
    id: 'etf-flows',
    priority: 1,
    load: async () => {
      const { ETFFlowsPanel } = await import('@/components/ETFFlowsPanel');
      return new ETFFlowsPanel();
    },
  },
  {
    id: 'stablecoins',
    priority: 1,
    load: async () => {
      const { StablecoinPanel } = await import('@/components/StablecoinPanel');
      return new StablecoinPanel();
    },
  },
  // Tier 2: Market data - load after first paint
  {
    id: 'funding-rates',
    priority: 2,
    load: async () => {
      const { FundingRatesPanel } = await import('@/components/FundingRatesPanel');
      return new FundingRatesPanel();
    },
  },
  {
    id: 'gas-tracker',
    priority: 2,
    load: async () => {
      const { GasTrackerPanel } = await import('@/components/GasTrackerPanel');
      return new GasTrackerPanel();
    },
  },
  {
    id: 'fee-compare',
    priority: 2,
    load: async () => {
      const { FeeComparePanel } = await import('@/components/FeeComparePanel');
      return new FeeComparePanel();
    },
  },
  {
    id: 'protocol-health',
    priority: 2,
    load: async () => {
      const { ProtocolHealthPanel } = await import('@/components/ProtocolHealthPanel');
      return new ProtocolHealthPanel();
    },
  },
  {
    id: 'venue-spread',
    priority: 2,
    load: async () => {
      const { VenueSpreadPanel } = await import('@/components/VenueSpreadPanel');
      return new VenueSpreadPanel();
    },
  },
  {
    id: 'dex-trending',
    priority: 2,
    load: async () => {
      const { DexTrendingPanel } = await import('@/components/DexTrendingPanel');
      return new DexTrendingPanel();
    },
  },
  {
    id: 'liquidations',
    priority: 2,
    load: async () => {
      const { LiquidationPanel } = await import('@/components/LiquidationPanel');
      return new LiquidationPanel();
    },
  },
  {
    id: 'open-interest',
    priority: 2,
    load: async () => {
      const { OpenInterestPanel } = await import('@/components/OpenInterestPanel');
      return new OpenInterestPanel();
    },
  },
  {
    id: 'protocol-revenue',
    priority: 2,
    load: async () => {
      const { ProtocolRevenuePanel } = await import('@/components/ProtocolRevenuePanel');
      return new ProtocolRevenuePanel();
    },
  },
  {
    id: 'chain-tvl',
    priority: 2,
    load: async () => {
      const { ChainTvlPanel } = await import('@/components/ChainTvlPanel');
      return new ChainTvlPanel();
    },
  },
  {
    id: 'dex-volume',
    priority: 2,
    load: async () => {
      const { DexVolumePanel } = await import('@/components/DexVolumePanel');
      return new DexVolumePanel();
    },
  },
  {
    id: 'exchange-flow',
    priority: 2,
    load: async () => {
      const { ExchangeFlowPanel } = await import('@/components/ExchangeFlowPanel');
      return new ExchangeFlowPanel();
    },
  },
  {
    id: 'long-short',
    priority: 2,
    load: async () => {
      const { LongShortPanel } = await import('@/components/LongShortPanel');
      return new LongShortPanel();
    },
  },
  {
    id: 'hack-alerts',
    priority: 2,
    load: async () => {
      const { HackAlertsPanel } = await import('@/components/HackAlertsPanel');
      return new HackAlertsPanel();
    },
  },
  {
    id: 'wallet-tracker',
    priority: 2,
    load: async () => {
      const { WalletTrackerPanel } = await import('@/components/WalletTrackerPanel');
      return new WalletTrackerPanel();
    },
  },
];

// Track loaded panels for cleanup
const loadedPanels: Array<{ id: string; instance: { destroy(): void } }> = [];

async function loadPanel(def: IntelPanelDef): Promise<void> {
  try {
    const instance = await def.load();
    loadedPanels.push({ id: def.id, instance });

    // Panels create their own DOM elements and append to document.body or a parent.
    // For Shadow DOM, we need to move the panel's root element into our grid.
    const panelEl = grid.ownerDocument.querySelector(`[data-panel="${def.id}"]`)
      || document.querySelector(`[data-panel="${def.id}"]`);
    if (panelEl) {
      grid.appendChild(panelEl);
    }
  } catch (err) {
    console.warn(`[Intel] Failed to load panel "${def.id}":`, err);
  }
}

async function boot(): Promise<void> {
  const statusEl = shadow.getElementById('intel-status');

  // Phase 1: Load priority-1 panels
  const tier1 = INTEL_PANELS.filter(p => p.priority === 1);
  await Promise.allSettled(tier1.map(loadPanel));

  if (statusEl) {
    statusEl.textContent = `${loadedPanels.length} panels`;
    statusEl.classList.add('intel-status-ok');
  }

  // Phase 2: Load priority-2 panels after a short delay (let first paint settle)
  const tier2 = INTEL_PANELS.filter(p => p.priority === 2);
  await new Promise(r => setTimeout(r, 500));
  await Promise.allSettled(tier2.map(loadPanel));

  if (statusEl) {
    statusEl.textContent = `${loadedPanels.length} panels`;
  }
}

// ── PostMessage bridge to the host ───────────────────────────────────
window.addEventListener('message', (event) => {
  // Only accept messages from known host origins
  const trustedOrigins = [
    'https://three.ws',
    'https://www.three.ws',
  ];
  if (!trustedOrigins.includes(event.origin) && !event.origin.includes('localhost')) return;

  const msg = event.data;
  if (!msg || typeof msg !== 'object' || !msg.type) return;

  switch (msg.type) {
    case 'hq:theme':
      // Receive theme updates from the host
      if (msg.payload?.dark !== undefined) {
        container.classList.toggle('intel-light', !msg.payload.dark);
      }
      break;
    case 'hq:filter':
      // Receive filter commands (e.g., "show only DeFi news about Ethereum")
      window.dispatchEvent(new CustomEvent('crypto-news:filter', {
        detail: { keyword: msg.payload?.keyword || '' },
      }));
      break;
  }
});

// Forward detail:open events to the host
window.addEventListener('detail:open', ((e: CustomEvent) => {
  window.parent.postMessage({
    type: 'hq:detail',
    payload: e.detail,
  }, '*');
}) as EventListener);

// ── Cleanup on unload ────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  for (const { instance } of loadedPanels) {
    try { instance.destroy(); } catch { /* ignore */ }
  }
  loadedPanels.length = 0;
});

// ── Launch ───────────────────────────────────────────────────────────
boot().catch(console.error);
