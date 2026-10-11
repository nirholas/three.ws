/**
 * Real-time WebSocket price feed via Binance combined stream.
 *
 * Connects to Binance's free public WebSocket for top 20 trading pairs,
 * dispatches `price:update` CustomEvents on `window` so any panel
 * can listen and update prices in real-time.
 *
 * Falls back to existing polling when disconnected.
 */

import type { PriceUpdate } from '@/types';

/* ── Config ── */

export interface WebSocketPriceConfig {
  pairs: string[];
  onUpdate?: (update: PriceUpdate) => void;
  onStatusChange?: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
}

/** Binance pair → display symbol */
const PAIR_TO_SYMBOL: Record<string, string> = {
  btcusdt: 'BTC',    ethusdt: 'ETH',   solusdt: 'SOL',  bnbusdt: 'BNB',
  xrpusdt: 'XRP',    adausdt: 'ADA',   dogeusdt: 'DOGE', avaxusdt: 'AVAX',
  dotusdt: 'DOT',    maticusdt: 'MATIC', linkusdt: 'LINK', uniusdt: 'UNI',
  aaveusdt: 'AAVE',  mkrusdt: 'MKR',   shibusdt: 'SHIB', ltcusdt: 'LTC',
  nearusdt: 'NEAR',  aptusdt: 'APT',   arbusdt: 'ARB',   opusdt: 'OP',
};

const DEFAULT_PAIRS = Object.keys(PAIR_TO_SYMBOL);

/* ── Throttle helper ── */

/** Ensures a function fires at most once per `limitMs` per key. */
function createKeyThrottle(limitMs: number): (key: string) => boolean {
  const lastFired = new Map<string, number>();
  return (key: string): boolean => {
    const now = performance.now();
    const last = lastFired.get(key) ?? 0;
    if (now - last < limitMs) return false; // skip
    lastFired.set(key, now);
    return true; // allow
  };
}

/* ── Service ── */

class WebSocketPriceService {
  private ws: WebSocket | null = null;
  private config: WebSocketPriceConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
  private lastPrices: Map<string, PriceUpdate> = new Map();
  private isDestroyed = false;
  private paused = false;
  private visibilityHandler: (() => void) | null = null;

  /** Throttle dispatches to ~250 ms per symbol to avoid DOM thrash */
  private shouldDispatch = createKeyThrottle(250);

  constructor(config?: Partial<WebSocketPriceConfig>) {
    this.config = {
      pairs: config?.pairs ?? DEFAULT_PAIRS,
      onUpdate: config?.onUpdate,
      onStatusChange: config?.onStatusChange,
    };
  }

  /* ── Connection ── */

  connect(): void {
    if (this.isDestroyed) return;

    const streams = this.config.pairs.map(p => `${p}@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.setStatus('connected');
        this.reconnectAttempts = 0;
        console.log('[WS-Prices] Connected to Binance');
      };

      this.ws.onmessage = (event) => {
        if (this.paused) return;
        try {
          const msg = JSON.parse(event.data);
          const data = msg.data;
          if (!data || !data.s) return;

          const pair = data.s.toLowerCase();
          const symbol = PAIR_TO_SYMBOL[pair] || data.s;

          const update: PriceUpdate = {
            symbol,
            pair: data.s,
            price: parseFloat(data.c),
            change24h: parseFloat(data.P),
            changeAbsolute: parseFloat(data.p),
            volume24h: parseFloat(data.v) * parseFloat(data.c),
            high24h: parseFloat(data.h),
            low24h: parseFloat(data.l),
            timestamp: data.E,
          };

          this.lastPrices.set(symbol, update);

          // Throttle per-symbol to avoid excessive DOM updates
          if (this.shouldDispatch(symbol)) {
            window.dispatchEvent(new CustomEvent('price:update', { detail: update }));
            this.config.onUpdate?.(update);
          }
        } catch {
          // Ignore parse errors for individual messages
        }
      };

      this.ws.onclose = () => {
        if (!this.isDestroyed) {
          this.setStatus('disconnected');
          this.reconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[WS-Prices] Error:', err);
        this.ws?.close();
      };
    } catch (e) {
      console.warn('[WS-Prices] Failed to connect:', e);
      this.reconnect();
    }

    // Tab-visibility handling: pause processing when hidden
    if (!this.visibilityHandler) {
      this.visibilityHandler = () => {
        this.paused = document.hidden;
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /* ── Reconnect with exponential backoff ── */

  private reconnect(): void {
    if (this.isDestroyed || this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.setStatus('reconnecting');
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    console.log(`[WS-Prices] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /* ── Status management ── */

  private setStatus(s: 'connected' | 'disconnected' | 'reconnecting'): void {
    this.status = s;
    this.config.onStatusChange?.(s);
    window.dispatchEvent(new CustomEvent('ws:status', { detail: { status: s } }));
  }

  /* ── Public API ── */

  getLastPrice(symbol: string): PriceUpdate | undefined {
    return this.lastPrices.get(symbol);
  }

  getAllPrices(): Map<string, PriceUpdate> {
    return new Map(this.lastPrices);
  }

  getStatus(): 'connected' | 'disconnected' | 'reconnecting' {
    return this.status;
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;          // prevent reconnect loop
      this.ws.close();
      this.ws = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.lastPrices.clear();
  }
}

/* ── Singleton ── */

let instance: WebSocketPriceService | null = null;

export function getWebSocketPriceService(): WebSocketPriceService {
  if (!instance) {
    instance = new WebSocketPriceService();
  }
  return instance;
}

export function startPriceFeed(): void {
  getWebSocketPriceService().connect();
}

export function stopPriceFeed(): void {
  instance?.destroy();
  instance = null;
}
