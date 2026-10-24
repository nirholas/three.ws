// Summary-first MCP results with on-demand expansion.
//
// A tool that can return hundreds of rows (a market-data list, an account's
// agents, a memory recall) used to put every row into the model's context on
// every call, in both the text block and structuredContent. This module lets
// such a tool answer with a compact envelope instead:
//
//   { summary, handle, count, offset, limit, next_offset, items: <first page> }
//
// and park the full list server-side. The caller reads the summary, and only
// when it needs more calls the `expand` tool (api/_mcp/tools/expand.js) with the
// handle and a page or a field selector.
//
// A handle is `mx1.<payload>.<signature>`:
//   - signed with HMAC-SHA256 under JWT_SECRET, so it cannot be forged or edited;
//   - bound to the principal that received it (account or API key), so a handle
//     passed to another account is refused exactly like a forged one;
//   - short-lived (HANDLE_TTL_SECONDS): the list lives in the shared cache
//     (Redis in production) and the signature carries the same deadline, so an
//     expired handle fails cleanly and tells the caller to re-run the tool.
//
// A result that already fits one page, or that is for a caller with no stable
// identity (anonymous, or a pay-per-call x402 principal who paid for the whole
// answer), is returned unchanged. The envelope is a context saver, never a gate.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { cacheGetFresh, cacheSet } from './cache.js';
import { env } from './env.js';

export const HANDLE_PREFIX = 'mx1.';
export const HANDLE_TTL_SECONDS = 15 * 60;
export const MAX_STORED_ITEMS = 2000;
export const MAX_PAGE = 100;

const CACHE_KEY = (id) => `mcp:expand:${id}`;

/** Stable identity a handle is bound to, or null when the caller has none. */
export function principalKey(auth) {
	if (auth?.source === 'x402') return null;
	if (auth?.userId) return `user:${auth.userId}`;
	if (auth?.apiKeyId) return `key:${auth.apiKeyId}`;
	return null;
}

function sign(payload) {
	return createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

function principalHash(principal) {
	return createHash('sha256').update(principal).digest('base64url').slice(0, 22);
}

function encodeHandle({ id, principal, tool, exp }) {
	const payload = Buffer.from(JSON.stringify({ i: id, p: principalHash(principal), t: tool, e: exp }), 'utf8').toString('base64url');
	return `${HANDLE_PREFIX}${payload}.${sign(payload)}`;
}

/**
 * Verify a handle's signature and shape. Returns the claims or null. Does not
 * check the principal or the clock: expand does, so it can answer each failure
 * with its own message.
 */
export function decodeHandle(handle) {
	if (typeof handle !== 'string' || !handle.startsWith(HANDLE_PREFIX) || handle.length > 600) return null;
	const rest = handle.slice(HANDLE_PREFIX.length);
	const dot = rest.indexOf('.');
	if (dot < 1 || dot === rest.length - 1) return null;
	const payload = rest.slice(0, dot);
	const sig = rest.slice(dot + 1);
	try {
		const expected = Buffer.from(sign(payload), 'utf8');
		const actual = Buffer.from(sig, 'utf8');
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
		const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		if (!obj?.i || !obj?.p || !obj?.t || !Number.isFinite(obj.e)) return null;
		return { id: String(obj.i), principal: String(obj.p), tool: String(obj.t), exp: obj.e };
	} catch {
		return null;
	}
}

/** Approximate token count: the common four-characters-per-token estimate. */
export function approxTokens(value) {
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	return Math.ceil((text || '').length / 4);
}

export function clip(text, max) {
	const t = String(text ?? '').replace(/\s+/g, ' ').trim();
	return t.length > max ? `${t.slice(0, max - 1)}...` : t;
}

function pageText({ summary, items, renderItem, offset, count, handle }) {
	const lines = items.map((item, i) => (renderItem ? renderItem(item, offset + i) : JSON.stringify(item)));
	const end = offset + items.length;
	const more =
		end < count
			? `Showing ${offset + 1}-${end} of ${count}. Call expand with handle "${handle}" and offset ${end} for the next page, or pass fields to narrow each row.`
			: `Showing ${offset + 1}-${end} of ${count}. That is the end of the list.`;
	return [summary, '', ...lines, '', more].join('\n');
}

/**
 * Answer with a summary-first envelope when the list is longer than one page.
 *
 * @param {object} o
 * @param {string} o.tool       tool name the list came from
 * @param {object} o.auth       the MCP auth context
 * @param {Array}  o.items      the full list
 * @param {number} o.pageSize   rows in the first page and the default expand page
 * @param {string} o.summary    one or two lines describing the WHOLE list
 * @param {Function} [o.renderItem] (item, index) => one line of text for the page
 * @param {object} [o.extra]    extra keys merged into structuredContent
 * @returns {Promise<object|null>} an MCP tool result, or null when the caller should return the full list
 */
export async function summarizeList({ tool, auth, items, pageSize, summary, renderItem, extra = {} }) {
	const principal = principalKey(auth);
	if (!principal || !Array.isArray(items) || items.length <= pageSize) return null;

	const stored = items.slice(0, MAX_STORED_ITEMS);
	const id = randomBytes(12).toString('base64url');
	const exp = Date.now() + HANDLE_TTL_SECONDS * 1000;
	await cacheSet(CACHE_KEY(id), { p: principalHash(principal), t: tool, ps: pageSize, items: stored }, HANDLE_TTL_SECONDS);
	const handle = encodeHandle({ id, principal, tool, exp });

	const page = stored.slice(0, pageSize);
	const count = stored.length;
	const structured = {
		...extra,
		...(items.length > stored.length ? { total_available: items.length, truncated_to: stored.length } : {}),
		summary,
		handle,
		count,
		offset: 0,
		limit: pageSize,
		next_offset: pageSize < stored.length ? pageSize : null,
		expires_at: new Date(exp).toISOString(),
		items: page,
	};
	return {
		content: [{ type: 'text', text: pageText({ summary, items: page, renderItem, offset: 0, count, handle }) }],
		structuredContent: structured,
	};
}

function refusal(code, message) {
	return {
		content: [{ type: 'text', text: message }],
		isError: true,
		structuredContent: { error: code, message },
	};
}

function pick(item, fields) {
	if (!fields?.length || item === null || typeof item !== 'object') return item;
	const out = {};
	for (const path of fields) {
		const parts = String(path).split('.');
		let src = item;
		for (const p of parts) {
			if (src === null || typeof src !== 'object' || !Object.hasOwn(src, p)) {
				src = undefined;
				break;
			}
			src = src[p];
		}
		if (src === undefined) continue;
		let dst = out;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!Object.hasOwn(dst, parts[i]) || typeof dst[parts[i]] !== 'object') dst[parts[i]] = {};
			dst = dst[parts[i]];
		}
		dst[parts[parts.length - 1]] = src;
	}
	return out;
}

