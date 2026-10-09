// @ts-check
// Read the posts that mention one of our X accounts, since a cursor.
//
// This is the input side of the @-mention bot (prompts x-grok 24 to 28). It
// does one thing: ask X's user mention timeline for everything newer than the
// last mention we saw, and hand back each one as a platform-neutral mention
// carrying what a later step needs to decide and to reply: the author, the
// conversation, the post it replies to or quotes, and every attached image.
// It never writes to X and it never interprets the text. Mention text is
// untrusted data; the intent parser (x-mention-intents.js) is the only thing
// that reads it, and it is pure.
//
// Two credential modes, one endpoint (GET /2/users/:id/mentions):
//   company  @trythreews through the app's OAuth 1.0a user context
//            (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET), the
//            same credentials every outbound company post already uses.
//   agent    an agent's own connected X account through its OAuth2 user token
//            (agent_x_connections via resolveXConnection), refreshed on expiry
//            exactly the way the posting path refreshes it.
//
// Failures are typed so the polling cron can act on them without parsing
// strings: XTierUnavailable (the app's access level or credit cannot read
// mentions, the measurement owner order 926 needs), XRateLimited (with X's own
// reset time), XAuthFailed (credentials rejected), XMentionsError (anything
// else, X down included).

import { fetchUpstream } from './upstream-fetch.js';
import { decodeXText } from './x-search.js';

const API_BASE = 'https://api.twitter.com/2';
const BREAKER = 'x:mentions';
const TIMEOUT_MS = 10_000;
// X accepts 5 to 100 per page on the mentions timeline.
const PAGE_MIN = 5;
const PAGE_MAX = 100;
// A poll that finds more than this many pages of new mentions is a flood, not
// a conversation; the rest is reported as truncated rather than read.
const DEFAULT_MAX_PAGES = 5;
export const COMPANY_HANDLE_DEFAULT = 'trythreews';

export const TWEET_FIELDS = [
	'author_id',
	'conversation_id',
	'created_at',
	'referenced_tweets',
	'attachments',
	'entities',
	'in_reply_to_user_id',
	'lang',
	'note_tweet',
];
export const EXPANSIONS = [
	'author_id',
	'attachments.media_keys',
	'referenced_tweets.id',
	'referenced_tweets.id.author_id',
	'referenced_tweets.id.attachments.media_keys',
];
export const USER_FIELDS = ['username', 'name', 'profile_image_url', 'verified', 'created_at'];
export const MEDIA_FIELDS = ['url', 'type', 'width', 'height', 'preview_image_url', 'alt_text'];

export class XMentionsError extends Error {
	/**
	 * @param {string} message
	 * @param {{ status?: number|null, code?: string, body?: unknown }} [info]
	 */
	constructor(message, info = {}) {
		super(message);
		this.name = 'XMentionsError';
		this.status = info.status ?? null;
		this.code = info.code || 'upstream_error';
		this.body = info.body ?? null;
	}
}

/** The app's access level or credit balance cannot read the mention timeline. */
export class XTierUnavailable extends XMentionsError {
	/** @param {string} message @param {{ status?: number|null, body?: unknown, reason?: string|null }} [info] */
	constructor(message, info = {}) {
		super(message, { ...info, code: 'tier_unavailable' });
		this.name = 'XTierUnavailable';
		this.reason = info.reason ?? null;
	}
}

/** X refused the call for rate; `resetAt` is X's own window reset. */
export class XRateLimited extends XMentionsError {
	/** @param {string} message @param {{ status?: number|null, body?: unknown, resetAt?: string|null, limit?: number|null }} [info] */
	constructor(message, info = {}) {
		super(message, { ...info, code: 'rate_limited' });
		this.name = 'XRateLimited';
		this.resetAt = info.resetAt ?? null;
		this.limit = info.limit ?? null;
	}
}

/** The credentials themselves were rejected (revoked, rotated, or expired). */
export class XAuthFailed extends XMentionsError {
	/** @param {string} message @param {{ status?: number|null, body?: unknown }} [info] */
	constructor(message, info = {}) {
		super(message, { ...info, code: 'auth_failed' });
		this.name = 'XAuthFailed';
	}
}

// --- pure helpers -----------------------------------------------------------

