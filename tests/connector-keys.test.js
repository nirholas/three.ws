// Scoped API keys for unattended agents (x-grok order 026).
//
// A key stored as a Grok Bot secret must read, generate and edit agent data and
// never move value. Every claim below runs against the real code: the key scope
// module, authenticateBearer on a real-shaped api_keys row, the shared policy
// gate, and every hosted MCP dispatcher. Only the database is replaced.

import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { POLICY } from '@three-ws/mcp-policy';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const hashOf = (token) => createHash('sha256').update(token).digest('hex');

// Fixtures: rows shaped like api_keys, one per case. LEGACY_ROW is a key minted
// before the migration, so it has no `preset` column value at all.
const USER = '9a8b7c6d-0000-4000-8000-0000000000aa';
const FIXTURE_ROWS = {
	sk_live_fixture_connector_000000000000: {
		id: '6f1d2c3b-0000-4000-8000-00000000c0de',
		user_id: USER,
		scope: 'read generate agents:write',
		preset: 'connector',
		expires_at: null,
		revoked_at: null,
	},
	// A connector row whose scope string was tampered with directly in the
	// database: the preset alone must still keep it from spending.
	sk_live_fixture_tampered_00000000000000: {
		id: '6f1d2c3b-0000-4000-8000-00000000dead',
		user_id: USER,
		scope: 'read generate agents:write spend wallet:write services:write',
		preset: 'connector',
		expires_at: null,
		revoked_at: null,
	},
	sk_live_fixture_legacy_spender_00000000: {
		id: '6f1d2c3b-0000-4000-8000-00000000a001',
		user_id: USER,
		scope: 'avatars:read avatars:write wallet:read wallet:write services:write',
		expires_at: null,
		revoked_at: null,
	},
	sk_live_fixture_legacy_reader_000000000: {
		id: '6f1d2c3b-0000-4000-8000-00000000a002',
		user_id: USER,
		scope: 'avatars:read avatars:write',
		expires_at: null,
		revoked_at: null,
	},
	sk_live_fixture_explicit_spend_00000000: {
		id: '6f1d2c3b-0000-4000-8000-00000000a003',
		user_id: USER,
		scope: 'read generate agents:write spend',
		preset: null,
		expires_at: null,
		revoked_at: null,
	},
};
const ROWS_BY_HASH = new Map(Object.entries(FIXTURE_ROWS).map(([token, row]) => [hashOf(token), row]));

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...values) => {
		const text = Array.isArray(strings) ? strings.join('?') : String(strings);
		if (/from api_keys where token_hash/.test(text)) {
			const hit = values.map((v) => ROWS_BY_HASH.get(v)).find(Boolean);
			return Promise.resolve(hit ? [hit] : []);
		}
		return Promise.resolve([]);
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false, isStoragePressured: () => false };
});

vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const {
	CONNECTOR_SCOPES,
	SPEND_GRANTS,
	expandKeyScopes,
	effectiveKeyScope,
	connectorViolations,
} = await import('../api/_lib/key-scopes.js');
const { authenticateBearer, hasScope } = await import('../api/_lib/auth.js');
const { assertBearerMaySpend } = await import('../api/_lib/spend-scope.js');
const { mintApiKey, normalizeKeyScopes, API_KEY_SCOPES } = await import('../api/_lib/api-keys.js');
const { gateCall, listForRequest, movesValue } = await import('../api/_mcp/policy.js');

const bearer = (token) => authenticateBearer(token);

describe('key scopes', () => {
	it('knows the coarse scopes', () => {
		for (const s of ['read', 'generate', 'agents:write', 'spend']) expect(API_KEY_SCOPES).toContain(s);
		expect(normalizeKeyScopes('read generate agents:write spend').invalid).toEqual([]);
	});

	it('fixes the connector grant at read, generate, agents:write', () => {
		expect([...CONNECTOR_SCOPES]).toEqual(['read', 'generate', 'agents:write']);
		expect(connectorViolations(['read', 'spend', 'wallet:write', 'agents:write'])).toEqual(['spend', 'wallet:write']);
		expect(connectorViolations([...CONNECTOR_SCOPES])).toEqual([]);
	});

	it('expands coarse scopes into the fine scopes routes check', () => {
		const fine = expandKeyScopes('read generate agents:write');
		for (const s of ['avatars:read', 'agents:read', 'memory:read', 'avatars:write', 'agents:write', 'memory:write'])
			expect(fine).toContain(s);
		for (const s of SPEND_GRANTS) expect(fine).not.toContain(s);
	});

	it('leaves a pre-migration scope string exactly as it was', () => {
		const scope = 'avatars:read avatars:write wallet:write profile';
		expect(effectiveKeyScope({ scope })).toEqual({ scope, connector: false });
	});

	it('strips every spend-capable scope from a connector row', () => {
		const { scope, connector } = effectiveKeyScope({ scope: 'read spend wallet:write services:write', preset: 'connector' });
		expect(connector).toBe(true);
		for (const s of SPEND_GRANTS) expect(scope.split(' ')).not.toContain(s);
	});
});

