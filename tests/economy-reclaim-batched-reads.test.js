// The agent-reclaim leg's balance reads (reclaimIdleAgentSol in
// api/_lib/economy-sweepback.js).
//
// treasury-topup runs every 30 minutes and, while the fleet carries any SOL
// deficit, walks every platform agent wallet. It used to read them with one
// serial getBalance each: measured 2026-11-06, 10,227 getBalance calls an hour
// from /api/cron/treasury-topup, the third largest Solana RPC caller, on a day
// both paid lanes were exhausted and x402 settles were falling back to free
// lanes. getMultipleAccountsInfo answers the same lamports for 100 accounts in
// one call. The properties pinned here: the reads are batched, an unreadable
// batch is reported per wallet as a read error (never a confirmed zero, which
// would read as "nothing to reclaim"), and one malformed address cannot hide the
// other wallets in its batch.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

const rows = vi.hoisted(() => ({ current: [] }));
const KEYS = vi.hoisted(() => ({ current: new Map() }));

vi.mock('../api/_lib/db.js', () => ({ sql: async () => rows.current }));
vi.mock('../api/_lib/avatar-wallet.js', () => ({
	sendSol: vi.fn(async () => 'never-called-in-dry-run'),
	LAMPORTS_PER_SOL: 1_000_000_000,
}));
vi.mock('../api/_lib/solana-signers.js', () => ({ SOLANA_SIGNERS: [], loadSignerKeypair: async () => ({ configured: false }) }));
vi.mock('../api/_lib/execution-engine.js', () => ({ submitProtected: async () => ({ signature: 'x' }) }));
vi.mock('../api/_lib/agent-wallet.js', () => ({
	recoverSolanaAgentKeypair: async (secret) => {
		const kp = KEYS.current.get(secret);
		if (!kp) throw new Error(`no key for ${secret}`);
		return kp;
	},
}));

const { reclaimIdleAgentSol, PLATFORM_AGENT_OWNER_EMAIL } = await import('../api/_lib/economy-sweepback.js');

const LAMPORTS = 1_000_000_000;

function fleet(n, sol) {
	const out = [];
	for (let i = 0; i < n; i++) {
		const kp = Keypair.generate();
		const secret = `secret-${i}`;
		KEYS.current.set(secret, kp);
		out.push({
			agent_id: `ag-${i}`,
			name: `bot-${i}`,
			address: kp.publicKey.toBase58(),
			secret,
			owner: PLATFORM_AGENT_OWNER_EMAIL,
			strategy_enabled: false,
			per_trade_lamports: null,
			auto_fund_enabled: false,
			open_positions: 0,
			__sol: sol,
		});
	}
	return out;
}

function batchConnection(list, { failChunk = -1 } = {}) {
	const byAddress = new Map(list.map((r) => [r.address, r.__sol]));
	let chunk = 0;
	return {
		getBalance: vi.fn(async (pk) => Math.round((byAddress.get(pk.toBase58()) ?? 0) * LAMPORTS)),
		getMultipleAccountsInfo: vi.fn(async (keys) => {
			if (chunk++ === failChunk) throw new Error('429 Too Many Requests');
			return keys.map((k) => {
				const sol = byAddress.get(k.toBase58());
				return sol ? { lamports: Math.round(sol * LAMPORTS) } : null;
			});
		}),
	};
}

beforeEach(() => {
	KEYS.current = new Map();
});

describe('agent reclaim reads balances in batches, not one RPC call per wallet', () => {
	it('reads 250 wallets in 3 calls and never calls getBalance per wallet', async () => {
		rows.current = fleet(250, 0.5);
		const conn = batchConnection(rows.current);
		const res = await reclaimIdleAgentSol({ connection: conn, dryRun: true, maxWallets: 1000 });

		expect(conn.getBalance).not.toHaveBeenCalled();
		expect(conn.getMultipleAccountsInfo).toHaveBeenCalledTimes(3);
		expect(res.readErrors).toEqual([]);
		expect(res.moves.length + res.skipped.length).toBe(250);
	});

	it('an unreadable batch becomes per-wallet read errors, never a zero balance', async () => {
		rows.current = fleet(150, 0.5);
		const conn = batchConnection(rows.current, { failChunk: 1 });
		const res = await reclaimIdleAgentSol({ connection: conn, dryRun: true, maxWallets: 1000 });

		expect(res.readErrors).toHaveLength(50);
		expect(res.readErrors.every((e) => /^rpc_error: /.test(e.reason))).toBe(true);
		expect(res.readErrors[0]).toHaveProperty('name');
		const unread = new Set(res.readErrors.map((e) => e.address));
		expect(res.moves.some((m) => unread.has(m.address))).toBe(false);
		expect(res.skipped.some((s) => unread.has(s.address))).toBe(false);
		expect(res.moves.length + res.skipped.length).toBe(100);
	});

	it('a malformed address errors alone and the rest of its batch is still read', async () => {
		rows.current = fleet(5, 0.5);
		rows.current[2] = { ...rows.current[2], address: 'not-a-pubkey' };
		const conn = batchConnection(rows.current);
		const res = await reclaimIdleAgentSol({ connection: conn, dryRun: true, maxWallets: 1000 });

		expect(res.readErrors).toHaveLength(1);
		expect(res.readErrors[0]).toMatchObject({ name: 'bot-2', address: 'not-a-pubkey' });
		expect(res.readErrors[0].reason).toMatch(/^bad_address: /);
		expect(res.moves.length + res.skipped.length).toBe(4);
	});
});
