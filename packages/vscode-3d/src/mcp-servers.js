// The three.ws MCP servers this extension hands to VS Code.
//
// Two hosted servers, both over Streamable HTTP:
//   - /api/mcp-studio: the free 3D tools (text to 3D, rigging, the catalog,
//     docs search). No key, no account, so it is always registered.
//   - /api/mcp: the account server (your agents, wallets, paid tools). It is
//     registered once you sign in, either with VS Code's own OAuth flow (the
//     server advertises its authorization server, so VS Code runs the browser
//     sign-in and stores the token itself) or with an API key from
//     three.ws/dashboard/api, kept in VS Code's secret storage.
//
// Pure: no vscode import, so the list VS Code receives is tested directly.

import { normalizeOrigin } from './studio.js';

export const MCP_PROVIDER_ID = 'threews3d.mcp';
export const KEY_PATTERN = /^sk_(live|test)_[A-Za-z0-9_-]{8,}$/;

/**
 * @typedef {{ mode: 'oauth' } | { mode: 'key', key: string } | null} Account
 * @typedef {{ label: string, uri: string, headers: Record<string, string>, version?: string }} ServerSpec
 */

/**
 * The servers to register, in the order VS Code lists them.
 * @param {{ origin: string, account: Account, version?: string }} opts
 * @returns {ServerSpec[]}
 */
export function serverList({ origin, account, version }) {
	const base = normalizeOrigin(origin);
	const servers = [{ label: 'three.ws Studio (free)', uri: `${base}/api/mcp-studio`, headers: {}, version }];
	if (account?.mode === 'oauth') {
		servers.push({ label: 'three.ws account', uri: `${base}/api/mcp`, headers: {}, version });
	} else if (account?.mode === 'key' && account.key) {
		servers.push({ label: 'three.ws account', uri: `${base}/api/mcp`, headers: { Authorization: `Bearer ${account.key}` }, version });
	}
	return servers;
}

/**
 * Check an API key against the account server before storing it.
 *
 * A tools/list with the key as a Bearer token is the cheapest authenticated
 * call: 401 means the key is wrong or revoked, 200 means it works.
 *
 * @returns {Promise<{ ok: boolean, message: string, tools?: number }>}
 */
export async function validateApiKey(origin, key, { signal, timeoutMs = 20_000 } = {}) {
	const trimmed = String(key || '').trim();
	if (!KEY_PATTERN.test(trimmed)) {
		return { ok: false, message: 'three.ws API keys start with sk_live_ (create one at three.ws/dashboard/api)' };
	}
	const url = `${normalizeOrigin(origin)}/api/mcp`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onAbort = () => controller.abort();
	signal?.addEventListener('abort', onAbort, { once: true });
	let res;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${trimmed}` },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			signal: controller.signal,
		});
	} catch (err) {
		if (signal?.aborted) return { ok: false, message: 'cancelled' };
		return { ok: false, message: `could not reach ${url}: ${controller.signal.aborted ? 'no answer in time' : err?.message || err}` };
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
	if (res.status === 401 || res.status === 403) {
		return { ok: false, message: 'three.ws rejected that key: it is wrong, revoked or expired. Create a new one at three.ws/dashboard/api.' };
	}
	if (!res.ok) return { ok: false, message: `the account server returned HTTP ${res.status}; try again in a moment` };
	const body = await res.json().catch(() => null);
	const tools = Array.isArray(body?.result?.tools) ? body.result.tools.length : undefined;
	return { ok: true, message: tools ? `key accepted, ${tools} account tools available` : 'key accepted', tools };
}