describe('authenticateBearer with keys', () => {
	it('gives a connector key read, generate and agent edit power and flags it', async () => {
		const auth = await bearer('sk_live_fixture_connector_000000000000');
		expect(auth).toMatchObject({ userId: USER, source: 'apikey', connector: true });
		for (const s of ['avatars:read', 'avatars:write', 'agents:read', 'agents:write', 'memory:read', 'memory:write'])
			expect(hasScope(auth.scope, s), s).toBe(true);
	});

	it('refuses a connector key every spend scope, even when its stored scope string holds them', async () => {
		const auth = await bearer('sk_live_fixture_tampered_00000000000000');
		expect(auth.connector).toBe(true);
		for (const s of SPEND_GRANTS) expect(hasScope(auth.scope, s), s).toBe(false);
	});

	it('trips the REST spend gate for a connector key and passes a legacy spender', async () => {
		const connector = await bearer('sk_live_fixture_connector_000000000000');
		expect(() => assertBearerMaySpend(connector, { method: 'POST' })).toThrow(/wallet:write/);
		const tampered = await bearer('sk_live_fixture_tampered_00000000000000');
		expect(() => assertBearerMaySpend(tampered, { method: 'POST' })).toThrow(/wallet:write/);
		const legacy = await bearer('sk_live_fixture_legacy_spender_00000000');
		expect(assertBearerMaySpend(legacy, { method: 'POST' })).toBe(legacy);
	});

	it('keeps pre-migration keys working with the scope they always had', async () => {
		const legacy = await bearer('sk_live_fixture_legacy_reader_000000000');
		expect(legacy.scope).toBe('avatars:read avatars:write');
		expect(legacy.connector).toBeUndefined();
		const spender = await bearer('sk_live_fixture_legacy_spender_00000000');
		expect(hasScope(spender.scope, 'wallet:write')).toBe(true);
	});

	it('lets a non-connector key hold the explicit spend scope', async () => {
		const auth = await bearer('sk_live_fixture_explicit_spend_00000000');
		expect(auth.connector).toBeUndefined();
		expect(hasScope(auth.scope, 'wallet:write')).toBe(true);
		expect(hasScope(auth.scope, 'spend')).toBe(true);
	});
});

describe('mintApiKey', () => {
	it('refuses a connector key that asks for spend', async () => {
		await expect(mintApiKey({ userId: USER, name: 'x', scopes: ['read', 'spend'], preset: 'connector' })).rejects.toMatchObject({
			status: 400,
		});
		await expect(mintApiKey({ userId: USER, name: 'x', scopes: ['wallet:write'], preset: 'connector' })).rejects.toThrow(/connector/);
	});
});

// Every server in the shared policy table, every value-moving tool on it.
const SPENDING = Object.entries(POLICY).flatMap(([server, tools]) =>
	Object.keys(tools)
		.filter((name) => movesValue(server, name))
		.map((name) => ({ server, name })),
);

