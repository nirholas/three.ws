import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, SystemProgram, PublicKey } from '@solana/web3.js';

const WALLET = Keypair.generate().publicKey.toBase58();
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AGENT = '11111111-1111-4111-8111-111111111111';
const OWNER = 'user-owner';

const usdcRow = {
	reserve: Keypair.generate().publicKey.toBase58(), mint: USDC, symbol: 'USDC', decimals: 6, price_usd: 1,
	supply_apy: 0.05, deposit_capacity_remaining: 1_000_000, risk: { liquidation_threshold: 0.85 },
};

const state = { agentOwner: OWNER, spend: { frozen: false, per_tx_usd: 50 }, position: null, simOk: true };
const venue = {
	id: 'kamino', name: 'Test Venue', market: 'M', program: 'P',
	listMarkets: vi.fn(async () => ({ markets: [usdcRow] })),
	getReserve: vi.fn(async () => usdcRow),
	getPosition: vi.fn(async () => state.position),
	buildDeposit: vi.fn(async () => buildResult()),
	buildWithdraw: vi.fn(async () => buildResult()),
	invalidateMarket: vi.fn(),
};
function buildResult() {
	return {
		instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(WALLET), toPubkey: new PublicKey(WALLET), lamports: 1 })],
		labels: ['transfer'], lookup_table_addresses: [], obligation: 'OBL', first_deposit: false,
	};
}

const conn = {
	getBalance: vi.fn(async () => 50_000_000),
	getLatestBlockhash: vi.fn(async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 })),
	getAddressLookupTable: vi.fn(async () => ({ value: null })),
	simulateTransaction: vi.fn(async () => ({ value: state.simOk ? { err: null, logs: [], unitsConsumed: 123_456, accounts: [{ lamports: 50_000_000 }, null] } : { err: 'InsufficientFunds', logs: ['boom'] } })),
	sendRawTransaction: vi.fn(),
};
let liquid = 500_000_000n;

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111', user_id: state.agentOwner, name: 'A', meta: {} }]),
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/agent-wallet.js', () => ({ ensureAgentWallet: vi.fn(async () => ({ address: WALLET })), recoverSolanaAgentKeypair: vi.fn() }));
vi.mock('../api/_lib/solana/confirm.js', () => ({ confirmOrThrow: vi.fn() }));
vi.mock('../api/_lib/agent-trade-guards.js', () => {
	class SpendLimitError extends Error {
		constructor(code, message, detail) { super(message); this.code = code; this.status = 403; this.detail = detail; }
	}
	return { getSpendLimits: vi.fn(() => state.spend), reserveSpendUsd: vi.fn(async () => ({ reservationId: 'r1' })), releaseSpendReservation: vi.fn(), updateCustodyEvent: vi.fn(), SpendLimitError };
});
vi.mock('../api/_lib/lending/index.js', () => ({ getVenue: vi.fn(() => venue), listVenues: vi.fn(() => []), DEFAULT_VENUE: 'kamino' }));
vi.mock('../api/_lib/lending/rpc.js', () => ({
	lendingConnection: () => conn, liquidBalanceRaw: vi.fn(async () => liquid), WSOL_MINT: 'So11111111111111111111111111111111111111112',
	ataFor: () => new PublicKey(WALLET), decodeTokenAmount: () => 0n,
}));

const { agentRoutes } = await import('../api/_lib/lending/routes.js');
const guards = await import('../api/_lib/agent-trade-guards.js');
const route = (name) => agentRoutes.find((r) => r.name === name);
const call = (name, extra = {}) => route(name).handler({ params: { id: AGENT }, principal: { userId: OWNER, source: 'session' }, query: {}, body: {}, req: {}, ...extra });

beforeEach(() => {
	vi.clearAllMocks();
	state.agentOwner = OWNER;
	state.spend = { frozen: false, per_tx_usd: 50 };
	state.position = null;
	state.simOk = true;
	liquid = 500_000_000n;
});

describe('route table auth', () => {
	it('keeps market reads public and everything touching the agent authenticated', () => {
		expect(route('lending.markets').auth).toBe('public');
		for (const n of ['lending.positions', 'lending.deposit', 'lending.withdraw', 'lending.earn_rule']) expect(route(n).auth).toBe('required');
		expect(route('lending.deposit').scope).toBe('wallet:write');
		expect(route('lending.positions').scope).toBe('wallet:read');
	});
	it('rejects a malformed agent id before reading anything', async () => {
		await expect(call('lending.positions', { params: { id: 'nope' } })).rejects.toBeTruthy();
	});
	it('refuses an agent the caller does not own', async () => {
		state.agentOwner = 'someone-else';
		await expect(call('lending.positions')).rejects.toMatchObject({ status: 403 });
		expect(venue.getPosition).not.toHaveBeenCalled();
	});
	it('lets only a signed-in owner session set the earn rule', () => {
		expect(() => call('lending.earn_rule', { principal: { userId: OWNER, source: 'api_key' }, body: { mode: 'deposit_idle', token: 'USDC' } })).toThrow(/signed in/);
	});
});

