// Settlement lifecycle for the Agent Labor Market (Moonshot 01).
// Exercises the money-moving core — runSettlement — for the happy path (verify
// pass → on-chain worker payout + author royalty + poster surplus refund +
// invocation receipt) and the refund path (verify fail → full refund, job failed).
// All on-chain + DB leaves are mocked; the real exact-integer split runs.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sql = vi.fn(async (strings, ...values) => {
	const id = values[0];
	const wallets = {
		w: { id: 'w', user_id: 'uw', name: 'Worker', meta: { solana_address: 'WADDR', encrypted_solana_secret: 'enc' } },
		p: { id: 'p', user_id: 'up', name: 'Poster', meta: { solana_address: 'PADDR' } },
	};
	return wallets[id] ? [wallets[id]] : [];
});
vi.mock('../api/_lib/db.js', () => ({ sql, isDbUnavailableError: () => false, isDbCapacityError: () => false }));

// agent-labor: real pure math, spies for the DB ops.
const claimSettle = vi.fn();
const recordVerdict = vi.fn(async () => ({}));
const markJobSettled = vi.fn(async () => ({}));
const markJobFailed = vi.fn(async () => ({}));
const setBountyStatus = vi.fn(async () => ({}));
const releaseSettleClaim = vi.fn(async () => ({}));
vi.mock('../api/_lib/agent-labor.js', async () => {
	const econ = await import('../api/_lib/labor-economics.js');
	return {
		settlementSplit: econ.settlementSplit,
		defaultRoyaltyBps: econ.defaultRoyaltyBps,
		atomicsToThree: econ.atomicsToThree,
		_toBig: econ.toBig,
		claimSettle, recordVerdict, markJobSettled, markJobFailed, setBountyStatus, releaseSettleClaim,
		getBounty: vi.fn(), getJobByBounty: vi.fn(),
	};
});

// labor-match: verifier + author resolver are the injectable decision points.
const verifyDeliverable = vi.fn();
const resolveSkillAuthorPayout = vi.fn();
vi.mock('../api/_lib/labor-match.js', () => ({
	verifyDeliverable,
	resolveSkillAuthorPayout,
	emitReasoning: vi.fn(),
	autoBidForBounty: vi.fn(),
	autoAwardIfReady: vi.fn(),
	performJob: vi.fn(),
}));

const payFromEscrow = vi.fn(async ({ toAddress, amountAtomics }) => `SIG:${toAddress}:${amountAtomics}`);
const ensureEscrowGas = vi.fn(async () => ({ topped: false, reason: 'gas_source_unconfigured' }));
vi.mock('../api/_lib/labor-escrow.js', () => ({ payFromEscrow, ensureEscrowGas }));

vi.mock('../api/_lib/agent-wallet.js', () => ({
	recoverSolanaAgentKeypair: vi.fn(async () => ({ publicKey: { toBase58: () => 'WADDR' } })),
}));
const recordInvocationReceipt = vi.fn(async () => ({ signature: 'INVSIG' }));
vi.mock('../api/_lib/agent-invocation-onchain.js', () => ({ recordInvocationReceipt }));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({ recordCustodyEvent: vi.fn(async () => 1) }));

const { runSettlement } = await import('../api/_lib/labor-settle.js');

const bounty = { id: 'b1', reward_atomics: '1000000', poster_agent_id: 'p', required_skill: 'summarize', title: 'Task' };
const job = { id: 'job1', price_atomics: '800000', worker_agent_id: 'w', deliverable: { output: 'a real deliverable' } };

beforeEach(() => {
	vi.clearAllMocks();
	claimSettle.mockResolvedValue(job); // this caller wins the settle claim
});

describe('runSettlement — happy path (verify pass)', () => {
	it('releases worker payout + author royalty + poster surplus, sums to the reward, records the receipt', async () => {
		verifyDeliverable.mockResolvedValue({ pass: true, score: 0.92, reason: 'good', verifier: 'llm' });
		resolveSkillAuthorPayout.mockResolvedValue({ payoutAddress: 'AUTHOR', authorAgentId: 'author-agent' });

		const result = await runSettlement({ job, bounty });

		expect(result.settled).toBe(true);
		expect(result.status).toBe('settled');

		// 800000 awarded → 10% royalty (80000) to author, 720000 to worker, 200000 surplus refunded to poster.
		const byTo = Object.fromEntries(payFromEscrow.mock.calls.map(([a]) => [a.toAddress, a.amountAtomics]));
		expect(byTo.WADDR).toBe(720_000n);
		expect(byTo.AUTHOR).toBe(80_000n);
		expect(byTo.PADDR).toBe(200_000n);
		// Conservation: every atomic out of escrow equals the escrowed reward.
		const total = payFromEscrow.mock.calls.reduce((s, [a]) => s + a.amountAtomics, 0n);
		expect(total).toBe(1_000_000n);

		expect(markJobSettled).toHaveBeenCalledWith('job1', expect.objectContaining({
			workerPayoutAtomics: 720_000n, royaltyAtomics: 80_000n, royaltyAuthorId: 'author-agent', invocationSig: 'INVSIG',
		}));
		expect(recordInvocationReceipt).toHaveBeenCalledTimes(1);
		expect(setBountyStatus).toHaveBeenCalledWith('b1', 'settled');
	});

	it('routes the full awarded amount to the worker when the skill has no author', async () => {
		verifyDeliverable.mockResolvedValue({ pass: true, score: 0.8, reason: 'ok', verifier: 'heuristic' });
		resolveSkillAuthorPayout.mockResolvedValue(null);

		await runSettlement({ job, bounty });
		const byTo = Object.fromEntries(payFromEscrow.mock.calls.map(([a]) => [a.toAddress, a.amountAtomics]));
		expect(byTo.WADDR).toBe(800_000n); // no royalty skimmed
		expect(byTo.AUTHOR).toBeUndefined();
		expect(byTo.PADDR).toBe(200_000n);
	});
});

