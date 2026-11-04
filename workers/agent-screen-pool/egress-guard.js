// egress-guard.js, the caster's request-level SSRF guard.
//
// The pool's Chromium is steerable by agent owners (a control lease lets them
// click, type and navigate) and its pixels are streamed to the public wall, so
// any byte the browser can fetch is effectively readable by the lease holder. A
// check on the typed URL alone is not enough: a public page can redirect to
// http://169.254.169.254, a public hostname can resolve (or later rebind) to
// 10.x, and any page can pull subresources or open websockets to internal hosts.
//
// This module closes those paths at the browser context:
//   1. context.route('**/*') sees EVERY request Chromium makes (main frame,
//      each redirect hop, iframes, subresources, fetch/XHR). The hostname is
//      resolved with dns.promises.lookup({ all: true }) and the request is
//      aborted if ANY returned address is non-public. Verdicts are cached per
//      hostname for a few seconds to bound DNS cost.
//   2. context.routeWebSocket applies the same check to websocket upgrades.
//   3. Every response's connected address (response.serverAddr()) is checked.
//      Chromium resolves names itself after our check, so a rebinding resolver
//      could still steer the socket to a private address; when that happens the
//      caller is told (onViolation, kind 'response') and tears the page down so
//      no further frame of it is ever cast.
//
// The worker is deployed standalone and cannot import repo code, so the
// address policy below is a byte-identical copy of the block in
// src/shared/agent-screen-control.js (tests/agent-screen-egress-guard.test.js
// fails on drift).

import { lookup as dnsLookup } from 'node:dns/promises';

// ── egress-guard:address-policy:start ──
// Resolved-address policy, shared byte-for-byte by the API sanitizer
// (src/shared/agent-screen-control.js) and the caster worker
// (workers/agent-screen-pool/egress-guard.js). tests/agent-screen-egress-guard.test.js
// fails if the two copies drift. Pure and dependency-free so the browser bundle
// can import it too. An address is public only when it falls in none of the
// ranges below; IPv6 forms that embed an IPv4 address (mapped, NAT64, 6to4) are
// judged by the embedded IPv4 address.

const V4_BLOCKED = [
	['0.0.0.0', 8],        // this network
	['10.0.0.0', 8],       // private
	['100.64.0.0', 10],    // carrier-grade NAT
	['127.0.0.0', 8],      // loopback
	['169.254.0.0', 16],   // link-local, cloud metadata
	['172.16.0.0', 12],    // private
	['192.0.0.0', 24],     // IETF protocol assignments
	['192.0.2.0', 24],     // documentation
	['192.88.99.0', 24],   // 6to4 relay anycast
	['192.168.0.0', 16],   // private
	['198.18.0.0', 15],    // benchmarking
	['198.51.100.0', 24],  // documentation
	['203.0.113.0', 24],   // documentation
	['224.0.0.0', 4],      // multicast
	['240.0.0.0', 4],      // reserved, broadcast
];

const V6_BLOCKED = [
	['::', 96],            // unspecified, loopback, IPv4-compatible
	['64:ff9b:1::', 48],   // local-use NAT64
	['100::', 64],         // discard-only
	['2001::', 32],        // Teredo
	['2001:db8::', 32],    // documentation
	['fc00::', 7],         // unique local
	['fe80::', 10],        // link-local
	['fec0::', 10],        // site-local (deprecated)
	['ff00::', 8],         // multicast
];

