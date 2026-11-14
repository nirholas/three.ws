// Autopilot trade limits and the trade dry run.
//
// The owner bounds autonomous trading with a per-trade SOL cap and a maximum
// number of open positions (both stored in the autopilot config, 0 = unset), and
// previews a trade proposal before confirming it. The preview must carry the
// live quote (venue, expected out, minimum received, price impact) and the
// wallet guard verdicts from the same runAgentTrade path a fill uses, without
// ever signing or submitting.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const THREE_CA = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const MINT = 'THREEsynthetic11111111111111111111111111111';
const HELD_A = 'THREEsynthetic22222222222222222222222222222';
const HELD_B = 'THREEsynthetic33333333333333333333333333333';
const WALLET = 'THREEsynthetic44444444444444444444444444444';

const sqlMock = vi.fn();
const runAgentTradeMock = vi.fn();
const state = vi.hoisted(() => ({ held: [], balances: {} }));

vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/llm.js', () => ({ llmComplete: vi.fn(), llmConfigured: () => false, LlmUnavailableError: class extends Error {} }));
vi.mock('../api/_lib/three-gate.js', () => ({ THREE_CA, checkThreeBalance: vi.fn(async () => ({ balance: 0, eligible: true })) }));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({ recordCustodyEvent: vi.fn(async () => 1), updateCustodyEvent: vi.fn(async () => {}) }));
vi.mock('../api/_lib/real-funds-agreement.js', () => ({ currentSignatureFor: vi.fn(async () => ({ id: 'sig' })) }));
vi.mock('../api/_lib/agent-wallet.js', () => ({ ensureAgentWallet: vi.fn(async () => ({ address: WALLET })) }));
vi.mock('../api/_lib/solana/connection.js', async () => ({
	...(await vi.importActual('../api/_lib/solana/connection.js')),
	solanaConnection: () => ({
		getBalance: async () => 5_000_000_000,
		getParsedTokenAccountsByOwner: async (_owner, { programId }) => ({
			value: String(programId) === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
				? state.held.map((mint) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount: state.balances[mint] ?? '1000', decimals: 6 } } } } } }))
				: [],
		}),
	}),
}));
vi.mock('../api/agents/solana-trade.js', async () => {
	const actual = await vi.importActual('../api/agents/solana-trade.js');
	return { ...actual, runAgentTrade: (...a) => runAgentTradeMock(...a) };
});

const { normalizeAutopilotConfig, executeProposal, dryRunProposal } = await import('../api/_lib/autopilot.js');

const agent = { id: 'a1', user_id: 'u1', meta: { solana_address: WALLET } };
const buy = (over = {}) => ({
	id: 'p1', agentId: 'a1', kind: 'trade', rationale: 'r', sourceMemoryIds: [],
	params: { side: 'buy', mint: MINT, amount_sol: 0.2, slippage_bps: 100, ...over },
});
const metaWith = (cfg) => ({ autopilot: { enabled: true, scopes: { trade: true }, daily_spend_sol: 1, require_confirm: true, ...cfg } });
const walletRow = [{ meta: { encrypted_solana_secret: 'enc', solana_address: WALLET } }];
const QUOTE = {
	preview: true, side: 'buy', mint: MINT, network: 'mainnet', venue: 'pumpfun', graduated: false, slippage_bps: 100,
	in: { asset: 'SOL', amount: 0.2, atomics: '200000000' },
	out: { asset: MINT, amount: 51234.5, atomics: '51234500000', decimals: 6 },
	min_received: { amount: 50722.1, atomics: '50722100000' },
	price_impact_pct: 1.4, platform_fee_bps: 0, usd: 30.1, wallet_balance_sol: 5,
	guard: null, funds: null, firewall: { verdict: 'pass', score: 92, simulated: true, reasons: [], checks: [] },
};

beforeEach(() => {
	sqlMock.mockReset();
	runAgentTradeMock.mockReset();
	state.held = [];
	state.balances = {};
});

