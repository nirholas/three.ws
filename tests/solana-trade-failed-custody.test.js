// A trade that does not land must never leave its custody row pending.
//
// runAgentTrade claims an idempotency slot (a 'pending' agent_custody_events
// row) before it recovers the key and submits. Every failure after the claim
// has to settle that row as 'failed': a pending row reads as "in flight", so a
// retry with the same idempotency key (autopilot uses the proposal id) is
// refused as trade_in_progress forever. The on-chain revert (TX_ERR: the
// transaction landed and its instructions failed) was left pending and answered
// as a 202 "not yet confirmed", which is the bug these tests pin.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

const MINT = 'THREEsynthetic11111111111111111111111111111';
const WALLET = Keypair.generate().publicKey.toBase58();

const sqlMock = vi.fn();
const updateCustodyEventMock = vi.fn(async () => {});
const submitProtectedMock = vi.fn();

vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/agent-trade-guards.js', async () => ({
	...(await vi.importActual('../api/_lib/agent-trade-guards.js')),
	updateCustodyEvent: (...a) => updateCustodyEventMock(...a),
}));
vi.mock('../api/_lib/agent-wallet.js', async () => ({
	...(await vi.importActual('../api/_lib/agent-wallet.js')),
	recoverSolanaAgentKeypair: vi.fn(async () => Keypair.generate()),
}));
vi.mock('../api/_lib/agent-pumpfun.js', async () => {
	const conn = { getBalance: async () => 5_000_000_000 };
	return { ...(await vi.importActual('../api/_lib/agent-pumpfun.js')), solanaConnection: () => conn, solanaPublicConnection: () => conn };
});
vi.mock('../api/_lib/execution-engine.js', () => ({ submitProtected: (...a) => submitProtectedMock(...a) }));
vi.mock('../api/_lib/pump-platform-fee.js', () => ({
	buildAgentTradeFee: async () => null,
	isPlatformOwnedUser: async () => true,
	effectivePumpFeeBps: async () => 0,
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: () => {} }));
vi.mock('../api/_lib/cache.js', async () => ({ ...(await vi.importActual('../api/_lib/cache.js')), cacheSet: async () => {} }));

const { runAgentTrade, parseTradeRequest } = await import('../api/agents/solana-trade.js');

// A venue executor stands in for the market only: the guard chain, the custody
// ledger and the failure handling under test are the real code.
const executor = {
	quote: async () => ({
		venue: 'amm', graduated: true,
		inAsset: MINT, inAmount: 1, inAtomics: '1000000',
		outAsset: 'SOL', outUi: 0.01, outAtomics: '10000000', decimals: 6,
		minOutUi: 0.0099, minOutAtomics: '9900000', priceImpactPct: 0.5,
	}),
	build: async () => ({ instructions: [] }),
};

function sell() {
	const parsed = parseTradeRequest({ side: 'sell', mint: MINT, token_amount_raw: '1000000', idempotency_key: 'autopilot:p1' });
	expect(parsed.ok).toBe(true);
	return runAgentTrade({ agentId: 'a1', userId: 'u1', meta: {}, address: WALLET, encryptedSecret: 'enc', parsed, ownerInitiated: true, executor });
}

beforeEach(() => {
	sqlMock.mockReset();
	updateCustodyEventMock.mockClear();
	submitProtectedMock.mockReset();
	// 1st query: no prior row for this idempotency key. 2nd: the claim insert.
	sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 77 }]).mockResolvedValue([]);
});

describe('runAgentTrade failed submit', () => {
	it('settles the custody row as failed when the submit never lands', async () => {
		submitProtectedMock.mockRejectedValueOnce(Object.assign(new Error('rpc down'), { code: 'EXEC_EXHAUSTED' }));
		const out = await sell();
		expect(out.error).toMatchObject({ code: 'send_failed' });
		expect(out.status).toBe(502);
		expect(updateCustodyEventMock).toHaveBeenCalledWith(77, expect.objectContaining({ status: 'failed' }));
	});

	it('settles the custody row as failed when the transaction reverts on-chain', async () => {
		submitProtectedMock.mockRejectedValueOnce(Object.assign(new Error('tx failed on-chain: {"InstructionError":[2,{"Custom":6003}]}'), { code: 'TX_ERR', signature: 'REVERTEDSIG' }));
		const out = await sell();
		expect(out.status).toBe(422);
		expect(out.error).toMatchObject({ code: 'trade_reverted' });
		expect(out.error.detail).toMatchObject({ signature: 'REVERTEDSIG' });
		expect(updateCustodyEventMock).toHaveBeenCalledWith(77, expect.objectContaining({ status: 'failed', signature: 'REVERTEDSIG' }));
		expect(updateCustodyEventMock).not.toHaveBeenCalledWith(77, expect.not.objectContaining({ status: expect.anything() }));
	});
});
