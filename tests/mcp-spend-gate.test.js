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
const {
	CONNECTOR_KEY_SCOPES,
	CONNECTOR_MARKER,
	SPEND_SCOPE,
	assertBearerMaySpend,
	capConnectorScope,
	isConnectorScope,
} = await import('../api/_lib/spend-scope.js');
const { KEY_PRESETS, presetScopes, normalizeKeyScopes } = await import('../api/_lib/api-keys.js');
const { SPEND_REFUSED_CODE, SPEND_WRITE_TOOLS, assertMaySpend, gateCall, spendScopeFor } = await import('../api/_mcp/policy.js');

const SERVERS = {
	'three.ws': { dispatch: (await import('../api/_mcp/dispatch.js')).dispatch, tools: (await import('../api/_mcp/catalog.js')).TOOLS },
	'threews-agent': { dispatch: (await import('../api/_mcpagent/dispatch.js')).dispatch, tools: (await import('../api/_mcpagent/catalog.js')).TOOLS },
	'threews-3d-studio': { dispatch: (await import('../api/_mcp3d/dispatch.js')).dispatch, tools: (await import('../api/_mcp3d/catalog.js')).TOOLS },
	'threews-x402-bazaar': { dispatch: (await import('../api/_mcpbazaar/dispatch.js')).dispatch, tools: (await import('../api/_mcpbazaar/catalog.js')).TOOLS },
	'ibm-x402-mcp-remote': { dispatch: (await import('../api/_mcpibm/dispatch.js')).dispatch, tools: (await import('../api/_mcpibm/catalog.js')).TOOLS },
};

// The effective principal a connector key authenticates as: its preset scope,
// capped exactly the way authenticateBearer caps it.
const CONNECTOR_KEY_SCOPE = capConnectorScope(presetScopes('connector').join(' '));
const CONNECTOR = { userId: 'user-1', rateKey: 'user-1', scope: CONNECTOR_KEY_SCOPE, source: 'apikey', apiKeyId: 'key-1' };
// Everything turned on, so tools/list shows the financial tier too.
const ALL_ON = { headers: { 'x-three-tools': 'default,financial' } };

