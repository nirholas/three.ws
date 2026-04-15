// SSRF-hardened model fetcher.
//
// Arbitrary URL fetching from a server reachable by the internet is a classic
// SSRF vector: an attacker can point "url" at internal metadata endpoints
// (169.254.169.254 on AWS/GCP), private RFC1918 ranges, or loopback and we'd
// happily proxy the response back to them. Defenses here:
//   1. Scheme allowlist — only https by default (http permitted in dev).
//   2. DNS resolution happens on OUR side, and the resolved address is
//      checked against an IP blocklist before the connection is opened.
//   3. Follow redirects manually, re-validating the target host each hop.
//   4. Size limit — we stop reading after N bytes.
//   5. Timeout — total request + streaming is bounded.

import { lookup } from 'node:dns/promises';
import { env } from './env.js';

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

const IS_DEV = env.NODE_ENV !== 'production';

export class FetchModelError extends Error {
	constructor(message, code = 'fetch_failed') {
		super(message);
		this.code = code;
	}
}

function isPrivateIPv4(ip) {
	const p = ip.split('.').map(Number);
	if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
	if (p[0] === 10) return true;
	if (p[0] === 127) return true;
	if (p[0] === 0) return true;
	if (p[0] === 169 && p[1] === 254) return true; // link-local, cloud metadata
	if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
	if (p[0] === 192 && p[1] === 168) return true;
	if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true; // IETF
	if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true; // docs
	if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true; // benchmark
	if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true; // docs
	if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true; // docs
	if (p[0] >= 224) return true; // multicast + reserved
	return false;
}

function isPrivateIPv6(ip) {
	const lower = ip.toLowerCase();
	if (lower === '::' || lower === '::1') return true;
	if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
	if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
	if (lower.startsWith('::ffff:')) {
		const mapped = lower.replace(/^::ffff:/, '');
		if (/^\d+\.\d+\.\d+\.\d+$/.test(mapped)) return isPrivateIPv4(mapped);
	}
	if (lower.startsWith('2001:db8:')) return true; // docs
	return false;
}

async function assertPublicHost(host) {
	if (!host) throw new FetchModelError('missing host', 'invalid_url');
	let resolved;
	try {
		resolved = await lookup(host, { all: true });
	} catch (e) {
		throw new FetchModelError(`DNS lookup failed for ${host}`, 'dns_failed');
	}
	const addrs = Array.isArray(resolved) ? resolved : [resolved];
	for (const { address, family } of addrs) {
		if (family === 4 && isPrivateIPv4(address)) {
			throw new FetchModelError(`host resolves to private address: ${address}`, 'private_address');
		}
		if (family === 6 && isPrivateIPv6(address)) {
			throw new FetchModelError(`host resolves to private address: ${address}`, 'private_address');
		}
	}
}

function validateUrl(rawUrl) {
	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new FetchModelError('invalid URL', 'invalid_url');
	}
	if (url.protocol !== 'https:' && !(IS_DEV && url.protocol === 'http:')) {
		throw new FetchModelError(`scheme not allowed: ${url.protocol}`, 'scheme_not_allowed');
	}
	return url;
}

/**
 * Fetch bytes from an untrusted URL with SSRF protection.
 *
 * @param {string} rawUrl
 * @param {{ maxBytes?: number, timeoutMs?: number }} opts
 * @returns {Promise<{ bytes: Uint8Array, url: string, contentType: string, filename: string }>}
 */
export async function fetchModel(rawUrl, opts = {}) {
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	let currentUrl = validateUrl(rawUrl);
	let redirects = 0;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		while (true) {
			await assertPublicHost(currentUrl.hostname);

			const res = await fetch(currentUrl, {
				method: 'GET',
				redirect: 'manual',
				signal: controller.signal,
				headers: {
					'user-agent': '3d-agent-mcp/1.0 (+https://3dagent.vercel.app)',
					accept: 'model/gltf-binary, model/gltf+json, application/octet-stream, */*;q=0.5',
				},
			});

			if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
				if (++redirects > MAX_REDIRECTS) {
					throw new FetchModelError('too many redirects', 'too_many_redirects');
				}
				const next = new URL(res.headers.get('location'), currentUrl);
				currentUrl = validateUrl(next.toString());
				continue;
			}

			if (!res.ok) {
				throw new FetchModelError(`upstream returned ${res.status}`, 'upstream_error');
			}

			const lenHeader = res.headers.get('content-length');
			if (lenHeader && Number(lenHeader) > maxBytes) {
				throw new FetchModelError(
					`file too large (${lenHeader} > ${maxBytes} bytes)`,
					'file_too_large',
				);
			}

			const reader = res.body?.getReader();
			if (!reader) throw new FetchModelError('no response body', 'no_body');

			const chunks = [];
			let received = 0;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				received += value.byteLength;
				if (received > maxBytes) {
					try {
						reader.cancel();
					} catch {}
					throw new FetchModelError(
						`file exceeded ${maxBytes} bytes during download`,
						'file_too_large',
					);
				}
				chunks.push(value);
			}

			const bytes = new Uint8Array(received);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}

			const contentType = res.headers.get('content-type') || 'application/octet-stream';
			const filename = currentUrl.pathname.split('/').pop() || 'model';

			return {
				bytes,
				url: currentUrl.toString(),
				contentType,
				filename,
			};
		}
	} finally {
		clearTimeout(timer);
	}
}
