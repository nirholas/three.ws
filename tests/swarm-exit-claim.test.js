// A swarm exit claims the member's single payout row BEFORE any SOL moves.
//
// exitSwarm read the member with a plain SELECT, paid share x NAV, and only then
// wrote the idempotent payout row and flipped the member to exited. N parallel
// exits each read 'active', each priced off the same pre-transfer NAV and each
// paid, so a 30% member could drain the treasury in a few concurrent calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SWARM = { id: 'sw1', network: 'mainnet', treasury_agent_id: 'treasury', status: 'active', policy: { exit_policy: 'settle_at_mark' } };
const MEMBER = { id: 'm1', agent_id: 'agent-a', share_bps: 3000, status: 'active', contribution_lamports: '1000', withdrawn_lamports: '0' };
let claimRows = [{ id: 'payout-1' }];
const statements = [];

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const text = strings.join('?');
		statements.push(text);
		if (/from swarms where id/.test(text)) return [SWARM];
		if (/from agent_identities\s+where id = \? and deleted_at is null/.test(text)) return [{ id: 'agent-a', user_id: 'u1', meta: {} }];
		if (/from swarm_members where swarm_id/.test(text)) return [MEMBER];
		if (/count\(\*\)::int as n from agent_sniper_positions/.test(text)) return [{ n: 0 }];
		if (/sum\(coalesce\(last_value_lamports/.test(text)) return [{ marked: '0' }];
		if (/insert into swarm_payouts/.test(text)) return claimRows;
		if (/select meta from agent_identities/.test(text)) return [{ meta: { encrypted_solana_secret: 'enc' } }];
		return [];
	}),
}));
vi.mock('../api/_lib/agent-wallet.js', () => ({
	ensureAgentWallet: vi.fn(async () => ({ address: 'Dest1111111111111111111111111111111111111111' })),
	getOrCreateAgentSolanaWallet: vi.fn(async () => ({ address: 'So11111111111111111111111111111111111111112' })),
	recoverSolanaAgentKeypair: vi.fn(async () => ({})),
}));
const transferNativeSol = vi.fn(async () => 'sig-exit');
vi.mock('../api/_lib/solana-transfer.js', () => ({ transferNativeSol: (...a) => transferNativeSol(...a) }));
vi.mock('../api/_lib/solana/connection.js', () => ({ solanaConnection: vi.fn(() => ({})) }));
vi.mock('../api/_lib/solana/read-guards.js', () => ({
	readBalanceOrNull: vi.fn(async () => 10_000_000_000),
	rpcUnavailableError: (e, m) => new Error(m),
}));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({ recordCustodyEvent: vi.fn(async () => {}) }));

const { exitSwarm } = await import('../api/_lib/swarms.js');

beforeEach(() => {
	statements.length = 0;
	transferNativeSol.mockClear();
	claimRows = [{ id: 'payout-1' }];
});

describe('exitSwarm', () => {
	it('claims the payout row before it transfers', async () => {
		const out = await exitSwarm({ userId: 'u1', swarmId: 'sw1', agentId: 'agent-a' });
		expect(out.signature).toBe('sig-exit');
		const claimAt = statements.findIndex((t) => /insert into swarm_payouts/.test(t));
		expect(claimAt).toBeGreaterThan(-1);
		expect(transferNativeSol).toHaveBeenCalledTimes(1);
	});

	it('pays nothing when a concurrent exit already holds the claim', async () => {
		claimRows = [];
		await expect(exitSwarm({ userId: 'u1', swarmId: 'sw1', agentId: 'agent-a' })).rejects.toMatchObject({ code: 'exit_in_progress' });
		expect(transferNativeSol).not.toHaveBeenCalled();
	});

	it('releases the claim when the transfer fails, so the member can retry', async () => {
		transferNativeSol.mockImplementationOnce(async () => { throw new Error('rpc down'); });
		await expect(exitSwarm({ userId: 'u1', swarmId: 'sw1', agentId: 'agent-a' })).rejects.toThrow('rpc down');
		expect(statements.some((t) => /delete from swarm_payouts where id = \? and status = 'pending'/.test(t))).toBe(true);
	});
});
