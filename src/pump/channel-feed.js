// channel-feed — pump.fun signal aggregation pipeline.
//
// buildFeed()        — pure merge/dedupe/sort/filter; used by the API endpoint.
// fetchChannelFeed() — HTTP client; calls GET /api/pump/channel-feed.

const VALID_KINDS = new Set(['mint', 'whale', 'claim']);

function _parseKinds(kinds) {
	if (!kinds) return new Set(['mint', 'whale', 'claim']);
	const parsed = String(kinds)
		.split(',')
		.map((s) => s.trim())
		.filter((k) => VALID_KINDS.has(k));
	return parsed.length ? new Set(parsed) : new Set(['mint', 'whale', 'claim']);
}

function _normalize(raw, kind) {
	const name = [raw.name, raw.symbol].filter(Boolean).join(' ');
	return {
		kind,
		mint: raw.mint ?? null,
		signature: raw.signature ?? raw.tx_signature ?? null,
		ts: raw.ts ?? raw.timestamp ?? 0,
		summary: raw.summary ?? name ?? '',
		refs: raw.refs ?? {},
	};
}

/**
 * Merge, deduplicate (by signature), sort newest-first, and limit.
 *
 * @param {{ kind: string, items: Object[] }[]} batches
 * @param {{ limit?: number, kinds?: string }} [opts]
 * @returns {{ kind, mint, signature, ts, summary, refs }[]}
 */
export function buildFeed(batches, { limit = 50, kinds } = {}) {
	const activeKinds = _parseKinds(kinds);
	const seen = new Set();
	const result = [];

	for (const { kind, items } of batches) {
		if (!activeKinds.has(kind)) continue;
		for (const raw of items) {
			const item = _normalize(raw, kind);
			if (!item.signature || seen.has(item.signature)) continue;
			seen.add(item.signature);
			result.push(item);
		}
	}

	result.sort((a, b) => b.ts - a.ts);
	return result.slice(0, limit);
}

/**
 * Client helper — fetches from the HTTP endpoint.
 * Works in browser and Node.js (requires global fetch).
 *
 * @param {{ limit?: number, kinds?: string }} [opts]
 * @returns {Promise<{ items: Object[] }>}
 */
export async function fetchChannelFeed({ limit = 50, kinds } = {}) {
	const params = new URLSearchParams({ limit: String(limit) });
	if (kinds) params.set('kinds', kinds);
	const res = await fetch(`/api/pump/channel-feed?${params}`);
	if (!res.ok) throw new Error(`channel-feed: ${res.status}`);
	return res.json();
}