describe('autopilot trade limits config', () => {
	it('defaults both limits to unset so existing configs behave as before', () => {
		const c = normalizeAutopilotConfig({ enabled: true });
		expect(c.trade_max_sol).toBe(0);
		expect(c.max_open_positions).toBe(0);
	});

	it('keeps valid values and clamps nonsense', () => {
		expect(normalizeAutopilotConfig({ trade_max_sol: 0.25, max_open_positions: 3 })).toMatchObject({ trade_max_sol: 0.25, max_open_positions: 3 });
		expect(normalizeAutopilotConfig({ trade_max_sol: -1, max_open_positions: -2 })).toMatchObject({ trade_max_sol: 0, max_open_positions: 0 });
		expect(normalizeAutopilotConfig({ max_open_positions: 2.7 }).max_open_positions).toBe(2);
		expect(normalizeAutopilotConfig({ max_open_positions: 9999 }).max_open_positions).toBe(50);
	});
});

describe('executeProposal trade limits', () => {
	it('refuses a buy over the per-trade cap before anything is quoted', async () => {
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]);
		await expect(executeProposal({ proposal: buy(), agent, userId: 'u1', meta: metaWith({ trade_max_sol: 0.1 }), confirmed: true }))
			.rejects.toMatchObject({ code: 'per_trade_cap', status: 403 });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
	});

	it('refuses a buy of a new mint once the open-position limit is reached, not counting $THREE', async () => {
		state.held = [HELD_A, HELD_B, THREE_CA];
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]).mockResolvedValueOnce(walletRow);
		await expect(executeProposal({ proposal: buy(), agent, userId: 'u1', meta: metaWith({ max_open_positions: 2 }), confirmed: true }))
			.rejects.toMatchObject({ code: 'max_positions', status: 403 });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
	});

	it('lets a buy add to a position the wallet already holds at the limit', async () => {
		state.held = [HELD_A, MINT];
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: { signature: 'SIG', venue: 'pumpfun', custody_event_id: 3 } });
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]).mockResolvedValueOnce(walletRow)
			.mockResolvedValueOnce([{ id: 9, agent_id: 'a1', ts: 't' }])
			.mockResolvedValue([{ id: 'p1', agent_id: 'a1', kind: 'trade', status: 'executed', params: {}, source_memory_ids: [] }]);
		await executeProposal({ proposal: buy(), agent, userId: 'u1', meta: metaWith({ max_open_positions: 2 }), confirmed: true });
		expect(runAgentTradeMock).toHaveBeenCalledTimes(1);
	});

	it('never applies the buy limits to a sell', async () => {
		state.held = [HELD_A, HELD_B, MINT];
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: { signature: 'SIG', venue: 'pumpfun' } });
		sqlMock.mockResolvedValueOnce(walletRow)
			.mockResolvedValueOnce([{ id: 9, agent_id: 'a1', ts: 't' }])
			.mockResolvedValue([{ id: 'p1', agent_id: 'a1', kind: 'trade', status: 'executed', params: {}, source_memory_ids: [] }]);
		const sell = { ...buy(), params: { side: 'sell', mint: MINT, token_amount_raw: '1000', slippage_bps: 100 } };
		await executeProposal({ proposal: sell, agent, userId: 'u1', meta: metaWith({ max_open_positions: 1, trade_max_sol: 0.01 }), confirmed: true });
		expect(runAgentTradeMock).toHaveBeenCalledTimes(1);
	});
});

