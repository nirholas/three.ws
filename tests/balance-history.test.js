// Hourly SOL + USDC history: the chain reader, the snapshot cron and the range read.
// Only the Postgres tagged template and the RPC Connection are faked; the math,
// the SQL parameters and the summary are the real code.
import { test, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

const calls = [];
let dueRows = [];
let historyRows = [];
vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.join('?');
		calls.push({ text, values });
		if (/from agent_balance_history\s+WHERE|FROM agent_balance_history/i.test(text) && /ORDER BY captured_at ASC/i.test(text)) return historyRows;
		if (/with active as/i.test(text)) return dueRows;
		return [];
	};
	return { sql };
});
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
vi.mock('../api/_lib/trader-stats.js', () => ({ cachedSolUsd: async () => 150 }));
const rpc = { balance: 2_500_000_000, usdc: '12340000' };
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({
		getBalance: async () => rpc.balance,
		getParsedTokenAccountsByOwner: async () => ({
			value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: rpc.usdc } } } } } }],
		}),
	}),
}));

const { readSolUsdc, sumUsdcRaw, usdTotal, parseNetwork } = await import('../api/_lib/custody/balance-reader.js');
const cron = (await import('../api/cron/balance-snapshot.js')).default;
const { summarizeHistory, readBalanceHistory } = await import('../api/agents/wallet-custody.js');

function makeRes() {
	return {
		statusCode: 0, body: null, headersSent: false, writableEnded: false,
		setHeader() {}, getHeader() {}, writeHead(c) { this.statusCode = c; },
		end(p) { this.writableEnded = true; if (p) { try { this.body = JSON.parse(p); } catch { this.body = p; } } return this; },
	};
}

beforeEach(() => { calls.length = 0; dueRows = []; historyRows = []; });

test('readSolUsdc totals SOL and USDC from the chain', async () => {
	const r = await readSolUsdc({ address: Keypair.generate().publicKey.toBase58() });
	expect(r.sol).toBe(2.5);
	expect(r.usdc).toBeCloseTo(12.34, 6);
	expect(r.sol_usd).toBe(150);
	expect(r.usd_total).toBeCloseTo(2.5 * 150 + 12.34, 6);
});

test('usdTotal is null rather than wrong when SOL is held but unpriced', () => {
	expect(usdTotal({ lamports: 1_000_000_000n, usdcRaw: 5_000_000n, solUsd: null })).toBeNull();
	expect(usdTotal({ lamports: 0n, usdcRaw: 5_000_000n, solUsd: null })).toBe(5);
	expect(sumUsdcRaw([])).toBe(0n);
});

test('parseNetwork rejects anything but mainnet and devnet', () => {
	expect(parseNetwork(undefined)).toBe('mainnet');
	expect(() => parseNetwork('testnet')).toThrow(/network must be one of/);
});

test('the cron records one hourly row per due agent and reports counts', async () => {
	const a = Keypair.generate().publicKey.toBase58();
	dueRows = [{ agent_id: '11111111-1111-4111-8111-111111111111', address: a, network: 'mainnet' }];
	const res = makeRes();
	await cron({ method: 'GET', url: '/api/cron/balance-snapshot', headers: {} }, res);
	expect(res.body).toMatchObject({ ok: true, due: 1, recorded: 1, failed: 0 });
	const insert = calls.find((c) => /insert into agent_balance_history/i.test(c.text));
	expect(insert.text).toMatch(/date_trunc\('hour', now\(\)\)/);
	expect(insert.text).toMatch(/on conflict \(agent_id, network, captured_at\)/);
	expect(insert.values).toContain('2500000000');
	expect(insert.values).toContain('12340000');
});

test('summarizeHistory reports the change across the range', () => {
	const s = summarizeHistory([
		{ captured_at: 'a', usd_total: 100 }, { captured_at: 'b', usd_total: 80 }, { captured_at: 'c', usd_total: 120 },
	]);
	expect(s).toMatchObject({ count: 3, change_usd: 20, change_pct: 20, min_usd: 80, max_usd: 120 });
	expect(summarizeHistory([]).count).toBe(0);
});

test('readBalanceHistory converts raw columns into SOL and USDC and keeps order', async () => {
	historyRows = [
		{ captured_at: '2026-11-03T10:00:00Z', address: 'x', lamports: '1000000000', usdc_raw: '2000000', sol_usd: '100', usd_total: '102' },
	];
	const out = await readBalanceHistory('11111111-1111-4111-8111-111111111111', { range: '7d', network: 'mainnet' });
	expect(out.points[0]).toMatchObject({ sol: 1, usdc: 2, sol_usd: 100, usd_total: 102 });
	expect(out).toMatchObject({ range: '7d', interval: '1h' });
	const q = calls.find((c) => /FROM agent_balance_history/.test(c.text));
	expect(q.values).toContain(24 * 7);
});
