import { describe, it, expect } from 'vitest';

import { getSelfRegistry } from '../api/_lib/x402/autonomous-registry.js';
import {
	run,
	tokenDeltasByOwner,
	verifySettleAmount,
	verifySweepMovement,
	feeDivergence,
	MAX_PARSED_TX_PER_RUN,
	ORPHAN_GRACE_MINUTES,
	TRIPWIRE_WINDOW_MINUTES,
	FEE_DIVERGENCE_THRESHOLD,
} from '../api/_lib/x402/ring-reconciliation.js';

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TREASURY = 'TREASURYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const PAYER = 'PAYERxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// Captured-SQL mock. Routes each query by matching the table it reads, records
// every statement (text + values), and resolves [] for DDL / INSERT / UPSERT.
// `settle`, `sweep`, `buyer` are the three book loads; `feeLogged` and `feeAudit`
// answer the fee-coherence pair.
function mockSql({ settle = [], sweep = [], buyer = [], feeLogged = 0, feeAudit = undefined, openMissing = [] } = {}) {
	const calls = [];
	const fn = (strings, ...values) => {
		const text = strings.join('?').replace(/\s+/g, ' ').trim();
		calls.push({ text, values });
		if (/FROM payment_reconciliation/i.test(text)) return Promise.resolve(openMissing);
		if (/FROM x402_self_facilitator_log[\s\S]*action = 'settle'[\s\S]*ORDER BY ts/i.test(text)) return Promise.resolve(settle);
		if (/FROM x402_ring_ledger[\s\S]*GROUP BY tx_sig/i.test(text)) {
			// The per-tx totals aggregate: derive from the same sweep fixtures.
			const totals = new Map();
			for (const r of sweep) {
				if (!r.tx_sig) continue;
				totals.set(r.tx_sig, (totals.get(r.tx_sig) || 0) + Number(r.amount_atomic || 0));
			}
			return Promise.resolve([...totals].map(([tx_sig, total]) => ({ tx_sig, total })));
		}
		if (/FROM x402_ring_ledger/i.test(text)) return Promise.resolve(sweep);
		if (/FROM x402_autonomous_log[\s\S]*success = true/i.test(text)) return Promise.resolve(buyer);
		if (/COALESCE\(sum\(fee_lamports\)/i.test(text)) return Promise.resolve([{ total: feeLogged }]);
		if (/FROM x402_fee_audit/i.test(text)) {
			if (feeAudit === undefined) return Promise.reject(new Error('relation "x402_fee_audit" does not exist'));
			return Promise.resolve(feeAudit === null ? [] : [{ total_fee_lamports: feeAudit }]);
		}
		return Promise.resolve([]);
	};
	fn.calls = calls;
	return fn;
}

// Fake Solana connection. `statuses` maps sig → { found, err }; absent sigs
// resolve to null (RPC gap). `parsed` maps sig → parsed-tx object.
function mockConn({ statuses = {}, parsed = {} } = {}) {
	const parsedCalls = [];
	return {
		parsedCalls,
		getSignatureStatuses: async (sigs) => ({
			value: sigs.map((s) => (s in statuses ? statuses[s] : null)),
		}),
		getParsedTransaction: async (sig) => {
			parsedCalls.push(sig);
			return parsed[sig] ?? null;
		},
	};
}

// Build a parsed-tx whose token balance deltas move `amount` of MINT to `receiver`
// from `sender`. Balances are absolute pre/post; the module diffs them.
function parsedTransfer({ sender, receiver, amount, mint = MINT }) {
	return {
		meta: {
			preTokenBalances: [
				{ owner: sender, mint, uiTokenAmount: { amount: String(amount) } },
				{ owner: receiver, mint, uiTokenAmount: { amount: '0' } },
			],
			postTokenBalances: [
				{ owner: sender, mint, uiTokenAmount: { amount: '0' } },
				{ owner: receiver, mint, uiTokenAmount: { amount: String(amount) } },
			],
		},
	};
}

function captureAlerts() {
	const alerts = [];
	return { alerts, sendAlert: async (title, detail, opts) => { alerts.push({ title, detail, opts }); } };
}

function memCache() {
	const store = new Map();
	return { store, get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } };
}

const NOW = 1_760_000_000_000; // fixed epoch ms so window math is deterministic
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function baseCtx(overrides = {}) {
	return { now: NOW, ringEnabled: false, cache: memCache(), ...captureAlerts(), ...overrides };
}

