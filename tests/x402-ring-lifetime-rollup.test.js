// Pruning x402_self_facilitator_log must not move a lifetime figure.
//
// Runs the REAL archive-then-prune SQL (api/_lib/db-archive.js with the
// x402_self_facilitator_log spec) and the real lifetime readers against PGlite:
// totals before pruning must equal live + rollup after pruning, exactly.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { settleTotals, settleDaily } from '../api/_lib/x402/self-facilitator-totals.js';
import { archiveSlice } from '../api/_lib/db-archive.js';
import { ARCHIVED_TABLES } from '../api/_lib/db-archive-tables.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
let pg;
const sql = async (strings, ...values) => {
	const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
	return (await pg.query(text, values)).rows;
};
const query = async (text, params) => (await pg.query(text, params)).rows;

const memoryStore = () => ({
	async put(name, body) {
		return { name, size: String(body.length), md5Hash: createHash('md5').update(body).digest('base64') };
	},
});

beforeAll(async () => {
	pg = new PGlite();
	await pg.exec(`
		CREATE TABLE x402_self_facilitator_log (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ts timestamptz NOT NULL, action text NOT NULL,
			network text, payer text, pay_to text, mint text, amount_atomic bigint, tx_sig text,
			fee_lamports bigint, ok boolean NOT NULL, reject_reason text
		);
	`);
	await pg.exec(readFileSync('api/_lib/migrations/20261103120000_x402_self_facilitator_rollup.sql', 'utf8'));
	// 4 rows a day for 100 days: settle ok, settle failed, settle ok other mint, verify.
	for (let d = 0; d < 100; d++) {
		for (let k = 0; k < 4; k++) {
			await pg.query(
				`INSERT INTO x402_self_facilitator_log (ts, action, network, mint, amount_atomic, fee_lamports, ok, reject_reason)
				 VALUES (now() - make_interval(days => $1::int, mins => $2::int), $3, 'solana', $4, $5, $6, $7, $8)`,
				[d, k, k === 3 ? 'verify' : 'settle', k === 2 ? 'OtherMint1111' : USDC, 1000 + d * 7 + k, 5000 + k, k !== 1, k === 1 ? 'fee_wallet_below_floor:1<2' : null],
			);
		}
	}
});

describe('x402 lifetime totals across pruning', () => {
	it('lifetime totals are identical before and after the old rows are archived and pruned', async () => {
		const before = await settleTotals(sql, null);
		const dailyBefore = await settleDaily(sql, USDC);
		expect(before.n).toBeGreaterThan(100);

		const spec = ARCHIVED_TABLES.find((t) => t.table === 'x402_self_facilitator_log');
		const r = await archiveSlice({ query, store: memoryStore(), spec, prune: true, maxRows: 100_000, partRows: 50, pageRows: 25, runId: 'test' });
		expect(r.skipped).toBeNull();
		expect(r.deletedRows).toBeGreaterThan(100);
		expect(r.deletedRows).toBe(r.archivedRows);

		const [{ live }] = await sql`SELECT count(*)::int AS live FROM x402_self_facilitator_log`;
		expect(live).toBeLessThan(300);

		const after = await settleTotals(sql, null);
		expect(after).toEqual(before);
		expect(await settleDaily(sql, USDC)).toEqual(dailyBefore);
	});

	it('a bounded period reads the live log alone', async () => {
		const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
		const t = await settleTotals(sql, since);
		const [live] = await sql`SELECT count(*)::int AS n FROM x402_self_facilitator_log WHERE action = 'settle' AND ok = true AND ts >= ${since}::timestamptz`;
		expect(t.n).toBe(live.n);
	});

	it('keeps fault counts in the rollup by reason class', async () => {
		const rows = await sql`SELECT reject_class, sum(n)::int AS n FROM x402_self_facilitator_rollup WHERE ok = false GROUP BY 1`;
		expect(rows).toEqual([{ reject_class: 'fee_wallet_below_floor', n: expect.any(Number) }]);
	});
});
