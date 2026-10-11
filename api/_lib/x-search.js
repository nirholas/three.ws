// X (Twitter) recent search, read-only, for evidence that has to be citable.
//
// The Sentiment Scout uses this to find posts that quote a coin's exact
// contract address. Searching the mint (not the ticker) is deliberate: a
// ticker like $CAT matches thousands of unrelated coins, while a 44-character
// base58 address only matches posts about that one coin. Every post returned
// here carries its own permalink, author and timestamp, so a claim built from
// it can always be opened and checked by a reader.
//
// Auth: an app-only bearer token. X_BEARER_TOKEN is used as-is when set;
// otherwise one is minted from the app's consumer key pair (X_API_KEY /
// X_API_SECRET, the same app the platform posts from) with the OAuth2
// client-credentials grant and cached in-process until X rejects it.
//
// Budget: X meters recent search per app per 15 minutes. Every response
// reports what is left (x-rate-limit-remaining); once it drops under
// RESERVE_REQUESTS this module stops searching until the window resets, so a
// busy scout board can never exhaust the quota other X features share.
//
// Second rung: xAI's built-in x_search tool on the Responses API
// (https://api.x.ai/v1/responses). It is a second, independent path to the
// same X data, billed per call by xAI, so searchMintPosts only reaches it
// when the bearer rung above cannot answer (XSearchUnavailable of any
// reason). Grok runs the search server-side and is instructed to return the
// matching posts as strict JSON; that JSON is untrusted model output, parsed
// defensively and never treated as instructions. A daily cap
// (XAI_X_SEARCH_DAILY_CAP, counted in Postgres so it holds across instances
// and cold starts) stops the rung once reached rather than paying for every
// search an outage on rung one would otherwise trigger.

import { fetchUpstream, fetchUpstreamJson } from './upstream-fetch.js';
import { sql } from './db.js';
import { GROK_BUDGET_MODEL } from './chat-models.js';

const TOKEN_URL = 'https://api.twitter.com/oauth2/token';
const SEARCH_URL = 'https://api.twitter.com/2/tweets/search/recent';
const BREAKER = 'x:search';
const TIMEOUT_MS = 6_000;
const RESERVE_REQUESTS = 60;

const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const XAI_BREAKER = 'x:search:xai';
const XAI_TIMEOUT_MS = 15_000;
const XAI_USAGE_KEY = 'x_search_xai_usage';
const XAI_DEFAULT_DAILY_CAP = 200;

let _token = null;
let _budget = { remaining: null, resetAtMs: 0 };

export class XSearchUnavailable extends Error {
	constructor(reason, message) {
		super(message || reason);
		this.name = 'XSearchUnavailable';
		this.reason = reason;
	}
}

/** True when this deployment holds credentials for the bearer (rung one) search. */
export function xSearchConfigured(env = process.env) {
	return !!(env.X_BEARER_TOKEN || (env.X_API_KEY && env.X_API_SECRET));
}

/** True when this deployment holds an xAI key for the x_search rung (rung two). */
export function xaiSearchConfigured(env = process.env) {
	return !!(env.GROK_API_KEY || env.XAI_API_KEY);
}

/** True when either rung could answer a search. Gate feature-level attempts on this, not xSearchConfigured alone. */
export function anyXSearchConfigured(env = process.env) {
	return xSearchConfigured(env) || xaiSearchConfigured(env);
}

/**
 * Build the search query for posts quoting one contract address. Retweets are
 * excluded: a retweet is the same post again, and counting it would let one
 * account's shill be amplified into many "mentions".
 */
export function mintQuery(mint) {
	return `"${String(mint).trim()}" -is:retweet`;
}

// X returns post text with &amp; &lt; &gt; escaped. Decode those three (and
// &quot; / &#39; for safety) so a quote reads as the author wrote it; the page
// escapes again on render.
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
export function decodeXText(text) {
	return String(text ?? '').replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
}

