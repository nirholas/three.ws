// Cached X (Twitter) profile lookup for the KOL tracker: follower count + avatar
// only, read through the official X API v2 client (api/_lib/x-api.js) with this
// deployment's own credentials. Callers only pass handles an admin attached to a
// wallet, so this never scans arbitrary accounts.
//
// Honest degradation: when X is not configured, rate limited or down, resolves
// to null. The tracker renders a wallet row with no follower count rather than
// a fabricated one.
//
// Cached for 15 minutes per handle: the X API tier's rate limit is tight and
// follower counts don't move fast enough to need fresher reads than that.

import { cacheGet, cacheSet } from '../../api/_lib/cache.js';
import { fetchXProfile as readXProfile } from '../../api/_lib/x-api.js';

const CACHE_TTL_S = 900;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * @param {string} handle
 * @param {object} [deps] test seams
 * @param {(clean: string) => Promise<object>} [deps.lookup]
 */
export async function fetchXProfile(handle, { lookup = readXProfile } = {}) {
	const clean = String(handle || '').replace(/^@/, '');
	if (!HANDLE_RE.test(clean)) return null;

	const cacheKey = `kol:xprofile:${clean.toLowerCase()}`;
	const cached = await cacheGet(cacheKey).catch(() => null);
	if (cached) return cached;

	let user;
	try {
		user = await lookup(clean);
	} catch (err) {
		if (err?.reason !== 'not_configured') {
			console.warn(`[kol/x-profile] lookup failed for @${clean} (${err?.reason || 'error'}): ${err?.message || err}`);
		}
		return null;
	}
	const profile = {
		handle: user.username || clean,
		name: user.name || null,
		avatarUrl: user.avatar || null,
		verified: !!user.verified,
		followerCount: Number.isFinite(user.followers) ? user.followers : null,
		source: 'x-api',
	};
	await cacheSet(cacheKey, profile, CACHE_TTL_S).catch(() => {});
	return profile;
}
