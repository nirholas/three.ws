import { describe, expect, it } from 'vitest';

import { moneyToNumber, numberToMoney } from '../api/_lib/cloud-domains.js';
import { DomainsError, domainPricing, labelFromQuery, normalizeContact, normalizeDomain } from '../api/_lib/domains-service.js';
import { toolDefs } from '../api/_mcp/tools/domains.js';

const contact = {
	name: 'Ada Lovelace',
	email: 'ada@example.com',
	phone: '+1 (415) 555-0123',
	address_lines: ['1 Main St'],
	city: 'San Francisco',
	region: 'CA',
	postal_code: '94105',
	country: 'us',
};

describe('normalizeDomain', () => {
	it('lowercases, strips scheme and path, and punycodes', () => {
		expect(normalizeDomain('HTTPS://Orbit.App/path')).toBe('orbit.app');
		expect(normalizeDomain('bücher.de')).toBe('xn--bcher-kva.de');
	});
	it('rejects names that are not registrable', () => {
		for (const bad of ['', 'nodot', 'a..b', '-x.com', 'spa ce.com']) {
			expect(() => normalizeDomain(bad)).toThrow(DomainsError);
		}
	});
});

describe('labelFromQuery', () => {
	it('turns a project name into a label', () => {
		expect(labelFromQuery('My Cool Coin!')).toBe('my-cool-coin');
		expect(labelFromQuery('orbit.app')).toBe('orbit');
	});
	it('refuses an empty query', () => {
		expect(() => labelFromQuery('!!!')).toThrow(DomainsError);
	});
});

describe('normalizeContact', () => {
	it('normalizes phone and country', () => {
		const c = normalizeContact(contact);
		expect(c.phone).toBe('+14155550123');
		expect(c.country).toBe('US');
	});
	it('names every missing field', () => {
		try {
			normalizeContact({ ...contact, email: 'nope', city: '' });
			throw new Error('should have thrown');
		} catch (e) {
			expect(e.code).toBe('contact_invalid');
			expect(e.detail.missing).toEqual(expect.arrayContaining(['email', 'city']));
		}
	});
	it('requires a contact at all', () => {
		expect(() => normalizeContact(null)).toThrow(/contact is required/);
	});
});

describe('money conversion', () => {
	it('round-trips Google Money', () => {
		expect(moneyToNumber({ units: '12', nanos: 500000000 })).toBe(12.5);
		expect(numberToMoney(12.5)).toEqual({ currencyCode: 'USD', units: '12', nanos: 500000000 });
		expect(numberToMoney(9)).toEqual({ currencyCode: 'USD', units: '9' });
	});
});

describe('domainPricing', () => {
	it('answers from the snapshot without a registrar call', () => {
		const out = domainPricing({ limit: 5 });
		expect(Array.isArray(out.tlds)).toBe(true);
		expect(out.note).toMatch(/one year/);
	});
});

describe('domain MCP tools', () => {
	const byName = Object.fromEntries(toolDefs.map((t) => [t.name, t]));
	it('exposes the full set', () => {
		expect(Object.keys(byName).sort()).toEqual(
			['domain_check', 'domain_connect', 'domain_connect_status', 'domain_pricing', 'domain_register', 'domain_register_quote', 'domain_search', 'domain_status'].sort(),
		);
	});
	it('gates registration behind confirm, price and idempotency', () => {
		const t = byName.domain_register;
		expect(t.annotations.destructiveHint).toBe(true);
		expect(t.inputSchema.required).toEqual(expect.arrayContaining(['confirm_spend', 'expected_price_usd', 'idempotency_key', 'quote_id']));
	});
});
