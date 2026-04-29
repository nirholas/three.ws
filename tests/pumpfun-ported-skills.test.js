import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are available inside vi.mock factories (which are hoisted).
const { mockValidateInvoicePayment, mockGetInvoiceIdPDA } = vi.hoisted(() => ({
	mockValidateInvoicePayment: vi.fn(),
	mockGetInvoiceIdPDA: vi.fn(),
}));

vi.mock('@pump-fun/agent-payments-sdk', () => {
	class PumpAgent {
		validateInvoicePayment(...args) { return mockValidateInvoicePayment(...args); }
		buildAcceptPaymentInstructions() { return Promise.resolve([]); }
	}
	return { PumpAgent, getInvoiceIdPDA: mockGetInvoiceIdPDA };
});

vi.mock('@solana/web3.js', () => {
	class PublicKey {
		constructor(val) { this._val = String(val); }
		toBase58() { return this._val; }
	}
	class Connection {}
	class Transaction { add() {} }
	return { PublicKey, Connection, Transaction, LAMPORTS_PER_SOL: 1_000_000_000 };
});

vi.mock('bn.js', () => ({ default: function BN(v) { this.v = v; this.toString = () => String(v); } }));
vi.mock('@solana/spl-token', () => ({ TOKEN_PROGRAM_ID: 'TokenProgramId' }));

vi.mock('../src/erc8004/solana-deploy.js', () => ({
	detectSolanaWallet: vi.fn(() => null),
	SOLANA_RPC: {
		mainnet: 'https://api.mainnet-beta.solana.com',
		devnet: 'https://api.devnet.solana.com',
	},
}));

// Stub heavier SDKs loaded lazily by other skills — handlers for these skills are
// never called in this test file, but the module must import cleanly.
vi.mock('@pump-fun/pump-sdk', () => ({ PumpSdk: class {}, OnlinePumpSdk: class {} }));
vi.mock('@pump-fun/pump-swap-sdk', () => ({ OnlinePumpAmmSdk: class {}, canonicalPumpPoolPda: vi.fn() }));
vi.mock('../src/pump/channel-feed.js', () => ({ fetchChannelFeed: vi.fn() }));
vi.mock('../src/pump/pumpkit-claims.js', () => ({ listRecentClaims: vi.fn() }));
vi.mock('../src/kol/wallet-pnl.js', () => ({ getWalletPnl: vi.fn() }));

const { registerPumpFunSkills } = await import('../src/agent-skills-pumpfun.js');

function makeRegistry() {
	const map = new Map();
	return {
		register(spec) { map.set(spec.name, spec); },
		get(name) { return map.get(name); },
		perform: vi.fn(),
	};
}

// ── pumpfun-verify-payment ────────────────────────────────────────────────────