// Route the module's env-derived treasury through the pure verifier tests instead
// of process.env — verifySweepMovement takes the treasury as an argument.

describe('ring-reconciliation — pure helpers', () => {
	it('tokenDeltasByOwner nets pre/post balances per owner', () => {
		const tx = parsedTransfer({ sender: TREASURY, receiver: PAYER, amount: 1_000_000 });
		const d = tokenDeltasByOwner(tx, MINT);
		expect(d.get(TREASURY)).toBe(-1_000_000n);
		expect(d.get(PAYER)).toBe(1_000_000n);
	});

	it('tokenDeltasByOwner returns null when balances are absent', () => {
		expect(tokenDeltasByOwner({ meta: {} }, MINT)).toBeNull();
		expect(tokenDeltasByOwner(null, MINT)).toBeNull();
	});

	it('verifySettleAmount passes on exact receiver credit', () => {
		const tx = parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 500_000 });
		expect(verifySettleAmount({ pay_to: TREASURY, mint: MINT, amount_atomic: 500_000 }, tx).ok).toBe(true);
	});

	it('verifySettleAmount fails on receiver amount mismatch', () => {
		const tx = parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 400_000 });
		const r = verifySettleAmount({ pay_to: TREASURY, mint: MINT, amount_atomic: 500_000 }, tx);
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/receiver_got_400000_logged_500000/);
	});

	it('verifySettleAmount flags unparseable as soft (no false CRITICAL)', () => {
		const r = verifySettleAmount({ pay_to: TREASURY, mint: MINT, amount_atomic: 1 }, { meta: {} });
		expect(r.ok).toBe(false);
		expect(r.soft).toBe(true);
	});

	it('verifySweepMovement passes treasury→payer exact', () => {
		const tx = parsedTransfer({ sender: TREASURY, receiver: PAYER, amount: 2_000_000 });
		const r = verifySweepMovement({ from_wallet: TREASURY, to_wallet: PAYER, mint: MINT, amount_atomic: 2_000_000 }, tx, TREASURY);
		expect(r.ok).toBe(true);
	});

	it('verifySweepMovement rejects a non-treasury source', () => {
		const tx = parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1 });
		const r = verifySweepMovement({ from_wallet: PAYER, to_wallet: TREASURY, mint: MINT, amount_atomic: 1 }, tx, TREASURY);
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/sweep_source_not_treasury/);
	});

	it('verifySweepMovement rejects wrong amount', () => {
		const tx = parsedTransfer({ sender: TREASURY, receiver: PAYER, amount: 999 });
		const r = verifySweepMovement({ from_wallet: TREASURY, to_wallet: PAYER, mint: MINT, amount_atomic: 1_000 }, tx, TREASURY);
		expect(r.ok).toBe(false);
	});

	it('verifySweepMovement verifies each leg of a split sweep (payer + master revshare) via txTotal', () => {
		const MASTER = 'MasterWallet1111111111111111111111111111111';
		// One tx: treasury sends 1.0 USDC total (0.8 to payer, 0.2 to master).
		const tx = {
			meta: {
				preTokenBalances: [
					{ owner: TREASURY, mint: MINT, uiTokenAmount: { amount: '1000000' } },
					{ owner: PAYER, mint: MINT, uiTokenAmount: { amount: '0' } },
					{ owner: MASTER, mint: MINT, uiTokenAmount: { amount: '0' } },
				],
				postTokenBalances: [
					{ owner: TREASURY, mint: MINT, uiTokenAmount: { amount: '0' } },
					{ owner: PAYER, mint: MINT, uiTokenAmount: { amount: '800000' } },
					{ owner: MASTER, mint: MINT, uiTokenAmount: { amount: '200000' } },
				],
			},
		};
		const payerLeg = verifySweepMovement(
			{ from_wallet: TREASURY, to_wallet: PAYER, mint: MINT, amount_atomic: 800_000 }, tx, TREASURY, 1_000_000,
		);
		const masterLeg = verifySweepMovement(
			{ from_wallet: TREASURY, to_wallet: MASTER, mint: MINT, amount_atomic: 200_000 }, tx, TREASURY, 1_000_000,
		);
		expect(payerLeg.ok).toBe(true);
		expect(masterLeg.ok).toBe(true);
		// A leg claiming more than its on-chain credit still fails.
		const inflated = verifySweepMovement(
			{ from_wallet: TREASURY, to_wallet: MASTER, mint: MINT, amount_atomic: 300_000 }, tx, TREASURY, 1_000_000,
		);
		expect(inflated.ok).toBe(false);
	});

	it('feeDivergence: null when no audit figure, 0 when both zero, ratio otherwise', () => {
		expect(feeDivergence(100, null)).toBeNull();
		expect(feeDivergence(0, 0)).toBe(0);
		expect(feeDivergence(100, 100)).toBe(0);
		expect(feeDivergence(120, 100)).toBeCloseTo(0.1667, 3);
		expect(feeDivergence(100, 130)).toBeCloseTo(0.2308, 3);
	});
});

