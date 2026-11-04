// egress-guard.js, the caster's request-level SSRF guard.
//
// The pool's Chromium is steerable by agent owners (a control lease lets them
// click, type and navigate) and its pixels are streamed to the public wall, so
// any byte the browser can fetch is effectively readable by the lease holder. A
// check on the typed URL alone is not enough: a public page can redirect to
// http://169.254.169.254, a public hostname can resolve (or later rebind) to
// 10.x, and any page can pull subresources or open websockets to internal hosts.
//
// Two layers close those paths:
//   1. startEgressProxy: an in-process forward proxy that ALL of Chromium's
//      traffic goes through (loopback included). For every connection it
//      resolves the hostname itself with dns.promises.lookup({ all: true }),
//      refuses it when ANY returned address is non-public, and then connects to
//      the exact address it vetted. Each redirect hop is a fresh proxy request,
//      subresources, iframes, websockets and service-worker fetches all pass
//      through it, and because Chromium does no DNS of its own behind a proxy a
//      rebinding resolver has no second lookup to win.
//   2. install(context): context.route('**/*') and routeWebSocket re-check
//      every request Playwright surfaces and abort it early with
//      ERR_BLOCKED_BY_CLIENT, so a refused navigation fails fast and is logged
//      with the page that made it. (Playwright does not surface redirect hops to
//      route handlers; the proxy is what enforces those.)
// Verdicts are cached per hostname for a few seconds to bound DNS cost.
//
// The worker is deployed standalone and cannot import repo code, so the
// address policy below is a byte-identical copy of the block in
// src/shared/agent-screen-control.js (tests/agent-screen-egress-guard.test.js
// fails on drift).

import http from 'node:http';
import net from 'node:net';
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
// the name does not resolve: fail closed, nothing could load it anyway).
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
const DEFAULT_PORT = { 'http:': 80, 'ws:': 80, 'https:': 443, 'wss:': 443 };

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
	const cache = new Map(); // host -> { at, verdict: Promise<{ ok, reason, addresses }> }

	function verdictFor(host) {
		const t = now();
		const hit = cache.get(host);
		if (hit && t - hit.at < ttlMs) return hit.verdict;
		if (cache.size >= maxEntries) cache.clear();
		const verdict = assertResolvedPublic(host, { lookup }).then(
			(addresses) => ({ ok: true, reason: null, addresses }),
			(err) => ({ ok: false, reason: err?.message || String(err), addresses: [] }),
		);
		cache.set(host, { at: t, verdict });
		return verdict;
	}

	const isTrusted = (hostname, port, defaultPort) => {
		const h = String(hostname).toLowerCase();
		return trusted.has(`${h}:${port}`) || (Number(port) === defaultPort && trusted.has(h));
	};

	// Vet one connection target. Trusted hosts connect by name; everything else
	// connects to the first vetted address, never to a second resolution.
	async function resolveTarget(hostname, port, defaultPort) {
		if (isTrusted(hostname, port, defaultPort)) return { ok: true, reason: null, address: normalizeHost(hostname) };
		const v = await verdictFor(normalizeHost(hostname));
		return { ok: v.ok, reason: v.reason, address: v.addresses[0] || null };
	}

	async function checkUrl(rawUrl) {
		let u;
		try { u = new URL(String(rawUrl)); } catch { return { ok: false, reason: 'unparseable url' }; }
		if (INERT.has(u.protocol)) return { ok: true, reason: null };
		if (!NETWORK.has(u.protocol)) return { ok: false, reason: `scheme ${u.protocol} not allowed` };
		const def = DEFAULT_PORT[u.protocol];
		const { ok, reason } = await resolveTarget(u.hostname, u.port || def, def);
		return { ok, reason };
	}

	const pageOf = (request) => {
		try { return request.frame()?.page() ?? null; } catch { return null; }
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
	}

	return { checkUrl, resolveTarget, install };
}

// "host:port" or "[v6]:port" from a CONNECT request line.
function parseAuthority(authority) {
	const m = /^\[([^\]]+)\]:(\d{1,5})$/.exec(authority) || /^([^:]+):(\d{1,5})$/.exec(authority);
	if (!m) return null;
	const port = Number(m[2]);
	return port > 0 && port < 65536 ? { hostname: m[1], port } : null;
}