describe('runSettlement — refund path (verify fail)', () => {
	it('refunds the poster in full, marks the job failed, releases nothing to the worker', async () => {
		verifyDeliverable.mockResolvedValue({ pass: false, score: 0.1, reason: 'off-spec', verifier: 'llm' });

		const result = await runSettlement({ job, bounty });

		expect(result.settled).toBe(false);
		expect(result.status).toBe('failed');
		expect(payFromEscrow).toHaveBeenCalledTimes(1);
		expect(payFromEscrow).toHaveBeenCalledWith({ toAddress: 'PADDR', amountAtomics: 1_000_000n });
		expect(markJobFailed).toHaveBeenCalledWith('job1', expect.objectContaining({ status: 'failed' }));
		expect(setBountyStatus).toHaveBeenCalledWith('b1', 'failed', expect.any(Object));
		expect(recordInvocationReceipt).not.toHaveBeenCalled();
	});

	it('a moderator-forced refund marks the job refunded (no worker blame), not failed', async () => {
		// Forced verdict from POST /api/labor/release — verifier is never consulted.
		const result = await runSettlement({
			job, bounty,
			verdict: { pass: false, score: 0, reason: 'mod refund', moderator: { admin_id: 'm1', wallet: 'MOD' } },
		});

		expect(result.status).toBe('refunded');
		expect(verifyDeliverable).not.toHaveBeenCalled(); // forced verdict skips the verifier
		expect(payFromEscrow).toHaveBeenCalledWith({ toAddress: 'PADDR', amountAtomics: 1_000_000n });
		expect(markJobFailed).toHaveBeenCalledWith('job1', expect.objectContaining({ status: 'refunded' }));
		expect(setBountyStatus).toHaveBeenCalledWith('b1', 'refunded', expect.any(Object));
	});
});

describe('runSettlement — moderator forced release', () => {
	it('pays the worker on a forced pass without consulting the verifier', async () => {
		resolveSkillAuthorPayout.mockResolvedValue(null);

		const result = await runSettlement({
			job, bounty,
			verdict: { pass: true, score: 1, reason: 'moderator release by MOD', moderator: { admin_id: 'm1', wallet: 'MOD' } },
		});

		expect(result.settled).toBe(true);
		expect(result.status).toBe('settled');
		expect(verifyDeliverable).not.toHaveBeenCalled();
		const byTo = Object.fromEntries(payFromEscrow.mock.calls.map(([a]) => [a.toAddress, a.amountAtomics]));
		expect(byTo.WADDR).toBe(800_000n);
		expect(byTo.PADDR).toBe(200_000n);
	});
});

describe('runSettlement — idempotency', () => {
	it('no-ops when another settle already owns the claim (never double-pays)', async () => {
		claimSettle.mockResolvedValue(null); // claim already taken
		sql.mockResolvedValueOnce([{ ...job, status: 'settled' }]);

		const result = await runSettlement({ job, bounty });

		expect(result.idempotent).toBe(true);
		expect(payFromEscrow).not.toHaveBeenCalled();
		expect(markJobSettled).not.toHaveBeenCalled();
	});
});

describe('runSettlement: a failed worker payout does not strand the job', () => {
	it('releases the settle claim and rethrows, so the next sweep can pay instead of no-opping forever', async () => {
		resolveSkillAuthorPayout.mockResolvedValue(null);
		payFromEscrow.mockRejectedValueOnce(new Error('transaction was not confirmed'));

		await expect(
			runSettlement({ job, bounty, verdict: { pass: true, score: 1, reason: 'ok' } }),
		).rejects.toThrow(/not confirmed/);

		expect(releaseSettleClaim).toHaveBeenCalledWith('job1');
		expect(markJobSettled).not.toHaveBeenCalled();
		expect(setBountyStatus).not.toHaveBeenCalledWith('b1', 'settled');
	});
});
