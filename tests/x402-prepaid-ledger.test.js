// The prepaid x402 ledger against a REAL Postgres engine (PGlite) built from the
// shipped migration. Mocked SQL could not see a lost update or a negative
// balance; these run the actual statements.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const ledger = await import('../api/_lib/x402/prepaid-ledger.js');
const settle = await import('../api/_lib/x402/prepaid-settle.js');
const { reconcileReport } = await import('../api/_lib/x402/prepaid-reconcile.js');
const { servePrepaid } = await import('../api/_lib/x402/prepaid-route.js');
const { PREPAID_ASSET, PREPAID_NETWORK } = await import('../api/_lib/x402/prepaid-chain.js');

const MIGRATION = new URL(
	'../api/_lib/migrations/20261023160000_x402_prepaid_ledger.sql',
	import.meta.url,
);

const PAYER = 'THREEsynthPayer1111111111111111111111111111';
const PAYEE_A = 'THREEsynthPayeeA111111111111111111111111111';
const PAYEE_B = 'THREEsynthPayeeB111111111111111111111111111';
const key = { payer: PAYER, network: PREPAID_NETWORK, asset: PREPAID_ASSET };

async function fund(amount, ref = `dep-${Math.random()}`) {
	return ledger.creditDeposit({ ...key, amountAtomics: amount, ref });
}
async function debit(amount, payee = PAYEE_A, ref = `req-${Math.random()}`) {
	return ledger.reserveDebit({ ...key, amountAtomics: amount, payee, route: '/api/x402/test', ref });
}

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(readFileSync(MIGRATION, 'utf8'));
});

describe('deposits', () => {
	it('credits once per transaction signature', async () => {
		const first = await ledger.creditDeposit({ ...key, amountAtomics: 5_000_000n, ref: 'sig-1' });
		const again = await ledger.creditDeposit({ ...key, amountAtomics: 5_000_000n, ref: 'sig-1' });
		expect(first).toEqual({ credited: true, balanceAtomics: 5_000_000n });
		expect(again).toEqual({ credited: false, balanceAtomics: 5_000_000n });
	});

	it('rejects a zero or non-integer amount', async () => {
		await expect(fund(0n)).rejects.toMatchObject({ code: 'bad_amount' });
		await expect(fund('1.5')).rejects.toMatchObject({ code: 'bad_amount' });
	});
});

describe('debits', () => {
	it('never takes the balance below zero', async () => {
		await fund(1000n);
		expect((await debit(1001n)).ok).toBe(false);
		expect((await debit(1000n)).ok).toBe(true);
		expect((await debit(1n)).ok).toBe(false);
		expect(await ledger.getBalance(key)).toBe(0n);
	});

	it('refuses a payer with no account', async () => {
		expect(await debit(1n)).toEqual({ ok: false, reason: 'insufficient' });
	});

	it('100 parallel debits against a small balance leave an exact balance', async () => {
		await fund(500n);
		const results = await Promise.all(Array.from({ length: 100 }, () => debit(7n)));
		const won = results.filter((r) => r.ok).length;
		const balance = await ledger.getBalance(key);
		console.log(`parallel debits: balance 500, 100 x 7 -> ${won} succeeded, balance ${balance}`);
		expect(won).toBe(71);
		expect(balance).toBe(500n - 71n * 7n);
		expect(balance).toBeGreaterThanOrEqual(0n);
		const report = await reconcileReport();
		expect(report.ok).toBe(true);
	});
});