describe('ring-reconciliation — registry entry', () => {
	const entry = getSelfRegistry().find((e) => e.id === 'ring-reconciliation');

	it('exists, enabled, reconciliation pipeline, free, 30-min cooldown', () => {
		expect(entry).toBeTruthy();
		expect(entry.enabled).toBe(true);
		expect(entry.pipeline).toBe('reconciliation');
		expect(entry.price_atomic).toBe(0);
		expect(entry.cooldown_s).toBe(1800);
		expect(entry.cooldown_seconds).toBe(1800);
		expect(typeof entry.run).toBe('function');
	});
});

describe('ring-reconciliation run() — settle integrity (check 1)', () => {
	it('confirmed settle → reconciled verdict, no alert', async () => {
		const settle = [{ id: 1, ts: iso(60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigOK' }];
		const sql = mockSql({ settle });
		const conn = mockConn({ statuses: { sigOK: { found: true, err: null } }, parsed: { sigOK: parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 }) } });
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);

		expect(out.success).toBe(true);
		expect(out.responseData.settles_confirmed).toBe(1);
		expect(out.responseData.discrepancies).toBe(0);
		expect(ctx.alerts.length).toBe(0);
		const v = sql.calls.find((c) => /INSERT INTO payment_reconciliation/i.test(c.text));
		expect(v.values[0]).toContain('ring_facilitator_settle');
	});

	it('settle whose tx is absent on-chain (null status) → CRITICAL x402_ring_settle_missing', async () => {
		const settle = [{ id: 2, ts: iso(60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigGONE' }];
		const sql = mockSql({ settle });
		// A null value from getSignatureStatuses = the RPC searched and did NOT find
		// the signature → found:false → missing_onchain discrepancy.
		const conn = mockConn();
		conn.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => null) });
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);

		expect(out.responseData.settles_missing).toBe(1);
		expect(out.responseData.discrepancies).toBe(1);
		const v = sql.calls.find((c) => /INSERT INTO payment_reconciliation/i.test(c.text) && String(c.values[0]).includes('x402_ring_settle_missing'));
		expect(v).toBeTruthy();
	});

	it('RPC batch failure → unknown, NOT a discrepancy (self-heals next run)', async () => {
		const settle = [{ id: 3, ts: iso(60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigRPCDOWN' }];
		const sql = mockSql({ settle });
		const conn = mockConn();
		conn.getSignatureStatuses = async () => { throw new Error('rpc_unreachable'); };
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);

		expect(out.responseData.settles_unknown).toBe(1);
		expect(out.responseData.settles_missing).toBe(0);
		expect(out.responseData.discrepancies).toBe(0);
		expect(ctx.alerts.length).toBe(0);
	});

	it('settle reverted on-chain → CRITICAL x402_ring_settle_failed + page', async () => {
		const settle = [{ id: 4, ts: iso(60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigFAIL' }];
		const sql = mockSql({ settle });
		const conn = mockConn({ statuses: { sigFAIL: { found: true, err: { InstructionError: [0, 'Custom'] } } } });
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);

		expect(out.responseData.settles_failed).toBe(1);
		expect(out.responseData.discrepancies).toBe(1);
		const crit = ctx.alerts.find((a) => a.title.includes('ring reconciliation'));
		expect(crit).toBeTruthy();
		expect(crit.detail).toMatch(/x402_ring_settle_failed=1/);
		const v = sql.calls.find((c) => /INSERT INTO payment_reconciliation/i.test(c.text) && String(c.values[0]).includes('x402_ring_settle_failed'));
		expect(v).toBeTruthy();
	});

	it('settle with no signature → CRITICAL missing_signature', async () => {
		const settle = [{ id: 5, ts: iso(60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: null }];
		const sql = mockSql({ settle });
		const conn = mockConn();
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.settles_no_signature).toBe(1);
		expect(out.responseData.discrepancies).toBe(1);
	});
});

describe('ring-reconciliation run() — amount fidelity (check 2)', () => {
	it('receiver credited less than logged → CRITICAL x402_ring_amount_mismatch', async () => {
		const settle = [{ id: 10, ts: iso(60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigSHORT' }];
		const sql = mockSql({ settle });
		const conn = mockConn({
			statuses: { sigSHORT: { found: true, err: null } },
			parsed: { sigSHORT: parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 400_000 }) },
		});
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.amount_mismatches).toBe(1);
		expect(out.responseData.discrepancies).toBe(1);
		const crit = ctx.alerts.find((a) => a.title.includes('ring reconciliation'));
		expect(crit.detail).toMatch(/x402_ring_amount_mismatch=1/);
	});
});

describe('ring-reconciliation run() — sweep integrity (check 3)', () => {
	it('valid treasury→payer sweep → reconciled', async () => {
		process.env.X402_PAY_TO_SOLANA = TREASURY;
		const sweep = [{ id: 20, ts: iso(60_000), from_wallet: TREASURY, to_wallet: PAYER, mint: MINT, amount_atomic: 3_000_000, tx_sig: 'sweepOK' }];
		const sql = mockSql({ sweep });
		const conn = mockConn({
			statuses: { sweepOK: { found: true, err: null } },
			parsed: { sweepOK: parsedTransfer({ sender: TREASURY, receiver: PAYER, amount: 3_000_000 }) },
		});
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.sweeps_confirmed).toBe(1);
		expect(out.responseData.sweep_mismatches).toBe(0);
		delete process.env.X402_PAY_TO_SOLANA;
	});

	it('sweep from a non-treasury source → CRITICAL x402_ring_sweep_mismatch', async () => {
		process.env.X402_PAY_TO_SOLANA = TREASURY;
		const sweep = [{ id: 21, ts: iso(60_000), from_wallet: PAYER, to_wallet: TREASURY, mint: MINT, amount_atomic: 3_000_000, tx_sig: 'sweepBAD' }];
		const sql = mockSql({ sweep });
		const conn = mockConn({
			statuses: { sweepBAD: { found: true, err: null } },
			parsed: { sweepBAD: parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 3_000_000 }) },
		});
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.sweep_mismatches).toBe(1);
		const v = sql.calls.find((c) => /INSERT INTO payment_reconciliation/i.test(c.text) && String(c.values[0]).includes('x402_ring_sweep_mismatch'));
		expect(v).toBeTruthy();
		delete process.env.X402_PAY_TO_SOLANA;
	});
});

