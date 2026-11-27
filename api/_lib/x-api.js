// Official X API v2 reader, using this deployment's own credentials.
//
// Every X read in the platform (account profiles for the Oracle and KOL
// tracker, account timelines for the social ingest, single posts for the
// price-impact tools) goes through here. It sends an honest identity, never
// borrows the web client's tokens, and never calls an undocumented endpoint.
//
// Auth: an app-only bearer. X_BEARER_TOKEN (or TWITTER_BEARER_TOKEN) is used
// as-is; otherwise one is minted from X_API_KEY / X_API_SECRET with the OAuth2
// client-credentials grant. With none of those set every call throws
// XApiUnavailable('not_configured') without touching the network, and callers
// degrade to "unknown" instead of guessing.

const API_BASE = 'https://api.x.com/2';
const TOKEN_URL = 'https://api.x.com/oauth2/token';
const USER_AGENT = 'three.ws/1.0 (+https://three.ws)';
const TIMEOUT_MS = 8_000;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const ID_RE = /^\d{1,20}$/;

let mintedToken = null;
let cooldownUntil = 0;

export class XApiUnavailable extends Error {
	/** @param {'not_configured'|'auth_failed'|'rate_limited'|'not_found'|'upstream'} reason */
	constructor(reason, message) {
		super(message || reason);
		this.name = 'XApiUnavailable';
		this.reason = reason;
	}
}

function configuredToken(env) {
	return env.X_BEARER_TOKEN || env.TWITTER_BEARER_TOKEN || '';
}

/** True when this deployment holds X API credentials. */
export function xApiConfigured(env = process.env) {
	return !!(configuredToken(env) || (env.X_API_KEY && env.X_API_SECRET));
}

export function resetXApiState() {
	mintedToken = null;
	cooldownUntil = 0;
}

