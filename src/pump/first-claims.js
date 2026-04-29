/**
 * pump/first-claims.js
 * ---------------------
 * First-time creator fee claim data.
 *
 * Exports:
 *   filterFirstClaims(allClaims, sinceTs, limit) — pure dedupe, no I/O
 *   fetchFirstClaims({ sinceTs, limit })          — browser fetch → API
 *
 * "First-time" means the creator has no observed claim before sinceTs.
 * allClaims must span a wider lookback window so prior claimers are visible.
 */

const API_PATH = '/api/pump/first-claims';

/**
 * Pure dedupe: from a flat list of claims spanning a wide lookback window,
 * return only first-time claimers — creators whose earliest observed claim
 * falls at or after sinceTs (i.e. they have no prior claim in the dataset).
 *
 * @param {Array<{creator:string, mint:string, signature:string, lamports:number, ts:number}>} allClaims
 * @param {number} sinceTs  Unix seconds — boundary for "prior claim"
 * @param {number} [limit]
 * @returns {Array<{creator, mint, signature, lamports, ts}>} newest first
 */
export function filterFirstClaims(allClaims, sinceTs, limit = 50) {
	// Find each creator's earliest observed claim across the full dataset.
	const earliest = new Map();
	for (const c of allClaims) {
		const prev = earliest.get(c.creator);
		if (!prev || c.ts < prev.ts) earliest.set(c.creator, c);
	}

	const result = [];
	for (const firstClaim of earliest.values()) {
		// Exclude if the earliest claim predates sinceTs — they've claimed before.
		if (firstClaim.ts >= sinceTs) result.push(firstClaim);
	}

	return result.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/**
 * Browser entry point. Calls GET /api/pump/first-claims and returns
 * { items: [...] }.
 *
 * @param {{ sinceTs: number, limit?: number }} opts
 */
export async function fetchFirstClaims({ sinceTs, limit = 50 }) {
	const params = new URLSearchParams({
		sinceTs: String(sinceTs),
		limit: String(Math.min(50, Math.max(1, limit))),
	});
	const r = await fetch(`${API_PATH}?${params}`, { credentials: 'include' });
	if (!r.ok) throw new Error(`first-claims: ${r.status}`);
	return r.json();
}