/**
 * Normalize a v2 search payload into post receipts. PURE.
 *
 * @param {object} payload  the JSON body of /2/tweets/search/recent
 * @returns {Array<{ id, url, text, created_at, author: { id, username, name, followers, verified }, likes, reposts, replies, quotes, impressions }>}
 */
export function parseSearchPayload(payload) {
	const users = new Map();
	for (const u of payload?.includes?.users || []) {
		if (u?.id) users.set(String(u.id), u);
	}
	const out = [];
	for (const t of Array.isArray(payload?.data) ? payload.data : []) {
		if (!t?.id || typeof t.text !== 'string') continue;
		const u = users.get(String(t.author_id)) || null;
		const username = u?.username ? String(u.username) : null;
		const m = t.public_metrics || {};
		out.push({
			id: String(t.id),
			// Without a username X still resolves /i/status/<id> to the post.
			url: username ? `https://x.com/${username}/status/${t.id}` : `https://x.com/i/status/${t.id}`,
			text: decodeXText(t.text),
			created_at: t.created_at || null,
			author: {
				id: t.author_id ? String(t.author_id) : null,
				username,
				name: u?.name || null,
				followers: Number.isFinite(Number(u?.public_metrics?.followers_count)) ? Number(u.public_metrics.followers_count) : null,
				verified: u?.verified === true,
			},
			likes: Number(m.like_count) || 0,
			reposts: Number(m.retweet_count) || 0,
			replies: Number(m.reply_count) || 0,
			quotes: Number(m.quote_count) || 0,
			impressions: Number.isFinite(Number(m.impression_count)) ? Number(m.impression_count) : null,
		});
	}
	return out;
}

/**
 * Summarize a set of posts about one coin: how many, from how many distinct
 * accounts, the most-followed account, and how concentrated the chatter is.
 * PURE. `posts` come from parseSearchPayload.
 */
export function summarizePosts(posts) {
	const list = Array.isArray(posts) ? posts : [];
	const byAuthor = new Map();
	for (const p of list) {
		const key = p.author?.id || p.author?.username || p.id;
		const cur = byAuthor.get(key) || { author: p.author, posts: 0 };
		cur.posts += 1;
		byAuthor.set(key, cur);
	}
	const authors = [...byAuthor.values()];
	const top = authors.slice().sort((a, b) => (b.posts - a.posts))[0] || null;
	const mostFollowed = authors
		.filter((a) => a.author?.followers != null)
		.sort((a, b) => b.author.followers - a.author.followers)[0] || null;
	const reach = authors.reduce((s, a) => s + (a.author?.followers || 0), 0);
	const engagement = list.reduce((s, p) => s + p.likes + p.reposts + p.replies + p.quotes, 0);
	const times = list.map((p) => Date.parse(p.created_at)).filter(Number.isFinite).sort((a, b) => a - b);
	return {
		posts: list.length,
		authors: authors.length,
		top_poster: top ? { username: top.author?.username || null, posts: top.posts } : null,
		top_poster_share: list.length && top ? top.posts / list.length : 0,
		most_followed: mostFollowed ? { username: mostFollowed.author.username, followers: mostFollowed.author.followers } : null,
		reach_followers: reach,
		engagement,
		first_at: times.length ? new Date(times[0]).toISOString() : null,
		last_at: times.length ? new Date(times[times.length - 1]).toISOString() : null,
	};
}

function noteBudget(res) {
	const remaining = Number(res.headers.get('x-rate-limit-remaining'));
	const reset = Number(res.headers.get('x-rate-limit-reset'));
	if (Number.isFinite(remaining)) _budget.remaining = remaining;
	if (Number.isFinite(reset)) _budget.resetAtMs = reset * 1000;
}

function budgetExhausted(now = Date.now()) {
	if (_budget.remaining == null) return false;
	if (now >= _budget.resetAtMs) return false;
	return _budget.remaining < RESERVE_REQUESTS;
}

