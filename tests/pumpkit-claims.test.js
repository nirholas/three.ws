import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted; use vi.hoisted for variables referenced inside factory.
const { getSignaturesForAddressMock, getParsedTransactionMock } = vi.hoisted(() => ({
	getSignaturesForAddressMock: vi.fn(),
	getParsedTransactionMock: vi.fn(),
}));

vi.mock('../src/erc8004/solana-deploy.js', () => ({
	detectSolanaWallet: vi.fn(),
	SOLANA_RPC: {
		mainnet: 'https://api.mainnet-beta.solana.com',
		devnet: 'https://api.devnet.solana.com',
	},
}));

vi.mock('@solana/web3.js', () => ({
	Connection: function Connection() {
		this.getSignaturesForAddress = getSignaturesForAddressMock;
		this.getParsedTransaction = getParsedTransactionMock;
	},
	PublicKey: function PublicKey(s) {
		this.toString = () => s;
	},
}));

const { listRecentClaims, watchClaims } = await import('../src/pump/pumpkit-claims.js');

// ── Fixtures ───────────────────────────────────────────────────────────────

const CREATOR = 'CREatorWALLet111111111111111111111111111111111';
const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function makeTx({
	creator = CREATOR,
	programId = PUMP_PROGRAM,
	preBalance = 0,
	postBalance = 500_000_000,
	blockTime = 1_700_000_000,
	mint = 'MINTTTT1111111111111111111111111111111111111',
} = {}) {
	return {
		transaction: {
			message: {
				instructions: [{ programId }],
				accountKeys: [{ pubkey: { toString: () => creator } }],
			},
		},
		meta: {
			innerInstructions: [],
			preBalances: [preBalance],
			postBalances: [postBalance],
			postTokenBalances: [{ mint }],
		},
		blockTime,
	};
}

// ── listRecentClaims ───────────────────────────────────────────────────────

describe('listRecentClaims', () => {
	beforeEach(() => {
		getSignaturesForAddressMock.mockReset();
		getParsedTransactionMock.mockReset();
	});

	it('returns empty array when no transactions found', async () => {
		getSignaturesForAddressMock.mockResolvedValue([]);
		const result = await listRecentClaims({ creator: CREATOR });
		expect(result).toEqual([]);
	});

	it('filters out transactions without pump.fun program involvement', async () => {
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 'sig1', blockTime: 1_700_000_000 },
		]);
		getParsedTransactionMock.mockResolvedValue(
			makeTx({ programId: 'SomeOtherProgram111111111111111111111111111' }),
		);
		const result = await listRecentClaims({ creator: CREATOR });
		expect(result).toEqual([]);
	});

	it('filters out transactions where creator lamports did not increase', async () => {
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 'sig1', blockTime: 1_700_000_000 },
		]);
		getParsedTransactionMock.mockResolvedValue(
			makeTx({ preBalance: 1_000_000_000, postBalance: 500_000_000 }),
		);
		const result = await listRecentClaims({ creator: CREATOR });
		expect(result).toEqual([]);
	});

	it('returns a claim event for a matching pump.fun transaction', async () => {
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 'sigABC', blockTime: 1_700_000_100 },
		]);
		getParsedTransactionMock.mockResolvedValue(
			makeTx({ preBalance: 0, postBalance: 500_000_000, mint: 'MINTTTT', blockTime: 1_700_000_100 }),
		);
		const result = await listRecentClaims({ creator: CREATOR });
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			signature: 'sigABC',
			mint: 'MINTTTT',
			lamports: 500_000_000,
			ts: 1_700_000_100,
		});
	});

	it('respects the limit and stops fetching after enough claims', async () => {
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 's1', blockTime: 100 },
			{ signature: 's2', blockTime: 99 },
			{ signature: 's3', blockTime: 98 },
		]);
		getParsedTransactionMock.mockResolvedValue(makeTx());
		const result = await listRecentClaims({ creator: CREATOR, limit: 2 });
		expect(result).toHaveLength(2);
	});

	it('skips transactions where getParsedTransaction throws', async () => {
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 'bad', blockTime: 100 },
			{ signature: 'good', blockTime: 99 },
		]);
		getParsedTransactionMock
			.mockRejectedValueOnce(new Error('rpc error'))
			.mockResolvedValueOnce(makeTx());
		const result = await listRecentClaims({ creator: CREATOR });
		expect(result).toHaveLength(1);
		expect(result[0].signature).toBe('good');
	});

	it('recognises inner-instruction pump.fun program calls', async () => {
		const tx = makeTx({ programId: 'SystemProgram' });
		tx.meta.innerInstructions = [{ instructions: [{ programId: PUMP_PROGRAM }] }];
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 'inner', blockTime: 1_700_000_000 },
		]);
		getParsedTransactionMock.mockResolvedValue(tx);
		const result = await listRecentClaims({ creator: CREATOR });
		expect(result).toHaveLength(1);
	});
});

// ── watchClaims ────────────────────────────────────────────────────────────

describe('watchClaims', () => {
	beforeEach(() => {
		getSignaturesForAddressMock.mockReset();
		getParsedTransactionMock.mockReset();
	});

	it('calls onClaim for each new claim on the initial poll', async () => {
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 'sig1', blockTime: 1_700_000_100 },
		]);
		getParsedTransactionMock.mockResolvedValue(makeTx({ blockTime: 1_700_000_100 }));

		const received = [];
		const ctrl = new AbortController();
		ctrl.abort(); // abort immediately — no polling interval fires

		await watchClaims({
			creator: CREATOR,
			signal: ctrl.signal,
			onClaim: (c) => received.push(c),
		});

		expect(received).toHaveLength(1);
		expect(received[0].signature).toBe('sig1');
	});

	it('filters events at or before sinceTs', async () => {
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 'old', blockTime: 1_700_000_000 },
		]);
		getParsedTransactionMock.mockResolvedValue(makeTx({ blockTime: 1_700_000_000 }));

		const received = [];
		const ctrl = new AbortController();
		ctrl.abort();

		await watchClaims({
			creator: CREATOR,
			sinceTs: 1_700_000_000, // event ts == sinceTs → filtered out
			signal: ctrl.signal,
			onClaim: (c) => received.push(c),
		});

		expect(received).toHaveLength(0);
	});

	it('aborts cleanly when signal fires before polling interval', async () => {
		getSignaturesForAddressMock.mockResolvedValue([]);

		const ctrl = new AbortController();
		ctrl.abort();

		await expect(
			watchClaims({ creator: CREATOR, signal: ctrl.signal, onClaim: vi.fn() }),
		).resolves.toBeUndefined();
	});

	it('survives onClaim throwing without propagating the error', async () => {
		getSignaturesForAddressMock.mockResolvedValue([
			{ signature: 'err', blockTime: 1_700_000_200 },
		]);
		getParsedTransactionMock.mockResolvedValue(makeTx({ blockTime: 1_700_000_200 }));

		const ctrl = new AbortController();
		ctrl.abort();

		await expect(
			watchClaims({
				creator: CREATOR,
				signal: ctrl.signal,
				onClaim: () => {
					throw new Error('handler error');
				},
			}),
		).resolves.toBeUndefined();
	});
});