describe('ring-reconciliation run() — cross-log coherence (check 4)', () => {
	it('settlement with no buyer record (outside grace) → WARN orphan', async () => {
		const oldTs = iso((ORPHAN_GRACE_MINUTES + 5) * 60_000);
		const settle = [{ id: 30, ts: oldTs, payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigORPHAN' }];
		const sql = mockSql({ settle, buyer: [] });
		const conn = mockConn({
			statuses: { sigORPHAN: { found: true, err: null } },
			parsed: { sigORPHAN: parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 }) },
		});
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.orphans_settle_side).toBe(1);
		const warn = ctx.alerts.find((a) => a.title.includes('cross-log orphans'));
		expect(warn).toBeTruthy();
	});

	it('settlement inside the grace window is NOT an orphan', async () => {
		const freshTs = iso((ORPHAN_GRACE_MINUTES - 5) * 60_000);
		const settle = [{ id: 31, ts: freshTs, payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigFRESH' }];
		const sql = mockSql({ settle, buyer: [] });
		const conn = mockConn({
			statuses: { sigFRESH: { found: true, err: null } },
			parsed: { sigFRESH: parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 }) },
		});
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.orphans_settle_side).toBe(0);
	});

	it('matched settle+buyer on the same signature → no orphan', async () => {
		const ts = iso((ORPHAN_GRACE_MINUTES + 5) * 60_000);
		const settle = [{ id: 32, ts, payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigMATCH' }];
		const buyer = [{ id: 900, ts, tx_signature: 'sigMATCH', endpoint_url: '/api/x402/ring-settle' }];
		const sql = mockSql({ settle, buyer });
		const conn = mockConn({
			statuses: { sigMATCH: { found: true, err: null } },
			parsed: { sigMATCH: parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 }) },
		});
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.orphans_settle_side).toBe(0);
		expect(out.responseData.orphans_buyer_side).toBe(0);
	});

	it('ring-settle buyer row with no facilitator record → buyer-side orphan', async () => {
		const ts = iso((ORPHAN_GRACE_MINUTES + 5) * 60_000);
		const buyer = [{ id: 901, ts, tx_signature: 'sigBUYERONLY', endpoint_url: '/api/x402/ring-settle' }];
		const sql = mockSql({ settle: [], buyer });
		const conn = mockConn();
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.orphans_buyer_side).toBe(1);
	});
});