describe('charge only success', () => {
	it('refunds a reserved debit and restores the balance', async () => {
		await fund(1000n);
		const d = await debit(400n);
		expect(await ledger.getBalance(key)).toBe(600n);
		expect(await ledger.refundDebit(d.entryId, 'handler_error')).toBe(1000n);
		expect(await ledger.refundDebit(d.entryId, 'handler_error')).toBeNull();
		expect(await ledger.getBalance(key)).toBe(1000n);
	});

	it('does not refund a committed debit, and a refunded one cannot commit', async () => {
		await fund(1000n);
		const a = await debit(100n);
		expect(await ledger.commitDebit(a.entryId)).toBe(true);
		expect(await ledger.refundDebit(a.entryId, 'late')).toBeNull();
		const b = await debit(100n);
		await ledger.refundDebit(b.entryId, 'handler_error');
		expect(await ledger.commitDebit(b.entryId)).toBe(false);
		expect(await ledger.getBalance(key)).toBe(900n);
	});

	it('sweeps reservations a dead request left behind', async () => {
		await fund(1000n);
		await debit(300n);
		await dbState.pg.query("update x402_prepaid_entries set created_at = now() - interval '1 hour'");
		expect(await ledger.sweepStaleReservations()).toBe(1);
		expect(await ledger.getBalance(key)).toBe(1000n);
		expect(await ledger.sweepStaleReservations()).toBe(0);
	});
});

describe('servePrepaid', () => {
	const requirement = { network: PREPAID_NETWORK, asset: PREPAID_ASSET, amount: '1000', payTo: PAYEE_A };

	function makeRes() {
		const res = {
			statusCode: 200,
			headers: {},
			body: null,
			writableEnded: false,
			destroyed: false,
			setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
			end(b) { this.body = b; this.writableEnded = true; },
		};
		return res;
	}
	const makeReq = () => ({ headers: {}, on() {}, off() {} });
	async function serve(handler, res = makeRes(), req = makeReq()) {
		const outcome = await servePrepaid({
			req, res, payer: PAYER, requirement, route: '/api/x402/test',
			resourceUrl: 'https://three.ws/api/x402/test', handler, challenge: { accepts: [] },
			mimeType: 'application/json', startedAt: Date.now(),
		});
		return { outcome, res };
	}

	it('debits and commits a successful call', async () => {
		await fund(5000n);
		const { outcome, res } = await serve(async () => ({ ok: true }));
		expect(outcome).toBe('served');
		expect(res.body).toBe('{"ok":true}');
		expect(res.headers['x-prepaid-charged']).toBe('1000');
		expect(await ledger.getBalance(key)).toBe(4000n);
	});

	it('does not charge a handler that throws a 5xx', async () => {
		await fund(5000n);
		const { res } = await serve(async () => {
			throw Object.assign(new Error('upstream down'), { status: 502, code: 'upstream_error' });
		});
		expect(res.statusCode).toBe(502);
		expect(await ledger.getBalance(key)).toBe(5000n);
	});

	it('does not charge a handler that throws a 4xx', async () => {
		await fund(5000n);
		await serve(async () => {
			throw Object.assign(new Error('bad input'), { status: 400, code: 'bad_request' });
		});
		expect(await ledger.getBalance(key)).toBe(5000n);
	});

	it('does not charge a cancelled request', async () => {
		await fund(5000n);
		const res = makeRes();
		const { res: out } = await serve(async () => {
			res.destroyed = true;
			return { ok: true };
		}, res);
		expect(out.body).toBeNull();
		expect(await ledger.getBalance(key)).toBe(5000n);
	});

	it('reports insufficient without touching the balance', async () => {
		await fund(500n);
		const { outcome } = await serve(async () => ({ ok: true }));
		expect(outcome).toBe('insufficient');
		expect(await ledger.getBalance(key)).toBe(500n);
	});
});

