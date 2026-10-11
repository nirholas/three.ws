// The Crawl worker's network fence (workers/agent-crawler/guard.js): every
// address a crawled page reaches is checked here before the browser connects.
import { describe, expect, it } from 'vitest';
import { guardHost, isBlockedAddress } from '../workers/agent-crawler/guard.js';

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