/** Lowercased plain-object headers from a fetch Headers or node IncomingHttpHeaders. */
export function plainHeaders(headers) {
	const out = {};
	if (!headers) return out;
	if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
		headers.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
		return out;
	}
	for (const [k, v] of Object.entries(headers)) {
		if (v != null) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
	}
	return out;
}

/**
 * The rate-limit window X reported, from response headers. PURE.
 * @returns {{ limit: number|null, remaining: number|null, resetAt: string|null }}
 */
export function readRateLimit(headers) {
	const h = plainHeaders(headers);
	const num = (k) => {
		const n = Number(h[k]);
		return h[k] != null && Number.isFinite(n) ? n : null;
	};
	const reset = num('x-rate-limit-reset');
	return {
		limit: num('x-rate-limit-limit'),
		remaining: num('x-rate-limit-remaining'),
		resetAt: reset != null ? new Date(reset * 1000).toISOString() : null,
	};
}

// The problem types and phrases X uses when the app's access level, project
// enrollment or credit balance does not include an endpoint. Matched against
// the v2 problem body, never against a 200.
const TIER_PATTERNS = [
	/client-not-enrolled/i,
	/client-forbidden/i,
	/appropriate level of api access/i,
	/subset of x api v2 endpoints/i,
	/subset of twitter api v2 endpoints/i,
	/access level/i,
	/credits?/i,
	/usage[- ]cap/i,
	/upgrade/i,
	/enroll/i,
];

/**
 * Turn a non-2xx mention-timeline response into the typed error a caller can
 * act on. PURE, so the policy is testable on captured bodies.
 *
 * @param {{ status: number, headers?: object, body?: any }} res
 * @param {number} [now]
 * @returns {XMentionsError}
 */
export function classifyMentionsError(res, now = Date.now()) {
	const status = Number(res?.status) || 0;
	const body = res?.body ?? null;
	const detail = problemText(body);
	if (status === 429) {
		const rl = readRateLimit(res.headers);
		// A 429 without a usable reset still has to stop the poller; X's
		// mention window is 15 minutes, so that is the honest fallback.
		const resetAt = rl.resetAt && Date.parse(rl.resetAt) > now ? rl.resetAt : new Date(now + 15 * 60_000).toISOString();
		const err = new XRateLimited(`X rate limit on the mention timeline until ${resetAt}`, { status, body, resetAt, limit: rl.limit });
		err.headers = plainHeaders(res.headers);
		return err;
	}
	if (status === 402 || (status === 403 && TIER_PATTERNS.some((re) => re.test(detail)))) {
		const reason = body?.reason || body?.type || body?.title || null;
		return new XTierUnavailable(`X refused the mention timeline for this app's access level: ${detail || `HTTP ${status}`}`.slice(0, 500), { status, body, reason });
	}
	if (status === 401) return new XAuthFailed(`X rejected the credentials: ${detail || 'HTTP 401'}`.slice(0, 500), { status, body });
	return new XMentionsError(`X mention timeline returned HTTP ${status}${detail ? `: ${detail}` : ''}`.slice(0, 500), { status, body });
}

function problemText(body) {
	if (!body) return '';
	if (typeof body === 'string') return body.slice(0, 400);
	return [body.title, body.detail, body.reason, body.type, body.required_enrollment, ...(Array.isArray(body.errors) ? body.errors.map((e) => e?.message || e?.detail) : [])]
		.filter(Boolean)
		.join(' | ')
		.slice(0, 400);
}

function mediaOf(keys, mediaByKey) {
	const out = [];
	for (const key of Array.isArray(keys) ? keys : []) {
		const m = mediaByKey.get(String(key));
		if (!m) continue;
		out.push({
			key: String(m.media_key),
			type: m.type || null,
			// Photos carry `url`; videos and GIFs carry only a preview frame.
			url: m.url || null,
			previewUrl: m.preview_image_url || null,
			width: Number.isFinite(Number(m.width)) ? Number(m.width) : null,
			height: Number.isFinite(Number(m.height)) ? Number(m.height) : null,
			altText: m.alt_text ? decodeXText(m.alt_text) : null,
		});
	}
	return out;
}

function authorOf(id, usersById) {
	if (!id) return null;
	const u = usersById.get(String(id));
	return {
		id: String(id),
		username: u?.username ? String(u.username) : null,
		name: u?.name ? decodeXText(u.name) : null,
		profileImageUrl: u?.profile_image_url || null,
		verified: u?.verified === true,
		createdAt: u?.created_at && Number.isFinite(Date.parse(u.created_at)) ? String(u.created_at) : null,
	};
}

