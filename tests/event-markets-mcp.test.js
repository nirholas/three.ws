// The Event Markets MCP tools: policy classification and the confirm gate on
// event_market_pick. The seam is mocked at the module boundary; its SQL is
// covered by tests/event-markets.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let impl = async () => ({});
const placePick = Object.assign((...a) => { calls.push(a); return impl(...a); }, {});
vi.mock('../api/_lib/event-markets/index.js', async (importActual) => ({ ...(await importActual()), placePick: (...a) => placePick(...a) }));
vi.mock('../api/_lib/rate-limit.js', () => ({ limits: { mcpAgent: async () => ({ success: true }) } }));

const { eventMarketToolDefs } = await import('../api/_mcpagent/event-markets-tools.js');
const { POLICY } = await import('../packages/mcp-policy/src/index.js');

const pick = eventMarketToolDefs.find((t) => t.name === 'event_market_pick');
const auth = { userId: 'u1', scope: 'agents:write' };
const args = { slug: 'who-wins', outcome_id: '11111111-1111-4111-8111-111111111111', points: 50 };

beforeEach(() => { calls.length = 0; impl = async () => ({}); });

describe('event market MCP tools', () => {
	it('are classified in the policy table', () => {
		for (const t of eventMarketToolDefs) expect(POLICY['threews-agent'][t.name]).toBeTruthy();
	});
	it('refuses a pick without confirm: true and never reaches the seam', async () => {
		const res = await pick.handler({ ...args, confirm: false }, auth);
		expect(res.isError).toBe(true);
		expect(res.structuredContent.reason).toBe('confirmation_required');
		expect(calls).toHaveLength(0);
	});
	it('requires a signed-in caller', async () => {
		const res = await pick.handler({ ...args, confirm: true }, { scope: '' });
		expect(res.structuredContent.reason).toBe('auth_required');
	});
	it('places the pick once confirmed', async () => {
		impl = async () => ({
			pick: { market_id: 'm', outcome_id: args.outcome_id, points: 50, updated_at: 'now' },
			market: { title: 'Who wins?', locks_at: 'soon', odds: { even_prior: false }, outcomes: [{ id: args.outcome_id, label: 'Alpha', percent: 60, picks: 1, points: 50 }] },
		});
		const res = await pick.handler({ ...args, confirm: true }, auth);
		expect(res.isError).toBeUndefined();
		expect(calls).toEqual([[{ market: 'who-wins', accountId: 'u1', outcomeId: args.outcome_id, points: 50 }]]);
	});
	it('turns a lock rejection into a designed refusal', async () => {
		const { EventMarketError } = await import('../api/_lib/event-markets/errors.js');
		impl = async () => { throw new EventMarketError(409, 'market_locked', 'Picks closed at then.'); };
		const res = await pick.handler({ ...args, confirm: true }, auth);
		expect(res.structuredContent).toMatchObject({ ok: false, reason: 'market_locked' });
	});
});
