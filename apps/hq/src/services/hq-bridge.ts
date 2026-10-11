/**
 * HQBridge - Bidirectional postMessage bridge between HQ (iframe) and a host page (parent).
 *
 * Singleton service. Only activates when HQ runs inside an iframe (window !== window.parent).
 * When running standalone the bridge is a no-op with zero overhead.
 */

// ---------------------------------------------------------------------------
// Allowed origins - must match frame-ancestors in vercel.json
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS: readonly string[] = [
  'https://three.ws',
  'https://www.three.ws',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3210',
];

/**
 * Check if an origin matches any allowed origin.
 * Supports exact matches plus wildcard *.vercel.app for preview deployments.
 */
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events emitted by HQ → the host */
export type HQEventType =
  | 'hq:ready'
  | 'hq:template-changed'
  | 'hq:panel-toggled'
  | 'hq:country-selected'
  | 'hq:signal-detected'
  | 'hq:market-update'
  | 'hq:notification';

/** Commands received by HQ ← the host */
export type HQCommandType =
  | 'host:apply-template'
  | 'host:toggle-panel'
  | 'host:fly-to-country'
  | 'host:set-theme'
  | 'host:request-state'
  | 'host:show-panel';

export interface HQMessage<T = unknown> {
  type: HQEventType;
  payload: T;
}

export interface HostCommand<T = unknown> {
  type: HQCommandType;
  payload: T;
}

// Payload shapes -------------------------------------------------------

export interface ReadyPayload {
  version: string;
  variant: string;
}

export interface TemplateChangedPayload {
  id: string;
  name: string;
}

export interface PanelToggledPayload {
  key: string;
  enabled: boolean;
}

export interface CountrySelectedPayload {
  code: string;
  name: string;
}

export interface SignalDetectedPayload {
  summary: string;
  topCountries: Array<{ country: string; name: string; score: number }>;
  convergenceZones: number;
}

export interface MarketUpdatePayload {
  btcPrice: number | null;
  btcChange: number | null;
  topMovers: Array<{ symbol: string; change: number | null }>;
}

export interface NotificationPayload {
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
}

// Inbound command payloads
export interface ApplyTemplatePayload {
  id: string;
}

export interface TogglePanelPayload {
  key: string;
  enabled: boolean;
}

export interface FlyToCountryPayload {
  lat: number;
  lon: number;
  zoom?: number;
}

export interface SetThemePayload {
  theme: string;
}

export interface ShowPanelPayload {
  key: string;
}

// Callback types
export type CommandHandler = (type: HQCommandType, payload: unknown) => void;

