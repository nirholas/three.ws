import { describe, it, expect } from 'vitest';
import { isBlockedAddress } from '../mcp-bridge/src/url-guard.js';

describe('mcp-bridge url-guard: reserved ranges and tunnelled IPv4', () => {
	it.each([
		['224.0.0.1', 'multicast'],
		['239.255.255.250', 'multicast'],
		['240.0.0.1', 'reserved class E'],
		['255.255.255.255', 'broadcast'],
		['198.18.0.1', 'benchmarking'],
		['192.0.0.8', 'IETF protocol assignments'],
		['64:ff9b::a9fe:a9fe', 'NAT64 wrapping 169.254.169.254'],
		['64:ff9b::7f00:1', 'NAT64 wrapping 127.0.0.1'],
		['2002:a9fe:a9fe::1', '6to4 wrapping 169.254.169.254'],
		['2002:7f00:1::1', '6to4 wrapping 127.0.0.1'],
		['ff02::1', 'IPv6 multicast'],
	])('blocks %s (%s)', (ip) => {
		expect(isBlockedAddress(ip)).toBe(true);
	});

	it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '64:ff9b::0808:0808', '2002:0808:0808::1'])(
		'still allows public %s',
		(ip) => {
			expect(isBlockedAddress(ip)).toBe(false);
		},
	);
});
