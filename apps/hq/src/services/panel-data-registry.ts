/**
 * Registry of read-only data providers for HQ panels, so a host page can ask
 * for a panel's current data over the bridge (host:get-panel-data).
 * Providers return JSON-safe snapshots; they never expose DOM nodes.
 */

export type PanelDataProvider = () => unknown;

const providers = new Map<string, PanelDataProvider>();

export function registerPanelData(key: string, provider: PanelDataProvider): void {
  providers.set(key, provider);
}

export function unregisterPanelData(key: string): void {
  providers.delete(key);
}

export function hasPanelData(key: string): boolean {
  return providers.has(key);
}

export function listPanelDataKeys(): string[] {
  return [...providers.keys()].sort();
}

/** Snapshot a panel's data, or undefined when no provider is registered. */
export function readPanelData(key: string): unknown {
  const provider = providers.get(key);
  if (!provider) return undefined;
  return JSON.parse(JSON.stringify(provider() ?? null));
}