describe('ring-reconciliation run() — fee coherence (check 5)', () => {
	it('logged vs audit within 20% → reconciled, no warn', async () => {
		const sql = mockSql({ feeLogged: 100_000, feeAudit: 110_000 });
		const conn = mockConn();
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.fee_divergence).toBeLessThanOrEqual(FEE_DIVERGENCE_THRESHOLD);
		expect(ctx.alerts.find((a) => a.title.includes('fee books diverge'))).toBeFalsy();
	});

	it('logged vs audit beyond 20% → WARN + verdict', async () => {
		const sql = mockSql({ feeLogged: 100_000, feeAudit: 200_000 });
		const conn = mockConn();
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.fee_divergence).toBeGreaterThan(FEE_DIVERGENCE_THRESHOLD);
		expect(ctx.alerts.find((a) => a.title.includes('fee books diverge'))).toBeTruthy();
		const v = sql.calls.find((c) => /INSERT INTO payment_reconciliation/i.test(c.text) && String(c.values[0]).includes('x402_ring_fee_divergence'));
		expect(v).toBeTruthy();
	});

	it('no fee-audit table (fresh env) → divergence null, no crash', async () => {
		const sql = mockSql({ feeLogged: 100_000, feeAudit: undefined });
		const conn = mockConn();
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.fee_divergence).toBeNull();
		expect(out.success).toBe(true);
	});
});

describe('ring-reconciliation run() — zero-volume tripwire', () => {
	it('ring enabled + empty log → fires "enabled but silent"', async () => {
		const sql = mockSql({ settle: [] });
		const conn = mockConn();
		const ctx = baseCtx({ sql, conn, ringEnabled: true });
		const out = await run(ctx);
		expect(out.responseData.tripwire_fired).toBe(true);
		const tw = ctx.alerts.find((a) => a.title.includes('enabled but silent'));
		expect(tw).toBeTruthy();
		const v = sql.calls.find((c) => /INSERT INTO payment_reconciliation/i.test(c.text) && String(c.values[0]).includes('x402_ring_enabled_but_silent'));
		expect(v).toBeTruthy();
	});

	it('ring enabled + recent settle → tripwire does not fire, self-heals', async () => {
		const settle = [{ id: 40, ts: iso(5 * 60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigRECENT' }];
		const sql = mockSql({ settle });
		const conn = mockConn({
			statuses: { sigRECENT: { found: true, err: null } },
			parsed: { sigRECENT: parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 }) },
		});
		const ctx = baseCtx({ sql, conn, ringEnabled: true });
		const out = await run(ctx);
		expect(out.responseData.tripwire_fired).toBe(false);
		const heal = sql.calls.find((c) => /INSERT INTO payment_reconciliation/i.test(c.text) && String(c.values[0]).includes('ring_tripwire') && String(c.values[0]).includes(true));
		expect(heal).toBeTruthy();
	});

	it('settle older than the tripwire window still counts as silent', async () => {
		const settle = [{ id: 41, ts: iso((TRIPWIRE_WINDOW_MINUTES + 10) * 60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigSTALE' }];
		const sql = mockSql({ settle });
		const conn = mockConn({
			statuses: { sigSTALE: { found: true, err: null } },
			parsed: { sigSTALE: parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 }) },
		});
		const ctx = baseCtx({ sql, conn, ringEnabled: true });
		const out = await run(ctx);
		expect(out.responseData.tripwire_fired).toBe(true);
	});

	it('ring disabled + empty log → tripwire silent', async () => {
		const sql = mockSql({ settle: [] });
		const conn = mockConn();
		const ctx = baseCtx({ sql, conn, ringEnabled: false });
		const out = await run(ctx);
		expect(out.responseData.tripwire_fired).toBe(false);
		expect(ctx.alerts.find((a) => a.title.includes('enabled but silent'))).toBeFalsy();
	});
});

describe('ring-reconciliation run() — bounds & throttling', () => {
	it('never exceeds the parsed-tx budget; sweeps get first draw', async () => {
		// One sweep + many confirmed settles, all needing a parse. Budget is 50;
		// the sweep must be parsed and settle sampling capped at 49.
		process.env.X402_PAY_TO_SOLANA = TREASURY;
		const sweep = [{ id: 50, ts: iso(60_000), from_wallet: TREASURY, to_wallet: PAYER, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sw0' }];
		const settle = [];
		const statuses = { sw0: { found: true, err: null } };
		const parsed = { sw0: parsedTransfer({ sender: TREASURY, receiver: PAYER, amount: 1_000_000 }) };
		for (let i = 0; i < 100; i++) {
			const sig = `st${i}`;
			settle.push({ id: 100 + i, ts: iso(60_000 + i), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: sig });
			statuses[sig] = { found: true, err: null };
			parsed[sig] = parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 });
		}
		const sql = mockSql({ sweep, settle });
		const conn = mockConn({ statuses, parsed });
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.parsed_tx_used).toBeLessThanOrEqual(MAX_PARSED_TX_PER_RUN);
		expect(conn.parsedCalls).toContain('sw0'); // sweep parsed despite the settle flood
		expect(out.responseData.settles_confirmed).toBe(100); // all signature-verified
		expect(out.responseData.settles_amount_sampled).toBeLessThanOrEqual(MAX_PARSED_TX_PER_RUN - 1);
		delete process.env.X402_PAY_TO_SOLANA;
	});

	it('WARN alerts are throttled to one per class per window', async () => {
		const cache = memCache();
		const mk = () => {
			const sql = mockSql({ feeLogged: 100_000, feeAudit: 300_000 });
			const conn = mockConn();
			const cap = captureAlerts();
			return { sql, conn, ctx: { now: NOW, ringEnabled: false, cache, ...cap } };
		};
		const first = mk();
		await run({ sql: first.sql, conn: first.conn, ...first.ctx });
		expect(first.ctx.alerts.find((a) => a.title.includes('fee books diverge'))).toBeTruthy();
		const second = mk();
		await run({ sql: second.sql, conn: second.conn, ...second.ctx });
		// same shared cache → second run suppressed
		expect(second.ctx.alerts.find((a) => a.title.includes('fee books diverge'))).toBeFalsy();
	});

	it('empty everything → clean success, own log row, no alerts', async () => {
		const sql = mockSql();
		const conn = mockConn();
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.success).toBe(true);
		expect(out.amountAtomic).toBe(0);
		expect(out.responseData.discrepancies).toBe(0);
		expect(ctx.alerts.length).toBe(0);
		const logRow = sql.calls.find((c) => /INSERT INTO x402_autonomous_log/i.test(c.text));
		expect(logRow).toBeTruthy();
		expect(logRow.values).toContain('reconciliation');
	});
});

