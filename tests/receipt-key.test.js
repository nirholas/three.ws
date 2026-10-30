// The purchase-receipt HMAC key must never fall back to a public constant.
// With SESSION_SECRET unset the old code derived the key from the literal
// string 'dev', so anyone could forge a valid receipt signature.

import { describe, it, expect, afterEach } from 'vitest';
import { resolveReceiptKey } from '../api/_lib/receipt-key.js';

const saved = {
	PURCHASE_RECEIPT_KEY: process.env.PURCHASE_RECEIPT_KEY,
	SESSION_SECRET: process.env.SESSION_SECRET,
};

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe('resolveReceiptKey', () => {
	it('throws when neither PURCHASE_RECEIPT_KEY nor SESSION_SECRET is set', () => {
		delete process.env.PURCHASE_RECEIPT_KEY;
		delete process.env.SESSION_SECRET;
		expect(() => resolveReceiptKey()).toThrow(/PURCHASE_RECEIPT_KEY/);
	});

	it('uses the dedicated key when set', () => {
		process.env.PURCHASE_RECEIPT_KEY = 'a'.repeat(40);
		delete process.env.SESSION_SECRET;
		expect(resolveReceiptKey()).toBe('a'.repeat(40));
	});

	it('derives a stable key from a long SESSION_SECRET', () => {
		delete process.env.PURCHASE_RECEIPT_KEY;
		process.env.SESSION_SECRET = 's'.repeat(40);
		expect(resolveReceiptKey()).toMatch(/^[0-9a-f]{64}$/);
		expect(resolveReceiptKey()).toBe(resolveReceiptKey());
	});

	it('never derives from the old public "dev" constant', () => {
		delete process.env.PURCHASE_RECEIPT_KEY;
		delete process.env.SESSION_SECRET;
		let key = null;
		try { key = resolveReceiptKey(); } catch { /* expected */ }
		expect(key).toBeNull();
	});
});
