// The only fetch that ever talks to an external MCP server or its OAuth
// endpoints.
//
// An agent owner can point a connection at any URL, so every byte this module
// sends is a server-side request to an address someone else chose. The defense
// is enforced where it cannot be raced: the undici dispatcher's DNS lookup
// resolves the host itself and refuses to hand a private, loopback, link-local
// or metadata address to the socket. The address that is checked is the
// address that is connected to, so DNS rebinding has no window, and every
// redirect hop goes through the same lookup.
//
// Two more rules ride on top:
//   • https only (http is allowed outside production, for a local test server).
//   • No standing stream. The Streamable HTTP transport opens a GET event stream
//     after initialize so a server can push notifications. A server-side agent
//     turn has nothing to receive there, and an open stream would pin the
//     instance until it timed out, so a GET for `text/event-stream` on a
//     streamable connection is answered locally with the 405 the MCP spec
//     defines for "this server offers no stream". The legacy SSE transport needs
//     its stream (responses arrive on it) and is left alone.

import { lookup } from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';
import { isPrivateAddress } from '../ssrf.js';

const IS_PROD = process.env.NODE_ENV === 'production';

/** Per-request ceiling for anything that is not the legacy SSE stream. */
export const REQUEST_TIMEOUT_MS = 25_000;

export class BlockedUrlError extends Error {
	constructor(message) {
		super(message);
		this.name = 'BlockedUrlError';
		this.code = 'blocked_url';
	}
}

function validatingLookup(hostname, options, cb) {
	lookup(hostname, { all: true }, (err, addresses) => {
		if (err) return cb(err);
		const list = Array.isArray(addresses) ? addresses : [addresses];
		const blocked = list.find((a) => isPrivateAddress(a.address, a.family));
		if (blocked || !list.length) {
			return cb(new BlockedUrlError(`${hostname} resolves to a private address; external MCP servers must be public`));
		}
		if (options && options.all) return cb(null, list);
		return cb(null, list[0].address, list[0].family);
	});
}

const dispatcher = new Agent({
	connect: { lookup: validatingLookup, timeout: 10_000 },
	keepAliveTimeout: 10_000,
});

/**
 * Parse and scheme-check a server URL. Throws BlockedUrlError.
 * @param {string|URL} raw
 * @returns {URL}
 */
export function assertServerUrl(raw) {
	let url;
	try {
		url = new URL(String(raw || '').trim());
	} catch {
		throw new BlockedUrlError('not a valid URL');
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !IS_PROD)) {
		throw new BlockedUrlError('external MCP servers must use https://');
	}
	if (url.username || url.password) throw new BlockedUrlError('credentials in the URL are not accepted; use the token field');
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (IS_PROD && /^(localhost|.+\.local|.+\.internal)$/i.test(host)) {
		throw new BlockedUrlError('local hostnames are not reachable from three.ws');
	}
	return url;
}

function combineSignals(signal, timeoutMs) {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Build a fetch for one connection.
 * @param {{ transport?: string }} [opts]
 * @returns {(input: string|URL|Request, init?: RequestInit) => Promise<Response>}
 */
export function createSafeFetch({ transport = 'streamable-http' } = {}) {
	return async function safeFetch(input, init = {}) {
		const url = assertServerUrl(typeof input === 'string' || input instanceof URL ? input : input.url);
		const method = String(init.method || 'GET').toUpperCase();
		const headers = new Headers(init.headers || {});
		const wantsStream = method === 'GET' && (headers.get('accept') || '').includes('text/event-stream');

		if (wantsStream && transport === 'streamable-http') {
			return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
		}
		if (!headers.has('user-agent')) {
			headers.set('user-agent', 'three.ws-agent-integrations/1.0 (+https://three.ws/integrations/mcp)');
		}

		const res = await undiciFetch(url, {
			...init,
			headers,
			dispatcher,
			// The legacy SSE stream lives as long as the session; the caller closes it.
			signal: wantsStream ? init.signal : combineSignals(init.signal, REQUEST_TIMEOUT_MS),
		});
		return /** @type {Response} */ (/** @type {unknown} */ (res));
	};
}
