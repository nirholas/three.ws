// Hourly SOL + USDC history: the chain reader, the snapshot cron and the range read.
// Only the Postgres tagged template and the RPC Connection are faked; the math,
// the SQL parameters and the summary are the real code.
import { test, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { AccountLayout, ACCOUNT_SIZE, getAssociatedTokenAddressSync } from '@solana/spl-token';

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
const rpc = { balance: 2_500_000_000, usdc: '12340000', perWallet: 0, multi: [] };
function tokenAccountData(amount) {
	const data = Buffer.alloc(ACCOUNT_SIZE);
	AccountLayout.encode({
		mint: PublicKey.default, owner: PublicKey.default, amount: BigInt(amount), delegateOption: 0, delegate: PublicKey.default,
		state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default,
	}, data);
	return data;
}
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({
		getMultipleAccountsInfo: async (keys) => {
			rpc.multi.push(keys.length);
			return keys.map((_, i) => (i % 2 === 0 ? { lamports: rpc.balance, data: Buffer.alloc(0) } : { lamports: 2039280, data: tokenAccountData(rpc.usdc) }));
		},
		getBalance: async () => { rpc.perWallet += 1; return rpc.balance; },
		getParsedTokenAccountsByOwner: async () => { rpc.perWallet += 1; return {
			value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: rpc.usdc } } } } } }],
		}; },
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

beforeEach(() => { calls.length = 0; dueRows = []; historyRows = []; rpc.perWallet = 0; rpc.multi = []; });

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

test('the cron values a whole batch in a constant number of RPC calls, not two per wallet', async () => {
	// 60 wallets at two calls each burst 120 requests, which rate-limited Helius and
	// the free tail in a live run (49 of 60 snapshots failed with 429).
	dueRows = Array.from({ length: 60 }, (_, i) => ({
		agent_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
		address: Keypair.generate().publicKey.toBase58(),
		network: 'mainnet',
	}));
	const res = makeRes();
	await cron({ method: 'GET', url: '/api/cron/balance-snapshot', headers: {} }, res);
	expect(res.body).toMatchObject({ ok: true, due: 60, recorded: 60, failed: 0 });
	expect(rpc.perWallet).toBe(0);
	expect(rpc.multi.length).toBeLessThanOrEqual(2);
	expect(rpc.multi.every((n) => n <= 100)).toBe(true);
	const inserts = calls.filter((c) => /insert into agent_balance_history/i.test(c.text));
	expect(inserts).toHaveLength(60);
	expect(inserts[0].values).toContain('2500000000');
	expect(inserts[0].values).toContain('12340000');
});

test('readSolUsdcMany reads each owner and its USDC associated token account', async () => {
	const { readSolUsdcMany } = await import('../api/_lib/custody/balance-reader.js');
	const owner = Keypair.generate().publicKey;
	const seen = [];
	const connection = {
		getMultipleAccountsInfo: async (keys) => { seen.push(...keys.map((k) => k.toBase58())); return [{ lamports: 1_000_000_000 }, null]; },
	};
	const out = await readSolUsdcMany({ addresses: [owner.toBase58()], network: 'devnet', connection, solUsd: null });
	const ata = getAssociatedTokenAddressSync(new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), owner, true);
	expect(seen).toEqual([owner.toBase58(), ata.toBase58()]);
	const r = out.get(owner.toBase58());
	expect(r).toMatchObject({ network: 'devnet', sol: 1, usdc: 0, sol_usd: null, usd_total: null });
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
