import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Owner-funded agent budgets: the remaining on-chain allowance is a hard
// ceiling. The chain reads (delegation account, owner token balance) are the
// only impure edges; they are stubbed at the RPC boundary so the real ceiling
// math, store and guard code run unmodified.
const fetchFixed = vi.fn();
vi.mock('@solana/subscriptions', async (importOriginal) => ({
	...(await importOriginal()),
	fetchMaybeFixedDelegation: (...a) => fetchFixed(...a),
}));

const dbState = { rows: [] };
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const q = strings.join('?');
		if (q.includes('FROM agent_onchain_allowances') && q.includes('agent_id')) {
			const [agentId, network] = values;
			return Promise.resolve(dbState.rows.filter((r) => r.agent_id === agentId && r.network === network && !r.revoked_at));
		}
		throw new Error(`unexpected query: ${q}`);
	},
}));

const {
	checkAllowanceCeiling,
	recurringRemaining,
	recurringEnabled,
	kitInstructionToWeb3,
	prepareCreateAllowance,
	checkAllowancePull,
	AllowanceError,
} = await import('../api/_lib/onchain-allowance.js');
const { checkAgentAllowanceSpend } = await import('../api/_lib/onchain-allowance-store.js');

const NOW = 1_800_000_000;

describe('checkAllowanceCeiling', () => {
	it('allows a request within remaining and owner balance', () => {
		const v = checkAllowanceCeiling({ remaining: 60n, expiryTs: NOW + 100, ownerBalance: 500n, amount: 40n, nowTs: NOW });
		expect(v).toMatchObject({ allow: true, code: 'ok' });
	});

	it('refuses a request above the remaining allowance', () => {
		const v = checkAllowanceCeiling({ remaining: 60n, expiryTs: 0n, ownerBalance: 500n, amount: 80n, nowTs: NOW });
		expect(v).toMatchObject({ allow: false, code: 'allowance_exceeded', detail: { remaining: '60', requested: '80' } });
	});

	it('refuses after expiry, but treats expiry 0 as never', () => {
		expect(checkAllowanceCeiling({ remaining: 60n, expiryTs: NOW - 1, amount: 1n, nowTs: NOW }).code).toBe('allowance_expired');
		expect(checkAllowanceCeiling({ remaining: 60n, expiryTs: 0, amount: 1n, nowTs: NOW }).allow).toBe(true);
	});

	it('refuses when the owner no longer holds the funds', () => {
		const v = checkAllowanceCeiling({ remaining: 60n, ownerBalance: 5n, amount: 10n, nowTs: NOW });
		expect(v).toMatchObject({ allow: false, code: 'owner_balance_low' });
	});

	it('refuses zero, negative and missing allowances', () => {
		expect(checkAllowanceCeiling({ remaining: 60n, amount: 0n }).code).toBe('invalid_amount');
		expect(checkAllowanceCeiling({ remaining: null, amount: 1n }).code).toBe('no_allowance');
	});
});

describe('recurringRemaining', () => {
	const d = { amountPerPeriod: 100n, amountPulledInPeriod: 70n, currentPeriodStartTs: 1000n, periodLengthS: 500n };
	it('is the unspent part of the current period', () => {
		expect(recurringRemaining(d, 1200)).toBe(30n);
	});
	it('resets once the period has fully elapsed', () => {
		expect(recurringRemaining(d, 1500)).toBe(100n);
	});
	it('is zero before the first period starts', () => {
		expect(recurringRemaining(d, 900)).toBe(0n);
	});
});

describe('recurring delegation feature flag', () => {
	it('is off unless ALLOWANCE_RECURRING_ENABLED is set', () => {
		expect(recurringEnabled({})).toBe(false);
		expect(recurringEnabled({ ALLOWANCE_RECURRING_ENABLED: '1' })).toBe(true);
		expect(recurringEnabled({ ALLOWANCE_RECURRING_ENABLED: 'true' })).toBe(true);
	});

	it('refuses to prepare a recurring allowance while the flag is off', async () => {
		const [owner, agent, mint] = [0, 1, 2].map(() => Keypair.generate().publicKey.toBase58());
		await expect(
			prepareCreateAllowance({ network: 'devnet', owner, delegatee: agent, mint, amount: 10n, expiryTs: NOW, kind: 'recurring', periodLengthS: 3600, env: {} }),
		).rejects.toMatchObject({ code: 'feature_disabled' });
	});
});

