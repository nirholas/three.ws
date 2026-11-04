// Last-seen Forge catalog, kept per browser so the composer's engine pill can
// paint its settled lanes on the first frame of a repeat visit instead of
// growing ~50 px when /api/forge?catalog answers. The catalog is env-dependent
// (which lanes are configured), so it is never baked into the HTML: a stale
// snapshot is replaced by the live response, and only a changed catalog
// triggers a rebuild.
const KEY = 'forge.catalog.v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function usable(c) {
	return !!c && Array.isArray(c.backends) && c.backends.length > 0 && c.backends.every((b) => b && typeof b.id === 'string' && Array.isArray(b.paths));
}

export function readCachedCatalog(storage = globalThis.localStorage, now = Date.now()) {
	try {
		const raw = storage?.getItem(KEY);
		if (!raw) return null;
		const { at, catalog } = JSON.parse(raw);
		if (typeof at !== 'number' || now - at > MAX_AGE_MS || !usable(catalog)) return null;
		return catalog;
	} catch {
		return null;
	}
}

export function writeCachedCatalog(catalog, storage = globalThis.localStorage, now = Date.now()) {
	if (!usable(catalog)) return;
	try {
		storage?.setItem(KEY, JSON.stringify({ at: now, catalog }));
	} catch {
		/* private mode or quota: the live fetch still works */
	}
}
