/**
 * Registry of read-only data providers for HQ panels, so a host page can ask
 * for a panel's current data over the bridge (host:get-panel-data).
 * Providers return JSON-safe snapshots; they never expose DOM nodes.
 *
 * Each key also carries a freshness time so the host can tell live data from
 * a stale or not-yet-loaded panel: App marks a key when its data lands, and a
 * provider registered as `live` (derived from in-memory state that is always
 * current, such as panel settings) reports the time of the read.
 */

export type PanelDataProvider = () => unknown;

export interface PanelDataOptions {
  /** The provider reads state that is current by construction. */
  live?: boolean;
}

const providers = new Map<string, PanelDataProvider>();
const liveKeys = new Set<string>();
const loadedAt = new Map<string, number>();

export function registerPanelData(key: string, provider: PanelDataProvider, options: PanelDataOptions = {}): void {
  providers.set(key, provider);
  if (options.live) liveKeys.add(key);
  else liveKeys.delete(key);
}

export function unregisterPanelData(key: string): void {
  providers.delete(key);
  liveKeys.delete(key);
  loadedAt.delete(key);
}

export function hasPanelData(key: string): boolean {
  return providers.has(key);
}

export function listPanelDataKeys(): string[] {
  return [...providers.keys()].sort();
}

/** Record that a panel's data was (re)loaded. Safe to call before the provider registers. */
export function markPanelDataLoaded(key: string, at: number = Date.now()): void {
  if (Number.isFinite(at)) loadedAt.set(key, at);
}

/** ISO time the panel's data was last loaded, or null when it has not loaded yet. */
export function readPanelDataUpdatedAt(key: string): string | null {
  if (liveKeys.has(key)) return new Date().toISOString();
  const at = loadedAt.get(key);
  return at === undefined ? null : new Date(at).toISOString();
}

/** Snapshot a panel's data, or undefined when no provider is registered. */
export function readPanelData(key: string): unknown {
  const provider = providers.get(key);
  if (!provider) return undefined;
  return JSON.parse(JSON.stringify(provider() ?? null));
}
