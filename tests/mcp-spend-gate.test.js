// Connector keys can never spend (x-grok order 026, design rule 2).
//
// A key an AI agent holds unattended (Grok Bot, a schedule, CI) reads,
// generates and edits agent data. Every value-moving tool on every hosted MCP
// server refuses it at one choke point, gateCall in api/_mcp/policy.js, with a
// JSON-RPC error that names the browser session. These tests drive the real
// dispatchers with a connector principal, and walk each server's tools/list so
// a value-moving tool added later cannot slip past the gate unclassified.

import { describe, it, expect, vi } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';

vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { POLICY } = await import('@three-ws/mcp-policy');
const { assertBearerMaySpend } = await import('../api/_lib/spend-scope.js');
const { normalizeKeyScopes } = await import('../api/_lib/api-keys.js');
const {
	CONNECTOR_PRESET,
	CONNECTOR_SCOPES,
	SPEND_GRANTS,
	effectiveKeyScope,
	connectorViolations,
	connectorSpendMessage,
	BROWSER_SESSION_URL,
} = await import('../api/_lib/key-scopes.js');
const { connectorSpendError, movesValue, gateCall } = await import('../api/_mcp/policy.js');

const SERVERS = {
	'three.ws': { dispatch: (await import('../api/_mcp/dispatch.js')).dispatch, tools: (await import('../api/_mcp/catalog.js')).TOOLS },
	'threews-agent': { dispatch: (await import('../api/_mcpagent/dispatch.js')).dispatch, tools: (await import('../api/_mcpagent/catalog.js')).TOOLS },
	'threews-3d-studio': { dispatch: (await import('../api/_mcp3d/dispatch.js')).dispatch, tools: (await import('../api/_mcp3d/catalog.js')).TOOLS },
	'threews-x402-bazaar': { dispatch: (await import('../api/_mcpbazaar/dispatch.js')).dispatch, tools: (await import('../api/_mcpbazaar/catalog.js')).TOOLS },
	'ibm-x402-mcp-remote': { dispatch: (await import('../api/_mcpibm/dispatch.js')).dispatch, tools: (await import('../api/_mcpibm/catalog.js')).TOOLS },
};

// The JSON-RPC code every value-moving tool refuses a connector key with,
// derived from the real function rather than hardcoded so a future
// renumbering of connectorSpendError fails here first, not silently.
const CONNECTOR_SPEND_CODE = connectorSpendError('probe').code;

// The effective principal a connector key authenticates as: its fixed preset
// scopes, capped exactly the way authenticateBearer caps them (api/_lib/auth.js).
const CONNECTOR_KEY_SCOPE = effectiveKeyScope({ scope: CONNECTOR_SCOPES.join(' '), preset: CONNECTOR_PRESET }).scope;
const CONNECTOR = { userId: 'user-1', rateKey: 'user-1', scope: CONNECTOR_KEY_SCOPE, source: 'apikey', apiKeyId: 'key-1', connector: true };
// Everything turned on, so tools/list shows the financial tier too.
const ALL_ON = { headers: { 'x-three-tools': 'default,financial' } };