// Measured 2026-11-06: every run took 380 to 590s, because each of ~5,500 verdicts
// was its own serial round trip to Neon. That carried the autonomous tick past its
// 120s budget (503 cron_timeout) on every reconciliation. Sweeps also spent the
// whole parsed-tx budget, so settles_amount_sampled was 0 on every run and no
// settle amount was ever checked against the chain.
describe('ring-reconciliation run(): cost of a full book', () => {
	const settleRows = (n) => Array.from({ length: n }, (_, i) => ({
		id: i + 1, ts: iso(60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: `sigS${i}`,
	}));
	const sweepRows = (n) => Array.from({ length: n }, (_, i) => ({
		id: i + 1, ts: iso(60_000), from_wallet: TREASURY, to_wallet: PAYER, amount_atomic: 1_000_000, tx_sig: `sigW${i}`,
	}));
	const allConfirmed = (rows) => Object.fromEntries(rows.map((r) => [r.tx_sig, { found: true, err: null }]));
	const inserts = (sql) => sql.calls.filter((c) => /INSERT INTO payment_reconciliation/i.test(c.text));

	it('writes a full book in a handful of statements, not one per verdict', async () => {
		const settle = settleRows(1200);
		const sql = mockSql({ settle });
		const conn = mockConn({ statuses: allConfirmed(settle) });
		const out = await run(baseCtx({ sql, conn }));
		expect(out.responseData.settles_confirmed).toBe(1200);
		expect(inserts(sql).length).toBeLessThanOrEqual(5);
		const written = inserts(sql).flatMap((c) => JSON.parse(c.values[0]));
		expect(new Set(written.map((v) => v.source_ref)).size).toBe(1200);
	});

	it('never puts one verdict key twice in a statement (Postgres rejects that upsert)', async () => {
		const settle = settleRows(3);
		const sql = mockSql({ settle });
		const conn = mockConn({ statuses: allConfirmed(settle), parsed: {} });
		await run(baseCtx({ sql, conn }));
		for (const c of inserts(sql)) {
			const keys = JSON.parse(c.values[0]).map((v) => `${v.source}:${v.source_ref}`);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});

	it('lands verdicts before the CRITICAL page that points the operator at them', async () => {
		const settle = settleRows(1);
		const sql = mockSql({ settle });
		const conn = mockConn();
		conn.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => null) });
		let writtenWhenPaged = 0;
		const ctx = baseCtx({ sql, conn });
		ctx.sendAlert = async () => { writtenWhenPaged = inserts(sql).length; };
		await run(ctx);
		expect(writtenWhenPaged).toBeGreaterThan(0);
	});

	it('keeps part of the parsed budget for settles when sweeps outnumber it', async () => {
		process.env.X402_PAY_TO_SOLANA = TREASURY;
		const settle = settleRows(100);
		const sweep = sweepRows(100);
		const parsed = Object.fromEntries([...settle, ...sweep].map((r) => [r.tx_sig, parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 })]));
		const sql = mockSql({ settle, sweep });
		const conn = mockConn({ statuses: allConfirmed([...settle, ...sweep]), parsed });
		const out = await run(baseCtx({ sql, conn }));
		expect(out.responseData.parsed_tx_used).toBeLessThanOrEqual(MAX_PARSED_TX_PER_RUN);
		expect(out.responseData.settles_amount_sampled).toBeGreaterThanOrEqual(MAX_PARSED_TX_PER_RUN / 2);
		delete process.env.X402_PAY_TO_SOLANA;
	});

	it('stops parsing when the tick says stop and still reports what it proved', async () => {
		const settle = settleRows(20);
		const parsed = Object.fromEntries(settle.map((r) => [r.tx_sig, parsedTransfer({ sender: PAYER, receiver: TREASURY, amount: 1_000_000 })]));
		const sql = mockSql({ settle });
		const conn = mockConn({ statuses: allConfirmed(settle), parsed });
		const out = await run(baseCtx({ sql, conn, shouldStop: () => conn.parsedCalls.length >= 3 }));
		expect(conn.parsedCalls.length).toBe(3);
		expect(out.success).toBe(true);
		expect(out.responseData.settles_confirmed).toBe(20);
	});

	it('tells the loop the run already logged itself, so a run is one row and not two', async () => {
		const sql = mockSql();
		const out = await run(baseCtx({ sql, conn: mockConn() }));
		expect(out.recorded).toBe(true);
	});
});

