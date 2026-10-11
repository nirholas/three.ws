// A key's IP allowlist: single addresses and CIDR ranges, v4 and v6, with
// the proxy-style IPv4-mapped IPv6 form a caller can arrive as.

import { describe, it, expect } from 'vitest';

const { normalizeIpAllowlist, ipAllowed, parseIpRule, IP_ALLOWLIST_MAX_RULES } = await import('../api/_lib/ip-allowlist.js');

describe('ip allowlist', () => {
	it('accepts addresses and ranges and reports what it cannot parse', () => {
		const { rules, invalid } = normalizeIpAllowlist(['203.0.113.7', ' 10.0.0.0/8 ', '2001:db8::/32', '2001:db8::1', 'office', '300.1.1.1', '10.0.0.0/33']);
		expect(rules).toEqual(['203.0.113.7', '10.0.0.0/8', '2001:db8::/32', '2001:db8::1']);
		expect(invalid).toEqual(['office', '300.1.1.1', '10.0.0.0/33']);
	});

	it('dedupes and refuses a list past the rule cap', () => {
		expect(normalizeIpAllowlist(['1.1.1.1', '1.1.1.1']).rules).toEqual(['1.1.1.1']);
		const many = Array.from({ length: IP_ALLOWLIST_MAX_RULES + 5 }, (_, i) => `10.0.${Math.floor(i / 256)}.${i % 256}`);
		const over = normalizeIpAllowlist(many);
		expect(over.invalid).toEqual([`more than ${IP_ALLOWLIST_MAX_RULES} rules`]);
	});

	it('matches exact addresses and ranges', () => {
		const rules = ['203.0.113.7', '10.0.0.0/8', '2001:db8::/32'];
		expect(ipAllowed('203.0.113.7', rules)).toBe(true);
		expect(ipAllowed('203.0.113.8', rules)).toBe(false);
		expect(ipAllowed('10.255.0.1', rules)).toBe(true);
		expect(ipAllowed('11.0.0.1', rules)).toBe(false);
		expect(ipAllowed('2001:db8:1::5', rules)).toBe(true);
		expect(ipAllowed('2001:db9::5', rules)).toBe(false);
	});

	it('treats an IPv4-mapped IPv6 caller as its IPv4 address', () => {
		expect(ipAllowed('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
		expect(ipAllowed('::ffff:11.1.2.3', ['10.0.0.0/8'])).toBe(false);
	});

	it('allows everyone when the list is empty and nobody unparseable when it is not', () => {
		expect(ipAllowed('8.8.8.8', [])).toBe(true);
		expect(ipAllowed('8.8.8.8', null)).toBe(true);
		expect(ipAllowed(null, ['8.8.8.8'])).toBe(false);
		expect(ipAllowed('not-an-ip', ['8.8.8.8'])).toBe(false);
	});

	it('parses a rule into base and mask', () => {
		expect(parseIpRule('192.168.1.0/24')).toMatchObject({ rule: '192.168.1.0/24' });
		expect(parseIpRule('nope')).toBeNull();
	});
});
