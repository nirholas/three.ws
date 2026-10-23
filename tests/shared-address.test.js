// The single address formatter (src/shared/address.js). Every address-shortening
// helper in src/ routes through shortAddress, so these pin the contract for all
// of them. The DOM behavior (markup, the focus trap) is exercised in a real
// browser by tests/e2e/w3ag-wallet.spec.js.

import { describe, it, expect } from 'vitest';
import { shortAddress, spokenAddress, addressHtml } from '../src/shared/address.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

describe('shortAddress', () => {
	it('keeps head and tail around an ellipsis', () => {
		expect(shortAddress(THREE_MINT)).toBe('FeMb…pump');
		expect(shortAddress(THREE_MINT, 6, 4)).toBe('FeMbDo…pump');
	});
	it('honours head, tail and separator', () => {
		expect(shortAddress(EVM, 6, 4)).toBe('0x742d…f44e');
		expect(shortAddress(EVM, 6, 4, { sep: '...' })).toBe('0x742d...f44e');
	});
	it('returns short and empty values unharmed', () => {
		expect(shortAddress('abc')).toBe('abc');
		expect(shortAddress(null)).toBe('');
		expect(shortAddress('', 4, 4, { empty: 'none' })).toBe('none');
	});
});

describe('spokenAddress', () => {
	it('groups by four and round-trips', () => {
		const s = spokenAddress(THREE_MINT);
		expect(s.replace(/ /g, '')).toBe(THREE_MINT);
		expect(s.split(' ').every((g) => g.length <= 4)).toBe(true);
	});
	it('keeps 0x as its own group', () => {
		expect(spokenAddress(EVM).startsWith('0x 742d 35Cc')).toBe(true);
	});
	it('is empty for nothing', () => {
		expect(spokenAddress(undefined)).toBe('');
	});
});

describe('addressHtml', () => {
	it('draws the short form, announces the chunked full value, titles the full value', () => {
		const html = addressHtml(THREE_MINT, { label: 'Token mint' });
		expect(html).toContain(`title="${THREE_MINT}"`);
		expect(html).toContain('translate="no"');
		expect(html).toContain(`<span aria-hidden="true">${shortAddress(THREE_MINT)}</span>`);
		expect(html).toContain('Token mint: ' + spokenAddress(THREE_MINT));
	});
	it('escapes hostile input', () => {
		const html = addressHtml('"><img src=x onerror=alert(1)>', { label: '<b>' });
		expect(html).not.toContain('<img');
		expect(html).not.toContain('<b>');
	});
	it('renders the empty text when there is no value', () => {
		expect(addressHtml(null, { empty: 'No wallet' })).toBe('No wallet');
	});
});
