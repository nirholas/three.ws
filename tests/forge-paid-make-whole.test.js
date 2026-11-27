// A paid Forge High generation is made whole when it fails AFTER the payment was
// taken (order 129, "charged for nothing").
//
// The submit claims the $THREE payment (or debits credits) and answers 200 with
// a job id. Before this fix the claim was only ever undone inside that same
// request, so a job that later failed (lane error after every failover hop, a
// stalled poll, the finalize cron timing it out after a restart) kept the money:
// the retry with the same proof got 409 payment_already_used and nothing was
// refunded. These tests pin the repair:
//
//   1. The submit binds the claim (and the credit spend) to the creation row it
//      made, through a request scope, so later code can find the job a payment
//      paid for.
//   2. assertForgePayment honors a free retry once the bound job is terminally
//      failed (following failover successors to the last row), says "settling"
//      while a failure is fresh or the job still runs, and still refuses a proof
//      whose generation delivered.
//   3. The make-whole reconciler refunds a credit spend whose job failed, exactly
//      once (same idempotency key as the in-request refund), and leaves done,
//      running and freshly failed jobs alone.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
	calls: [],
	payment: null,
	redemption: null,
	chain: null,
	spends: [],
	deleted: [{ payment_id: 'x' }],
}));

vi.mock('../api/_lib/db.js', () => {
	const sql = vi.fn(async (strings, ...values) => {
		const text = (Array.isArray(strings) ? strings.join('?') : String(strings)).replace(/\s+/g, ' ').trim();
		db.calls.push({ text, values });
		if (text.includes('from token_payments')) return db.payment ? [db.payment] : [];
		if (text.startsWith('with recursive')) return db.chain ? [db.chain] : [];
		if (text.startsWith('delete from forge_high_redemptions')) return db.deleted;
		if (text.startsWith('select') && text.includes('from forge_high_redemptions'))
			return db.redemption ? [db.redemption] : [];
		if (text.startsWith('select') && text.includes('from credit_ledger')) return db.spends;
		return [];
	});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const refundCredits = vi.hoisted(() => vi.fn(async () => ({ ledgerId: 'refund-1', replay: false })));
vi.mock('../api/_lib/credits.js', () => ({ refundCredits }));

import { assertForgePayment } from '../api/_lib/forge-high-payment.js';
import {
	withPaidGenerationScope,
	notePaidGeneration,
	currentPaidGeneration,
	bindPaidGeneration,
	classifyOutcome,
	paidJobOutcome,
	reconcilePaidCreditGenerations,
	RELEASE_GRACE_MS,
	CREDIT_REFUND_GRACE_MS,
} from '../api/_lib/forge-paid-generation.js';
import { priceForAction } from '../api/_lib/pricing/catalog.js';

const HIGH_USD = Number(priceForAction('forge.high').usd);
const PAY_ID = '7c4e1b93-2a68-4f0d-8b52-1e93af6c04d7';
const REF_ID = 'forge-high-abc123';
const CREATION = '301676f1-cddf-49f5-ab6e-351203c47d44';
const SUCCESSOR = '0b7f2a52-6a3e-4f1c-9d55-1f4f8a2b9c10';
const LEDGER = '5f0c2d7e-8a41-4b6e-9c3d-2e1f0a9b8c77';
const USER = 'a3d1c2b4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const ago = (ms) => new Date(Date.now() - ms).toISOString();

function settledPayment() {
	return {
		id: PAY_ID,
		purpose: 'consumption',
		usd: HIGH_USD.toFixed(6),
		ref_type: 'forge',
		ref_id: REF_ID,
		confirmed_at: ago(5 * 60_000),
		created_at: ago(5 * 60_000),
	};
}

function statements(fragment) {
	return db.calls.filter((c) => c.text.includes(fragment));
}

beforeEach(() => {
	db.calls.length = 0;
	db.payment = settledPayment();
	db.redemption = null;
	db.chain = null;
	db.spends = [];
	db.deleted = [{ payment_id: PAY_ID }];
	refundCredits.mockClear();
});

describe('assertForgePayment after the paid job failed', () => {
	it('honors a free retry when the generation the payment paid for failed past the grace window', async () => {
		db.redemption = { payment_id: PAY_ID, job_id: CREATION };
		db.chain = { id: CREATION, status: 'failed', superseded_by: null, completed_at: ago(RELEASE_GRACE_MS + 60_000) };

		const out = await assertForgePayment({ paymentId: PAY_ID, refId: REF_ID });

		expect(out.ok).toBe(true);
		expect(out.payment.id).toBe(PAY_ID);
		// The stale claim is removed, and only for the job it was bound to, so a
		// concurrent rebind to a newer creation can never be wiped.
		const del = statements('delete from forge_high_redemptions');
		expect(del).toHaveLength(1);
		expect(del[0].values).toEqual([PAY_ID, CREATION]);
	});

	it('follows failover successors and honors the retry only when the LAST attempt failed', async () => {
		db.redemption = { payment_id: PAY_ID, job_id: CREATION };
		db.chain = { id: SUCCESSOR, status: 'failed', superseded_by: null, completed_at: ago(RELEASE_GRACE_MS * 3) };
		await expect(assertForgePayment({ paymentId: PAY_ID, refId: REF_ID })).resolves.toMatchObject({ ok: true });
		const chainQuery = statements('with recursive');
		expect(chainQuery).toHaveLength(1);
		expect(chainQuery[0].values[0]).toBe(CREATION);
	});

	it('answers payment_settling with retry_after while a failure is fresh (a failover may still pick it up)', async () => {
		db.redemption = { payment_id: PAY_ID, job_id: CREATION };
		db.chain = { id: CREATION, status: 'failed', superseded_by: null, completed_at: ago(5_000) };
		const err = await assertForgePayment({ paymentId: PAY_ID, refId: REF_ID }).catch((e) => e);
		expect(err.code).toBe('payment_settling');
		expect(err.status).toBe(409);
		expect(err.retryAfter).toBeGreaterThan(0);
		expect(err.retryAfter).toBeLessThanOrEqual(Math.ceil(RELEASE_GRACE_MS / 1000));
		expect(statements('delete from forge_high_redemptions')).toHaveLength(0);
	});

	it('answers payment_settling while the paid generation is still running, so the client keeps its proof', async () => {
		db.redemption = { payment_id: PAY_ID, job_id: CREATION };
		db.chain = { id: CREATION, status: 'generating', superseded_by: null, completed_at: null };
		const err = await assertForgePayment({ paymentId: PAY_ID, refId: REF_ID }).catch((e) => e);
		expect(err.code).toBe('payment_settling');
		expect(err.status).toBe(409);
		expect(statements('delete from forge_high_redemptions')).toHaveLength(0);
	});

	it('still refuses a proof whose generation delivered, even through a failover', async () => {
		db.redemption = { payment_id: PAY_ID, job_id: CREATION };
		db.chain = { id: SUCCESSOR, status: 'done', superseded_by: null, completed_at: ago(60_000) };
		const err = await assertForgePayment({ paymentId: PAY_ID, refId: REF_ID }).catch((e) => e);
		expect(err.code).toBe('payment_already_used');
		expect(statements('delete from forge_high_redemptions')).toHaveLength(0);
	});

	it('refuses a claim bound to no job (legacy row) as already used', async () => {
		db.redemption = { payment_id: PAY_ID, job_id: null };
		const err = await assertForgePayment({ paymentId: PAY_ID, refId: REF_ID }).catch((e) => e);
		expect(err.code).toBe('payment_already_used');
		expect(statements('with recursive')).toHaveLength(0);
	});

	it('refuses when a concurrent retry already took the stale claim (the conditional delete removed nothing)', async () => {
		db.redemption = { payment_id: PAY_ID, job_id: CREATION };
		db.chain = { id: CREATION, status: 'failed', superseded_by: null, completed_at: ago(RELEASE_GRACE_MS * 2) };
		db.deleted = [];
		const err = await assertForgePayment({ paymentId: PAY_ID, refId: REF_ID }).catch((e) => e);
		expect(err.code).toBe('payment_already_used');
	});
});

describe('paid generation scope and binding', () => {
	it('records nothing outside a paid request', () => {
		expect(notePaidGeneration({ highPaymentId: PAY_ID })).toBe(false);
		expect(currentPaidGeneration()).toBe(null);
	});

	it('carries the claim and the credit spend through one request', async () => {
		await withPaidGenerationScope(async () => {
			expect(currentPaidGeneration()).toBe(null);
			expect(notePaidGeneration({ highPaymentId: PAY_ID })).toBe(true);
			await Promise.resolve();
			notePaidGeneration({ creditLedgerId: LEDGER });
			expect(currentPaidGeneration()).toEqual({ highPaymentId: PAY_ID, creditLedgerId: LEDGER });
		});
		expect(currentPaidGeneration()).toBe(null);
	});

	it('binds the claim and the spend to the creation row', async () => {
		await bindPaidGeneration(CREATION, { highPaymentId: PAY_ID, creditLedgerId: LEDGER });
		const claim = statements('update forge_high_redemptions');
		expect(claim).toHaveLength(1);
		expect(claim[0].values).toEqual([CREATION, PAY_ID]);
		const spend = statements('update credit_ledger');
		expect(spend).toHaveLength(1);
		expect(spend[0].values).toContain(LEDGER);
		expect(spend[0].values).toContain(JSON.stringify({ creation_id: CREATION }));
	});

	it('never binds to a malformed creation id', async () => {
		await bindPaidGeneration('not-a-uuid', { highPaymentId: PAY_ID });
		expect(db.calls).toHaveLength(0);
	});
});

describe('classifyOutcome', () => {
	it('reads the terminal row of a failover chain', () => {
		expect(classifyOutcome(null).state).toBe('unknown');
		expect(classifyOutcome({ status: 'done' }).state).toBe('done');
		expect(classifyOutcome({ status: 'generating' }).state).toBe('pending');
		const failed = classifyOutcome({ status: 'failed', superseded_by: null, completed_at: ago(1000) });
		expect(failed.state).toBe('failed');
		expect(failed.failedAt).toBeInstanceOf(Date);
		// A failed row that still points at a successor means the walk hit its cap
		// or the successor row is gone: never treat that as a loss.
		expect(classifyOutcome({ status: 'failed', superseded_by: SUCCESSOR }).state).toBe('unknown');
	});

	it('answers unknown for a malformed id without querying', async () => {
		expect((await paidJobOutcome('nope')).state).toBe('unknown');
		expect(db.calls).toHaveLength(0);
	});
});

describe('reconcilePaidCreditGenerations', () => {
	const spend = (over = {}) => ({
		id: LEDGER,
		user_id: USER,
		amount_usd: (-HIGH_USD).toFixed(6),
		action: 'forge.high',
		ref_id: REF_ID,
		creation_id: CREATION,
		...over,
	});

	it('refunds a credit spend whose generation failed, with the in-request refund key so it can never pay twice', async () => {
		db.spends = [spend()];
		db.chain = { id: CREATION, status: 'failed', superseded_by: null, completed_at: ago(CREDIT_REFUND_GRACE_MS + 60_000) };
		const out = await reconcilePaidCreditGenerations();
		expect(refundCredits).toHaveBeenCalledTimes(1);
		expect(refundCredits.mock.calls[0][0]).toMatchObject({
			userId: USER,
			amountUsd: HIGH_USD,
			action: 'forge.high',
			refType: 'forge',
			refId: REF_ID,
			idempotencyKey: `forge:credits:refund:${LEDGER}`,
		});
		expect(out).toMatchObject({ checked: 1, refunded: 1 });
		// The candidate query skips spends that already have that refund row.
		expect(statements('from credit_ledger')[0].text).toContain("'forge:credits:refund:'");
	});

	it('leaves delivered, running and freshly failed generations alone', async () => {
		db.spends = [spend()];
		for (const chain of [
			{ id: CREATION, status: 'done', superseded_by: null, completed_at: ago(3_600_000) },
			{ id: CREATION, status: 'generating', superseded_by: null, completed_at: null },
			{ id: CREATION, status: 'failed', superseded_by: null, completed_at: ago(60_000) },
			null,
		]) {
			db.chain = chain;
			await reconcilePaidCreditGenerations();
		}
		expect(refundCredits).not.toHaveBeenCalled();
	});

	it('keeps going when one refund throws', async () => {
		db.spends = [spend(), spend({ id: '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' })];
		db.chain = { id: CREATION, status: 'failed', superseded_by: null, completed_at: ago(CREDIT_REFUND_GRACE_MS * 2) };
		refundCredits.mockRejectedValueOnce(new Error('db blip'));
		const out = await reconcilePaidCreditGenerations();
		expect(refundCredits).toHaveBeenCalledTimes(2);
		expect(out).toMatchObject({ checked: 2, refunded: 1, errors: 1 });
	});
});

describe('GET /api/cron/forge-paid-make-whole', () => {
	const run = async (headers) => {
		const { default: handler } = await import('../api/cron/forge-paid-make-whole.js');
		const res = {
			statusCode: 200,
			headers: {},
			body: '',
			setHeader(k, v) {
				this.headers[k.toLowerCase()] = v;
			},
			getHeader(k) {
				return this.headers[k.toLowerCase()];
			},
			end(b) {
				this.body = b || '';
			},
		};
		await handler({ method: 'GET', url: '/api/cron/forge-paid-make-whole', headers }, res);
		return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
	};

	it('refuses a caller without the cron secret and refunds nothing', async () => {
		process.env.CRON_SECRET = 'cron-test-secret';
		db.spends = [{ id: LEDGER, user_id: USER, amount_usd: '-0.5', action: 'forge.high', ref_id: REF_ID, creation_id: CREATION }];
		const out = await run({});
		expect(out.status).toBe(401);
		expect(db.calls).toHaveLength(0);
		expect(refundCredits).not.toHaveBeenCalled();
	});

	it('runs the reconciler for the scheduler and reports what it did', async () => {
		process.env.CRON_SECRET = 'cron-test-secret';
		const out = await run({ authorization: 'Bearer cron-test-secret' });
		expect(out.status).toBe(200);
		expect(out.body).toMatchObject({ ok: true, checked: 0, refunded: 0, errors: 0 });
	});
});