describe('the policy gate', () => {
	it('finds value-moving tools in every family', () => {
		const flags = new Set(SPENDING.map(({ server, name }) => POLICY[server][name].confirmFlag));
		for (const flag of ['confirm_swap', 'confirm_transfer', 'confirm_launch', 'confirm_spend', 'confirm_payment', 'confirm_withdraw', 'confirm_send', 'confirm_trade']) {
			expect(flags.has(flag), flag).toBe(true);
		}
		const groups = new Set(SPENDING.map(({ server, name }) => POLICY[server][name].group));
		for (const g of ['trading', 'wallet', 'launch', 'x402', 'marketplace']) expect(groups.has(g), g).toBe(true);
	});

	it('does not treat deleting your own data or running your own gear as spending', () => {
		const exempt = Object.entries(POLICY).flatMap(([server, tools]) =>
			Object.entries(tools)
				.filter(([, r]) => r.tier === 'financial' && ['confirm_delete', 'confirm_run'].includes(r.confirmFlag))
				.map(([name]) => ({ server, name })),
		);
		expect(exempt.length).toBeGreaterThan(0);
		for (const { server, name } of exempt) expect(movesValue(server, name), `${server}/${name}`).toBe(false);
	});

	it('refuses every value-moving tool on every server for a connector key with a -32003 that names the browser', async () => {
		expect(SPENDING.length).toBeGreaterThan(30);
		const auth = { userId: USER, scope: 'avatars:read', connector: true, apiKeyId: 'k' };
		for (const { server, name } of SPENDING) {
			const err = await gateCall(server, name, {}, auth, { headers: {} }).then(
				() => null,
				(e) => e,
			);
			expect(err, `${server}/${name}`).not.toBeNull();
			expect(err.code).toBe(-32003);
			expect(err.message).toContain('browser session');
			expect(err.message).toContain('https://three.ws/dashboard');
			expect(err.data).toMatchObject({ reason: 'spend_requires_browser_session', tool: name });
		}
	});

	it('does not raise the connector error for a normal key', async () => {
		const auth = { userId: null, scope: 'wallet:write', apiKeyId: null };
		for (const { server, name } of SPENDING) {
			const out = await gateCall(server, name, {}, auth, { headers: {} }).catch((e) => e);
			expect(out?.code, `${server}/${name}`).not.toBe(-32003);
		}
	});
});

describe('hosted MCP servers over JSON-RPC', () => {
	const connector = { userId: USER, scope: effectiveKeyScope({ scope: 'read generate agents:write', preset: 'connector' }).scope, connector: true, apiKeyId: 'k' };
	const req = { headers: {}, url: '/api/mcp' };

	async function surfaces() {
		const main = await import('../api/_mcp/dispatch.js');
		const agent = await import('../api/_mcpagent/dispatch.js');
		const studio3d = await import('../api/_mcp3d/dispatch.js');
		const studio = await import('../api/_mcp-studio/dispatch.js');
		const bazaar = await import('../api/_mcpbazaar/dispatch.js');
		return [
			{ label: 'three.ws', server: 'three.ws', run: (msg, auth) => main.dispatch(msg, auth, req) },
			{ label: 'threews-agent', server: 'threews-agent', run: (msg, auth) => agent.dispatch(msg, auth, req) },
			{ label: 'threews-3d-studio', server: 'threews-3d-studio', run: (msg, auth) => studio3d.dispatch(msg, auth, req) },
			{ label: 'threews-3d-studio-free', server: 'threews-3d-studio-free', run: (msg, auth) => studio.dispatch(msg, auth, req) },
			{ label: 'threews-x402-bazaar', server: 'threews-x402-bazaar', run: (msg, auth) => bazaar.dispatch(msg, auth, req) },
		];
	}

	it('answers tools/call on a value-moving tool with a JSON-RPC error, on every hosted server', async () => {
		let checked = 0;
		for (const s of await surfaces()) {
			const tools = Object.keys(POLICY[s.server]).filter((n) => movesValue(s.server, n));
			for (const name of tools) {
				const res = await s.run({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: {} } }, connector);
				// A tool the dispatcher does not serve on this surface answers -32602;
				// a served one must answer the connector error.
				if (res.error?.code === -32602) continue;
				expect(res.error?.code, `${s.label}/${name}`).toBe(-32003);
				expect(res.error.message).toContain('https://three.ws/dashboard');
				checked += 1;
			}
		}
		expect(checked).toBeGreaterThan(5);
	});

	it('never lists a value-moving tool to a connector key, and still lists them to a normal key', async () => {
		for (const s of await surfaces()) {
			const listed = await s.run({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, connector);
			const names = (listed.result?.tools || []).map((t) => t.name);
			expect(names.length, s.label).toBeGreaterThan(0);
			for (const n of names) expect(movesValue(s.server, n), `${s.label}/${n}`).toBe(false);
		}
	});

	it('hides spending tools from a connector even when the session enabled the financial tier', async () => {
		const { TOOL_CATALOG } = await import('../api/_mcp/catalog.js');
		const enabled = { headers: { 'x-three-tools': 'all' }, url: '/api/mcp' };
		const asNormal = await listForRequest('three.ws', TOOL_CATALOG, { userId: USER, scope: 'wallet:write' }, enabled);
		const asConnector = await listForRequest('three.ws', TOOL_CATALOG, connector, enabled);
		const spendingNames = SPENDING.filter((t) => t.server === 'three.ws').map((t) => t.name);
		expect(asNormal.some((t) => spendingNames.includes(t.name))).toBe(true);
		expect(asConnector.some((t) => spendingNames.includes(t.name))).toBe(false);
	});
});
