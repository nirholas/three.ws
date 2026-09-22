// Bounded, SSRF-safe downloads for gateway tools that read a caller-named URL
// (web_fetch, parse_document, transcribe).
//
// Every hop is DNS-resolved and checked against private, loopback, link-local
// and metadata ranges, and the socket is pinned to the validated address so a
// rebinding DNS server cannot swap it between the check and the connect
// (api/_lib/ssrf-guard.js fetchSafePublicUrlPinned). The body is capped while
// it streams, so a hostile host cannot exhaust instance memory.

import { fetchSafePublicUrlPinned, SsrfBlockedError, MaxBytesExceededError } from '../ssrf-guard.js';
import { GatewayError } from './errors.js';

const USER_AGENT = 'three.ws-tool-gateway/1.0 (+https://three.ws/docs/tool-gateway)';

/**
 * @param {string} url
 * @param {{ maxBytes: number, timeoutMs?: number, accept?: string }} o
 * @returns {Promise<{ body: Buffer, contentType: string, status: number }>}
 */
export async function downloadPublic(url, { maxBytes, timeoutMs = 20_000, accept = '*/*' }) {
	let res;
	try {
		res = await fetchSafePublicUrlPinned(
			String(url),
			{ headers: { 'user-agent': USER_AGENT, accept }, signal: AbortSignal.timeout(timeoutMs) },
			{ allowHttp: true, maxBytes },
		);
	} catch (err) {
		if (err instanceof SsrfBlockedError) {
			throw new GatewayError(400, 'url_not_public', `That URL is not publicly reachable: ${err.message}.`);
		}
		if (err instanceof MaxBytesExceededError) {
			throw new GatewayError(413, 'too_large', `That resource is larger than the ${Math.round(maxBytes / 1_048_576)} MB limit for this tool.`);
		}
		if (err?.name === 'TimeoutError' || /abort/i.test(String(err?.message))) {
			throw new GatewayError(504, 'upstream_timeout', `The site did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
		}
		throw new GatewayError(502, 'fetch_failed', `Could not fetch that URL: ${String(err?.message || err).slice(0, 200)}`);
	}
	if (res.status >= 400) {
		throw new GatewayError(502, 'upstream_status', `The site answered HTTP ${res.status}.`, { status: res.status });
	}
	const body = Buffer.from(await res.arrayBuffer());
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	return { body, contentType, status: res.status };
}

/** Decode a base64 (or data: URI) payload with a byte ceiling. */
export function decodeBase64Input(value, { maxBytes, field }) {
	const b64 = String(value || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
	if (!b64) throw new GatewayError(400, 'bad_request', `"${field}" is empty.`);
	if (Math.floor((b64.length * 3) / 4) > maxBytes) {
		throw new GatewayError(413, 'too_large', `"${field}" is larger than the ${Math.round(maxBytes / 1_048_576)} MB limit for this tool.`);
	}
	const buf = Buffer.from(b64, 'base64');
	if (!buf.length) throw new GatewayError(400, 'bad_request', `"${field}" is not valid base64.`);
	return buf;
}
