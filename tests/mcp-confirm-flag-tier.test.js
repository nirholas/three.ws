// Audit 2026-10-25, mcp-automation-spend-confirm-unbound-write-tier: a hosted
// MCP tool that takes a spend confirmation flag (confirm_payment, confirm_send,
// ...) must sit in the financial tier. A write-tier row would skip the
// connector-key spend refusal and the preview/confirm binding in gateCall.
import { describe, it, expect, vi } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';
vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { POLICY, normalizeEntry } = await import('@three-ws/mcp-policy');
const { movesValue, gateCall } = await import('../api/_mcp/policy.js');

const SERVERS = {
	'three.ws': (await import('../api/_mcp/catalog.js')).TOOL_CATALOG,
	'threews-agent': (await import('../api/_mcpagent/catalog.js')).TOOL_CATALOG,
	'threews-3d-studio': (await import('../api/_mcp3d/catalog.js')).TOOL_CATALOG,
	'threews-x402-bazaar': (await import('../api/_mcpbazaar/catalog.js')).TOOL_CATALOG,
	'ibm-x402-mcp-remote': (await import('../api/_mcpibm/catalog.js')).TOOL_CATALOG,
};
const NON_SPENDING = new Set(['confirm_delete', 'confirm_run', 'confirm_publish']);
// Mixed-action write tools: only a swap or transfer action spends, so the tier
// stays write and the handler enforces connector refusal, wallet:write, the
// real-funds agreement and confirm_spend itself (tests/mcp-agent-lifecycle.test.js).
const HANDLER_GATED = new Set(['three.ws/automation_create', 'three.ws/automation_update', 'three.ws/automation_trigger']);

describe('spend confirm flags live only on financial-tier tools', () => {
	it('every policy row with a spend confirm flag is financial', () => {
		const bad = [];
		for (const [server, rows] of Object.entries(POLICY)) {
			for (const [name, row] of Object.entries(rows)) {
				const e = normalizeEntry(name, row);
				if (e.confirmFlag && !NON_SPENDING.has(e.confirmFlag) && e.tier !== 'financial') bad.push(`${server}/${name}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('every hosted catalog tool that accepts a confirm_* argument is classified financial and moves value', () => {
		const bad = [];
		let seen = 0;
		for (const [server, tools] of Object.entries(SERVERS)) {
			for (const t of tools) {
				const props = Object.keys(t.inputSchema?.properties || {}).filter((p) => /^confirm_/.test(p) && !NON_SPENDING.has(p));
				if (!props.length) continue;
				seen++;
				const row = POLICY[server]?.[t.name];
				const tier = row ? normalizeEntry(t.name, row).tier : null;
				if (HANDLER_GATED.has(`${server}/${t.name}`)) continue;
				if (tier !== 'financial' || !movesValue(server, t.name)) bad.push(`${server}/${t.name}:${props.join(',')}:${tier}`);
			}
		}
		expect(seen).toBeGreaterThan(0);
		expect(bad).toEqual([]);
	});

	it('a financial tool is refused without its confirm flag and a preview id', async () => {
		const auth = { userId: 'u1', scope: 'wallet:write', source: 'session' };
		const req = { headers: { 'x-three-tools': 'default,financial' } };
		const gate = await gateCall('threews-agent', 'agent_buy_confirm', { offer_id: 'x' }, auth, req, null);
		expect(gate.ok).toBe(false);
	});
});
