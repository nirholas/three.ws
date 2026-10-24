// MCP perps access is opt-in per agent: tools/list hides the perps group from an
// account with no opted-in agent, and every agent-scoped perps tool refuses with
// `mcp_not_enabled` until the owner turns the limit on. The service is mocked at
// its edge so no database is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mcpAccess = vi.fn();
const account = vi.fn(async () => ({
	agent: { id: 'a', name: 'Test' },
	venue: 'phoenix',
	venue_label: 'Phoenix',
	mode: 'paper',
	summary: { equity_usd: 0, collateral_usd: 0, withdrawable_usd: 0, unrealized_pnl_usd: 0, notional_usd: 0, account_leverage: 0, positions: 0, open_orders: 0, risk_state: 'healthy', closest_liquidation_pct: null },
	account: { positions: [], orders: [], conditionals: [] },
	limits: { max_leverage: 2, max_margin_per_position_usd: 25, max_slippage_bps: 100, max_quote_move_bps: 50, live_enabled: false, halted: false },
	alerts: [],
	wallet: {},
}));
vi.mock('../api/_lib/perps/service.js', () => ({
	mcpAccess: (...a) => mcpAccess(...a),
	account: (...a) => account(...a),
	getLimits: vi.fn(async () => ({ limits: {} })),
	describeError: (err) => (err?.code ? { status: err.status || 400, code: err.code, message: err.message, detail: null } : null),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({ limits: { mcpAgent: async () => ({ success: true }) } }));

const { perpsToolDefs, PERPS_TOOL_NAMES } = await import('../api/_mcpagent/perps-tools.js');
const { makeDispatcher } = await import('../api/_lib/mcp-dispatch.js');

const tool = (name) => perpsToolDefs.find((t) => t.name === name);
const AGENT = '11111111-1111-4111-8111-111111111111';
const auth = { userId: 'u1', scope: 'wallet:read wallet:write wallet:trade' };

beforeEach(() => {
	mcpAccess.mockReset();
	account.mockClear();
});

describe('per-agent MCP permission', () => {
	it('refuses an agent-scoped tool until the owner opts the agent in', async () => {
		mcpAccess.mockResolvedValue(false);
		const res = await tool('perps_account').handler({ agent_id: AGENT }, auth, {});
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ ok: false, reason: 'mcp_not_enabled', agent_id: AGENT });
		expect(account).not.toHaveBeenCalled();
	});
	it('runs the tool once the agent is opted in', async () => {
		mcpAccess.mockResolvedValue(true);
		const res = await tool('perps_account').handler({ agent_id: AGENT }, auth, {});
		expect(res.isError).not.toBe(true);
		expect(account).toHaveBeenCalledTimes(1);
	});
	it('gates every tool that acts on an agent, including execution', () => {
		const gated = perpsToolDefs.filter((t) => t.inputSchema?.properties?.agent_id && t.name !== 'perps_limits');
		expect(gated.map((t) => t.name)).toEqual(expect.arrayContaining(['perps_account', 'perps_order_preview', 'perps_order_execute', 'perps_flatten']));
	});
	it('keeps perps_limits reachable so MCP can still tighten risk', async () => {
		const res = await tool('perps_limits').handler({ agent_id: AGENT }, auth, {});
		expect(mcpAccess).not.toHaveBeenCalled();
		expect(res.isError).not.toBe(true);
	});
	it('surfaces a not-your-agent error as a designed refusal', async () => {
		mcpAccess.mockRejectedValue(Object.assign(new Error("That agent isn't on your account."), { code: 'forbidden', status: 403 }));
		const res = await tool('perps_account').handler({ agent_id: AGENT }, auth, {});
		expect(res.structuredContent.reason).toBe('forbidden');
	});
});

describe('tools/list visibility', () => {
	const catalog = [{ name: 'perps_markets' }, { name: 'wallet_status' }];
	const build = (opted) =>
		makeDispatcher({
			serverInfo: { name: 't', version: '1' },
			instructions: '',
			catalog,
			tools: {},
			logName: 't',
			hiddenTools: async () => (opted ? [] : PERPS_TOOL_NAMES),
		});
	const list = async (d) => (await d({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, auth, {})).result.tools.map((t) => t.name);

	it('hides the perps group from an account with no opted-in agent', async () => {
		expect(await list(build(false))).toEqual(['wallet_status']);
	});
	it('shows it once an agent is opted in', async () => {
		expect(await list(build(true))).toEqual(['perps_markets', 'wallet_status']);
	});
});
