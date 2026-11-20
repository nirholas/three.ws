// Real HTTP access to the three.ws API. No mocks, no fixtures: every call is
// a live request to THREE_WS_BASE. Errors are normalized into a single shape so
// tool handlers can surface a clean message + status to the MCP client.

import { THREE_WS_BASE, HTTP_TIMEOUT_MS, USER_AGENT, THREE_WS_API_KEY, KEYS_URL } from '../config.js';

// three.ws answers 401 to a missing or refused key on every action that makes
// something. Both become one `sign_in_required` error that says what to do.
function signInRequired(refused) {
	const message = refused
		? `three.ws refused THREE_WS_API_KEY. Create a new key at ${KEYS_URL} and set it in this server's env.`
		: `Composing, building or exporting a world on three.ws needs a free account. Create an API key at ${KEYS_URL} and set THREE_WS_API_KEY in this server's env.`;
	return Object.assign(new Error(message), { code: 'sign_in_required', status: 401 });
}

/**
 * Call a three.ws HTTP endpoint and return its parsed JSON body.
 *
 * @param {string} path  Endpoint path beginning with `/` (e.g. `/api/diorama`).
 * @param {{ method?: string, query?: Record<string, unknown>, body?: unknown, timeoutMs?: number }} [opts]
 *   Every non-GET call makes something on three.ws, so it carries
 *   THREE_WS_API_KEY as a bearer and is refused locally, before any request,
 *   when no key is set. Reads stay keyless.
 *   `timeoutMs` overrides the default per-call timeout (THREE_WS_TIMEOUT_MS) for
 *   calls known to run long server-side work, e.g. a full compose+forge+export
 *   build, which chains several real generations. Every other call is unaffected.
 * @returns {Promise<any>} Parsed JSON response.
 * @throws {Error} with `.code` ('sign_in_required' | 'timeout' | 'network_error' | 'upstream_error'),
 *   and on upstream errors `.status` + `.body`.
 */
export async function apiRequest(path, { method = 'GET', query, body, timeoutMs } = {}) {
	const needsAccount = method !== 'GET';
	if (needsAccount && !THREE_WS_API_KEY) throw signInRequired(false);
	const url = new URL(`${THREE_WS_BASE}${path}`);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined || value === null || value === '') continue;
			url.searchParams.set(key, String(value));
		}
	}

	const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : HTTP_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), effectiveTimeout);

	let res;
	try {
		res = await fetch(url, {
			method,
			headers: {
				accept: 'application/json',
				'user-agent': USER_AGENT,
				...(needsAccount ? { authorization: `Bearer ${THREE_WS_API_KEY}` } : {}),
				...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});
	} catch (err) {
		clearTimeout(timer);
		if (err?.name === 'AbortError') {
			throw Object.assign(new Error(`three.ws ${path} timed out after ${effectiveTimeout}ms`), {
				code: 'timeout',
			});
		}
		throw Object.assign(new Error(`three.ws ${path} request failed: ${err?.message || err}`), {
			code: 'network_error',
		});
	}
	clearTimeout(timer);

	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { raw: text };
	}

	if (res.status === 401 && needsAccount) throw Object.assign(signInRequired(data?.error !== 'sign_in_required'), { body: data });
	if (!res.ok) {
		const message = data?.message || data?.error || `three.ws ${path} returned HTTP ${res.status}`;
		throw Object.assign(new Error(message), { code: 'upstream_error', status: res.status, body: data });
	}
	return data;
}