const call = (serverId, name, args = {}, auth = CONNECTOR) =>
	SERVERS[serverId].dispatch({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, auth, { ...ALL_ON });

function expectBrowserRefusal(r, { tool } = {}) {
	expect(r.result).toBeUndefined();
	expect(r.error.code).toBe(CONNECTOR_SPEND_CODE);
	expect(r.error.message).toContain('needs a browser session on three.ws');
	expect(r.error.message).toContain(BROWSER_SESSION_URL);
	expect(r.error.data).toMatchObject({
		reason: 'spend_requires_browser_session',
		url: BROWSER_SESSION_URL,
	});
	if (tool) expect(r.error.data.tool).toBe(tool);
}

describe('the connector preset', () => {
	it('issues read, generate and agent-data scopes and nothing that spends', () => {
		expect(CONNECTOR_SCOPES).toEqual(['read', 'generate', 'agents:write']);
		expect(connectorViolations(CONNECTOR_SCOPES)).toEqual([]);
		expect(connectorViolations(['wallet:write', 'read'])).toEqual(['wallet:write']);
		const scope = CONNECTOR_KEY_SCOPE.split(' ');
		// wallet:read is legitimate (the connector preset's "read" scope expands
		// into it, key-scopes.js EXPANSION); only SPEND_GRANTS must never appear.
		for (const grant of SPEND_GRANTS) expect(scope).not.toContain(grant);
	});

	it('only the connector preset strips scopes; any other preset value is ignored', () => {
		const untouched = effectiveKeyScope({ scope: 'avatars:read wallet:write', preset: 'admin' });
		expect(untouched).toEqual({ scope: 'avatars:read wallet:write', connector: false });
	});

	it('cannot be requested as a raw scope string, only through the preset column', () => {
		expect(normalizeKeyScopes('avatars:read connector').invalid).toEqual(['connector']);
	});

	it('is capped at authentication, so an edited stored scope can never spend', () => {
		const tampered = 'avatars:read wallet:write services:write agents:write';
		const effective = effectiveKeyScope({ scope: tampered, preset: CONNECTOR_PRESET });
		expect(effective.connector).toBe(true);
		expect(effective.scope.split(' ')).toEqual(['avatars:read', 'agents:write', 'memory:write']);
		for (const grant of SPEND_GRANTS) expect(effective.scope.split(' ')).not.toContain(grant);
	});

	it('leaves a standard key exactly as granted', () => {
		const full = 'avatars:read avatars:write wallet:read wallet:write services:write';
		expect(effectiveKeyScope({ scope: full, preset: null })).toEqual({ scope: full, connector: false });
	});
});

describe('every value-moving tool family refuses a connector key', () => {
	it('x402: pay_and_call', async () => {
		expectBrowserRefusal(await call('threews-agent', 'pay_and_call', { resource_url: 'https://paid.test/x', quote_id: 'q_aaaaaaaaaaaaaaaa', confirm_payment: true }), { tool: 'pay_and_call' });
	});

	// swap_execute is classified in the policy table but ships only in the stdio
	// trading package, so no hosted server answers it; the gate still knows it.
	it('trading: oracle_arm_watch, and swap_execute is classified', async () => {
		expect(movesValue('threews-agent', 'swap_execute')).toBe(true);
		expectBrowserRefusal(await call('three.ws', 'oracle_arm_watch', { agent_id: '00000000-0000-4000-8000-000000000000', confirm_spend: true }), { tool: 'oracle_arm_watch' });
	});

	it('marketplace: listing, bids, buy now and accept', async () => {
		for (const name of ['create_marketplace_listing', 'delist_marketplace_listing', 'place_bid', 'buy_now', 'accept_marketplace_bid', 'withdraw_marketplace_bid']) {
			expectBrowserRefusal(await call('threews-agent', name, {}), { tool: name });
		}
	});

	it('sniper: arming the launch sniper is refused, and its own scope check no longer accepts agents:write', async () => {
		expectBrowserRefusal(await call('threews-agent', 'sniper_activate', { agent_id: '00000000-0000-4000-8000-000000000000', per_trade_sol: 0.1, daily_budget_sol: 1, confirm_spend: true }), { tool: 'sniper_activate' });
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(new URL('../api/_mcpagent/sniper-alert-tools.js', import.meta.url), 'utf8');
		expect(src).toMatch(/const TRADE_SCOPES = \['wallet:trade'\];/);
	});

	it('predictions: open, close and redeem; a watch moves nothing and is left to its handler', async () => {
		for (const name of ['predictions_open', 'predictions_close', 'predictions_redeem']) {
			expectBrowserRefusal(await call('threews-agent', name, {}), { tool: name });
		}
		expect(movesValue('threews-agent', 'predictions_watch')).toBe(false);
	});

	it('wallet: provisioning and persona sends', async () => {
		expectBrowserRefusal(await call('threews-agent', 'provision_wallet', { agent_id: '00000000-0000-4000-8000-000000000000' }), { tool: 'provision_wallet' });
		for (const name of ['persona_tip', 'persona_send']) {
			expectBrowserRefusal(await call('threews-3d-studio', name, { persona_id: 'p', to: 'x', usdc: 1, confirm_send: true }), { tool: name });
		}
	});

	it('cards: quote, create, data, reveal, cancel, withdraw and connect', async () => {
		for (const name of ['agent_card_quote', 'agent_card_create', 'agent_card_data', 'agent_card_reveal', 'agent_card_cancel', 'agent_card_withdraw', 'agent_card_connect_link']) {
			expectBrowserRefusal(await call('three.ws', name, {}), { tool: name });
		}
	});

	it('services: publishing a paid endpoint needs services:write', async () => {
		expectBrowserRefusal(await call('threews-agent', 'monetize_endpoint', {}), { tool: 'monetize_endpoint' });
	});

	it('launch and every HTTP spend route: assertBearerMaySpend tells a connector where to go', () => {
		const post = { method: 'POST' };
		expect(() => assertBearerMaySpend({ scope: CONNECTOR_KEY_SCOPE }, post)).toThrowError(/lacks the wallet:write scope required to move funds/);
		try {
			assertBearerMaySpend({ scope: CONNECTOR_KEY_SCOPE }, post);
		} catch (err) {
			expect(err).toMatchObject({ status: 403, code: 'insufficient_scope', expose: true });
		}
		// Reads still pass, so a connector can look before a person acts.
		expect(assertBearerMaySpend({ scope: CONNECTOR_KEY_SCOPE }, { method: 'GET' })).toBeTruthy();
	});

	it('refuses before tool enablement, so turning a tool on cannot help', async () => {
		await expect(gateCall('threews-agent', 'pay_and_call', {}, CONNECTOR, { headers: { 'x-three-tools': 'default,pay_and_call' } })).rejects.toMatchObject({ code: CONNECTOR_SPEND_CODE });
	});

	it('still runs non-spending tools for a connector key', async () => {
		const r = await call('three.ws', 'getting_started', {});
		expect(r.error).toBeUndefined();
		expect(r.result).toBeTruthy();
	});

	it('anonymous x402 and free callers are not blocked by the connector gate', async () => {
		const r1 = await gateCall('threews-3d-studio', 'persona_tip', { persona_id: 'p', to: 'x', usdc: 1, confirm_send: true }, { userId: null, scope: '', source: 'x402' }, ALL_ON);
		expect(r1.ok).toBe(false);
		expect(r1.result.structuredContent.reason).not.toBe('spend_requires_browser_session');
		const r2 = await gateCall('threews-agent', 'pay_and_call', { resource_url: 'https://paid.test/x', quote_id: 'q_aaaaaaaaaaaaaaaa', confirm_payment: true }, null, ALL_ON);
		expect(r2.ok).toBe(false);
		expect(r2.result.structuredContent.reason).not.toBe('spend_requires_browser_session');
	});
});

describe('the gate covers every hosted tools/list', () => {
	// A key with every fine scope, so tools/list under it shows the full catalog
	// to diff against what a connector key is allowed to see.
	const FULL = {
		userId: 'user-2',
		rateKey: 'user-2',
		source: 'apikey',
		apiKeyId: 'key-2',
		scope: 'avatars:read avatars:write avatars:delete wallet:read wallet:write wallet:trade wallet:launch services:write profile memory:read memory:write agents:read agents:write herald:announce inference',
	};

	for (const [serverId, { dispatch, tools }] of Object.entries(SERVERS)) {
		it(`${serverId}: every listed value-moving tool refuses a connector key and is hidden from its tools/list`, async () => {
			const listedFull = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, FULL, { ...ALL_ON });
			const allNames = listedFull.result.tools.map((t) => t.name);
			expect(allNames.length).toBeGreaterThan(0);
			const listedConnector = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, CONNECTOR, { ...ALL_ON });
			const connectorNames = new Set(listedConnector.result.tools.map((t) => t.name));
			for (const name of allNames) {
				if (!movesValue(serverId, name)) continue;
				expect(connectorNames.has(name), `${serverId}/${name} should be hidden from a connector's tools/list`).toBe(false);
				const r = await call(serverId, name, {});
				expect(r.error?.code, `${serverId}/${name}`).toBe(CONNECTOR_SPEND_CODE);
			}
			// A financial-tier tool that also declares a wallet/services scope at
			// the dispatcher level must be classified, or a new one could ship
			// that only its own handler remembers to guard. (A non-financial
			// "write"-tier tool, e.g. a quote that prices but does not move funds,
			// may legitimately require the scope without being movesValue; those
			// go through EXTRA_VALUE_TOOLS or stay on the generic scope error.)
			for (const [name, tool] of Object.entries(tools)) {
				const financial = POLICY[serverId]?.[name]?.tier === 'financial';
				if (financial && (tool?.scope === 'wallet:write' || tool?.scope === 'services:write')) {
					expect(movesValue(serverId, name), `${serverId}/${name} declares ${tool.scope}`).toBe(true);
				}
			}
		});
	}

	it('every financial tool that moves money on a hosted server is classified', () => {
		const moneyFlags = /^confirm_(swap|transfer|launch|spend|payment|deposit|withdraw|bid|send|listing|delist|accept|trade|reveal|cancel)$/;
		for (const serverId of Object.keys(SERVERS)) {
			for (const [name, entry] of Object.entries(POLICY[serverId] || {})) {
				if (entry.tier === 'financial' && moneyFlags.test(entry.confirmFlag)) expect(movesValue(serverId, name), `${serverId}/${name}`).toBe(true);
				if (entry.confirmFlag === 'confirm_delete' || entry.confirmFlag === 'confirm_run') expect(movesValue(serverId, name), `${serverId}/${name}`).toBe(false);
			}
		}
	});
});