describe('dryRunProposal trade', () => {
	it('returns the live quote and guard verdicts from a preview-only runAgentTrade call', async () => {
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]);
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: QUOTE });
		const out = await dryRunProposal({ proposal: buy(), agent, config: normalizeAutopilotConfig(metaWith({}).autopilot) });
		expect(runAgentTradeMock).toHaveBeenCalledTimes(1);
		const arg = runAgentTradeMock.mock.calls[0][0];
		expect(arg.parsed.preview).toBe(true);
		expect(arg.encryptedSecret).toBeUndefined();
		expect(out.quote).toMatchObject({ venue: 'pumpfun', expected_out: 51234.5, min_received: 50722.1, price_impact_pct: 1.4, firewall: 'pass' });
		expect(out.checks.find((c) => c.label === 'Live quote')).toMatchObject({ ok: true });
		expect(out.checks.find((c) => c.label === 'Wallet guards')).toMatchObject({ ok: true });
		expect(out.blocked).toBe(false);
	});

	it('blocks the preview when a wallet guard would refuse the fill', async () => {
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]);
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: { ...QUOTE, guard: { status: 422, code: 'price_impact_too_high', message: 'Price impact is 9.0%, above the 5% safety limit.' } } });
		const out = await dryRunProposal({ proposal: buy(), agent, config: normalizeAutopilotConfig(metaWith({}).autopilot) });
		expect(out.checks.find((c) => c.label === 'Wallet guards')).toMatchObject({ ok: false, detail: expect.stringContaining('Price impact') });
		expect(out.blocked).toBe(true);
	});

	it('reports a quote failure as a failed check instead of throwing', async () => {
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]);
		runAgentTradeMock.mockResolvedValueOnce({ status: 404, error: { code: 'no_market', message: 'no bonding curve or AMM pool found for this mint' } });
		const out = await dryRunProposal({ proposal: buy(), agent, config: normalizeAutopilotConfig(metaWith({}).autopilot) });
		expect(out.quote).toBeNull();
		expect(out.checks.find((c) => c.label === 'Live quote')).toMatchObject({ ok: false, detail: expect.stringContaining('no bonding curve') });
		expect(out.blocked).toBe(true);
	});

	it('never provisions a wallet: an agent without one gets a failed quote check', async () => {
		const { ensureAgentWallet } = await import('../api/_lib/agent-wallet.js');
		ensureAgentWallet.mockClear();
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]);
		const out = await dryRunProposal({ proposal: buy(), agent: { ...agent, meta: {} }, config: normalizeAutopilotConfig(metaWith({}).autopilot) });
		expect(ensureAgentWallet).not.toHaveBeenCalled();
		expect(runAgentTradeMock).not.toHaveBeenCalled();
		expect(out.checks.find((c) => c.label === 'Live quote')).toMatchObject({ ok: false, detail: expect.stringContaining('no wallet') });
		expect(out.blocked).toBe(true);
	});

	it('previews the per-trade cap and position limit', async () => {
		state.held = [HELD_A];
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]);
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: QUOTE });
		const out = await dryRunProposal({ proposal: buy(), agent, config: normalizeAutopilotConfig(metaWith({ trade_max_sol: 0.1, max_open_positions: 1 }).autopilot) });
		expect(out.checks.find((c) => c.label.startsWith('Within per-trade cap'))).toMatchObject({ ok: false });
		expect(out.checks.find((c) => c.label.startsWith('Open positions'))).toMatchObject({ ok: false });
		expect(out.blocked).toBe(true);
	});

	it('judges the position limit on its own when only the per-trade cap fails', async () => {
		state.held = [];
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]);
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: QUOTE });
		const out = await dryRunProposal({ proposal: buy(), agent, config: normalizeAutopilotConfig(metaWith({ trade_max_sol: 0.1, max_open_positions: 3 }).autopilot) });
		expect(out.checks.find((c) => c.label.startsWith('Within per-trade cap'))).toMatchObject({ ok: false });
		expect(out.checks.find((c) => c.label.startsWith('Open positions'))).toMatchObject({ ok: true, detail: '0 held' });
	});
});