describe('pumpfun-verify-payment', () => {
	let registry;

	beforeEach(() => {
		registry = makeRegistry();
		registerPumpFunSkills(registry);
		mockValidateInvoicePayment.mockReset();
	});

	it('registers with correct schema', () => {
		const skill = registry.get('pumpfun-verify-payment');
		expect(skill).toBeDefined();
		expect(skill.mcpExposed).toBe(true);
		const req = skill.inputSchema.required;
		expect(req).toContain('agentMint');
		expect(req).toContain('user');
		expect(req).toContain('currencyMint');
		expect(req).toContain('amount');
		expect(req).toContain('memo');
		expect(req).toContain('startTime');
		expect(req).toContain('endTime');
	});

	it('returns verified:true when validateInvoicePayment resolves true', async () => {
		mockValidateInvoicePayment.mockResolvedValueOnce(true);
		const skill = registry.get('pumpfun-verify-payment');
		const result = await skill.handler({
			agentMint: 'AgentMint1111111111111111111111111111111111',
			user: 'UserWallet111111111111111111111111111111111',
			currencyMint: 'USDC11111111111111111111111111111111111111',
			amount: 1_000_000,
			memo: 42,
			startTime: 1700000000,
			endTime: 1700086400,
		});
		expect(result.success).toBe(true);
		expect(result.data.verified).toBe(true);
		expect(result.output).toMatch(/confirmed/);
	});

	it('returns verified:false when validateInvoicePayment resolves false', async () => {
		mockValidateInvoicePayment.mockResolvedValueOnce(false);
		const skill = registry.get('pumpfun-verify-payment');
		const result = await skill.handler({
			agentMint: 'AgentMint1111111111111111111111111111111111',
			user: 'UserWallet111111111111111111111111111111111',
			currencyMint: 'USDC11111111111111111111111111111111111111',
			amount: 1_000_000,
			memo: 42,
			startTime: 1700000000,
			endTime: 1700086400,
		});
		expect(result.success).toBe(true);
		expect(result.data.verified).toBe(false);
		expect(result.output).toMatch(/not confirmed/);
	});

	it('rejects amount <= 0 before calling the SDK', async () => {
		const skill = registry.get('pumpfun-verify-payment');
		const result = await skill.handler({
			agentMint: 'A', user: 'B', currencyMint: 'C',
			amount: 0, memo: 1, startTime: 1000, endTime: 2000,
		});
		expect(result.success).toBe(false);
		expect(mockValidateInvoicePayment).not.toHaveBeenCalled();
	});

	it('rejects endTime <= startTime before calling the SDK', async () => {
		const skill = registry.get('pumpfun-verify-payment');
		const result = await skill.handler({
			agentMint: 'A', user: 'B', currencyMint: 'C',
			amount: 1, memo: 1, startTime: 2000, endTime: 1000,
		});
		expect(result.success).toBe(false);
		expect(mockValidateInvoicePayment).not.toHaveBeenCalled();
	});
});

// ── pumpfun-invoice-pda ───────────────────────────────────────────────────────

describe('pumpfun-invoice-pda', () => {
	let registry;

	beforeEach(() => {
		registry = makeRegistry();
		registerPumpFunSkills(registry);
		mockGetInvoiceIdPDA.mockReset();
	});

	it('registers with correct schema', () => {
		const skill = registry.get('pumpfun-invoice-pda');
		expect(skill).toBeDefined();
		expect(skill.mcpExposed).toBe(true);
		const req = skill.inputSchema.required;
		['agentMint', 'currencyMint', 'amount', 'memo', 'startTime', 'endTime'].forEach((f) =>
			expect(req).toContain(f),
		);
	});

	it('returns the PDA address and bump', async () => {
		const fakePda = { toBase58: () => 'InvoicePDA1111111111111111111111111111111111' };
		mockGetInvoiceIdPDA.mockReturnValueOnce([fakePda, 255]);

		const skill = registry.get('pumpfun-invoice-pda');
		const result = await skill.handler({
			agentMint: 'AgentMint1111111111111111111111111111111111',
			currencyMint: 'USDC11111111111111111111111111111111111111',
			amount: 1_000_000,
			memo: 42,
			startTime: 1700000000,
			endTime: 1700086400,
		});
		expect(result.success).toBe(true);
		expect(result.data.pda).toBe('InvoicePDA1111111111111111111111111111111111');
		expect(result.data.bump).toBe(255);
		expect(result.output).toMatch(/InvoicePDA/);
	});

	it('passes all six parameters to getInvoiceIdPDA in correct order', async () => {
		const fakePda = { toBase58: () => 'PDA' };
		mockGetInvoiceIdPDA.mockReturnValueOnce([fakePda, 254]);

		const skill = registry.get('pumpfun-invoice-pda');
		await skill.handler({
			agentMint: 'MINT_A',
			currencyMint: 'CURRENCY_B',
			amount: 500,
			memo: 7,
			startTime: 100,
			endTime: 200,
		});

		expect(mockGetInvoiceIdPDA).toHaveBeenCalledOnce();
		const [tm, cm, amount, memo, start, end] = mockGetInvoiceIdPDA.mock.calls[0];
		expect(tm.toBase58()).toBe('MINT_A');
		expect(cm.toBase58()).toBe('CURRENCY_B');
		expect(amount).toBe(500);
		expect(memo).toBe(7);
		expect(start).toBe(100);
		expect(end).toBe(200);
	});
});