// ---------------------------------------------------------------------------
// Rate-limiter (simple token-bucket: max N commands per second)
// ---------------------------------------------------------------------------
class RateLimiter {
  private tokens: number;
  private readonly max: number;
  private lastRefill: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxPerSecond: number) {
    this.max = maxPerSecond;
    this.tokens = maxPerSecond;
    this.lastRefill = performance.now();
    this.refillRate = maxPerSecond / 1000;
  }

  allow(): boolean {
    const now = performance.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.max, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// HQBridge singleton
// ---------------------------------------------------------------------------
class HQBridge {
  /** Whether the bridge is active (we are inside an iframe). */
  private active = false;

  /** Detected parent origin (set on first valid handshake or via referrer). */
  private parentOrigin: string | null = null;

  /** Registered command handler (set by App). */
  private commandHandler: CommandHandler | null = null;

  /** Rate limiter for inbound commands. */
  private limiter = new RateLimiter(10);

  /** Bound listener reference for cleanup. */
  private boundListener: ((e: MessageEvent) => void) | null = null;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Initialise the bridge. Call once from App.init().
   * Returns `true` if the bridge activated (we are embedded).
   */
  init(version: string, variant: string): boolean {
    // Only activate when running inside an iframe
    if (typeof window === 'undefined' || window === window.parent) {
      return false;
    }

    this.active = true;

    // Try to detect parent origin from document.referrer
    this.parentOrigin = this.detectParentOrigin();

    // Listen for inbound commands
    this.boundListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.boundListener);

    // Emit ready event
    this.emit('hq:ready', { version, variant } satisfies ReadyPayload);

    console.log('[HQBridge] Initialised - parentOrigin:', this.parentOrigin ?? '(pending)');
    return true;
  }

  /**
   * Tear down the bridge - remove listener.
   */
  destroy(): void {
    if (this.boundListener) {
      window.removeEventListener('message', this.boundListener);
      this.boundListener = null;
    }
    this.active = false;
    this.parentOrigin = null;
    this.commandHandler = null;
  }

  /** Whether the bridge is currently active. */
  get isActive(): boolean {
    return this.active;
  }

  // -----------------------------------------------------------------------
  // Outbound: HQ → the host
  // -----------------------------------------------------------------------

  /**
   * Send a typed event to the parent frame.
   * Uses specific targetOrigin when known, otherwise tries all ALLOWED_ORIGINS.
   */
  emit<T>(type: HQEventType, payload: T): void {
    if (!this.active) return;

    const message: HQMessage<T> = { type, payload };

    if (this.parentOrigin) {
      window.parent.postMessage(message, this.parentOrigin);
    } else {
      // Parent origin unknown yet - broadcast to all allowed origins.
      // Only one will succeed (browser silently drops mismatches).
      for (const origin of ALLOWED_ORIGINS) {
        window.parent.postMessage(message, origin);
      }
    }
  }

  /** Convenience: emit template-changed */
  emitTemplateChanged(id: string, name: string): void {
    this.emit('hq:template-changed', { id, name } satisfies TemplateChangedPayload);
  }

  /** Convenience: emit panel-toggled */
  emitPanelToggled(key: string, enabled: boolean): void {
    this.emit('hq:panel-toggled', { key, enabled } satisfies PanelToggledPayload);
  }

  /** Convenience: emit country-selected */
  emitCountrySelected(code: string, name: string): void {
    this.emit('hq:country-selected', { code, name } satisfies CountrySelectedPayload);
  }

  /** Convenience: emit signal-detected */
  emitSignalDetected(payload: SignalDetectedPayload): void {
    this.emit('hq:signal-detected', payload);
  }

  /** Convenience: emit market-update */
  emitMarketUpdate(payload: MarketUpdatePayload): void {
    this.emit('hq:market-update', payload);
  }

  /** Convenience: emit notification */
  emitNotification(payload: NotificationPayload): void {
    this.emit('hq:notification', payload);
  }

  // -----------------------------------------------------------------------
  // Inbound: the host → HQ
  // -----------------------------------------------------------------------

  /**
   * Register the command handler. Only one handler at a time (the App instance).
   */
  onCommand(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  /**
   * Handle incoming postMessage events.
   */
  private handleMessage(event: MessageEvent): void {
    // 1. Origin validation
    if (!this.isAllowedOrigin(event.origin)) return;

    // 2. Capture parent origin on first valid message
    if (!this.parentOrigin) {
      this.parentOrigin = event.origin;
      console.log('[HQBridge] Parent origin detected:', this.parentOrigin);
    }

    // 3. Basic shape validation
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

    // 4. Only handle host: prefixed commands
    if (!data.type.startsWith('host:')) return;

    // 5. Rate limit
    if (!this.limiter.allow()) {
      console.warn('[HQBridge] Rate limit exceeded, dropping command:', data.type);
      return;
    }

    // 6. Sanitize payload (deep-clone to prevent reference manipulation)
    const type = data.type as HQCommandType;
    const payload = this.sanitizePayload(data.payload);

    console.log('[HQBridge] Received command:', type, payload);

    // 7. Dispatch to handler
    if (this.commandHandler) {
      try {
        this.commandHandler(type, payload);
      } catch (err) {
        console.error('[HQBridge] Command handler error:', err);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Security helpers
  // -----------------------------------------------------------------------

  private isAllowedOrigin(origin: string): boolean {
    return isAllowedOrigin(origin);
  }

  /**
   * Attempt to determine the parent origin from document.referrer.
   * Returns the origin string if it matches ALLOWED_ORIGINS, else null.
   */
  private detectParentOrigin(): string | null {
    try {
      if (document.referrer) {
        const url = new URL(document.referrer);
        if (this.isAllowedOrigin(url.origin)) {
          return url.origin;
        }
      }
    } catch {
      // Invalid referrer URL - ignore
    }
    return null;
  }

  /**
   * Deep-clone and sanitize an inbound payload.
   * Strips functions, symbols, and non-JSON-safe values.
   */
  private sanitizePayload(raw: unknown): unknown {
    if (raw === undefined || raw === null) return null;
    try {
      // JSON round-trip strips functions, undefined, symbols etc.
      return JSON.parse(JSON.stringify(raw));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Export singleton
// ---------------------------------------------------------------------------
export const hqBridge = new HQBridge();
