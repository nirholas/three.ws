/**
 * Agent-screen caster egress guard, unit tests.
 *
 * The caster pool runs a shared, owner-steerable Chromium and streams its pixels
 * to the public wall, so anything the browser can reach is effectively readable
 * by whoever holds a control lease. The literal-hostname check in isNavAllowed is
 * only the first filter; these tests pin the request-level guard behind it:
 *
 *   - isAddressAllowed: the resolved-address policy (IPv4, IPv6, IPv4-mapped,
 *     NAT64 and 6to4 forms) shared by the worker and the API mirror.
 *   - assertResolvedPublic: a hostname is refused when ANY address it resolves
 *     to is non-public (DNS is stubbed at the module boundary).
 *   - createEgressGuard: the Playwright route / websocket / response hooks that
 *     re-check every request, every redirect hop, and the connected address.
 *   - drift: the worker copy and the API copy of the address policy are byte
 *     identical (the worker is deployed standalone and cannot import src/).
 *
 * The real-Chromium proof (a public page 302-redirecting to a loopback secret is
 * aborted, and a rebound connection kills the page) lives in
 * scripts/agent-screen-egress-proof.mjs.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
	isAddressAllowed,
	isNavAllowed,
	assertResolvedPublic,
	createEgressGuard,
	EgressBlockedError,
} from '../workers/agent-screen-pool/egress-guard.js';
import {
	isAddressAllowed as apiIsAddressAllowed,
	isNavAllowed as apiIsNavAllowed,
} from '../src/shared/agent-screen-control.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// A stub resolver: hostname -> list of addresses, in dns.promises.lookup({all})
// shape. Unknown names reject with ENOTFOUND like the real resolver.
function stubLookup(table) {
	return vi.fn(async (host) => {
		const hit = table[host];
		if (!hit) {
			const err = new Error(`getaddrinfo ENOTFOUND ${host}`);
			err.code = 'ENOTFOUND';
			throw err;
		}
		return hit.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
	});
}

const PUBLIC_V4 = '93.184.215.14';
const PUBLIC_V6 = '2606:2800:21f:cb07:6820:80da:af6b:8b2c';

describe('isAddressAllowed, resolved-address policy', () => {
	const refused = [
		'10.0.0.1', '127.0.0.1', '127.255.255.254', '0.0.0.0', '169.254.169.254',
		'172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255',
		'192.0.0.8', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9',
		'224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
		'::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1',
		'::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '::ffff:7f00:1',
		'64:ff9b::a00:1', '2002:a00:1::1', '2001:db8::1', '::127.0.0.1',
		'', 'not-an-ip', '1.2.3', '256.1.1.1',
	];
	for (const ip of refused) {
		it(`refuses ${JSON.stringify(ip)}`, () => {
			expect(isAddressAllowed(ip)).toBe(false);
		});
	}

	const allowed = [PUBLIC_V4, '8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', PUBLIC_V6, '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1'];
	for (const ip of allowed) {
		it(`allows public ${ip}`, () => {
			expect(isAddressAllowed(ip)).toBe(true);
		});
	}
});

describe('isNavAllowed, literal first filter', () => {
	it('refuses decimal, hex and short IPv4 encodings of loopback', () => {
		expect(isNavAllowed('http://2130706433/')).toBe(false);
		expect(isNavAllowed('http://0x7f.1/')).toBe(false);
		expect(isNavAllowed('http://0177.0.0.1/')).toBe(false);
		expect(isNavAllowed('http://127.1/')).toBe(false);
	});

	it('refuses IPv4-mapped and NAT64 IPv6 literals of private space', () => {
		expect(isNavAllowed('http://[::ffff:10.0.0.1]/')).toBe(false);
		expect(isNavAllowed('http://[::ffff:169.254.169.254]/latest/meta-data')).toBe(false);
		expect(isNavAllowed('http://[64:ff9b::7f00:1]/')).toBe(false);
	});

	it('the API mirror refuses the same literals', () => {
		expect(apiIsNavAllowed('http://[::ffff:10.0.0.1]/')).toBe(false);
		expect(apiIsNavAllowed('http://2130706433/')).toBe(false);
		expect(apiIsNavAllowed('https://example.com/')).toBe(true);
	});
});

describe('assertResolvedPublic, hostname resolution', () => {
	const lookup = stubLookup({
		'rebind-10.example': ['10.0.0.1'],
		'rebind-loop.example': ['127.0.0.1'],
		'rebind-meta.example': ['169.254.169.254'],
		'rebind-cgnat.example': ['100.64.0.1'],
		'rebind-v6loop.example': ['::1'],
		'rebind-ula.example': ['fc00::1'],
		'rebind-mapped.example': ['::ffff:10.0.0.1'],
		'mixed.example': [PUBLIC_V4, '10.0.0.1'],
		'public.example': [PUBLIC_V4, PUBLIC_V6],
	});

	for (const host of [
		'rebind-10.example', 'rebind-loop.example', 'rebind-meta.example', 'rebind-cgnat.example',
		'rebind-v6loop.example', 'rebind-ula.example', 'rebind-mapped.example',
	]) {
		it(`refuses ${host}, which resolves to a non-public address`, async () => {
			await expect(assertResolvedPublic(host, { lookup })).rejects.toBeInstanceOf(EgressBlockedError);
		});
	}

	it('refuses a name when ANY of its addresses is non-public', async () => {
		await expect(assertResolvedPublic('mixed.example', { lookup })).rejects.toThrow(/10\.0\.0\.1/);
	});

	it('allows a name that resolves only to public addresses and returns them', async () => {
		await expect(assertResolvedPublic('public.example', { lookup })).resolves.toEqual([PUBLIC_V4, PUBLIC_V6]);
		expect(lookup).toHaveBeenCalledWith('public.example', expect.objectContaining({ all: true }));
	});

	it('fails closed when the name does not resolve', async () => {
		await expect(assertResolvedPublic('nx.example', { lookup })).rejects.toBeInstanceOf(EgressBlockedError);
	});

	it('checks IP literals without touching DNS', async () => {
		const spy = stubLookup({});
		await expect(assertResolvedPublic('127.0.0.1', { lookup: spy })).rejects.toBeInstanceOf(EgressBlockedError);
		await expect(assertResolvedPublic('[::1]', { lookup: spy })).rejects.toBeInstanceOf(EgressBlockedError);
		await expect(assertResolvedPublic(PUBLIC_V4, { lookup: spy })).resolves.toEqual([PUBLIC_V4]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('refuses reserved names before resolving them', async () => {
		const spy = stubLookup({ localhost: [PUBLIC_V4], 'metadata.google.internal': [PUBLIC_V4] });
		await expect(assertResolvedPublic('localhost', { lookup: spy })).rejects.toBeInstanceOf(EgressBlockedError);
		await expect(assertResolvedPublic('metadata.google.internal', { lookup: spy })).rejects.toBeInstanceOf(EgressBlockedError);
		expect(spy).not.toHaveBeenCalled();
	});
});

// Minimal stand-ins for the Playwright objects the guard touches. They record
// what the guard decided, which is the behaviour under test; the real-browser
// path is proven by scripts/agent-screen-egress-proof.mjs.
function fakeRoute(url) {
	const calls = [];
	return {
		calls,
		request: () => ({ url: () => url, frame: () => ({ page: () => 'PAGE' }) }),
		abort: async (code) => { calls.push(['abort', code]); },
		continue: async () => { calls.push(['continue']); },
	};
}
function fakeContext() {
	const ctx = { routes: [], wsRoutes: [], listeners: {} };
	ctx.route = async (pattern, handler) => { ctx.routes.push([pattern, handler]); };
	ctx.routeWebSocket = async (pattern, handler) => { ctx.wsRoutes.push([pattern, handler]); };
	ctx.on = (ev, fn) => { (ctx.listeners[ev] ||= []).push(fn); };
	return ctx;
}

describe('createEgressGuard, request-level enforcement', () => {
	const table = {
		'public.example': [PUBLIC_V4],
		'internal.example': ['10.0.0.1'],
	};

	it('checkUrl refuses non-network schemes it cannot vet and allows inert ones', async () => {
		const guard = createEgressGuard({ lookup: stubLookup(table) });
		expect((await guard.checkUrl('file:///etc/passwd')).ok).toBe(false);
		expect((await guard.checkUrl('ftp://public.example/')).ok).toBe(false);
		expect((await guard.checkUrl('data:text/plain,hi')).ok).toBe(true);
		expect((await guard.checkUrl('about:blank')).ok).toBe(true);
		expect((await guard.checkUrl('wss://public.example/socket')).ok).toBe(true);
		expect((await guard.checkUrl('ws://internal.example/socket')).ok).toBe(false);
	});

	it('caches verdicts per hostname inside the TTL and re-resolves after it', async () => {
		let now = 1_000;
		const lookup = stubLookup(table);
		const guard = createEgressGuard({ lookup, ttlMs: 5_000, now: () => now });
		await guard.checkUrl('https://public.example/a');
		await guard.checkUrl('https://public.example/b.png');
		expect(lookup).toHaveBeenCalledTimes(1);
		now += 6_000;
		await guard.checkUrl('https://public.example/c');
		expect(lookup).toHaveBeenCalledTimes(2);
	});

	it('trusts only the exact configured base origin host', async () => {
		const guard = createEgressGuard({ lookup: stubLookup({}), trustedHosts: ['localhost:3000'] });
		expect((await guard.checkUrl('http://localhost:3000/agent/a1')).ok).toBe(true);
		expect((await guard.checkUrl('http://localhost:3001/')).ok).toBe(false);
	});

	it('install() routes every request: a blocked hop is aborted, a public one continues', async () => {
		const violations = [];
		const guard = createEgressGuard({ lookup: stubLookup(table) });
		const ctx = fakeContext();
		await guard.install(ctx, { onViolation: (v) => violations.push(v) });
		expect(ctx.routes).toHaveLength(1);
		const [, handler] = ctx.routes[0];

		const good = fakeRoute('https://public.example/');
		await handler(good);
		expect(good.calls).toEqual([['continue']]);

		// A redirect hop arrives at the route handler as its own request.
		const hop = fakeRoute('http://127.0.0.1:8080/secret');
		await handler(hop);
		expect(hop.calls).toEqual([['abort', 'blockedbyclient']]);

		const rebind = fakeRoute('https://internal.example/x.png');
		await handler(rebind);
		expect(rebind.calls).toEqual([['abort', 'blockedbyclient']]);

		expect(violations.map((v) => v.kind)).toEqual(['request', 'request']);
		expect(violations[0].page).toBe('PAGE');
	});

	it('install() closes websockets to non-public hosts and connects public ones', async () => {
		const guard = createEgressGuard({ lookup: stubLookup(table) });
		const ctx = fakeContext();
		await guard.install(ctx, {});
		const [, wsHandler] = ctx.wsRoutes[0];
		const mk = (url) => {
			const calls = [];
			return { calls, url: () => url, close: async (o) => { calls.push(['close', o?.code]); }, connectToServer: () => { calls.push(['connect']); } };
		};
		const bad = mk('ws://internal.example/live');
		await wsHandler(bad);
		expect(bad.calls).toEqual([['close', 1008]]);
		const ok = mk('wss://public.example/live');
		await wsHandler(ok);
		expect(ok.calls).toEqual([['connect']]);
	});

	it('install() flags a response whose connected address is non-public (rebinding)', async () => {
		const violations = [];
		const guard = createEgressGuard({ lookup: stubLookup(table) });
		const ctx = fakeContext();
		await guard.install(ctx, { onViolation: (v) => violations.push(v) });
		const [onResponse] = ctx.listeners.response;
		const res = (url, ipAddress) => ({
			url: () => url,
			serverAddr: async () => (ipAddress ? { ipAddress, port: 443 } : null),
			frame: () => ({ page: () => 'PAGE' }),
		});
		await onResponse(res('https://public.example/', PUBLIC_V4));
		await onResponse(res('https://public.example/cached.css', null));
		expect(violations).toEqual([]);
		await onResponse(res('https://public.example/', '10.0.0.1'));
		expect(violations).toHaveLength(1);
		expect(violations[0]).toMatchObject({ kind: 'response', page: 'PAGE', address: '10.0.0.1' });
	});
});

describe('worker and API address policy stay in sync', () => {
	const START = '// ── egress-guard:address-policy:start';
	const END = '// ── egress-guard:address-policy:end';
	const slice = (path) => {
		const src = readFileSync(resolve(__dir, '..', path), 'utf8');
		const a = src.indexOf(START);
		const b = src.indexOf(END);
		expect(a, `${path} is missing the address-policy start marker`).toBeGreaterThan(-1);
		expect(b, `${path} is missing the address-policy end marker`).toBeGreaterThan(a);
		return src.slice(a, b);
	};

	it('the literal-IP block lists are byte identical in both copies', () => {
		expect(slice('workers/agent-screen-pool/egress-guard.js')).toBe(slice('src/shared/agent-screen-control.js'));
	});

	it('both copies give the same verdict on a spread of addresses', () => {
		for (const ip of ['10.0.0.1', '::ffff:10.0.0.1', PUBLIC_V4, PUBLIC_V6, 'fe80::1', '2002:a00:1::1']) {
			expect(apiIsAddressAllowed(ip)).toBe(isAddressAllowed(ip));
		}
	});
});