describe('kitInstructionToWeb3', () => {
	it('maps kit account roles to web3.js signer and writable flags', () => {
		const keys = [0, 1, 2, 3].map(() => Keypair.generate().publicKey.toBase58());
		const ix = kitInstructionToWeb3({
			programAddress: keys[0],
			accounts: [
				{ address: keys[0], role: 0 },
				{ address: keys[1], role: 1 },
				{ address: keys[2], role: 2 },
				{ address: keys[3], role: 3 },
			],
			data: new Uint8Array([1, 2, 3]),
		});
		expect(ix.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([[false, false], [false, true], [true, false], [true, true]]);
		expect([...ix.data]).toEqual([1, 2, 3]);
	});
});

describe('guard: remaining on-chain allowance is a hard ceiling', () => {
	const owner = Keypair.generate().publicKey.toBase58();
	const agentWallet = Keypair.generate().publicKey.toBase58();
	const mint = Keypair.generate().publicKey.toBase58();
	const pda = Keypair.generate().publicKey.toBase58();
	const agentId = '11111111-1111-4111-8111-111111111111';

	// A connection double at the RPC edge. getLatestBlockhash is what every
	// transaction build needs; asserting it is never called proves the refusal
	// happens before a transaction is built.
	const conn = {
		rpcEndpoint: 'http://127.0.0.1:1',
		getAccountInfo: vi.fn(async () => ({ owner: TOKEN_PROGRAM_ID })),
		getTokenAccountBalance: vi.fn(async () => ({ value: { amount: '500000000' } })),
		getLatestBlockhash: vi.fn(),
	};

	function onChain(remaining, expiryTs = 0) {
		fetchFixed.mockResolvedValue({
			exists: true,
			data: { mint, amount: BigInt(remaining), expiryTs: BigInt(expiryTs), header: { delegator: owner, delegatee: agentWallet } },
		});
	}

	beforeEach(() => {
		fetchFixed.mockReset();
		conn.getLatestBlockhash.mockReset();
		dbState.rows = [
			{
				id: 'a1', agent_id: agentId, user_id: 'u1', network: 'devnet', kind: 'fixed', owner_wallet: owner, delegatee: agentWallet,
				mint, nonce: '1', delegation_pda: pda, cap_raw: '100000000', expiry_ts: 0, period_length_s: null,
				create_signature: 's', revoke_signature: null, revoked_at: null, created_at: new Date(),
			},
		];
	});

	it('refuses a pull above the remaining allowance without building a transaction', async () => {
		onChain(60_000_000);
		const v = await checkAgentAllowanceSpend({ agentId, network: 'devnet', mint, amount: 80_000_000n, connection: conn });
		expect(v).toMatchObject({ gated: true, allow: false, code: 'allowance_exceeded' });
		expect(v.detail).toEqual({ remaining: '60000000', requested: '80000000' });
		expect(conn.getLatestBlockhash).not.toHaveBeenCalled();
	});

	it('allows a pull within the remaining allowance', async () => {
		onChain(60_000_000);
		const v = await checkAgentAllowanceSpend({ agentId, network: 'devnet', mint, amount: 40_000_000n, connection: conn });
		expect(v).toMatchObject({ gated: true, allow: true, code: 'ok' });
		expect(v.allowance.id).toBe('a1');
	});

	it('refuses once the delegation account is gone (revoked on chain)', async () => {
		fetchFixed.mockResolvedValue({ exists: false });
		const v = await checkAgentAllowanceSpend({ agentId, network: 'devnet', mint, amount: 1n, connection: conn });
		expect(v).toMatchObject({ gated: true, allow: false, code: 'no_allowance' });
	});

	it('refuses an expired allowance', async () => {
		onChain(60_000_000, 1);
		const v = await checkAgentAllowanceSpend({ agentId, network: 'devnet', mint, amount: 1n, connection: conn });
		expect(v).toMatchObject({ gated: true, allow: false, code: 'allowance_expired' });
	});

	it('does not gate an agent or token with no allowance on file', async () => {
		const other = Keypair.generate().publicKey.toBase58();
		expect(await checkAgentAllowanceSpend({ agentId, network: 'devnet', mint: other, amount: 1n, connection: conn })).toEqual({ gated: false });
		expect(await checkAgentAllowanceSpend({ agentId, network: 'devnet', mint: 'not-an-address', amount: 1n, connection: conn })).toEqual({ gated: false });
	});

	it('checkAllowancePull reads the live owner balance as part of the ceiling', async () => {
		onChain(60_000_000);
		conn.getTokenAccountBalance.mockResolvedValueOnce({ value: { amount: '1000' } });
		const v = await checkAllowancePull({ network: 'devnet', kind: 'fixed', delegationPda: pda, amount: 5_000_000n, connection: conn });
		expect(v).toMatchObject({ allow: false, code: 'owner_balance_low' });
	});
});

describe('AllowanceError', () => {
	it('carries a machine-readable code', () => {
		const e = new AllowanceError('invalid_request', 'bad');
		expect(e).toBeInstanceOf(Error);
		expect(e.code).toBe('invalid_request');
	});
});