describe('executeProposal trade sells and receipts', () => {
	const recorded = () => sqlMock.mock.calls.some(([strings]) => String(strings?.join?.('') ?? '').includes('INSERT INTO agent_actions'));
	const sell = (params) => ({ ...buy(), params: { side: 'sell', mint: MINT, slippage_bps: 100, ...params } });
	const SELL_FILL = {
		status: 200,
		data: {
			signature: 'SELLSIG', venue: 'pumpfun', custody_event_id: 11, replayed: false,
			in: { asset: MINT, amount: 987.654321, atomics: '987654321' },
			out: { asset: 'SOL', amount: 0.42, atomics: '420000000', decimals: 9 },
			min_received: { amount: 0.4158, atomics: '415800000' },
			price_impact_pct: 0.8,
		},
	};
	const executed = () => sqlMock.mockResolvedValueOnce([{ id: 9, agent_id: 'a1', ts: 't' }])
		.mockResolvedValue([{ id: 'p1', agent_id: 'a1', kind: 'trade', status: 'executed', params: {}, source_memory_ids: [] }]);

	it('sells the whole position for amount_tokens "all" and records the SOL it realized', async () => {
		state.held = [MINT];
		state.balances[MINT] = '987654321';
		runAgentTradeMock.mockResolvedValueOnce(SELL_FILL);
		sqlMock.mockResolvedValueOnce(walletRow);
		executed();
		const out = await executeProposal({ proposal: sell({ amount_tokens: 'all' }), agent, userId: 'u1', meta: metaWith({}), confirmed: true });
		expect(runAgentTradeMock.mock.calls[0][0].parsed.tokenAmountRaw).toBe('987654321');
		expect(runAgentTradeMock.mock.calls[0][0].parsed.idempotencyKey).toBe('autopilot:p1');
		const insert = sqlMock.mock.calls.find(([strings]) => strings.join('').includes('INSERT INTO agent_actions'));
		const payload = JSON.parse(insert.find((v) => typeof v === 'string' && v.includes('SELLSIG')));
		expect(payload).toMatchObject({
			proposal_id: 'p1', side: 'sell', mint: MINT, amount_sol: 0, token_amount_raw: '987654321',
			signature: 'SELLSIG', realized_sol: 0.42, min_received: 0.4158, price_impact_pct: 0.8, custody_id: 11,
		});
		expect(out.receipt).toBe(`Sold 987.654321 tokens of ${MINT.slice(0, 6)}… for about 0.42 SOL (SELLSIG).`);
	});

	it('converts a token amount to base units with the mint decimals', async () => {
		state.held = [MINT];
		state.balances[MINT] = '987654321';
		runAgentTradeMock.mockResolvedValueOnce(SELL_FILL);
		sqlMock.mockResolvedValueOnce(walletRow);
		executed();
		await executeProposal({ proposal: sell({ amount_tokens: 12.5 }), agent, userId: 'u1', meta: metaWith({}), confirmed: true });
		expect(runAgentTradeMock.mock.calls[0][0].parsed.tokenAmountRaw).toBe('12500000');
	});

	it('refuses a sell of a token the wallet does not hold', async () => {
		state.held = [HELD_A];
		sqlMock.mockResolvedValueOnce(walletRow);
		await expect(executeProposal({ proposal: sell({ amount_tokens: 'all' }), agent, userId: 'u1', meta: metaWith({}), confirmed: true }))
			.rejects.toMatchObject({ code: 'no_position', status: 409 });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
	});

	it('refuses a sell larger than the position', async () => {
		state.held = [MINT];
		state.balances[MINT] = '1000';
		sqlMock.mockResolvedValueOnce(walletRow);
		await expect(executeProposal({ proposal: sell({ token_amount_raw: '5000' }), agent, userId: 'u1', meta: metaWith({}), confirmed: true }))
			.rejects.toMatchObject({ code: 'insufficient_tokens', status: 409 });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
	});

	it('refuses a $THREE sell at execution even if the stored params were never validated', async () => {
		state.held = [THREE_CA];
		await expect(executeProposal({ proposal: sell({ mint: THREE_CA, amount_tokens: 'all' }), agent, userId: 'u1', meta: metaWith({}), confirmed: true }))
			.rejects.toMatchObject({ code: 'three_sell_forbidden', status: 400 });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('refuses slippage above the ceiling at execution', async () => {
		await expect(executeProposal({ proposal: buy({ slippage_bps: undefined, max_slippage_bps: 900 }), agent, userId: 'u1', meta: metaWith({}), confirmed: true }))
			.rejects.toMatchObject({ code: 'invalid_trade', status: 400 });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
	});

	it('denies a trade when the scope is not granted', async () => {
		await expect(executeProposal({ proposal: buy(), agent, userId: 'u1', meta: metaWith({ scopes: { trade: false } }), confirmed: true }))
			.rejects.toMatchObject({ code: 'scope_denied', status: 403 });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
	});

	it('surfaces an underfunded wallet as a 402 and records nothing', async () => {
		runAgentTradeMock.mockResolvedValueOnce({ status: 402, error: { code: 'insufficient_sol', message: 'This buy needs more SOL than the wallet holds.' } });
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]).mockResolvedValueOnce(walletRow);
		await expect(executeProposal({ proposal: buy(), agent, userId: 'u1', meta: metaWith({}), confirmed: true }))
			.rejects.toMatchObject({ code: 'insufficient_sol', status: 402 });
		expect(recorded()).toBe(false);
	});

	it('records nothing and leaves the proposal pending when the submit fails', async () => {
		runAgentTradeMock.mockResolvedValueOnce({ status: 502, error: { code: 'send_failed', message: 'the trade could not be submitted and no funds were moved; try again' } });
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]).mockResolvedValueOnce(walletRow);
		await expect(executeProposal({ proposal: buy(), agent, userId: 'u1', meta: metaWith({}), confirmed: true }))
			.rejects.toMatchObject({ code: 'send_failed', status: 502 });
		expect(recorded()).toBe(false);
		expect(sqlMock.mock.calls.some(([s]) => s.join('').includes('UPDATE agent_autopilot_proposals'))).toBe(false);
	});

	it('writes a buy receipt with the tokens received', async () => {
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: { ...QUOTE, preview: undefined, signature: 'BUYSIG', custody_event_id: 4, replayed: false } });
		sqlMock.mockResolvedValueOnce([{ spent: '0' }]).mockResolvedValueOnce(walletRow);
		executed();
		const out = await executeProposal({ proposal: buy({ mint: THREE_CA }), agent, userId: 'u1', meta: metaWith({}), confirmed: true });
		expect(out.receipt).toBe('Bought 51,234.5 $THREE with 0.2 SOL (BUYSIG).');
	});
});