const BLOCKED_BODY = 'Blocked by the three.ws egress guard: this address is not on the public internet.\n';
const HOP_BY_HOP = new Set(['proxy-connection', 'proxy-authorization', 'keep-alive', 'connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

// Start the forward proxy Chromium is launched behind. Returns { url, port, close }.
// It listens on loopback only and serves nothing but proxied traffic.
export function startEgressProxy({ guard, host = '127.0.0.1', port = 0, onViolation, connectTimeoutMs = 15_000 } = {}) {
	if (!guard) throw new TypeError('startEgressProxy needs a guard from createEgressGuard()');
	const report = (v) => { try { onViolation?.(v); } catch { /* never let logging break the proxy */ } };
	const sockets = new Set();

	// Plain http:// requests arrive in absolute form (GET http://host/path).
	async function onRequest(req, res) {
		let u;
		try { u = new URL(req.url); } catch { u = null; }
		if (!u || u.protocol !== 'http:') {
			res.writeHead(400, { 'content-type': 'text/plain' });
			res.end('This proxy only forwards absolute http:// requests.\n');
			return;
		}
		const t = await guard.resolveTarget(u.hostname, u.port || 80, 80);
		if (!t.ok) {
			report({ kind: 'proxy', url: u.href, reason: t.reason });
			res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
			res.end(BLOCKED_BODY);
			return;
		}
		const headers = {};
		for (let i = 0; i < req.rawHeaders.length; i += 2) {
			const k = req.rawHeaders[i];
			if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = req.rawHeaders[i + 1];
		}
		const upstream = http.request({
			host: t.address,
			port: Number(u.port) || 80,
			method: req.method,
			path: `${u.pathname}${u.search}`,
			headers,
			setHost: false,
			timeout: connectTimeoutMs,
		});
		upstream.on('response', (up) => {
			const out = [];
			for (let i = 0; i < up.rawHeaders.length; i += 2) {
				if (!HOP_BY_HOP.has(up.rawHeaders[i].toLowerCase())) out.push(up.rawHeaders[i], up.rawHeaders[i + 1]);
			}
			res.writeHead(up.statusCode || 502, up.statusMessage, out);
			up.pipe(res);
		});
		upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
		upstream.on('error', () => {
			if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
			res.end();
		});
		req.pipe(upstream);
	}

	// Open a vetted TCP tunnel, then splice the two sockets together.
	function tunnel(clientSocket, address, targetPort, onOpen) {
		const upstream = net.connect({ host: address, port: targetPort, timeout: connectTimeoutMs });
		upstream.once('connect', () => {
			upstream.setTimeout(0);
			onOpen(upstream);
			upstream.pipe(clientSocket);
			clientSocket.pipe(upstream);
		});
		upstream.on('timeout', () => upstream.destroy());
		upstream.on('error', () => clientSocket.destroy());
		clientSocket.on('error', () => upstream.destroy());
		clientSocket.on('close', () => upstream.destroy());
	}

	// https:// and ws(s):// go through CONNECT host:port.
	async function onConnect(req, clientSocket, head) {
		const a = parseAuthority(req.url);
		const t = a ? await guard.resolveTarget(a.hostname, a.port, 443) : { ok: false, reason: 'bad CONNECT authority' };
		if (!t.ok) {
			report({ kind: 'proxy', url: `connect://${req.url}`, reason: t.reason });
			clientSocket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n');
			return;
		}
		tunnel(clientSocket, t.address, a.port, (upstream) => {
			clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			if (head?.length) upstream.write(head);
		});
	}

	// A plain ws:// upgrade sent in absolute form instead of via CONNECT.
	async function onUpgrade(req, clientSocket, head) {
		let u;
		try { u = new URL(req.url); } catch { u = null; }
		const t = u ? await guard.resolveTarget(u.hostname, u.port || 80, 80) : { ok: false, reason: 'bad upgrade url' };
		if (!t.ok) {
			report({ kind: 'proxy', url: req.url, reason: t.reason });
			clientSocket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n');
			return;
		}
		tunnel(clientSocket, t.address, Number(u.port) || 80, (upstream) => {
			const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`];
			for (let i = 0; i < req.rawHeaders.length; i += 2) {
				const k = req.rawHeaders[i].toLowerCase();
				if (k !== 'proxy-connection' && k !== 'proxy-authorization') lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
			}
			upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
			if (head?.length) upstream.write(head);
		});
	}

	const server = http.createServer((req, res) => { onRequest(req, res).catch(() => { try { res.destroy(); } catch { /* */ } }); });
	server.on('connect', (req, sock, head) => { onConnect(req, sock, head).catch(() => sock.destroy()); });
	server.on('upgrade', (req, sock, head) => { onUpgrade(req, sock, head).catch(() => sock.destroy()); });
	server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

	return new Promise((resolveStart, rejectStart) => {
		server.once('error', rejectStart);
		server.listen(port, host, () => {
			server.off('error', rejectStart);
			const bound = server.address().port;
			resolveStart({
				port: bound,
				url: `http://${host}:${bound}`,
				close: () => new Promise((r) => {
					for (const s of sockets) s.destroy();
					server.close(() => r());
				}),
			});
		});
	});
}
