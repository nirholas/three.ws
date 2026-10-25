// The x402 modal renders fields from a merchant-controlled 402 challenge and
// X-PAYMENT-RESPONSE header. Every one of them must pass through escapeHtml
// before it reaches innerHTML, in the SDK source and the shipped /x402.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = ['../x402-modal-sdk/src/x402-modal.js', '../public/x402.js'];

describe.each(FILES)('x402 modal challenge field escaping: %s', (rel) => {
	const src = readFileSync(new URL(rel, import.meta.url), 'utf8');

	it('escapes the currency symbol taken from accept.extra.name', () => {
		expect(src).toMatch(/<span class="x402-currency"> \$\{escapeHtml\(sym\)\}<\/span>/);
	});

	it('escapes the network label in both wallet buttons', () => {
		expect(src).not.toMatch(/x402-wallet-meta">\$\{networkLabel\(/);
		expect(src).toMatch(/x402-wallet-meta">\$\{escapeHtml\(networkLabel\(solanaAccept\.network, solanaAccept\)\)\}/);
	});

	it('escapes the settlement transaction and explorer href', () => {
		expect(src).not.toMatch(/<a href="\$\{explorer\}"/);
		expect(src).toMatch(/<a href="\$\{escapeHtml\(explorer\)\}"[^>]*>\$\{escapeHtml\(txShort\)\}/);
		expect(src).toMatch(/: escapeHtml\(txShort\)/);
	});
});
