// POST one tool call to an HQ deployment's /api/agent-tools. Real HTTP, no cache.

import { hqBase, HTTP_TIMEOUT_MS, USER_AGENT } from '../config.js';

/**
 * @param {{ tool?: string, args?: object, question?: string, narrate?: boolean }} body
 * @returns {Promise<any>}
 */
export async function callHq(body, { fetchImpl = fetch } = {}) {
	const url = new URL('/api/agent-tools', hqBase());
	let res;
	try {
		res = await fetchImpl(url, {
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': USER_AGENT },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
		});
	} catch (err) {
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
			throw Object.assign(new Error(`HQ timed out after ${HTTP_TIMEOUT_MS}ms`), { code: 'timeout' });
		}
		throw Object.assign(new Error(`HQ request failed: ${err?.message || err}`), { code: 'network_error' });
	}
	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { raw: text };
	}
	if (!res.ok) {
		throw Object.assign(new Error(data?.error || `HQ returned HTTP ${res.status}`), { code: 'upstream_error', status: res.status, body: data });
	}
	return data;
}