function fullText(t) {
	// Posts over 280 characters keep their full body in note_tweet.
	return decodeXText(t?.note_tweet?.text || t?.text || '');
}

function permalink(id, username) {
	return username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/status/${id}`;
}

function referencedOf(ref, tweetsById, usersById, mediaByKey) {
	if (!ref?.id) return null;
	const t = tweetsById.get(String(ref.id));
	// X omits a referenced post that was deleted or is not visible to us; the
	// id stays so a reply can still be threaded, the content is simply absent.
	if (!t) return { id: String(ref.id), available: false, text: null, author: null, media: [], url: permalink(ref.id, null), conversationId: null };
	const author = authorOf(t.author_id, usersById);
	return {
		id: String(t.id),
		available: true,
		text: fullText(t),
		author,
		media: mediaOf(t.attachments?.media_keys, mediaByKey),
		url: permalink(t.id, author?.username),
		conversationId: t.conversation_id ? String(t.conversation_id) : null,
	};
}

/**
 * Normalize one page of the mention timeline into platform-neutral mentions.
 * PURE. Field names that overlap the chat gateway's GatewayEvent
 * (api/_lib/gateway/core.js) use its names: platform, chatId, chatType,
 * userId, username, text.
 *
 * @param {any} payload  the JSON body of GET /2/users/:id/mentions
 * @param {{ kind: 'company'|'agent', ref: string, userId: string, handle?: string|null }} account
 */
export function normalizeMentions(payload, account) {
	const usersById = new Map();
	const tweetsById = new Map();
	const mediaByKey = new Map();
	for (const u of payload?.includes?.users || []) if (u?.id) usersById.set(String(u.id), u);
	for (const t of payload?.includes?.tweets || []) if (t?.id) tweetsById.set(String(t.id), t);
	for (const m of payload?.includes?.media || []) if (m?.media_key) mediaByKey.set(String(m.media_key), m);

	const out = [];
	for (const t of Array.isArray(payload?.data) ? payload.data : []) {
		if (!t?.id) continue;
		const refs = Array.isArray(t.referenced_tweets) ? t.referenced_tweets : [];
		const ref = (type) => refs.find((r) => r?.type === type) || null;
		const author = authorOf(t.author_id, usersById);
		const conversationId = t.conversation_id ? String(t.conversation_id) : String(t.id);
		const entities = t.note_tweet?.entities || t.entities || {};
		out.push({
			platform: 'x',
			id: String(t.id),
			url: permalink(t.id, author?.username),
			text: fullText(t),
			lang: t.lang || null,
			createdAt: t.created_at || null,
			chatId: conversationId,
			chatType: 'public',
			conversationId,
			userId: t.author_id ? String(t.author_id) : null,
			username: author?.username || null,
			author,
			inReplyToUserId: t.in_reply_to_user_id ? String(t.in_reply_to_user_id) : null,
			repliedTo: referencedOf(ref('replied_to'), tweetsById, usersById, mediaByKey),
			quoted: referencedOf(ref('quoted'), tweetsById, usersById, mediaByKey),
			isRetweet: !!ref('retweeted'),
			media: mediaOf(t.attachments?.media_keys, mediaByKey),
			mentions: (entities.mentions || []).map((m) => ({
				username: m?.username ? String(m.username) : null,
				id: m?.id ? String(m.id) : null,
				start: Number.isFinite(m?.start) ? m.start : null,
				end: Number.isFinite(m?.end) ? m.end : null,
			})),
			urls: (entities.urls || []).map((u) => ({
				url: u?.url || null,
				expandedUrl: u?.expanded_url || null,
				start: Number.isFinite(u?.start) ? u.start : null,
				end: Number.isFinite(u?.end) ? u.end : null,
			})),
			account: { kind: account.kind, ref: account.ref, userId: account.userId, handle: account.handle || null },
			fromSelf: !!(t.author_id && String(t.author_id) === String(account.userId)),
		});
	}
	return out;
}

/** Compare two X snowflake ids as numbers (they exceed 2^53). */
export function compareIds(a, b) {
	const x = BigInt(String(a));
	const y = BigInt(String(b));
	return x < y ? -1 : x > y ? 1 : 0;
}

/** The query string for one page. PURE. */
export function mentionsQuery({ sinceId = null, maxResults = PAGE_MAX, paginationToken = null } = {}) {
	const q = {
		max_results: String(Math.max(PAGE_MIN, Math.min(PAGE_MAX, Math.round(Number(maxResults) || PAGE_MAX)))),
		'tweet.fields': TWEET_FIELDS.join(','),
		expansions: EXPANSIONS.join(','),
		'user.fields': USER_FIELDS.join(','),
		'media.fields': MEDIA_FIELDS.join(','),
	};
	if (sinceId) q.since_id = String(sinceId);
	if (paginationToken) q.pagination_token = String(paginationToken);
	return q;
}

// --- credentials and transport ---------------------------------------------

/** The company account's X user id: an OAuth 1.0a access token is `<userId>-<secret>`. */
export function companyUserId(env = process.env) {
	if (env.X_COMPANY_USER_ID) return String(env.X_COMPANY_USER_ID);
	const m = /^(\d+)-/.exec(String(env.X_ACCESS_TOKEN || ''));
	return m ? m[1] : null;
}

/** True when this deployment can read the company account's mentions. */
export function companyMentionsConfigured(env = process.env) {
	return !!(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET && companyUserId(env));
}

// OAuth 1.0a request signing is twitter-api-v2's job (already the client for
// every company post). Its errors carry status, headers and the v2 problem
// body; both outcomes become one { status, headers, body } shape.
function oauth1Transport(env) {
	let client = null;
	return async (path, query) => {
		if (!client) {
			const { TwitterApi } = await import('twitter-api-v2');
			client = new TwitterApi({
				appKey: env.X_API_KEY,
				appSecret: env.X_API_SECRET,
				accessToken: env.X_ACCESS_TOKEN,
				accessSecret: env.X_ACCESS_SECRET,
			}).readOnly;
		}
		try {
			const res = await client.v2.get(path, query, { fullResponse: true });
			return { status: 200, headers: plainHeaders(res.headers), body: res.data };
		} catch (err) {
			if (err && typeof err.code === 'number' && err.code >= 400) {
				return { status: err.code, headers: plainHeaders(err.headers), body: err.data ?? null };
			}
			throw new XMentionsError(`X request failed: ${err?.message || err}`, { status: null });
		}
	};
}

export function bearerTransport(accessToken, fetchImpl = fetchUpstream) {
	return async (path, query) => {
		const url = `${API_BASE}/${path}?${new URLSearchParams(query)}`;
		let res;
		try {
			res = await fetchImpl(url, {
				headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
			}, { name: BREAKER, timeoutMs: TIMEOUT_MS, attempts: 1, okWhen: () => true });
		} catch (err) {
			throw new XMentionsError(`X request failed: ${err?.message || err}`, { status: err?.status ?? null });
		}
		let body = null;
		const raw = await res.text();
		try { body = raw ? JSON.parse(raw) : null; } catch { body = raw.slice(0, 400); }
		return { status: res.status, headers: plainHeaders(res.headers), body };
	};
}

/**
 * Resolve an account descriptor into { account, request }.
 *   { kind: 'company' }                              @trythreews, env credentials
 *   { kind: 'agent', agentId, userId }               an agent's connected account
 * A caller may pass `request` to supply its own transport (the probe script
 * and tests replay captured responses through it).
 */
export async function resolveAccount(account, env) {
	if (account?.kind === 'agent') {
		if (!account.agentId || !account.userId) throw new XMentionsError('agent mentions need agentId and userId', { code: 'bad_account' });
		const { resolveXConnection, refreshIfNeeded } = await import('./x-post.js');
		const conn = await resolveXConnection({ userId: account.userId, agentId: account.agentId });
		// Only the agent's own account: the owner's personal account is never
		// read on an agent's behalf.
		if (!conn || conn.source !== 'agent') throw new XMentionsError(`agent ${account.agentId} has no connected X account`, { code: 'not_connected' });
		const accessToken = await refreshIfNeeded(conn);
		return {
			account: { kind: 'agent', ref: String(account.agentId), userId: String(conn.provider_uid), handle: conn.username || null },
			request: bearerTransport(accessToken),
		};
	}
	if (!companyMentionsConfigured(env)) throw new XMentionsError('company X credentials are not configured', { code: 'not_configured' });
	const handle = env.X_COMPANY_HANDLE || COMPANY_HANDLE_DEFAULT;
	return {
		account: { kind: 'company', ref: handle, userId: companyUserId(env), handle },
		request: oauth1Transport(env),
	};
}

/**
 * Every mention of `account` newer than `sinceId`, oldest first.
 *
 * Without a sinceId only the newest page is read: the first poll anchors the
 * cursor at "now" rather than replying to an account's whole history.
 *
 * @param {{
 *   account: { kind: 'company' } | { kind: 'agent', agentId: string, userId: string },
 *   sinceId?: string|null,
 *   maxResults?: number,
 *   maxPages?: number,
 *   env?: Record<string, string|undefined>,
 *   request?: (path: string, query: Record<string,string>) => Promise<{ status: number, headers: object, body: any }>,
 *   resolvedAccount?: { kind: 'company'|'agent', ref: string, userId: string, handle?: string|null },
 * }} opts
 * @returns {Promise<{ account: object, mentions: object[], newestId: string|null, pages: number, truncated: boolean, rateLimit: object|null, partialErrors: object[] }>}
 */
export async function fetchMentions({ account, sinceId = null, maxResults = PAGE_MAX, maxPages = DEFAULT_MAX_PAGES, env = process.env, request = null, resolvedAccount = null }) {
	let acct = resolvedAccount;
	let req = request;
	if (!acct || !req) {
		const resolved = await resolveAccount(account, env);
		acct = acct || resolved.account;
		req = req || resolved.request;
	}
	const path = `users/${acct.userId}/mentions`;
	const pageCap = sinceId ? Math.max(1, Math.round(maxPages)) : 1;

	const byId = new Map();
	const partialErrors = [];
	let newestId = null;
	let token = null;
	let pages = 0;
	let rateLimit = null;
	let lastHeaders = {};
	let truncated = false;

	for (;;) {
		const res = await req(path, mentionsQuery({ sinceId, maxResults, paginationToken: token }));
		rateLimit = readRateLimit(res.headers);
		lastHeaders = plainHeaders(res.headers);
		if (res.status < 200 || res.status >= 300) throw classifyMentionsError(res);
		pages += 1;
		const body = res.body || {};
		// X answers 200 with a partial `errors` array when a referenced post is
		// deleted or protected; the mention itself is still good.
		if (Array.isArray(body.errors)) partialErrors.push(...body.errors.map((e) => ({ title: e?.title || null, detail: e?.detail || null, resourceId: e?.resource_id || e?.value || null })));
		for (const m of normalizeMentions(body, acct)) byId.set(m.id, m);
		const meta = body.meta || {};
		if (meta.newest_id && (!newestId || compareIds(meta.newest_id, newestId) > 0)) newestId = String(meta.newest_id);
		token = meta.next_token || null;
		if (!token) break;
		if (pages >= pageCap) {
			truncated = !!sinceId;
			break;
		}
	}

	const mentions = [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
	return { account: acct, mentions, newestId: newestId || (sinceId ? String(sinceId) : null), pages, truncated, rateLimit, headers: lastHeaders, partialErrors };
}

/**
 * Look accounts up by username (GET /2/users/by). Returns the ones X knows;
 * a name X does not return is simply absent. Throws the classified X error on
 * a refusal so the caller can keep its cache and record the outcome.
 *
 * @param {{ usernames: string[], request: (path: string, query: Record<string,string>) => Promise<{ status: number, headers: object, body: any }> }} o
 * @returns {Promise<{ id: string, username: string, createdAt: string|null }[]>}
 */
export async function lookupUsersByUsername({ usernames, request }) {
	const names = [...new Set((usernames || []).map((n) => String(n).replace(/^@/, '').trim()).filter((n) => /^\w{1,15}$/.test(n)))];
	if (!names.length) return [];
	const res = await request('users/by', { usernames: names.join(','), 'user.fields': 'created_at,username' });
	if (res.status < 200 || res.status >= 300) throw classifyMentionsError(res);
	return (Array.isArray(res.body?.data) ? res.body.data : [])
		.filter((u) => u?.id && u?.username)
		.map((u) => ({ id: String(u.id), username: String(u.username), createdAt: u.created_at || null }));
}