describe('dryRunProposal trade sells', () => {
	it('sizes a sell-all preview from the live position', async () => {
		state.held = [MINT];
		state.balances[MINT] = '987654321';
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: { ...QUOTE, side: 'sell', in: { asset: MINT, amount: 987.654321, atomics: '987654321' }, out: { asset: 'SOL', amount: 0.42, atomics: '420000000' } } });
		const out = await dryRunProposal({ proposal: { ...buy(), params: { side: 'sell', mint: MINT, amount_tokens: 'all' } }, agent, config: normalizeAutopilotConfig(metaWith({}).autopilot) });
		expect(runAgentTradeMock.mock.calls[0][0].parsed).toMatchObject({ preview: true, tokenAmountRaw: '987654321' });
		expect(out.checks.find((c) => c.label === 'Position held')).toMatchObject({ ok: true });
		expect(out.willDo).toContain('the whole position');
	});

	it('blocks a sell preview when the wallet holds none of the token', async () => {
		state.held = [];
		const out = await dryRunProposal({ proposal: { ...buy(), params: { side: 'sell', mint: MINT, amount_tokens: 'all' } }, agent, config: normalizeAutopilotConfig(metaWith({}).autopilot) });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
		expect(out.checks.find((c) => c.label === 'Position held')).toMatchObject({ ok: false });
		expect(out.blocked).toBe(true);
	});
});
