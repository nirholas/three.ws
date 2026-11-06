// x402_autonomous_log is read as outbound spend. Measured 2026-11-06: each prop call
// wrote two rows, and the pipeline's row carried the quoted price even when nothing
// was paid, so a 503 that never settled was booked as $0.15.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ inserts: [] }));
const pay = vi.hoisted(() => ({ result: null }));

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const text = strings.join('?');
		if (text.includes('INSERT INTO x402_autonomous_log')) db.inserts.push({ text, values });
		return [];
	}),
}));
vi.mock('../api/_lib/x402/pay.js', () => ({
	payX402: vi.fn(async () => pay.result),
	bootstrapSolanaContext: vi.fn(),
	USDC_MINT: 'THREEsynthetic1111',
}));

const { run } = await import('../api/_lib/x402/pipelines/forge-content.js');

const ctx = { runId: 'run-1', origin: 'https://three.ws', buyer: {}, conn: {}, blockhash: 'b', mintInfo: {} };
const AMOUNT_COLUMN = 5;

describe('forge-content spend log', () => {
	beforeEach(() => {
		db.inserts.length = 0;
	});

	it('books nothing for a call that was quoted but never paid', async () => {
		pay.result = { success: false, paid: false, amountAtomic: 150000, txSig: null, status: 503, errorMsg: 'http_503' };
		const outcome = await run(ctx);
		expect(db.inserts).toHaveLength(1);
		expect(db.inserts[0].values[AMOUNT_COLUMN]).toBe(0);
		expect(outcome.recorded).toBe(true);
	});

	it('books a paid call once, with its signal summary, so the loop adds no second row', async () => {
		pay.result = {
			success: true, paid: true, amountAtomic: 150000, txSig: 'sig-1', status: 200,
			responseBody: { status: 'queued', job_id: 'job-1', tier: 'standard', backend: 'trellis_selfhost' },
		};
		const outcome = await run(ctx);
		expect(db.inserts).toHaveLength(1);
		expect(db.inserts[0].values[AMOUNT_COLUMN]).toBe(150000);
		expect(db.inserts[0].text).toContain('signal_data');
		expect(outcome.recorded).toBe(true);
		expect(outcome.amountAtomic).toBe(150000);
	});

	it('marks a thrown payment as recorded so it is not logged twice either', async () => {
		pay.result = null;
		const { payX402 } = await import('../api/_lib/x402/pay.js');
		payX402.mockRejectedValueOnce(new Error('aborted'));
		const outcome = await run(ctx);
		expect(db.inserts).toHaveLength(1);
		expect(outcome.recorded).toBe(true);
	});
});
