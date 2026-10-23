// Oracle: the X account a coin links to, as a conviction input. A coin whose
// linked account is days old with a handful of followers reads very differently
// from one linked to an established account, and the platform never had that
// signal because the paid X API was the only reader. This uses the keyless
// guest reader (api/_lib/x-guest), cached, bounded by a short deadline, and
// negative-cached so a dead or rate-limited reader never slows scoring.
//
// Every failure resolves to null ("unknown", treated as neutral downstream).

import { cacheGet, cacheSet } from '../cache.js';
import { fetchGuestProfile } from '../x-guest/index.js';

const HIT_TTL_S = 6 * 3600;
const MISS_TTL_S = 600;
const LOOKUP_DEADLINE_MS = 2500;
const DAY_MS = 86_400_000;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
// Path segments on x.com / twitter.com that are not account handles.
const RESERVED = new Set(['i', 'intent', 'home', 'search', 'share', 'hashtag', 'explore', 'messages', 'settings']);

/**
 * Handle from a coin's `twitter` field: a bare handle, @handle, or an
 * x.com / twitter.com profile or status URL. Returns null for communities,
 * intents and anything that is not a profile link.
 */
export function xHandleFromLink(link) {
	const raw = String(link || '').trim();
	if (!raw) return null;
	if (HANDLE_RE.test(raw.replace(/^@/, ''))) return raw.replace(/^@/, '');
	let url;
	try {
		url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
	} catch {
		return null;
	}
	if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(url.hostname)) return null;
	const first = url.pathname.split('/').filter(Boolean)[0];
	if (!first || RESERVED.has(first.toLowerCase()) || !HANDLE_RE.test(first)) return null;
	return first;
}

/**
 * @param {string|null} link coin.twitter
 * @param {object} [deps] test seams
 * @returns {Promise<{handle:string, ageDays:number|null, followers:number|null, verified:boolean, source:string}|null>}
 */
export async function xAccountSignal(link, { lookup = fetchGuestProfile, now = Date.now } = {}) {
	const handle = xHandleFromLink(link);
	if (!handle) return null;

	const key = `oracle:xacct:${handle.toLowerCase()}`;
	const cached = await cacheGet(key).catch(() => null);
	if (cached) return cached.miss ? null : cached;

	try {
		const profile = await Promise.race([
			lookup(handle),
			new Promise((_, reject) => setTimeout(() => reject(new Error('x account lookup deadline')), LOOKUP_DEADLINE_MS).unref?.()),
		]);
		const joined = profile.joined ? Date.parse(profile.joined) : NaN;
		const signal = {
			handle: profile.username || handle,
			ageDays: Number.isFinite(joined) ? Math.max(0, Math.floor((now() - joined) / DAY_MS)) : null,
			followers: Number.isFinite(profile.followers) ? profile.followers : null,
			verified: !!profile.verified,
			source: 'x-guest',
		};
		await cacheSet(key, signal, HIT_TTL_S).catch(() => {});
		return signal;
	} catch (err) {
		console.warn(`[oracle/x-account] @${handle}: ${err?.reason || 'error'}: ${err?.message || err}`);
		await cacheSet(key, { miss: true }, MISS_TTL_S).catch(() => {});
		return null;
	}
}