describe('batch settlement', () => {
	async function spend(count, amount, payee) {
		for (let i = 0; i < count; i++) {
			const d = await debit(amount, payee);
			await ledger.commitDebit(d.entryId);
		}
	}

	it('settles per payee in one transaction and skips payees under the floor', async () => {
		await fund(10_000_000n);
		await spend(1500, 1000n, PAYEE_A); // 1.5 USDC, over the 1 USDC floor
		await spend(100, 1000n, PAYEE_B); // 0.1 USDC, under it
		const sent = [];
		const out = await settle.runSettlementWindow({
			send: async (batches) => { sent.push(batches); return 'sigOK'; },
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]).toHaveLength(1);
		expect(sent[0][0]).toMatchObject({ payee: PAYEE_A, totalAtomics: 1_500_000n, count: 1500 });
		expect(out.plan.deferred.map((d) => d.payee)).toEqual([PAYEE_B]);

		const again = await settle.runSettlementWindow({ send: async () => { throw new Error('must not send'); } });
		expect(again.transactions).toHaveLength(0);

		const report = await reconcileReport();
		expect(report.raw.settledAtomics).toBe(1_500_000n);
		expect(report.ok).toBe(true);
	});

	it('two racing windows pay a debit once', async () => {
		await fund(10_000_000n);
		await spend(2000, 1000n, PAYEE_A);
		let total = 0n;
		const send = async (batches) => { for (const b of batches) total += b.totalAtomics; return 'sigRace'; };
		await Promise.all([settle.runSettlementWindow({ send }), settle.runSettlementWindow({ send })]);
		expect(total).toBe(2_000_000n);
	});

	it('releases the debits when the chain definitively rejects, and retries them', async () => {
		await fund(10_000_000n);
		await spend(1200, 1000n, PAYEE_A);
		const failed = await settle.runSettlementWindow({
			send: async () => { throw Object.assign(new Error('tx failed on-chain'), { code: 'TX_ERR' }); },
		});
		expect(failed.failed).toHaveLength(1);
		const retried = await settle.runSettlementWindow({ send: async () => 'sigRetry' });
		expect(retried.transactions[0].batches[0].totalAtomics).toBe(1_200_000n);
		expect((await reconcileReport()).ok).toBe(true);
	});

	it('parks an ambiguous failure instead of risking a double payment', async () => {
		await fund(10_000_000n);
		await spend(1200, 1000n, PAYEE_A);
		const parked = await settle.runSettlementWindow({ send: async () => { throw new Error('confirmation timeout'); } });
		expect(parked.unconfirmed).toHaveLength(1);
		const next = await settle.runSettlementWindow({ send: async () => { throw new Error('must not send'); } });
		expect(next.plan.settle).toHaveLength(0);
		await dbState.pg.query("update x402_prepaid_batches set created_at = now() - interval '2 hours'");
		const report = await reconcileReport();
		expect(report.problems).toEqual(['stuck_batches']);
	});

	it('splits a window across transactions at the payee cap', async () => {
		await fund(50_000_000n);
		for (let i = 0; i < 5; i++) {
			await dbState.pg.query(
				`insert into x402_prepaid_entries (kind, payer, network, asset, amount_atomic, ref, state, payee, route)
				 values ('debit', $1, $2, $3, 2000000, $4, 'committed', $5, '/r')`,
				[PAYER, PREPAID_NETWORK, PREPAID_ASSET, `seed-${i}`, `THREEsynthPayee${i}`],
			);
		}
		await dbState.pg.query("update x402_prepaid_accounts set balance_atomic = balance_atomic");
		const sizes = [];
		await settle.runSettlementWindow({
			maxPayeesPerTx: 2,
			send: async (batches) => { sizes.push(batches.length); return `sig${sizes.length}`; },
		});
		expect(sizes).toEqual([2, 2, 1]);
	});
});

describe('reconciliation', () => {
	it('reads zero on a clean ledger and flags a tampered balance', async () => {
		await fund(9_000_000n);
		const a = await debit(1_000_000n);
		await ledger.commitDebit(a.entryId);
		const b = await debit(500_000n);
		await ledger.refundDebit(b.entryId, 'handler_error');
		const clean = await reconcileReport();
		expect(clean.ok).toBe(true);
		expect(clean.raw.delta).toBe(0n);

		await dbState.pg.query('update x402_prepaid_accounts set balance_atomic = balance_atomic + 5');
		const dirty = await reconcileReport();
		expect(dirty.ok).toBe(false);
		expect(dirty.problems).toEqual(['balance_delta', 'drifted_accounts']);
	});
});