describe('deposit', () => {
	it('without confirm returns a simulated preview and moves nothing', async () => {
		const out = await call('lending.deposit', { body: { token: 'USDC', amount: '25' } });
		expect(out.executed).toBe(false);
		expect(out.simulation).toMatchObject({ ok: true, bounded: true, compute_units: 123_456 });
		expect(out.amount).toBe('25');
		expect(guards.reserveSpendUsd).not.toHaveBeenCalled();
		expect(conn.sendRawTransaction).not.toHaveBeenCalled();
	});
	it('refuses a deposit above the per-transaction spend cap and never reserves or sends', async () => {
		await expect(call('lending.deposit', { body: { token: 'USDC', amount: '100', confirm: true } })).rejects.toMatchObject({ code: 'check_failed', status: 422 });
		expect(guards.reserveSpendUsd).not.toHaveBeenCalled();
		expect(conn.sendRawTransaction).not.toHaveBeenCalled();
		const preview = await call('lending.deposit', { body: { token: 'USDC', amount: '100' } });
		expect(preview.checks.find((c) => c.id === 'per_tx').ok).toBe(false);
	});
	it('refuses to send when the wallet cannot cover the deposit', async () => {
		liquid = 1_000_000n;
		await expect(call('lending.deposit', { body: { token: 'USDC', amount: '10', confirm: true } })).rejects.toMatchObject({ code: 'check_failed' });
	});
	it('refuses to send when the simulation fails against chain state', async () => {
		state.simOk = false;
		const preview = await call('lending.deposit', { body: { token: 'USDC', amount: '10' } });
		expect(preview.simulation.ok).toBe(false);
		await expect(call('lending.deposit', { body: { token: 'USDC', amount: '10', confirm: true } })).rejects.toMatchObject({ code: 'check_failed' });
	});
	it('refuses a frozen wallet', async () => {
		state.spend = { frozen: true, per_tx_usd: null };
		await expect(call('lending.deposit', { body: { token: 'USDC', amount: '10', confirm: true } })).rejects.toMatchObject({ code: 'check_failed' });
	});
	it('rejects an amount with too many decimals before building', async () => {
		await expect(call('lending.deposit', { body: { token: 'USDC', amount: '1.1234567' } })).rejects.toMatchObject({ code: 'invalid_amount', status: 400 });
		expect(venue.buildDeposit).not.toHaveBeenCalled();
	});
});

describe('withdraw', () => {
	const position = (raw) => ({ obligation: 'OBL', deposits: [{ mint: USDC, amount_raw: raw, amount: Number(raw) / 1e6 }], borrows: [], stats: null });
	it('refuses more than the position holds before any transaction is built', async () => {
		state.position = position('10000000');
		await expect(call('lending.withdraw', { body: { token: 'USDC', amount: '11' } })).rejects.toMatchObject({ code: 'exceeds_position', status: 422 });
		expect(venue.buildWithdraw).not.toHaveBeenCalled();
	});
	it('refuses a withdraw when nothing is supplied', async () => {
		await expect(call('lending.withdraw', { body: { token: 'USDC', all: true } })).rejects.toMatchObject({ code: 'no_position' });
		expect(venue.buildWithdraw).not.toHaveBeenCalled();
	});
	it('previews an in-bounds withdraw without sending', async () => {
		state.position = position('10000000');
		const out = await call('lending.withdraw', { body: { token: 'USDC', amount: '4' } });
		expect(out).toMatchObject({ executed: false, kind: 'withdraw', amount: '4', all: false });
		expect(conn.sendRawTransaction).not.toHaveBeenCalled();
	});
	it('previews a full exit with all: true', async () => {
		state.position = position('10000000');
		const out = await call('lending.withdraw', { body: { token: 'USDC', all: true } });
		expect(out).toMatchObject({ all: true, amount: '10' });
	});
});

describe('earn rule', () => {
	it('rejects an unknown mode and a withdraw_below without a floor', async () => {
		await expect(call('lending.earn_rule', { body: { token: 'USDC', mode: 'yolo' } })).rejects.toMatchObject({ code: 'invalid_mode' });
		await expect(call('lending.earn_rule', { body: { token: 'USDC', mode: 'withdraw_below' } })).rejects.toMatchObject({ code: 'invalid_rule' });
	});
	it('stores a valid deposit_idle rule', async () => {
		const out = await call('lending.earn_rule', { body: { token: 'usdc', mode: 'deposit_idle', reserve: '25' } });
		expect(out).toMatchObject({ enabled: true, token: 'USDC', mode: 'deposit_idle', reserve: '25' });
	});
});
