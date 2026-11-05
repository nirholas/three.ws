// Region-restricted engines on /forge.
//
// Some engine licences exclude whole regions (api/_lib/forge-territory.js). The
// server refuses those lanes per request with 403 region_restricted and names
// the engines that can take the same request (retry_backends). It also answers
// GET /api/forge?territory with the lanes it will refuse for this visitor, so
// the picker can disable them before anyone clicks Generate.

/**
 * Map a 403 region_restricted body onto the composer's error kinds. With
 * alternatives named it is a `lane_failed` hop (the composer flips the picker
 * and retries once, visibly); without any it is a designed `region` error.
 * Returns null for any other body.
 */
export function regionRestrictedError(data) {
	if (!data || data.error !== 'region_restricted') return null;
	const retry = Array.isArray(data.retry_backends)
		? data.retry_backends.filter((id) => typeof id === 'string' && id)
		: [];
	const e = new Error(
		data.message ||
			'This engine is not available in your region because its model licence excludes it. Pick another engine.',
	);
	e.regionRestricted = true;
	e.backend = typeof data.backend === 'string' ? data.backend : null;
	if (retry.length) {
		e.kind = 'lane_failed';
		e.retryBackends = retry;
	} else {
		e.kind = 'region';
	}
	return e;
}

/** The set of backend ids a GET /api/forge?territory answer restricts. */
export function parseTerritory(body) {
	const list = Array.isArray(body?.restricted_backends) ? body.restricted_backends : [];
	return new Set(list.filter((id) => typeof id === 'string' && id));
}

/** Fetch this visitor's restricted engines. An unreachable answer restricts nothing client side; the server still enforces. */
export async function fetchRestrictedEngines(headers) {
	try {
		const res = await fetch('/api/forge?territory=1', { headers, cache: 'no-store' });
		if (!res.ok) return new Set();
		return parseTerritory(await res.json().catch(() => null));
	} catch {
		return new Set();
	}
}