describe('existing keys keep working', () => {
	// A row exactly as api_keys stored it before connector keys existed: no
	// preset, its own scope string, nothing else new.
	const PRE_MIGRATION_ROW = { id: 'k-old', user_id: 'user-1', scope: 'avatars:read avatars:write wallet:read wallet:write services:write', preset: null, expires_at: null, revoked_at: null };

	it('authenticates with its stored scope unchanged and may still spend', async () => {
		vi.resetModules();
		vi.doMock('../api/_lib/db.js', () => ({ sql: vi.fn(async (strings) => (String(strings.join('?')).includes('select') ? [PRE_MIGRATION_ROW] : [])) }));
		const { authenticateBearer } = await import('../api/_lib/auth.js');
		const auth = await authenticateBearer('sk_live_pre_migration_key');
		expect(auth).toMatchObject({ userId: 'user-1', scope: PRE_MIGRATION_ROW.scope, source: 'apikey', apiKeyId: 'k-old' });
		expect(auth.connector).toBeUndefined();
		const r = await call('threews-agent', 'pay_and_call', { resource_url: 'https://paid.test/x', quote_id: 'q_aaaaaaaaaaaaaaaa', confirm_payment: true }, auth);
		expect(r.error?.code).not.toBe(CONNECTOR_SPEND_CODE);
		expect(assertBearerMaySpend(auth, { method: 'POST' })).toBe(auth);
		vi.doUnmock('../api/_lib/db.js');
	});

	it('a stored connector row is capped on the way in', async () => {
		vi.resetModules();
		const row = { ...PRE_MIGRATION_ROW, id: 'k-conn', preset: CONNECTOR_PRESET, scope: 'avatars:read agents:write wallet:write' };
		vi.doMock('../api/_lib/db.js', () => ({ sql: vi.fn(async (strings) => (String(strings.join('?')).includes('select') ? [row] : [])) }));
		const { authenticateBearer } = await import('../api/_lib/auth.js');
		const auth = await authenticateBearer('sk_live_connector_key');
		expect(auth.connector).toBe(true);
		expect(auth.scope).toBe('avatars:read agents:write memory:write');
		const r = await call('three.ws', 'agent_card_create', {}, auth);
		expect(r.error?.code).toBe(CONNECTOR_SPEND_CODE);
		vi.doUnmock('../api/_lib/db.js');
	});

	it('a standard key without wallet:write is told which scope it lacks', async () => {
		const narrow = { userId: 'user-1', rateKey: 'user-1', scope: 'avatars:read', source: 'apikey', apiKeyId: 'key-3' };
		const r = await call('threews-agent', 'provision_wallet', { agent_id: '00000000-0000-4000-8000-000000000000' }, narrow);
		expect(r.error).toBeUndefined();
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent).toMatchObject({ ok: false, reason: 'insufficient_scope', required: 'wallet:write' });
	});
});