const call = (serverId, name, args = {}, auth = CONNECTOR) =>
	SERVERS[serverId].dispatch({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, auth, { ...ALL_ON });

function expectBrowserRefusal(r, { tool, required = SPEND_SCOPE } = {}) {
	expect(r.result).toBeUndefined();
	expect(r.error.code).toBe(SPEND_REFUSED_CODE);
	expect(r.error.message).toContain('needs a browser session on three.ws');
	expect(r.error.message).toContain('https://three.ws/dashboard');
	expect(r.error.data).toMatchObject({
		reason: 'connector_key_cannot_spend',
		required_scope: required,
		needs: 'browser_session',
		url: 'https://three.ws/dashboard',
		docs: 'https://three.ws/docs/mcp#api-key-scopes',
	});
	if (tool) expect(r.error.data.tool).toBe(tool);
}

describe('the connector preset', () => {
	it('issues read, generate and agent-data scopes and nothing that spends', () => {
		const scopes = presetScopes('connector');
		expect(scopes).toEqual([...CONNECTOR_KEY_SCOPES, CONNECTOR_MARKER]);
		for (const s of ['wallet:write', 'wallet:read', 'services:write', 'inference', 'profile', 'herald:announce', 'avatars:delete']) {
			expect(scopes).not.toContain(s);
		}
		expect(Object.isFrozen(KEY_PRESETS.connector)).toBe(true);
		expect(presetScopes('admin')).toBeNull();
		expect(presetScopes('__proto__')).toBeNull();
	});

	it('cannot be requested as a raw scope, only through the preset', () => {
		expect(normalizeKeyScopes(`avatars:read ${CONNECTOR_MARKER}`).invalid).toEqual([CONNECTOR_MARKER]);
	});

	it('is capped at authentication, so an edited stored scope can never spend', () => {
		const tampered = `avatars:read ${CONNECTOR_MARKER} wallet:write services:write profile agents:write`;
		const effective = capConnectorScope(tampered);
		expect(effective.split(' ')).toEqual(['avatars:read', 'agents:write', CONNECTOR_MARKER]);
		expect(isConnectorScope(effective)).toBe(true);
	});

	it('leaves a standard key exactly as granted', () => {
		const full = 'avatars:read avatars:write wallet:read wallet:write services:write';
		expect(capConnectorScope(full)).toBe(full);
		expect(isConnectorScope(full)).toBe(false);
	});
});

describe('every value-moving tool family refuses a connector key', () => {
	it('x402: pay_and_call', async () => {
		expectBrowserRefusal(await call('threews-agent', 'pay_and_call', { resource_url: 'https://paid.test/x', quote_id: 'q_aaaaaaaaaaaaaaaa', confirm_payment: true }), { tool: 'pay_and_call' });
	});

	// swap_execute is classified in the policy table but ships only in the stdio
	// trading package, so no hosted server answers it; the gate still knows it.
	it('trading: oracle_arm_watch, and swap_execute is classified', async () => {
		expect(spendScopeFor('threews-agent', 'swap_execute')).toBe(SPEND_SCOPE);
		expectBrowserRefusal(await call('three.ws', 'oracle_arm_watch', { agent_id: '00000000-0000-4000-8000-000000000000', confirm_spend: true }), { tool: 'oracle_arm_watch' });
	});

	it('marketplace: listing, bids, buy now and accept', async () => {
		for (const name of ['create_marketplace_listing', 'delist_marketplace_listing', 'place_bid', 'buy_now', 'accept_marketplace_bid', 'withdraw_marketplace_bid']) {
			expectBrowserRefusal(await call('threews-agent', name, {}), { tool: name });
		}
	});

	it('predictions: open, close and redeem; a watch moves nothing and is left to its handler', async () => {
		for (const name of ['predictions_open', 'predictions_close', 'predictions_redeem']) {
			expectBrowserRefusal(await call('threews-agent', name, {}), { tool: name });
		}
		expect(spendScopeFor('threews-agent', 'predictions_watch')).toBeNull();
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
		expectBrowserRefusal(await call('threews-agent', 'monetize_endpoint', {}), { tool: 'monetize_endpoint', required: 'services:write' });
	});

	it('launch and every HTTP spend route: assertBearerMaySpend tells a connector where to go', () => {
		const post = { method: 'POST' };
		expect(() => assertBearerMaySpend({ scope: CONNECTOR_KEY_SCOPE }, post)).toThrowError(/needs a browser session on three\.ws.*https:\/\/three\.ws\/dashboard/);
		try {
			assertBearerMaySpend({ scope: CONNECTOR_KEY_SCOPE }, post);
		} catch (err) {
			expect(err).toMatchObject({ status: 403, code: 'insufficient_scope', expose: true });
		}
		// Reads still pass, so a connector can look before a person acts.
		expect(assertBearerMaySpend({ scope: CONNECTOR_KEY_SCOPE }, { method: 'GET' })).toBeTruthy();
	});

	it('refuses before tool enablement, so turning a tool on cannot help', async () => {
		await expect(gateCall('threews-agent', 'pay_and_call', {}, CONNECTOR, { headers: { 'x-three-tools': 'default,pay_and_call' } })).rejects.toMatchObject({ code: SPEND_REFUSED_CODE });
	});

	it('still runs non-spending tools for a connector key', async () => {
		const r = await call('three.ws', 'getting_started', {});
		expect(r.error).toBeUndefined();
		expect(r.result).toBeTruthy();
	});
});

describe('the gate covers every hosted tools/list', () => {
	for (const [serverId, { dispatch, tools }] of Object.entries(SERVERS)) {
		it(`${serverId}: every listed value-moving tool refuses a connector key`, async () => {
			const listed = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, CONNECTOR, { ...ALL_ON });
			const names = listed.result.tools.map((t) => t.name);
			expect(names.length).toBeGreaterThan(0);
			for (const name of names) {
				if (!spendScopeFor(serverId, name)) continue;
				const r = await call(serverId, name, {});
				expect(r.error?.code, `${serverId}/${name}`).toBe(SPEND_REFUSED_CODE);
			}
			// A tool declaring a spend scope must be classified, or a new one
			// could ship that only its handler remembers to guard.
			for (const [name, tool] of Object.entries(tools)) {
				if (tool?.scope === 'wallet:write' || tool?.scope === 'services:write') {
					expect(spendScopeFor(serverId, name), `${serverId}/${name} declares ${tool.scope}`).toBe(tool.scope);
				}
			}
		});
	}

	it('every financial tool that moves money on a hosted server is classified', () => {
		const moneyFlags = /^confirm_(swap|transfer|launch|spend|payment|deposit|withdraw|bid|send|listing|delist|accept|trade|reveal|cancel)$/;
		for (const serverId of Object.keys(SERVERS)) {
			for (const [name, entry] of Object.entries(POLICY[serverId] || {})) {
				if (entry.tier === 'financial' && moneyFlags.test(entry.confirmFlag)) expect(spendScopeFor(serverId, name), `${serverId}/${name}`).toBe(SPEND_SCOPE);
				if (entry.confirmFlag === 'confirm_delete' || entry.confirmFlag === 'confirm_run') expect(spendScopeFor(serverId, name), `${serverId}/${name}`).toBeNull();
			}
		}
	});

	it('names no tool in SPEND_WRITE_TOOLS that its server does not ship', () => {
		for (const [serverId, extra] of Object.entries(SPEND_WRITE_TOOLS)) {
			for (const name of Object.keys(extra)) expect(Object.hasOwn(SERVERS[serverId].tools, name), `${serverId}/${name}`).toBe(true);
		}
	});
});

