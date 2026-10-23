// Cached X (Twitter) profile lookup for the KOL tracker: follower count + avatar
// only. Two rungs, in order:
//   1. the paid X API v2 app-only bearer client (same as api/seed/x.js), when
//      TWITTER_BEARER_TOKEN is set and not rate limited;
//   2. the keyless guest-token reader (api/_lib/x-guest), when the bearer is
//      unset or the bearer lookup fails (rate limit, outage).
// Callers only pass handles an admin attached to a wallet, so rung 2 never
// scans arbitrary accounts.
//
// Honest degradation: when both rungs fail, resolves to null. The tracker
// renders a wallet row with no follower count rather than a fabricated one. A
// failed guest read logs its reason (rate_limited, stale_query_id, ...).
//
// Cached for 15 minutes per handle: the free X API tier's rate limit is tight
// (75 user lookups / 15 min) and follower counts don't move fast enough to need
// fresher reads than that.

import { cacheGet, cacheSet } from '../../api/_lib/cache.js';
import { fetchGuestProfile } from '../../api/_lib/x-guest/index.js';

const CACHE_TTL_S = 900;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

async function bearerProfile(clean, bearer) {
	const { TwitterApi } = await import('twitter-api-v2');
	const client = new TwitterApi(bearer).readOnly;
	const res = await client.v2.userByUsername(clean, {
		'user.fields': ['public_metrics', 'profile_image_url', 'verified'],
	});
	const user = res?.data;
	if (!user) return null;
	return {
		handle: user.username,
		name: user.name || null,
		avatarUrl: user.profile_image_url || null,
		verified: !!user.verified,
		followerCount: user.public_metrics?.followers_count ?? null,
		source: 'x-api',
	};
}

async function guestProfile(clean, fetchGuest) {
	const user = await fetchGuest(clean);
	return {
		handle: user.username || clean,
		name: user.name || null,
		avatarUrl: user.avatar || null,
		verified: !!user.verified,
		followerCount: Number.isFinite(user.followers) ? user.followers : null,
		source: 'x-guest',
	};
}

/**
 * @param {string} handle
 * @param {object} [deps] test seams
 * @param {(clean: string, bearer: string) => Promise<object|null>} [deps.bearerLookup]
 * @param {(clean: string) => Promise<object>} [deps.guestLookup]
 */
export async function fetchXProfile(handle, { bearerLookup = bearerProfile, guestLookup = fetchGuestProfile } = {}) {
	const clean = String(handle || '').replace(/^@/, '');
	if (!HANDLE_RE.test(clean)) return null;

	const cacheKey = `kol:xprofile:${clean.toLowerCase()}`;
	const cached = await cacheGet(cacheKey).catch(() => null);
	if (cached) return cached;

	const bearer = process.env.TWITTER_BEARER_TOKEN;
	let profile = null;

	if (bearer) {
		try {
			profile = await bearerLookup(clean, bearer);
		} catch (err) {
			console.warn(`[kol/x-profile] bearer lookup failed for @${clean}: ${err?.message || err}`);
		}
	}

	if (!profile) {
		try {
			profile = await guestProfile(clean, guestLookup);
		} catch (err) {
			console.warn(
				`[kol/x-profile] guest lookup failed for @${clean} (${err?.reason || 'error'}): ${err?.message || err}`,
			);
			return null;
		}
	}

	await cacheSet(cacheKey, profile, CACHE_TTL_S).catch(() => {});
	return profile;
}
