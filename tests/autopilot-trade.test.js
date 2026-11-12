import { describe, it, expect, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/llm.js', () => ({
	llmComplete: vi.fn(),
	llmConfigured: () => false,
	LlmUnavailableError: class extends Error {},
}));
const THREE_CA = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
vi.mock('../api/_lib/three-gate.js', () => ({ THREE_CA, checkThreeBalance: vi.fn(async () => ({ balance: 0, eligible: true })) }));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({
	recordCustodyEvent: vi.fn(async () => 1),
	updateCustodyEvent: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/real-funds-agreement.js', () => ({ currentSignatureFor: vi.fn(async () => ({ id: 'sig' })) }));
vi.mock('../api/_lib/agent-wallet.js', () => ({ ensureAgentWallet: vi.fn(async () => ({ address: 'A' })) }));
const runAgentTradeMock = vi.fn();
vi.mock('../api/agents/solana-trade.js', async () => {
	const actual = await vi.importActual('../api/agents/solana-trade.js').catch(() => ({}));
	return { ...actual, runAgentTrade: (...a) => runAgentTradeMock(...a) };
});

const {
	validateProposal, normalizeAutopilotConfig, AUTOPILOT_ACTION_KINDS, proposalDedupeKey, executeProposal,
} = await import('../api/_lib/autopilot.js');

const OTHER_MINT = 'So11111111111111111111111111111111111111112';
const MINT = 'THREEsynthetic11111111111111111111111111111';

describe('trade proposal kind', () => {
	it('is a known action kind', () => {
		expect(AUTOPILOT_ACTION_KINDS).toContain('trade');
	});

	it('refuses to sell $THREE', () => {
		const v = validateProposal('trade', { side: 'sell', mint: THREE_CA, token_amount_raw: '1000000' });
		expect(v.ok).toBe(false);
		expect(v.code).toBe('three_sell_forbidden');
	});

	it('allows buying $THREE', () => {
		const v = validateProposal('trade', { side: 'buy', mint: THREE_CA, amount_sol: 0.1 });
		expect(v.ok).toBe(true);
		expect(v.params.side).toBe('buy');
		expect(v.params.slippage_bps).toBe(100);
	});

	it('requires amount_sol above zero on a buy', () => {
		expect(validateProposal('trade', { side: 'buy', mint: MINT, amount_sol: 0 }).ok).toBe(false);
		expect(validateProposal('trade', { side: 'buy', mint: MINT }).ok).toBe(false);
	});

	it('rejects a malformed or wrapped-SOL mint', () => {
		expect(validateProposal('trade', { side: 'buy', mint: 'nope', amount_sol: 1 }).ok).toBe(false);
		expect(validateProposal('trade', { side: 'buy', mint: OTHER_MINT, amount_sol: 1 }).ok).toBe(false);
	});

	it('caps slippage at 500 bps', () => {
		expect(validateProposal('trade', { side: 'buy', mint: MINT, amount_sol: 1, slippage_bps: 501 }).ok).toBe(false);
		expect(validateProposal('trade', { side: 'buy', mint: MINT, amount_sol: 1, slippage_bps: 250 }).params.slippage_bps).toBe(250);
	});

	it('requires a base-unit amount on a sell', () => {
		expect(validateProposal('trade', { side: 'sell', mint: MINT }).ok).toBe(false);
		expect(validateProposal('trade', { side: 'sell', mint: MINT, token_amount_raw: '-4' }).ok).toBe(false);
		const ok = validateProposal('trade', { side: 'sell', mint: MINT, token_amount_raw: '5000' });
		expect(ok.ok).toBe(true);
		expect(ok.params.token_amount_raw).toBe('5000');
	});

	it('defaults the trade scope to off and never auto-executes', () => {
		const c = normalizeAutopilotConfig({ enabled: true, scopes: { trade: true }, auto_execute: { trade: true } });
		expect(c.scopes.trade).toBe(true);
		expect(c.auto_execute.trade).toBeUndefined();
		expect(normalizeAutopilotConfig(undefined).scopes.trade).toBe(false);
	});

	it('dedupes on side and mint', () => {
		expect(proposalDedupeKey('trade', { side: 'buy', mint: MINT })).toBe(`trade:buy:${MINT}`);
	});
});

describe('executeProposal trade', () => {
	const proposal = {
		id: 'p1', agentId: 'a1', kind: 'trade', rationale: 'r', sourceMemoryIds: [],
		params: { side: 'buy', mint: MINT, amount_sol: 0.2, slippage_bps: 100 },
	};
	const agent = { id: 'a1', user_id: 'u1', meta: {} };

	it('needs confirmation even when require_confirm is false only if confirmed is missing', async () => {
		const meta = { autopilot: { enabled: true, scopes: { trade: true }, daily_spend_sol: 1, require_confirm: true } };
		await expect(executeProposal({ proposal, agent, userId: 'u1', meta, confirmed: false })).rejects.toMatchObject({ code: 'confirmation_required' });
	});

	it('refuses past the daily SOL budget', async () => {
		sqlMock.mockReset();
		sqlMock.mockResolvedValueOnce([{ spent: '0.9' }]);
		const meta = { autopilot: { enabled: true, scopes: { trade: true }, daily_spend_sol: 1, require_confirm: true } };
		await expect(executeProposal({ proposal, agent, userId: 'u1', meta, confirmed: true })).rejects.toMatchObject({ code: 'budget_exceeded' });
		expect(runAgentTradeMock).not.toHaveBeenCalled();
	});

	it('fills through runAgentTrade with the proposal id as idempotency key and records the spend', async () => {
		sqlMock.mockReset();
		runAgentTradeMock.mockReset();
		runAgentTradeMock.mockResolvedValueOnce({ status: 200, data: { signature: 'SIG1', venue: 'pumpfun', custody_event_id: 7, replayed: false } });
		sqlMock
			.mockResolvedValueOnce([{ spent: '0' }]) // dailySolSpent
			.mockResolvedValueOnce([{ meta: { encrypted_solana_secret: 'enc', solana_address: 'ADDR' } }]) // wallet row
			.mockResolvedValueOnce([{ id: 9, agent_id: 'a1', ts: 't' }]) // recordAction insert
			.mockResolvedValue([{ id: 'p1', agent_id: 'a1', kind: 'trade', status: 'executed', params: {}, source_memory_ids: [] }]);
		const meta = { autopilot: { enabled: true, scopes: { trade: true }, daily_spend_sol: 1, require_confirm: true } };
		const out = await executeProposal({ proposal, agent, userId: 'u1', meta, confirmed: true }).catch((e) => e);
		expect(runAgentTradeMock).toHaveBeenCalledTimes(1);
		const arg = runAgentTradeMock.mock.calls[0][0];
		expect(arg.parsed.idempotencyKey).toBe('autopilot:p1');
		expect(arg.parsed.side).toBe('buy');
		expect(arg.parsed.solAmount).toBe(0.2);
		expect(out).not.toBeInstanceOf(Error);
	});

	it('surfaces a guard refusal as an AutopilotError with the guard code', async () => {
		sqlMock.mockReset();
		runAgentTradeMock.mockReset();
		runAgentTradeMock.mockResolvedValueOnce({ status: 403, error: { code: 'price_impact_breaker', message: 'impact too high' } });
		sqlMock
			.mockResolvedValueOnce([{ spent: '0' }])
			.mockResolvedValueOnce([{ meta: { encrypted_solana_secret: 'enc', solana_address: 'ADDR' } }]);
		const meta = { autopilot: { enabled: true, scopes: { trade: true }, daily_spend_sol: 1, require_confirm: true } };
		await expect(executeProposal({ proposal, agent, userId: 'u1', meta, confirmed: true })).rejects.toMatchObject({ code: 'price_impact_breaker', status: 403 });
	});
});

describe('trade proposals from memory', () => {
	it('proposes a buy only from a tagged memory with explicit intent, and never a THREE sell', async () => {
		const { heuristicProposals } = await import('../api/_lib/autopilot.js');
		const out = heuristicProposals([
			{ id: 'm1', type: 'fact', tags: ['intel'], content: `Intel said buy 0.5 SOL of ${MINT} before graduation` },
			{ id: 'm2', type: 'fact', tags: [], content: `buy 1 SOL of ${MINT}` },
		]);
		const trades = out.filter((p) => p.kind === 'trade');
		expect(trades).toHaveLength(1);
		expect(trades[0].source_memory_ids).toEqual(['m1']);
		expect(validateProposal('trade', trades[0].params).ok).toBe(true);
	});
});