async function bearer(env, fetchImpl) {
	const set = configuredToken(env);
	if (set) return set;
	if (mintedToken) return mintedToken;
	if (!env.X_API_KEY || !env.X_API_SECRET) {
		throw new XApiUnavailable('not_configured', 'X API credentials are not configured (set X_BEARER_TOKEN)');
	}
	const basic = Buffer.from(`${encodeURIComponent(env.X_API_KEY)}:${encodeURIComponent(env.X_API_SECRET)}`).toString('base64');
	const r = await fetchImpl(TOKEN_URL, {
		method: 'POST',
		headers: {
			authorization: `Basic ${basic}`,
			'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
			'user-agent': USER_AGENT,
		},
		body: 'grant_type=client_credentials',
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!r.ok) throw new XApiUnavailable('auth_failed', `X token exchange failed with HTTP ${r.status}`);
	const body = await r.json();
	if (!body?.access_token) throw new XApiUnavailable('auth_failed', 'X token exchange returned no access token');
	mintedToken = body.access_token;
	return mintedToken;
}

async function call(path, query, { env, fetchImpl }) {
	if (!xApiConfigured(env)) {
		throw new XApiUnavailable('not_configured', 'X API credentials are not configured (set X_BEARER_TOKEN)');
	}
	if (Date.now() < cooldownUntil) throw new XApiUnavailable('rate_limited', 'X API is cooling down after a rate limit');
	const token = await bearer(env, fetchImpl);
	const url = new URL(`${API_BASE}${path}`);
	for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
	let r;
	try {
		r = await fetchImpl(url, {
			headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT, accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (err) {
		throw new XApiUnavailable('upstream', `X API unreachable: ${err?.message || err}`);
	}
	if (r.status === 429) {
		const reset = Number(r.headers.get('x-rate-limit-reset'));
		cooldownUntil = Number.isFinite(reset) && reset * 1000 > Date.now() ? reset * 1000 : Date.now() + 60_000;
		throw new XApiUnavailable('rate_limited', 'X API rate limit reached');
	}
	if (r.status === 401 || r.status === 403) {
		mintedToken = null;
		throw new XApiUnavailable('auth_failed', `X API rejected the credentials (HTTP ${r.status})`);
	}
	if (!r.ok) throw new XApiUnavailable('upstream', `X API answered HTTP ${r.status}`);
	const body = await r.json();
	if (!body?.data && Array.isArray(body?.errors) && body.errors.length) {
		throw new XApiUnavailable('not_found', body.errors[0]?.detail || body.errors[0]?.title || 'not found');
	}
	return body;
}

function opts({ env = process.env, fetchImpl = fetch } = {}) {
	return { env, fetchImpl };
}

function cleanHandle(handle) {
	const h = String(handle || '').replace(/^@/, '');
	if (!HANDLE_RE.test(h)) throw new XApiUnavailable('not_found', 'invalid X handle');
	return h;
}

/**
 * @returns {Promise<{ id, username, name, avatar, verified, followers, joined }>}
 */
export async function fetchXProfile(handle, o = {}) {
	const h = cleanHandle(handle);
	const body = await call(
		`/users/by/username/${h}`,
		{ 'user.fields': 'public_metrics,profile_image_url,verified,created_at' },
		opts(o),
	);
	const u = body.data;
	return {
		id: String(u.id),
		username: u.username || h,
		name: u.name || null,
		avatar: u.profile_image_url || null,
		verified: u.verified === true,
		followers: Number.isFinite(Number(u.public_metrics?.followers_count)) ? Number(u.public_metrics.followers_count) : null,
		joined: u.created_at || null,
	};
}

/**
 * Latest original posts of an account (replies and reposts excluded).
 * @returns {Promise<{ tweets: Array<{ id, text, createdAt, url, author: { username }, metrics: { views, likes, retweets } }> }>}
 */
export async function fetchXTimeline(handle, { limit = 20, ...o } = {}) {
	const h = cleanHandle(handle);
	const base = opts(o);
	const user = (await call(`/users/by/username/${h}`, {}, base)).data;
	const max = Math.min(100, Math.max(5, Number(limit) || 20));
	const body = await call(
		`/users/${user.id}/tweets`,
		{ max_results: String(max), exclude: 'retweets,replies', 'tweet.fields': 'created_at,public_metrics' },
		base,
	);
	const tweets = (Array.isArray(body.data) ? body.data : []).map((t) => ({
		id: String(t.id),
		text: String(t.text || ''),
		createdAt: t.created_at || null,
		url: `https://x.com/${user.username || h}/status/${t.id}`,
		author: { username: user.username || h },
		metrics: {
			views: Number(t.public_metrics?.impression_count) || 0,
			likes: Number(t.public_metrics?.like_count) || 0,
			retweets: Number(t.public_metrics?.retweet_count) || 0,
		},
	}));
	return { tweets };
}

/**
 * One post by id with author and metrics.
 * @returns {Promise<{ id, text, createdAt, author: { name, handle, avatar, verified }, metrics, media: Array<{ type, thumbnail, durationMs }> }>}
 */
export async function fetchXPostById(id, o = {}) {
	if (!ID_RE.test(String(id))) throw new XApiUnavailable('not_found', 'invalid post id');
	const body = await call(
		`/tweets/${id}`,
		{
			'tweet.fields': 'created_at,public_metrics,attachments',
			expansions: 'author_id,attachments.media_keys',
			'user.fields': 'profile_image_url,verified',
			'media.fields': 'type,preview_image_url,duration_ms,url',
		},
		opts(o),
	);
	const t = body.data;
	const author = (body.includes?.users || []).find((u) => String(u.id) === String(t.author_id)) || {};
	const m = t.public_metrics || {};
	return {
		id: String(t.id),
		text: String(t.text || ''),
		createdAt: t.created_at || null,
		author: { name: author.name || null, handle: author.username || null, avatar: author.profile_image_url || null, verified: author.verified === true },
		metrics: {
			likes: m.like_count ?? null,
			replies: m.reply_count ?? null,
			reposts: m.retweet_count ?? null,
			quotes: m.quote_count ?? null,
			views: m.impression_count ?? null,
			bookmarks: m.bookmark_count ?? null,
		},
		media: (body.includes?.media || []).map((x) => ({
			type: x.type === 'animated_gif' ? 'gif' : x.type,
			thumbnail: x.preview_image_url || x.url || null,
			durationMs: x.duration_ms ?? null,
		})),
	};
}
