// The Crawl worker's network fence (workers/agent-crawler/guard.js): every
// address a crawled page reaches is checked here before the browser connects.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardHost, guardedFetch, isBlockedAddress } from '../workers/agent-crawler/guard.js';

describe('isBlockedAddress', () => {
	it.each([
		'10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.0.10', '100.64.1.1', '0.0.0.0', '224.0.0.251',
		'198.18.0.1', '::1', '::', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip',
	])('refuses %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

	// A rule for the IPv4-mapped range once matched every plain IPv4 address and
	// refused the entire public web; these pin that regression.
	it.each(['198.35.26.224', '8.8.8.8', '1.1.1.1', '172.32.0.1', '2620:0:863:ed1a::1', '::ffff:8.8.8.8'])('allows %s', (ip) => {
		expect(isBlockedAddress(ip)).toBe(false);
	});
});

describe('guardHost', () => {
	it('refuses internal names and private literals without a lookup', async () => {
		for (const h of ['localhost', 'metadata', 'metadata.google.internal', 'nas.local', 'db.internal', '10.1.1.1', '[::1]', '']) {
			expect(await guardHost(h), h).toBe(false);
		}
	});

	it('allows a public literal', async () => {
		expect(await guardHost('8.8.8.8')).toBe(true);
	});
});

describe('guardedFetch redirects', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('refuses a redirect hop that lands on a private or metadata address', async () => {
		const seen = [];
		globalThis.fetch = async (u) => {
			seen.push(String(u));
			return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
		};
		await expect(guardedFetch('https://8.8.8.8/robots.txt')).rejects.toThrow(/refused private host/);
		expect(seen).toEqual(['https://8.8.8.8/robots.txt']);
	});

	it('follows a redirect between public hosts', async () => {
		const seen = [];
		globalThis.fetch = async (u) => {
			seen.push(String(u));
			return seen.length === 1
				? new Response(null, { status: 301, headers: { location: 'https://1.1.1.1/robots.txt' } })
				: new Response('User-agent: *', { status: 200 });
		};
		const res = await guardedFetch('https://8.8.8.8/robots.txt');
		expect(await res.text()).toBe('User-agent: *');
		expect(seen).toEqual(['https://8.8.8.8/robots.txt', 'https://1.1.1.1/robots.txt']);
	});

	it('gives up after a bounded number of hops', async () => {
		globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://8.8.8.8/loop' } });
		await expect(guardedFetch('https://8.8.8.8/loop')).rejects.toThrow(/too many redirects/);
	});

	it('refuses a non-http scheme in a redirect', async () => {
		globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } });
		await expect(guardedFetch('https://8.8.8.8/x')).rejects.toThrow();
	});
});

describe('guardedLookup (DNS rebinding)', () => {
	it('re-checks the answer at connect time, so a flipped record is refused', async () => {
		const dns = (await import('node:dns/promises')).default;
		const { guardedLookup } = await import('../workers/agent-crawler/guard.js');
		const answers = [[{ address: '8.8.8.8', family: 4 }], [{ address: '169.254.169.254', family: 4 }]];
		const spy = vi.spyOn(dns, 'lookup').mockImplementation(async () => answers.shift());
		const lookup = (host) => new Promise((resolve) => guardedLookup(host, { all: true }, (err, addrs) => resolve({ err, addrs })));
		const first = await lookup('rebind.example');
		expect(first.err).toBeNull();
		expect(first.addrs[0].address).toBe('8.8.8.8');
		const second = await lookup('rebind.example');
		expect(second.err?.message).toMatch(/refused private host/);
		spy.mockRestore();
	});

	it('connects a hostname only through the pinned lookup, never through global fetch', async () => {
		const dns = (await import('node:dns/promises')).default;
		const spy = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
		let fetched = false;
		globalThis.fetch = async () => { fetched = true; return new Response('x'); };
		await expect(guardedFetch('http://public-looking.example/robots.txt')).rejects.toThrow();
		expect(fetched).toBe(false);
		spy.mockRestore();
	});
});