function parseIpv4(s) {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
	if (!m) return null;
	const p = m.slice(1).map(Number);
	if (p.some((n) => n > 255)) return null;
	return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

// IPv6 text to eight 16-bit groups, or null. Accepts '::' compression, a zone
// suffix (fe80::1%eth0) and a dotted IPv4 tail (::ffff:10.0.0.1).
function parseIpv6(s) {
	let str = s.replace(/%.*$/, '');
	if (!str.includes(':')) return null;
	const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(str);
	if (tail) {
		const v4 = parseIpv4(tail[1]);
		if (v4 === null) return null;
		str = `${str.slice(0, -tail[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
	}
	const halves = str.split('::');
	if (halves.length > 2) return null;
	const part = (h) => (h ? h.split(':') : []);
	const head = part(halves[0]);
	const rest = halves.length === 2 ? part(halves[1]) : [];
	const fill = 8 - head.length - rest.length;
	if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
	const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest];
	const out = [];
	for (const g of groups) {
		if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
		out.push(parseInt(g, 16));
	}
	return out;
}

function v4InRange(n, [base, bits]) {
	const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
	return ((n & mask) >>> 0) === ((parseIpv4(base) & mask) >>> 0);
}

function v6InRange(g, [base, bits]) {
	const b = parseIpv6(base);
	for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
		const take = Math.min(16, bits);
		const mask = (0xffff << (16 - take)) & 0xffff;
		if ((g[i] & mask) !== (b[i] & mask)) return false;
	}
	return true;
}

const isPublicV4 = (n) => !V4_BLOCKED.some((r) => v4InRange(n, r));

export function isAddressAllowed(ip) {
	let s = String(ip ?? '').trim().toLowerCase();
	if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
	if (!s) return false;
	const v4 = parseIpv4(s);
	if (v4 !== null) return isPublicV4(v4);
	const g = parseIpv6(s);
	if (!g) return false;
	const embedded = (hi, lo) => ((g[hi] << 16) | g[lo]) >>> 0;
	// ::ffff:a.b.c.d (mapped) and 64:ff9b::a.b.c.d (well-known NAT64).
	if (v6InRange(g, ['::ffff:0:0', 96]) || v6InRange(g, ['64:ff9b::', 96])) return isPublicV4(embedded(6, 7));
	// 2002:aabb:ccdd::/48, 6to4 carries the IPv4 address in groups 1-2.
	if (v6InRange(g, ['2002::', 16])) return isPublicV4(embedded(1, 2));
	return !V6_BLOCKED.some((r) => v6InRange(g, r));
}

// Literal host check on a parsed URL hostname. The WHATWG URL parser has already
// folded decimal, octal, hex and short IPv4 forms into dotted quads and IPv6 into
// canonical hex, so a literal is judged exactly like a resolved address.
export function isHostLiteralAllowed(hostname) {
	let host = String(hostname || '').toLowerCase().replace(/\.$/, '');
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
	if (!host) return false;
	if (host === 'localhost' || host.endsWith('.localhost')) return false;
	if (host === 'metadata.google.internal' || host.endsWith('.internal')) return false;
	if (host.includes(':') || parseIpv4(host) !== null) return isAddressAllowed(host);
	return true;
}

export function isNavAllowed(rawUrl) {
	let u;
	try {
		u = new URL(String(rawUrl));
	} catch {
		return false;
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
	return isHostLiteralAllowed(u.hostname);
}
// ── egress-guard:address-policy:end ──

export class EgressBlockedError extends Error {
	constructor(host, reason) {
		super(`egress blocked: ${host} (${reason})`);
		this.name = 'EgressBlockedError';
		this.host = host;
		this.reason = reason;
	}
}

function normalizeHost(hostname) {
	let host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
	return host;
}

const isIpLiteral = (host) => host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

// Resolve a hostname and require every address it maps to be public. Returns
// the resolved addresses; throws EgressBlockedError otherwise (including when
// the name does not resolve: fail closed, Chromium could not load it anyway).
export async function assertResolvedPublic(hostname, { lookup = dnsLookup } = {}) {
	const host = normalizeHost(hostname);
	if (!host) throw new EgressBlockedError(String(hostname), 'empty host');
	if (isIpLiteral(host)) {
		if (!isAddressAllowed(host)) throw new EgressBlockedError(host, 'non-public address');
		return [host];
	}
	if (!isHostLiteralAllowed(host)) throw new EgressBlockedError(host, 'reserved name');
	let addrs;
	try {
		addrs = await lookup(host, { all: true, verbatim: true });
	} catch (err) {
		throw new EgressBlockedError(host, `unresolvable: ${err?.code || err?.message || err}`);
	}
	if (!Array.isArray(addrs) || !addrs.length) throw new EgressBlockedError(host, 'no addresses');
	for (const a of addrs) {
		if (!isAddressAllowed(a.address)) throw new EgressBlockedError(host, `resolves to non-public ${a.address}`);
	}
	return addrs.map((a) => a.address);
}

// Schemes that never leave the process: allowed without a network check.
const INERT = new Set(['data:', 'blob:', 'about:']);
const NETWORK = new Set(['http:', 'https:', 'ws:', 'wss:']);

// Build a guard. trustedHosts are exact `host[:port]` values the operator
// configured (the pool's own BASE_URL), allowed without resolution so a local
// BASE_URL=http://localhost:3000 still works; production BASE_URL is public.
export function createEgressGuard({
	lookup = dnsLookup,
	ttlMs = 5_000,
	trustedHosts = [],
	now = () => Date.now(),
	maxEntries = 1_000,
} = {}) {
	const trusted = new Set(trustedHosts.map((h) => String(h).toLowerCase()));
	const cache = new Map(); // host -> { at, verdict: Promise<{ok, reason}> }

	function verdictFor(host) {
		const t = now();
		const hit = cache.get(host);
		if (hit && t - hit.at < ttlMs) return hit.verdict;
		if (cache.size >= maxEntries) cache.clear();
		const verdict = assertResolvedPublic(host, { lookup }).then(
			() => ({ ok: true, reason: null }),
			(err) => ({ ok: false, reason: err?.message || String(err) }),
		);
		cache.set(host, { at: t, verdict });
		return verdict;
	}

	async function checkUrl(rawUrl) {
		let u;
		try { u = new URL(String(rawUrl)); } catch { return { ok: false, reason: 'unparseable url' }; }
		if (INERT.has(u.protocol)) return { ok: true, reason: null };
		if (!NETWORK.has(u.protocol)) return { ok: false, reason: `scheme ${u.protocol} not allowed` };
		if (trusted.has(u.host.toLowerCase())) return { ok: true, reason: null };
		return verdictFor(normalizeHost(u.hostname));
	}

	function isTrustedUrl(rawUrl) {
		try { return trusted.has(new URL(String(rawUrl)).host.toLowerCase()); } catch { return false; }
	}

	const pageOf = (obj) => {
		try { return obj.frame()?.page() ?? null; } catch { return null; }
	};

	async function install(context, { onViolation } = {}) {
		const report = (v) => { try { onViolation?.(v); } catch { /* reporter must never break routing */ } };

		await context.route('**/*', async (route) => {
			const request = route.request();
			const url = request.url();
			const v = await checkUrl(url);
			if (!v.ok) {
				report({ kind: 'request', url, reason: v.reason, page: pageOf(request) });
				await route.abort('blockedbyclient').catch(() => {});
				return;
			}
			await route.continue().catch(() => {});
		});

		if (typeof context.routeWebSocket === 'function') {
			await context.routeWebSocket(/.*/, async (ws) => {
				const url = ws.url();
				const v = await checkUrl(url);
				if (!v.ok) {
					report({ kind: 'websocket', url, reason: v.reason, page: null });
					await ws.close({ code: 1008, reason: 'blocked by egress guard' });
					return;
				}
				ws.connectToServer();
			});
		}

		context.on('response', async (response) => {
			const url = response.url();
			if (isTrustedUrl(url)) return;
			const addr = await response.serverAddr().catch(() => null);
			if (!addr?.ipAddress) return; // served from cache or memory: no socket
			if (isAddressAllowed(addr.ipAddress)) return;
			report({ kind: 'response', url, address: addr.ipAddress, reason: 'connected to non-public address', page: pageOf(response) });
		});
	}

	return { checkUrl, install, isTrustedUrl };
}