describe('PUT /api/agents/:id: money keys in meta need the spend scope', async () => {
	const { changesMoneyMeta } = await import('../api/agents.js');
	const stored = { autopilot: { armed: false, max_usd: 5 }, payments: { receiver: 'THREEsynthetic1111' }, studio: { v: 1 } };

	it('lets a read-modify-write send the money keys back unchanged, in any key order', () => {
		expect(changesMoneyMeta(stored, { ...stored, studio: { v: 2 } })).toBe(false);
		expect(changesMoneyMeta(stored, { autopilot: { max_usd: 5, armed: false } })).toBe(false);
	});

	it('flags arming the autopilot, raising limits, and moving the payout', () => {
		expect(changesMoneyMeta(stored, { autopilot: { armed: true, max_usd: 5 } })).toBe(true);
		expect(changesMoneyMeta(stored, { spend_limits: { daily_usd: 1000 } })).toBe(true);
		expect(changesMoneyMeta(stored, { payments: { receiver: 'THREEsynthetic2222' } })).toBe(true);
		expect(changesMoneyMeta(stored, { solana_address: 'THREEsynthetic3333' })).toBe(true);
	});

	it('flags the spend-policy keys the reserve, burner and prediction guards read', () => {
		expect(changesMoneyMeta(stored, { spend_policy: { max_sol_per_tx: 1000, daily_sol_cap: 1e6 } })).toBe(true);
		expect(changesMoneyMeta(stored, { burner_policy: { cap_usd: 1e6 } })).toBe(true);
		expect(changesMoneyMeta(stored, { prediction_limits: { max_usd: 1e6 } })).toBe(true);
		expect(changesMoneyMeta(stored, { recovery: { address: 'THREEsynthetic4444' } })).toBe(true);
		const withPolicy = { ...stored, spend_policy: { daily_sol_cap: 5 } };
		expect(changesMoneyMeta(withPolicy, { spend_policy: { daily_sol_cap: 5 } })).toBe(false);
	});
});