// Measured 2026-11-06: 15,593 open x402_ring_settle_missing verdicts, and all 40 in
// a random sample were confirmed on-chain. getSignatureStatuses answers null from a
// lane without the history, and the RPC chain was rotating across exhausted lanes,
// so one null became a CRITICAL "settlement missing from the chain". Those rows
// then aged out of the 72h lookback and stayed open forever on the integrity board.
describe('ring-reconciliation run(): a null status is not proof of absence', () => {
	const settle = [{ id: 70, ts: iso(60_000), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1_000_000, tx_sig: 'sigLAG' }];
	const verdictsIn = (sql) => sql.calls
		.filter((c) => /INSERT INTO payment_reconciliation/i.test(c.text))
		.flatMap((c) => JSON.parse(c.values[0]));
	const stale = (over = {}) => ({
		source: 'ring_facilitator_settle', source_ref: '900', tx_signature: 'sigOLD', amount_atomic: '1000000',
		db_status: 'settle_ok', chain_status: 'missing_onchain', discrepancy: 'x402_ring_settle_missing', detail: { payer: PAYER },
		...over,
	});

	it('a signature one lane missed and the next lane confirms is confirmed, with no page', async () => {
		const sql = mockSql({ settle });
		const conn = mockConn();
		let calls = 0;
		conn.getSignatureStatuses = async (sigs) => {
			calls += 1;
			return { value: sigs.map(() => (calls === 1 ? null : { err: null })) };
		};
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.settles_missing).toBe(0);
		expect(out.responseData.settles_confirmed).toBe(1);
		expect(ctx.alerts.length).toBe(0);
	});

	it('an unanswered re-check is unknown, never missing', async () => {
		const sql = mockSql({ settle });
		const conn = mockConn();
		let calls = 0;
		conn.getSignatureStatuses = async (sigs) => {
			calls += 1;
			if (calls > 1) throw new Error('rpc_unreachable');
			return { value: sigs.map(() => null) };
		};
		const ctx = baseCtx({ sql, conn });
		const out = await run(ctx);
		expect(out.responseData.settles_missing).toBe(0);
		expect(out.responseData.settles_unknown).toBe(1);
		expect(ctx.alerts.length).toBe(0);
	});

	it('closes an old open verdict once the chain confirms the signature', async () => {
		const sql = mockSql({ openMissing: [stale()] });
		const conn = mockConn({ statuses: { sigOLD: { found: true, err: null } } });
		conn.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => ({ err: null })) });
		const out = await run(baseCtx({ sql, conn }));
		expect(out.responseData.stale_missing_cleared).toBe(1);
		expect(verdictsIn(sql).find((v) => v.source_ref === '900')).toMatchObject({
			source: 'ring_facilitator_settle', reconciled: true, discrepancy: null, chain_status: 'confirmed',
		});
	});

	it('keeps a still-absent verdict open and refreshes it so the queue moves on', async () => {
		const sql = mockSql({ openMissing: [stale()] });
		const conn = mockConn();
		conn.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => null) });
		const out = await run(baseCtx({ sql, conn }));
		expect(out.responseData.stale_missing_cleared).toBe(0);
		expect(verdictsIn(sql).find((v) => v.source_ref === '900')).toMatchObject({
			reconciled: false, discrepancy: 'x402_ring_settle_missing',
		});
	});

	it('pages when an old verdict turns out to have failed on-chain', async () => {
		const sql = mockSql({ openMissing: [stale()] });
		const conn = mockConn();
		conn.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => ({ err: { InstructionError: [0, 'Custom'] } })) });
		const ctx = baseCtx({ sql, conn });
		await run(ctx);
		expect(verdictsIn(sql).find((v) => v.source_ref === '900')).toMatchObject({
			reconciled: false, discrepancy: 'x402_ring_settle_failed', chain_status: 'failed_onchain',
		});
		expect(ctx.alerts.find((a) => a.title.includes('ring reconciliation')).detail).toMatch(/x402_ring_settle_failed=1/);
	});

	it('leaves an old verdict untouched when the RPC gives no answer', async () => {
		const sql = mockSql({ openMissing: [stale()] });
		const conn = mockConn();
		conn.getSignatureStatuses = async () => { throw new Error('rpc_unreachable'); };
		await run(baseCtx({ sql, conn }));
		expect(verdictsIn(sql).find((v) => v.source_ref === '900')).toBeUndefined();
	});
});