/**
 * Resolve a handle to one page of its list. Every failure is a designed
 * isError result: an invalid or foreign handle is one opaque message, so a
 * caller learns nothing about which handles exist.
 */
export async function expandHandle({ handle, offset = 0, limit, fields, auth, now = Date.now() }) {
	const principal = principalKey(auth);
	if (!principal) {
		return refusal('sign_in_required', 'Sign in with three.ws OAuth or an API key to expand a result. Handles belong to the account that received them.');
	}
	const claims = decodeHandle(handle);
	if (!claims || claims.principal !== principalHash(principal)) {
		return refusal('invalid_handle', 'That handle is not valid for this account. Handles come from a tool result that returned one, and only the account that received it can expand it.');
	}
	if (claims.exp <= now) {
		return refusal('handle_expired', `That handle expired. Handles last ${Math.round(HANDLE_TTL_SECONDS / 60)} minutes. Call ${claims.tool} again to get a fresh one.`);
	}
	const record = await cacheGetFresh(CACHE_KEY(claims.id));
	if (!record || record.p !== claims.principal || record.t !== claims.tool || !Array.isArray(record.items)) {
		return refusal('handle_expired', `That result is no longer stored. Call ${claims.tool} again to get a fresh handle.`);
	}

	const total = record.items.length;
	const start = Math.min(Math.max(Number(offset) || 0, 0), total);
	const size = Math.min(Math.max(Number(limit) || record.ps || 10, 1), MAX_PAGE);
	const slice = record.items.slice(start, start + size).map((item) => pick(item, fields));
	const end = start + slice.length;
	const structured = {
		handle,
		tool: claims.tool,
		count: total,
		offset: start,
		limit: size,
		next_offset: end < total ? end : null,
		items: slice,
	};
	const tail = end < total ? ` Next: offset ${end}.` : ' End of list.';
	const head = slice.length ? `${claims.tool}: rows ${start + 1}-${end} of ${total}.` : `${claims.tool}: no rows at offset ${start}, the list has ${total}.`;
	return {
		content: [{ type: 'text', text: `${head}${tail}\n${JSON.stringify(slice)}` }],
		structuredContent: structured,
	};
}
