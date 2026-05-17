// GET /api/seed/farcaster?handle=<fname-or-fid>
//
// Public Farcaster footprint connector for the three.ws memory-seeding
// demo. Uses the @neynar/nodejs-sdk to look up the user (by username or
// fid) and pull the last 20 casts.
//
// When NEYNAR_API_KEY is not configured we return { ok: false, reason }
// with a 200 status so the demo can render a "connector not configured"
// state cleanly.

import { NeynarAPIClient, Configuration } from '@neynar/nodejs-sdk';
import { cors, json, method, wrap, error } from '../_lib/http.js';

let _client = null;
function client() {
	if (_client) return _client;
	const apiKey = process.env.NEYNAR_API_KEY;
	if (!apiKey) return null;
	_client = new NeynarAPIClient(new Configuration({ apiKey }));
	return _client;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const raw = (url.searchParams.get('handle') || '').trim().replace(/^@/, '');
	if (!raw) return error(res, 400, 'invalid_request', 'handle query param required');

	const c = client();
	if (!c) {
		res.setHeader('cache-control', 'no-store');
		return json(res, 200, {
			ok: false,
			reason: 'Farcaster connector not configured',
			detail: 'Set NEYNAR_API_KEY in the environment to enable this connector.',
		});
	}

	// Resolve to a Farcaster user. Numeric → fid, otherwise → username lookup.
	let user = null;
	const numeric = /^\d+$/.test(raw) ? Number(raw) : null;

	try {
		if (numeric != null) {
			const resp = await c.fetchBulkUsers({ fids: [numeric] });
			user = resp?.users?.[0] || null;
		} else {
			const resp = await c.lookupUserByUsername({ username: raw });
			user = resp?.user || null;
		}
	} catch (err) {
		const status = err?.response?.status || 502;
		if (status === 404) return error(res, 404, 'not_found', `no Farcaster user "${raw}"`);
		res.setHeader('cache-control', 'no-store');
		return json(res, 200, {
			ok: false,
			reason: 'Farcaster upstream error',
			detail: err?.response?.data?.message || err.message || 'lookup failed',
		});
	}

	if (!user) return error(res, 404, 'not_found', `no Farcaster user "${raw}"`);

	const fid = user.fid;
	let casts = [];
	try {
		const resp = await c.fetchCastsForUser({ fid, limit: 20, includeReplies: false });
		casts = (resp?.casts || []).map((cast) => ({
			text: cast.text || '',
			timestamp: cast.timestamp || null,
			likes: cast.reactions?.likes_count ?? 0,
			recasts: cast.reactions?.recasts_count ?? 0,
			replies: cast.replies?.count ?? 0,
		}));
	} catch (err) {
		console.warn('[seed/farcaster] casts fetch failed', err?.message || err);
	}

	res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=600');
	return json(res, 200, {
		ok: true,
		handle: user.username || String(fid),
		fid,
		display_name: user.display_name || null,
		avatar_url: user.pfp_url || null,
		bio: user.profile?.bio?.text || '',
		follower_count: user.follower_count ?? 0,
		following_count: user.following_count ?? 0,
		power_badge: !!user.power_badge,
		recent_casts: casts,
	});
});