// Measured 2026-11-06: both books hit the 5,000-row cap, with the buyer book reaching
// back two hours further than the settle book, so every ring buyer row in that gap
// reported "no facilitator settle record" while the settle sat just past the cap.
describe('ring-reconciliation run(): orphans only count where both books have coverage', () => {
	const buyerRow = (i, ms) => ({ id: i, ts: iso(ms), tx_signature: `b${i}`, endpoint_url: 'https://three.ws/api/x402/ring-settle' });
	const settleRow = (i, ms) => ({ id: i, ts: iso(ms), payer: PAYER, pay_to: TREASURY, mint: MINT, amount_atomic: 1, tx_sig: `b${i}` });

	it('does not call a buyer row an orphan when the capped settle book stops short of it', async () => {
		const hour = 3_600_000;
		// 5,000 matched pairs, then one older buyer row the settle cap cut off.
		const settle = Array.from({ length: 5000 }, (_, i) => settleRow(i, hour + i * 1000));
		const buyer = [...settle.map((r) => buyerRow(r.id, hour + r.id * 1000)), buyerRow(9001, 10 * hour)];
		const statuses = Object.fromEntries(settle.map((r) => [r.tx_sig, { err: null }]));
		const out = await run(baseCtx({ sql: mockSql({ settle, buyer }), conn: mockConn({ statuses }) }));
		expect(out.responseData.orphans_buyer_side).toBe(0);
	});

	it('still reports a real orphan inside the covered span', async () => {
		const hour = 3_600_000;
		const settle = [settleRow(1, hour)];
		const buyer = [buyerRow(2, hour)];
		const out = await run(baseCtx({ sql: mockSql({ settle, buyer }), conn: mockConn({ statuses: { b1: { err: null } } }) }));
		expect(out.responseData.orphans_buyer_side).toBe(1);
		expect(out.responseData.orphans_settle_side).toBe(1);
	});
});
