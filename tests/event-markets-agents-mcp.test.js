// MCP tools for agent forecasting: policy classification, the confirm gate, the
// owner check, and that the analysis tool never forwards other agents' rationale.
// The data layer is mocked at the module boundary; its SQL is covered by
// tests/event-markets-agents.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const placeAgentPick = vi.fn();
const assertAgentOwner = vi.fn();
const analyzeMarket = vi.fn();
vi.mock('../api/_lib/event-markets/forecasters.js', async (importActual) => ({
	...(await importActual()),
	placeAgentPick: (...a) => placeAgentPick(...a),
	assertAgentOwner: (...a) => assertAgentOwner(...a),
}));
vi.mock('../api/_lib/event-markets/analyze.js', () => ({ analyzeMarket: (...a) => analyzeMarket(...a) }));
vi.mock('../api/_lib/rate-limit.js', () => ({ limits: { mcpAgent: async () => ({ success: true }) } }));

const { eventMarketForecastToolDefs } = await import('../api/_mcpagent/event-market-forecast-tools.js');
const { ForecastError } = await import('../api/_lib/event-markets/forecasters.js');
const { POLICY } = await import('../packages/mcp-policy/src/index.js');

const tool = (n) => eventMarketForecastToolDefs.find((t) => t.name === n);
const auth = { userId: 'u1', scope: 'agents:write' };
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUT = '11111111-1111-4111-8111-111111111111';
const args = { agent_id: AGENT, slug: 'who-wins', outcome_id: OUT, points: 20, confidence: 70, rationale: 'A reason.' };
const analysis = {
	market: { id: 'm1', slug: 'who-wins', title: 'Who wins?', accepting_picks: true, seconds_to_lock: 600, locks_at: 'soon' },
	crowd: { note: null },
	entrants: [{ outcome_id: OUT, label: 'Alpha', crowd: { share: 0.5 }, agents_on_it: 1, history_in_prior_events: null }],
	your_pick: null,
	confidence_scale: { min: 1, max: 99 },
};

beforeEach(() => {
	placeAgentPick.mockReset();
	assertAgentOwner.mockReset();
	analyzeMarket.mockReset();
	analyzeMarket.mockResolvedValue(analysis);
});

describe('event market forecasting MCP tools', () => {
	it('are classified in the policy table', () => {
		for (const t of eventMarketForecastToolDefs) expect(POLICY['threews-agent'][t.name]).toBeTruthy();
	});
	it('refuses a call without confirm: true and never reaches the data layer', async () => {
		const res = await tool('event_market_agent_pick').handler({ ...args, confirm: false }, auth);
		expect(res.structuredContent.reason).toBe('confirmation_required');
		expect(placeAgentPick).not.toHaveBeenCalled();
	});
	it('requires a signed-in caller', async () => {
		const res = await tool('event_market_agent_pick').handler({ ...args, confirm: true }, { scope: '' });
		expect(res.structuredContent.reason).toBe('auth_required');
	});
	it('refuses an agent the caller does not own', async () => {
		assertAgentOwner.mockRejectedValue(new ForecastError('not_found', 'agent not found', 404));
		const res = await tool('event_market_agent_pick').handler({ ...args, confirm: true }, auth);
		expect(res.structuredContent).toMatchObject({ ok: false, reason: 'not_found' });
		expect(placeAgentPick).not.toHaveBeenCalled();
	});
	it('places the call as the agent once confirmed', async () => {
		placeAgentPick.mockResolvedValue({ pick: { points: 20, confidence: 70 }, market: { title: 'Who wins?' }, outcome: { label: 'Alpha' }, replaced: false });
		const res = await tool('event_market_agent_pick').handler({ ...args, confirm: true }, auth);
		expect(res.isError).toBeUndefined();
		expect(placeAgentPick).toHaveBeenCalledWith(expect.objectContaining({ agentId: AGENT, marketId: 'm1', outcomeId: OUT, confidence: 70, via: 'mcp' }));
	});
	it('turns a lock rejection into a designed refusal', async () => {
		placeAgentPick.mockRejectedValue(new ForecastError('market_locked', 'Picks closed.', 409));
		const res = await tool('event_market_agent_pick').handler({ ...args, confirm: true }, auth);
		expect(res.structuredContent).toMatchObject({ ok: false, reason: 'market_locked' });
	});
	it('analyze returns the structured analysis and checks ownership only when an agent is named', async () => {
		const res = await tool('event_market_analyze').handler({ slug: 'who-wins' }, { scope: '' });
		expect(res.structuredContent.entrants).toHaveLength(1);
		expect(assertAgentOwner).not.toHaveBeenCalled();
		await tool('event_market_analyze').handler({ slug: 'who-wins', agent_id: AGENT }, auth);
		expect(assertAgentOwner).toHaveBeenCalledWith(AGENT, 'u1');
	});
});