async function bearer(env, fetchImpl) {
	if (env.X_BEARER_TOKEN) return env.X_BEARER_TOKEN;
	if (_token) return _token;
	if (!env.X_API_KEY || !env.X_API_SECRET) throw new XSearchUnavailable('not_configured', 'X search credentials are not configured');
	const basic = Buffer.from(`${encodeURIComponent(env.X_API_KEY)}:${encodeURIComponent(env.X_API_SECRET)}`).toString('base64');
	const res = await fetchImpl(TOKEN_URL, {
		method: 'POST',
		headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
		body: 'grant_type=client_credentials',
	}, { name: BREAKER, timeoutMs: TIMEOUT_MS, attempts: 1, okWhen: () => true });
	if (!res.ok) throw new XSearchUnavailable('auth_failed', `X token exchange failed with HTTP ${res.status}`);
	const body = await res.json();
	if (!body?.access_token) throw new XSearchUnavailable('auth_failed', 'X token exchange returned no access token');
	_token = body.access_token;
	return _token;
}

/**
 * Search recent posts (X keeps the last 7 days searchable) quoting a mint,
 * via the app-only bearer rung. Throws XSearchUnavailable when search cannot
 * run (no credentials, auth failure, the budget reserve reached, or X down);
 * callers list the source as unavailable rather than guessing.
 *
 * @param {string} mint
 * @param {{ sinceIso?: string|null, maxResults?: number, env?: object, fetchImpl?: Function }} [opts]
 */
export async function searchMintPostsBearer(mint, { sinceIso = null, maxResults = 25, env = process.env, fetchImpl = fetchUpstream } = {}) {
	if (!xSearchConfigured(env)) throw new XSearchUnavailable('not_configured', 'X search credentials are not configured');
	if (budgetExhausted()) throw new XSearchUnavailable('budget_reserve', 'X search budget reserve reached for this window');

	const params = new URLSearchParams({
		query: mintQuery(mint),
		max_results: String(Math.max(10, Math.min(100, Math.round(maxResults)))),
		'tweet.fields': 'created_at,public_metrics,author_id',
		expansions: 'author_id',
		'user.fields': 'username,name,public_metrics,verified',
	});
	// X rejects a start_time older than 7 days or in the future; clamp to a
	// valid window rather than sending one it will refuse.
	if (sinceIso) {
		const t = Date.parse(sinceIso);
		const floor = Date.now() - 7 * 24 * 3600 * 1000 + 60_000;
		const ceil = Date.now() - 15_000;
		if (Number.isFinite(t) && t < ceil) params.set('start_time', new Date(Math.max(t, floor)).toISOString());
	}

	for (let pass = 0; pass < 2; pass++) {
		const token = await bearer(env, fetchImpl);
		const res = await fetchImpl(`${SEARCH_URL}?${params}`, {
			headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
		}, { name: BREAKER, timeoutMs: TIMEOUT_MS, attempts: 1, okWhen: () => true });
		noteBudget(res);
		if (res.status === 401 && !env.X_BEARER_TOKEN && pass === 0) {
			// A revoked or rotated app token: mint a fresh one once.
			_token = null;
			continue;
		}
		if (res.status === 429) throw new XSearchUnavailable('rate_limited', 'X search rate limit reached');
		if (!res.ok) throw new XSearchUnavailable('upstream_error', `X search returned HTTP ${res.status}`);
		return parseSearchPayload(await res.json());
	}
	throw new XSearchUnavailable('auth_failed', 'X rejected the app token');
}

// ---------------------------------------------------------------------------
// Rung two: xAI's x_search tool on the Responses API.
// ---------------------------------------------------------------------------

function xaiDailyCap(env = process.env) {
	const v = parseInt(env.XAI_X_SEARCH_DAILY_CAP, 10);
	return Number.isFinite(v) && v > 0 ? v : XAI_DEFAULT_DAILY_CAP;
}

function todayUtc() {
	return new Date().toISOString().slice(0, 10);
}

