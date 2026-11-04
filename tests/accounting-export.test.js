// Accounting export: real SQL (PGlite) over the three ledgers it reads, plus the
// admin route's auth guard and the CSV contract.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const holder = vi.hoisted(() => ({ db: null, admin: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/admin.js', () => ({
	requireAdmin: async (req, res) => {
		if (holder.admin === 'ok') return { id: 'admin' };
		res.statusCode = holder.admin === 'anon' ? 401 : 403;
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify({ error: holder.admin === 'anon' ? 'unauthorized' : 'forbidden' }));
		return null;
	},
}));

const bountySql = readFileSync('api/_lib/migrations/20261105120000_vanity_bounties.sql', 'utf8');
const ledgerSql = `
create table agent_withdrawals (
  id text primary key, user_id text, agent_id text, amount bigint, currency_mint text, chain text,
  to_address text, status text, tx_signature text, created_at timestamptz default now());
create table agent_revenue_events (
  id text primary key, agent_id text, intent_id text, skill text, gross_amount bigint, fee_amount bigint,
  net_amount bigint, currency_mint text, chain text, payer_address text, created_at timestamptz default now());`;

let lib;
let handler;
beforeAll(async () => {
	lib = await import('../api/_lib/accounting-export.js');
	handler = (await import('../api/admin/accounting-export.js')).default;
});
beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(bountySql);
	await holder.db.exec(ledgerSql);
	holder.admin = 'ok';
});

const T = Date.parse('2026-10-15T12:00:00.000Z');

describe('parseRange', () => {
	it('is inclusive of the end day and rejects bad input', () => {
		const r = lib.parseRange('2026-10-01', '2026-10-31');
		expect(r.fromMs).toBe(Date.parse('2026-10-01T00:00:00Z'));
		expect(r.toMs).toBe(Date.parse('2026-11-01T00:00:00Z'));
		expect(() => lib.parseRange('10/01/2026', '2026-10-31')).toThrow(/YYYY-MM-DD/);
		expect(() => lib.parseRange('2026-10-31', '2026-10-01')).toThrow(/before/);
		expect(() => lib.parseRange('2024-01-01', '2026-01-01')).toThrow(/limited/);
	});
});

describe('collectAccountingRows', () => {
	it('merges withdrawals, platform fees and bounty escrow/payout/refund in time order with tx links', async () => {
		await holder.db.sql`insert into agent_withdrawals values ('w1','u1','a1',2000000,'USDC','solana','DestWallet','confirmed','sigW',${new Date(T).toISOString()})`;
		await holder.db.sql`insert into agent_revenue_events values ('r1','a1','pi_1','skill-x',1000000,50000,950000,'USDC','solana','PayerWallet',${new Date(T + 1000).toISOString()})`;
		await holder.db.sql`insert into agent_withdrawals values ('w-old','u1','a1',1,'USDC','solana','D','confirmed','sigOld','2026-01-01T00:00:00Z')`;
		const rec = { id: 'b1', status: 'refunded', amountAtomics: 5000000, asset: 'USDC', network: 'solana', refundAddress: 'Refundee',
			escrowTx: 'sigE', escrowSettledAt: T + 2000, payoutTx: 'sigP', payoutAt: T + 3000, winnerAddress: 'Winner', refundTx: 'sigR', refundAt: T + 4000 };
		await holder.db.sql`insert into vanity_bounties (id,status,record,created_at,amount_atomics) values ('b1','refunded',${JSON.stringify(rec)}::jsonb,${T},5000000)`;

		const rows = await lib.collectAccountingRows(lib.parseRange('2026-10-01', '2026-10-31'));
		expect(rows.map((r) => r.kind)).toEqual(['withdrawal', 'platform_fee', 'bounty_escrow', 'bounty_payout', 'bounty_refund']);
		expect(Object.keys(rows[0])).toEqual([...lib.COLUMNS]);
		expect(rows[0]).toMatchObject({ amount_atomics: '2000000', tx_url: 'https://solscan.io/tx/sigW', occurred_at: '2026-10-15T12:00:00.000Z' });
		expect(rows[1]).toMatchObject({ amount_atomics: '1000000', fee_atomics: '50000', net_atomics: '950000' });
		expect(rows[3]).toMatchObject({ counterparty: 'Winner', tx_signature: 'sigP' });
		expect(rows.find((r) => r.id === 'w-old')).toBeUndefined();
	});
});

describe('toCsv', () => {
	it('quotes, escapes and defuses spreadsheet formulas', () => {
		const csv = lib.toCsv([{ ...Object.fromEntries(lib.COLUMNS.map((c) => [c, ''])), kind: 'withdrawal', id: 'x', counterparty: '=HYPERLINK("evil")', note: 'a,b' }]);
		const [header, line] = csv.trimEnd().split('\r\n');
		expect(header).toBe(lib.COLUMNS.join(','));
		expect(line).toContain(`"'=HYPERLINK(""evil"")"`);
		expect(line).toContain('"a,b"');
	});
});

function call(query) {
	const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
	return handler({ method: 'GET', url: `/api/admin/accounting-export${query}`, headers: {} }, res).then(() => res);
}

describe('GET /api/admin/accounting-export', () => {
	it('401 without a session, 403 for a non-admin', async () => {
		holder.admin = 'anon';
		expect((await call('?from=2026-10-01&to=2026-10-31')).statusCode).toBe(401);
		holder.admin = 'user';
		expect((await call('?from=2026-10-01&to=2026-10-31')).statusCode).toBe(403);
	});
	it('serves CSV and JSON to an admin and 400s a bad range', async () => {
		const csv = await call('?from=2026-10-01&to=2026-10-31');
		expect(csv.statusCode).toBe(200);
		expect(csv.headers['content-type']).toContain('text/csv');
		expect(csv.body.startsWith(lib.COLUMNS.join(','))).toBe(true);
		const json = await call('?from=2026-10-01&to=2026-10-31&format=json');
		expect(JSON.parse(json.body)).toMatchObject({ count: 0, rows: [] });
		expect((await call('?from=nope&to=2026-10-31')).statusCode).toBe(400);
	});
});
