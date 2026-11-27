// A $THREE payment that left the wallet must always be recordable (order 129).
//
// Two holes in the settle step charged people for nothing:
//   1. verifyQuote rejected an expired quote before anything else, so a transfer
//      that confirmed inside the quote window but whose settle call arrived late
//      (a slow confirmation, a dropped response, a retried request) could never
//      be recorded: the money moved and no payment existed. A late settle is now
//      accepted when the transaction's own block time proves it was paid while
//      the quote was valid; a transfer made after expiry is still refused.
//   2. A settle retried after the first one recorded the payment (the response
//      was lost) answered 409 already_settled with no payment id, so the payer
//      could not use what they paid for. The settle route now resumes the same
//      user's same transaction and returns the recorded payment. Other callers
//      of verifyAndSettlePayment keep the strict 409 unless they opt in.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

process.env.THREE_QUOTE_SECRET = 'settle-recovery-test-secret';

const db = vi.hoisted(() => ({ used: null, insertConflict: null, inserted: [], conflictRow: null }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const text = strings.join(' ');
		if (text.includes('where nonce =') && text.includes('limit 1') && !text.includes(' or ')) {
			return db.used ? [db.used] : [];
		}
		if (text.includes('insert into token_payments')) {
			if (db.insertConflict) throw db.insertConflict;
			db.inserted.push(values);
			return [{ id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d', created_at: new Date() }];
		}
		if (text.includes(' or tx_signature =')) return db.conflictRow ? [db.conflictRow] : [];
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const chain = vi.hoisted(() => ({ tx: null }));
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({ getParsedTransaction: async () => chain.tx }),
}));

const { verifyAndSettlePayment } = await import('../api/_lib/token/payments.js');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const TREASURY = 'THREEsynthetic1111111111111111111111111111';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const USER = '2b7c9e41-6d3a-4f85-9b12-0c4e8a7f3d56';
const SIG = 'S'.repeat(88);

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function signQuote(payload, secret = process.env.THREE_QUOTE_SECRET) {
	const body = b64url(JSON.stringify(payload));
	const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
	return `${body}.${sig}`;
}

const now = () => Math.floor(Date.now() / 1000);
function quotePayload(overrides = {}) {
	return {
		purpose: 'consumption',
		mint: MINT,
		decimals: 6,
		usd: 0.5,
		priceUsd: 0.001,
		total: '500000000',
		legs: [{ role: 'treasury', address: TREASURY, bps: 10000, atomics: '500000000' }],
		nonce: 'nonce-' + crypto.randomUUID(),
		network: 'mainnet',
		refType: 'forge',
		refId: 'forge-high-abc',
		iat: now() - 300,
		exp: now() - 200,
		...overrides,
	};
}
function paidTx(quote, blockTime) {
	return {
		slot: 123,
		blockTime,
		meta: {
			err: null,
			preTokenBalances: [],
			postTokenBalances: [{ accountIndex: 1, mint: quote.mint, owner: TREASURY, uiTokenAmount: { amount: quote.total } }],
		},
		transaction: { message: { instructions: [{ programId: MEMO, parsed: quote.nonce }] } },
	};
}

beforeEach(() => {
	db.used = null;
	db.insertConflict = null;
	db.inserted = [];
	db.conflictRow = null;
	chain.tx = null;
});

describe('late settle of a quote that has since expired', () => {
	it('records a transfer that landed while the quote was still valid', async () => {
		const quote = quotePayload();
		chain.tx = paidTx(quote, quote.exp - 20);
		const out = await verifyAndSettlePayment({ quoteToken: signQuote(quote), txSignature: SIG, userId: USER });
		expect(out.ok).toBe(true);
		expect(out.payment_id).toBe('f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d');
		expect(db.inserted).toHaveLength(1);
	});

	it('refuses a transfer made after the quote expired', async () => {
		const quote = quotePayload();
		chain.tx = paidTx(quote, quote.exp + 120);
		await expect(
			verifyAndSettlePayment({ quoteToken: signQuote(quote), txSignature: SIG, userId: USER }),
		).rejects.toMatchObject({ status: 410, code: 'quote_expired' });
		expect(db.inserted).toHaveLength(0);
	});

	it('refuses an expired quote whose transaction has no block time', async () => {
		const quote = quotePayload();
		chain.tx = paidTx(quote, null);
		await expect(
			verifyAndSettlePayment({ quoteToken: signQuote(quote), txSignature: SIG, userId: USER }),
		).rejects.toMatchObject({ code: 'quote_expired' });
	});

	it('never lets the late path skip the signature check', async () => {
		const quote = quotePayload();
		chain.tx = paidTx(quote, quote.exp - 20);
		await expect(
			verifyAndSettlePayment({ quoteToken: signQuote(quote, 'someone-elses-secret'), txSignature: SIG, userId: USER }),
		).rejects.toMatchObject({ code: 'invalid_quote' });
		expect(db.inserted).toHaveLength(0);
	});
});

describe('a settle retried after the payment was recorded', () => {
	const fresh = () => quotePayload({ exp: now() + 60 });

	it('stays a strict 409 for callers that do not opt in', async () => {
		db.used = { id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d', tx_signature: SIG, user_id: USER };
		await expect(
			verifyAndSettlePayment({ quoteToken: signQuote(fresh()), txSignature: SIG, userId: USER }),
		).rejects.toMatchObject({ status: 409, code: 'already_settled' });
	});

	it('resumes the same user and the same transaction with the recorded payment', async () => {
		db.used = { id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d', tx_signature: SIG, user_id: USER };
		const quote = fresh();
		const out = await verifyAndSettlePayment({ quoteToken: signQuote(quote), txSignature: SIG, userId: USER, resumeSameTx: true });
		expect(out).toMatchObject({ ok: true, replay: true, payment_id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d' });
		expect(out.quote.nonce).toBe(quote.nonce);
		expect(db.inserted).toHaveLength(0);
	});

	it('resumes even when the quote has expired by the time of the retry', async () => {
		db.used = { id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d', tx_signature: SIG, user_id: USER };
		const out = await verifyAndSettlePayment({ quoteToken: signQuote(quotePayload()), txSignature: SIG, userId: USER, resumeSameTx: true });
		expect(out.payment_id).toBe('f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d');
	});

	it('refuses a different transaction against an already settled quote', async () => {
		db.used = { id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d', tx_signature: 'T'.repeat(88), user_id: USER };
		await expect(
			verifyAndSettlePayment({ quoteToken: signQuote(fresh()), txSignature: SIG, userId: USER, resumeSameTx: true }),
		).rejects.toMatchObject({ status: 409, code: 'already_settled' });
	});

	it('refuses another user presenting the same transaction', async () => {
		db.used = { id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d', tx_signature: SIG, user_id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a' };
		await expect(
			verifyAndSettlePayment({ quoteToken: signQuote(fresh()), txSignature: SIG, userId: USER, resumeSameTx: true }),
		).rejects.toMatchObject({ status: 409, code: 'already_settled' });
	});

	it('resolves a concurrent double-submit (insert conflict) to the one recorded payment', async () => {
		const quote = fresh();
		chain.tx = paidTx(quote, now());
		db.insertConflict = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
		db.conflictRow = { id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d', created_at: new Date(), tx_signature: SIG, user_id: USER };
		const out = await verifyAndSettlePayment({ quoteToken: signQuote(quote), txSignature: SIG, userId: USER, resumeSameTx: true });
		expect(out).toMatchObject({ ok: true, replay: true, payment_id: 'f3a9c1d2-0b4e-4f6a-8c5d-7e9f1a2b3c4d' });
		await expect(
			verifyAndSettlePayment({ quoteToken: signQuote(quote), txSignature: SIG, userId: USER }),
		).rejects.toMatchObject({ status: 409, code: 'already_settled' });
	});
});

describe('the settle route', () => {
	it('opts in to resuming the caller\'s own transaction', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync('api/token/[action].js', 'utf8');
		expect(src).toMatch(/verifyAndSettlePayment\(\{[^}]*resumeSameTx: true/s);
	});
});