describe('existing keys keep working', () => {
	// A row exactly as api_keys stored it before connector keys existed: no
	// marker, its own scope string, nothing else new.
	const PRE_MIGRATION_ROW = { id: 'k-old', user_id: 'user-1', scope: 'avatars:read avatars:write wallet:read wallet:write services:write', expires_at: null, revoked_at: null };

	it('authenticates with its stored scope unchanged and may still spend', async () => {
		vi.resetModules();
		vi.doMock('../api/_lib/db.js', () => ({ sql: vi.fn(async (strings) => (String(strings.join('?')).includes('select') ? [PRE_MIGRATION_ROW] : [])) }));
		const { authenticateBearer } = await import('../api/_lib/auth.js');
		const auth = await authenticateBearer('sk_live_pre_migration_key');
		expect(auth).toMatchObject({ userId: 'user-1', scope: PRE_MIGRATION_ROW.scope, source: 'apikey', apiKeyId: 'k-old' });
		expect(() => assertMaySpend('threews-agent', 'pay_and_call', auth)).not.toThrow();
		expect(() => assertMaySpend('threews-agent', 'monetize_endpoint', auth)).not.toThrow();
		expect(assertBearerMaySpend(auth, { method: 'POST' })).toBe(auth);
		vi.doUnmock('../api/_lib/db.js');
	});

	it('a stored connector row is capped on the way in', async () => {
		vi.resetModules();
		const row = { ...PRE_MIGRATION_ROW, id: 'k-conn', scope: `avatars:read agents:write ${CONNECTOR_MARKER} wallet:write` };
		vi.doMock('../api/_lib/db.js', () => ({ sql: vi.fn(async (strings) => (String(strings.join('?')).includes('select') ? [row] : [])) }));
		const { authenticateBearer } = await import('../api/_lib/auth.js');
		const auth = await authenticateBearer('sk_live_connector_key');
		expect(auth.scope).toBe(`avatars:read agents:write ${CONNECTOR_MARKER}`);
		expect(() => assertMaySpend('three.ws', 'agent_card_create', auth)).toThrow(/Connector keys/);
		vi.doUnmock('../api/_lib/db.js');
	});

	it('a standard key without wallet:write is told which scope it lacks', () => {
		const narrow = { userId: 'user-1', scope: 'avatars:read', source: 'apikey' };
		let thrown;
		try {
			assertMaySpend('threews-agent', 'swap_execute', narrow);
		} catch (err) {
			thrown = err;
		}
		expect(thrown.code).toBe(SPEND_REFUSED_CODE);
		expect(thrown.data.reason).toBe('spend_scope_required');
		expect(thrown.message).toContain('lacks the wallet:write scope');
	});

	it('anonymous x402 and free callers hold no account funds and are left to the handlers', () => {
		expect(() => assertMaySpend('threews-3d-studio', 'persona_tip', { userId: null, scope: '', source: 'x402' })).not.toThrow();
		expect(() => assertMaySpend('threews-agent', 'pay_and_call', null)).not.toThrow();
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
});