async function ensureAppSettings() {
	await sql`
		CREATE TABLE IF NOT EXISTS app_settings (
			key text PRIMARY KEY,
			value jsonb NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`;
}

/** How many xAI x_search calls have been made today. Exported for telemetry/ops reads. */
export async function xaiSearchUsageToday() {
	await ensureAppSettings();
	const [row] = await sql`SELECT value FROM app_settings WHERE key = ${XAI_USAGE_KEY}`;
	const v = row?.value;
	if (!v || v.day !== todayUtc()) return 0;
	return Number(v.count) || 0;
}

async function bumpXaiSearchUsage() {
	await ensureAppSettings();
	const day = todayUtc();
	const rows = await sql`
		INSERT INTO app_settings (key, value)
		VALUES (${XAI_USAGE_KEY}, jsonb_build_object('day', ${day}::text, 'count', 1))
		ON CONFLICT (key) DO UPDATE SET
			value = CASE
				WHEN app_settings.value->>'day' = ${day}::text
					THEN jsonb_build_object('day', ${day}::text, 'count', (app_settings.value->>'count')::int + 1)
				ELSE jsonb_build_object('day', ${day}::text, 'count', 1)
			END,
			updated_at = now()
		RETURNING (value->>'count')::int AS count
	`;
	return rows[0]?.count ?? 1;
}

/**
 * Build the strict-JSON instruction sent as the Responses API `input`. Grok
 * runs x_search itself; this only tells it what shape to answer in. The
 * model's answer is untrusted text, parsed defensively by
 * parseXaiSearchPayload and never treated as instructions.
 */
export function buildXaiSearchPrompt(mint, maxResults) {
	return [
		`Use the x_search tool to find up to ${maxResults} recent posts on X (Twitter) that contain the exact text "${String(mint).trim()}" and are not retweets.`,
		'Reply with ONLY a JSON array, no prose and no markdown code fence. Each element must have exactly this shape:',
		'{"id": "<the post\'s numeric id as a string>", "url": "<the post\'s https://x.com/.../status/<id> url>", "text": "<the post\'s exact own text>", "created_at": "<ISO 8601 timestamp, or null if unknown>", "author": {"username": "<handle without the @, or null if unknown>"}}',
		'If no matching posts exist, reply with exactly: []',
	].join('\n');
}

/** Pull the assistant's text out of a Responses API body, across its output items. PURE. */
export function extractResponsesOutputText(payload) {
	const items = Array.isArray(payload?.output) ? payload.output : [];
	const parts = [];
	for (const item of items) {
		const content = Array.isArray(item?.content) ? item.content : [];
		for (const part of content) {
			if (typeof part?.text === 'string') parts.push(part.text);
		}
	}
	return parts.join('').trim();
}

/**
 * Normalize Grok's strict-JSON x_search answer into the same post shape
 * parseSearchPayload returns. Engagement counters and author details the
 * tool does not expose are left at null/0 rather than fabricated. PURE.
 * Throws if the model's answer is not the requested JSON array shape.
 *
 * @param {object} payload  the JSON body of POST /v1/responses
 */
export function parseXaiSearchPayload(payload) {
	const text = extractResponsesOutputText(payload);
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	const raw = JSON.parse(fenced ? fenced[1] : text);
	if (!Array.isArray(raw)) throw new Error('xAI x_search answer was not a JSON array');

	const out = [];
	for (const p of raw) {
		if (!p || typeof p !== 'object') continue;
		const id = p.id != null ? String(p.id) : (typeof p.url === 'string' ? p.url.match(/status\/(\d+)/)?.[1] : null);
		if (!id) continue;
		const username = p.author?.username ? String(p.author.username).replace(/^@/, '') : null;
		out.push({
			id,
			url: typeof p.url === 'string' && p.url ? p.url : (username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/status/${id}`),
			text: decodeXText(String(p.text ?? '')),
			created_at: typeof p.created_at === 'string' ? p.created_at : null,
			author: { id: null, username, name: null, followers: null, verified: false },
			likes: 0,
			reposts: 0,
			replies: 0,
			quotes: 0,
			impressions: null,
		});
	}
	return out;
}

/**
 * Search X for a mint through xAI's x_search tool. Second rung: only reached
 * by searchMintPosts when the bearer rung cannot answer. Throws
 * XSearchUnavailable on no credentials, the daily cap, a rate limit, or an
 * upstream/parse failure, exactly like the bearer rung, so callers never need
 * to know which rung answered.
 *
 * @param {string} mint
 * @param {{ sinceIso?: string|null, maxResults?: number, env?: object, fetchImpl?: Function }} [opts]
 */
export async function searchMintPostsViaXai(mint, { sinceIso = null, maxResults = 25, env = process.env, fetchImpl = fetchUpstreamJson } = {}) {
	if (!xaiSearchConfigured(env)) throw new XSearchUnavailable('not_configured', 'xAI X search credentials are not configured');

	let usedToday;
	try {
		usedToday = await xaiSearchUsageToday();
	} catch {
		usedToday = 0; // a DB hiccup never blocks a rung that would otherwise work
	}
	if (usedToday >= xaiDailyCap(env)) throw new XSearchUnavailable('xai_daily_cap', 'xAI X search daily cap reached');

	const key = env.GROK_API_KEY || env.XAI_API_KEY;
	const capped = Math.max(1, Math.min(25, Math.round(maxResults)));
	const toDate = new Date().toISOString().slice(0, 10);
	const tools = [{ type: 'x_search', to_date: toDate }];
	if (sinceIso) {
		const t = Date.parse(sinceIso);
		const floor = Date.now() - 7 * 24 * 3600 * 1000;
		if (Number.isFinite(t)) tools[0].from_date = new Date(Math.max(t, floor)).toISOString().slice(0, 10);
	}

	const payload = {
		model: GROK_BUDGET_MODEL,
		input: [{ role: 'user', content: buildXaiSearchPrompt(mint, capped) }],
		tools,
	};

	let body;
	try {
		body = await fetchImpl(XAI_RESPONSES_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		}, { name: XAI_BREAKER, timeoutMs: XAI_TIMEOUT_MS, attempts: 1 });
	} catch (err) {
		if (err?.status === 429) throw new XSearchUnavailable('rate_limited', 'xAI X search rate limit reached');
		throw new XSearchUnavailable('upstream_error', `xAI X search returned HTTP ${err?.status ?? 'error'}`);
	}

	// The search already ran and was billed by xAI even if parsing fails below,
	// so the count is what the cap is protecting and must be bumped regardless.
	// Awaited (not fire-and-forget): the cap only works if the count it reads
	// back next time reflects every call that was actually billed.
	try {
		await bumpXaiSearchUsage();
	} catch {
		// A DB hiccup must never throw away a search result that already ran.
	}

	try {
		return parseXaiSearchPayload(body);
	} catch {
		throw new XSearchUnavailable('upstream_error', 'xAI X search returned an unparseable answer');
	}
}

/**
 * Search recent posts quoting a mint, failing over from the bearer rung to
 * xAI's x_search when the bearer rung cannot answer. Throws
 * XSearchUnavailable only when neither rung can answer.
 *
 * @param {string} mint
 * @param {{ sinceIso?: string|null, maxResults?: number, env?: object, fetchImpl?: Function }} [opts]
 */
export async function searchMintPosts(mint, opts = {}) {
	try {
		return await searchMintPostsBearer(mint, opts);
	} catch (err) {
		if (!(err instanceof XSearchUnavailable)) throw err;
		const env = opts.env || process.env;
		if (!xaiSearchConfigured(env)) throw err;
		return await searchMintPostsViaXai(mint, opts);
	}
}

/** Test seam: forget the cached token and budget. */
export function _resetXSearch() {
	_token = null;
	_budget = { remaining: null, resetAtMs: 0 };
}
