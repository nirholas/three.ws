// three:// MCP resources (api/_mcp/resources.js): URI routing, access rules,
// the per-server subsets, the read_resource tool on every server, and the
// subscribe -> poll -> notifications/resources/updated path a wallet transfer
// drives.
//
// The database is an in-memory stand-in that understands exactly the queries
// these cases issue; the Solana RPC is replaced by a connection whose latest
// signature the test moves, which is what a real transfer does.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
// The System Program id: a valid public key that is nobody's wallet.
const ADDRESS = '11111111111111111111111111111111';

const db = { subs: [], nextId: 1, launches: [] };

function agentRow() {
	return {
		id: AGENT,
		user_id: OWNER,
		name: 'Scout',
		description: 'test agent',
		persona_prompt: 'calm',
		skills: ['greet'],
		meta: { solana_address: ADDRESS, spend_limits: { daily_usd: 50 } },
		avatar_id: null,
		is_published: false,
		created_at: '2026-09-01T00:00:00.000Z',
		updated_at: '2026-09-01T00:00:00.000Z',
	};
}

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const q = strings.join('?').replace(/\s+/g, ' ').trim();
		if (q.startsWith('SELECT id, user_id, name, description, persona_prompt')) {
			return values[0] === AGENT ? [agentRow()] : [];
		}
		if (q.includes('FROM agent_identities ai LEFT JOIN avatars av')) {
			return values[0] === OWNER
				? [{ id: AGENT, name: 'Scout', description: null, is_published: false, created_at: '2026-09-01', solana_address: ADDRESS, model: null, avatar_id: null }]
				: [];
		}
		if (q.includes('FROM pump_agent_mints pam')) return db.launches;
		if (q.startsWith('SELECT count(*)::int AS n FROM mcp_resource_subscriptions')) {
			const [server, key, uri] = values;
			return [{ n: db.subs.filter((s) => s.server === server && s.subscriber_key === key && s.uri !== uri).length }];
		}
		if (q.startsWith('INSERT INTO mcp_resource_subscriptions')) {
			const [server, key, userId, uri, fingerprint] = values;
			const existing = db.subs.find((s) => s.server === server && s.subscriber_key === key && s.uri === uri);
			if (existing) existing.fingerprint = fingerprint;
			else db.subs.push({ id: db.nextId++, server, subscriber_key: key, user_id: userId, uri, fingerprint });
			return [];
		}
		if (q.startsWith('SELECT id, uri, fingerprint FROM mcp_resource_subscriptions')) {
			const [server, key] = values;
			return db.subs.filter((s) => s.server === server && s.subscriber_key === key);
		}
		if (q.startsWith('UPDATE mcp_resource_subscriptions SET fingerprint')) {
			const [fingerprint, id] = values;
			db.subs.find((s) => s.id === id).fingerprint = fingerprint;
			return [];
		}
		if (q.startsWith('UPDATE mcp_resource_subscriptions SET checked_at')) return [];
		if (q.startsWith('DELETE FROM mcp_resource_subscriptions WHERE id')) {
			db.subs = db.subs.filter((s) => s.id !== values[0]);
			return [];
		}
		if (q.startsWith('DELETE FROM mcp_resource_subscriptions WHERE server')) {
			const [server, key, uri] = values;
			db.subs = db.subs.filter((s) => !(s.server === server && s.subscriber_key === key && (uri === undefined || s.uri === uri)));
			return [];
		}
		if (q.startsWith("SELECT meta->>'solana_address' AS address")) return [{ address: ADDRESS }];
		throw new Error(`unexpected query in test: ${q.slice(0, 120)}`);
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const rpc = { signature: 'sig-before' };
vi.mock('../api/_lib/agent-pumpfun.js', () => ({
	solanaConnection: () => ({
		getSignaturesForAddress: vi.fn(async () => [{ signature: rpc.signature }]),
	}),
}));

const invalidated = [];
vi.mock('../api/_lib/balances.js', () => ({
	invalidateBalances: vi.fn(async (x) => invalidated.push(x)),
	getBalances: vi.fn(async () => ({ native: { amount: 1.5, usd: 300 }, tokens: [] })),
	walletUsdTotal: () => 300,
}));

const resources = await import('../api/_mcp/resources.js');
const { TOOL_CATALOG: mainCatalog } = await import('../api/_mcp/catalog.js');
const { TOOL_CATALOG: agentCatalog } = await import('../api/_mcpagent/catalog.js');
const { TOOL_CATALOG: studioCatalog } = await import('../api/_mcp3d/catalog.js');
const { TOOL_CATALOG: bazaarCatalog } = await import('../api/_mcpbazaar/catalog.js');

const CATALOGS = { mcp: mainCatalog, 'mcp-agent': agentCatalog, 'mcp-3d': studioCatalog, 'mcp-bazaar': bazaarCatalog };

const owner = { userId: OWNER, scope: 'agents:read wallet:read', source: 'oauth', clientId: 'client-a' };
const stranger = { userId: STRANGER, scope: 'agents:read wallet:read', source: 'oauth', clientId: 'client-b' };
const anon = { userId: null, scope: '', source: 'free' };
const req = { headers: {} };

beforeEach(() => {
	db.subs = [];
	db.nextId = 1;
	db.launches = [];
	rpc.signature = 'sig-before';
	invalidated.length = 0;
});

describe('resource registry', () => {
	it('every hosted server exposes resources and publishes read_resource', () => {
		for (const server of resources.RESOURCE_SERVERS) {
			expect(resources.resourcesFor(server).length).toBeGreaterThan(0);
			expect(CATALOGS[server].map((t) => t.name)).toContain('read_resource');
		}
	});

	it('covers every resource the spec requires', () => {
		const all = new Set(resources.RESOURCES.map((r) => r.uri || r.uriTemplate));
		for (const uri of [
			'three://me',
			'three://agents',
			'three://agents/{agentId}',
			'three://agents/{agentId}/wallet',
			'three://agents/{agentId}/usage',
			'three://agents/{agentId}/chat',
			'three://agents/{agentId}/runs',
			'three://agents/{agentId}/runs/{runId}',
			'three://agents/{agentId}/orders',
			'three://agents/{agentId}/dca',
			'three://agents/{agentId}/intents',
			'three://marketplace',
			'three://models',
			'three://wallets',
			'three://launches',
			'three://x402/services',
			'three://assets/{id}',
		]) {
			expect(all, uri).toContain(uri);
		}
		expect(resources.resourcesFor('mcp-3d').map((r) => r.key)).toContain('asset');
		expect(resources.resourcesFor('mcp').map((r) => r.key)).not.toContain('asset');
	});

	it('names a tool equivalent in every description, and only tools the server has', () => {
		for (const server of resources.RESOURCE_SERVERS) {
			const names = new Set(CATALOGS[server].map((t) => t.name));
			for (const def of resources.resourcesFor(server)) {
				expect(resources.describeFor(def, server)).toContain('read_resource');
				const dedicated = def.tools?.[server];
				if (dedicated) expect(names, `${server} ${dedicated}`).toContain(dedicated);
			}
		}
	});
});

describe('URI matching', () => {
	it('matches templates, captures params and reads the format flag', () => {
		const m = resources.matchResource('mcp', `three://agents/${AGENT}/wallet?format=markdown`);
		expect(m.def.key).toBe('wallet');
		expect(m.params).toEqual({ agentId: AGENT });
		expect(m.format).toBe('markdown');
		expect(m.path).toBe(`three://agents/${AGENT}/wallet`);
	});

	it('rejects foreign schemes, unknown paths and resources another server owns', () => {
		expect(resources.matchResource('mcp', 'https://three.ws/api/mcp')).toBeNull();
		expect(resources.matchResource('mcp', 'three://nothing/here')).toBeNull();
		expect(resources.matchResource('mcp-bazaar', 'three://agents')).toBeNull();
		expect(resources.matchResource('mcp', `three://assets/${AGENT}`)).toBeNull();
	});
});

describe('resources/read access', () => {
	it('refuses account data to an anonymous caller with a sign-in hint', async () => {
		await expect(
			resources.handleResourceMethod('mcp', 'resources/read', { uri: 'three://me' }, anon, req),
		).rejects.toMatchObject({ code: -32001 });
	});

	it('refuses a caller without an agents scope', async () => {
		const noScope = { ...owner, scope: 'avatars:read' };
		await expect(
			resources.handleResourceMethod('mcp', 'resources/read', { uri: 'three://agents' }, noScope, req),
		).rejects.toMatchObject({ code: -32001, data: { required_scopes: ['agents:read', 'agents:write'] } });
	});

	it("answers someone else's agent exactly like a missing one", async () => {
		await expect(
			resources.handleResourceMethod('mcp', 'resources/read', { uri: `three://agents/${AGENT}/wallet` }, stranger, req),
		).rejects.toMatchObject({ code: -32002 });
	});

	it('reads JSON by default and markdown on request', async () => {
		db.launches = [
			{ mint: 'THREEsynthetic2222', name: 'Test', symbol: 'TST', network: 'mainnet', created_at: '2026-09-02', quote_mint: null, agent_id: AGENT, agent_name: 'Scout' },
		];
		const json = await resources.handleResourceMethod('mcp', 'resources/read', { uri: 'three://launches' }, owner, req);
		expect(json.contents[0].mimeType).toBe('application/json');
		expect(JSON.parse(json.contents[0].text)).toMatchObject({ count: 1, launches: [{ symbol: 'TST' }] });

		const md = await resources.handleResourceMethod('mcp', 'resources/read', { uri: 'three://launches?format=markdown' }, owner, req);
		expect(md.contents[0].mimeType).toBe('text/markdown');
		expect(md.contents[0].text).toMatch(/^# Your token launches/);
		expect(md.contents[0].text).toContain('| mint | name | symbol |');
	});

	it('hides internal errors behind a generic message with a reference', async () => {
		db.launches = null;
		const err = await resources
			.handleResourceMethod('mcp', 'resources/read', { uri: 'three://launches' }, owner, req)
			.catch((e) => e);
		expect(err.code).toBe(-32603);
		expect(err.message).toMatch(/ref [0-9a-f]{8}/);
	});
});

describe('resources/list', () => {
	it('lists only public resources for an anonymous caller', async () => {
		const out = await resources.handleResourceMethod('mcp', 'resources/list', {}, anon, req);
		expect(out.resources.map((r) => r.uri).sort()).toEqual(['three://marketplace', 'three://models', 'three://x402/services']);
	});

	it("expands per-agent resources for the caller's agents", async () => {
		const out = await resources.handleResourceMethod('mcp', 'resources/list', {}, owner, req);
		const uris = out.resources.map((r) => r.uri);
		expect(uris).toContain(`three://agents/${AGENT}/wallet`);
		expect(uris).toContain(`three://agents/${AGENT}/usage`);
		expect(out.resources.every((r) => r.mimeType === 'application/json')).toBe(true);
	});

	it('serves templates per server', async () => {
		const out = await resources.handleResourceMethod('mcp-3d', 'resources/templates/list', {}, anon, req);
		expect(out.resourceTemplates.map((t) => t.uriTemplate)).toContain('three://assets/{id}');
	});
});

describe('read_resource tool', () => {
	it('returns the resource index with no uri', async () => {
		const out = await resources.readResourceToolResult('mcp-bazaar', {}, anon, req);
		expect(out.structuredContent.resources.map((r) => r.uri)).toContain('three://x402/services');
	});

	it('reports a missing sign-in as a tool error, not a protocol error', async () => {
		const out = await resources.readResourceToolResult('mcp', { uri: 'three://wallets' }, anon, req);
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toMatch(/sign in/);
	});
});

describe('subscriptions', () => {
	const walletUri = `three://agents/${AGENT}/wallet`;

	it('needs a signed-in client', async () => {
		await expect(
			resources.handleResourceMethod('mcp-agent', 'resources/subscribe', { uri: walletUri }, anon, req),
		).rejects.toMatchObject({ code: -32001 });
	});

	it('notifies once after a transfer moves the latest signature, then stays quiet', async () => {
		await resources.handleResourceMethod('mcp-agent', 'resources/subscribe', { uri: walletUri }, owner, req);
		expect(db.subs).toHaveLength(1);
		expect(db.subs[0].subscriber_key).toBe(`user:${OWNER}:client:client-a`);

		const sent = [];
		await resources.pollSubscriptions('mcp-agent', owner, req, (m) => sent.push(m));
		expect(sent).toHaveLength(0);

		rpc.signature = 'sig-after-transfer';
		await resources.pollSubscriptions('mcp-agent', owner, req, (m) => sent.push(m));
		expect(sent).toEqual([{ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: walletUri } }]);
		expect(invalidated).toEqual([{ chain: 'solana', address: ADDRESS }]);

		await resources.pollSubscriptions('mcp-agent', owner, req, (m) => sent.push(m));
		expect(sent).toHaveLength(1);
	});

	it('keys on Mcp-Session-Id when the client sends one', () => {
		expect(resources.subscriberKey(owner, { headers: { 'mcp-session-id': 'abc' } })).toBe('session:abc');
	});

	it('unsubscribe and session teardown remove subscriptions', async () => {
		await resources.handleResourceMethod('mcp-agent', 'resources/subscribe', { uri: walletUri }, owner, req);
		await resources.handleResourceMethod('mcp-agent', 'resources/unsubscribe', { uri: walletUri }, owner, req);
		expect(db.subs).toHaveLength(0);

		await resources.handleResourceMethod('mcp-agent', 'resources/subscribe', { uri: walletUri }, owner, req);
		await resources.dropSubscriptions('mcp-agent', owner, req);
		expect(db.subs).toHaveLength(0);
	});

	it('drops a subscription whose resource is no longer readable', async () => {
		await resources.handleResourceMethod('mcp-agent', 'resources/subscribe', { uri: walletUri }, owner, req);
		db.subs[0].subscriber_key = resources.subscriberKey(stranger, req);
		await resources.pollSubscriptions('mcp-agent', stranger, req, () => {});
		expect(db.subs).toHaveLength(0);
	});
});

describe('dispatcher wiring', () => {
	it('advertises resource subscriptions and prompts on initialize', async () => {
		const { dispatch } = await import('../api/_mcpbazaar/dispatch.js');
		const out = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, anon, req);
		expect(out.result.capabilities.resources).toEqual({ subscribe: true, listChanged: false });
		expect(out.result.capabilities.prompts).toEqual({ listChanged: false });
	});

	it('treats resource and prompt discovery as free discovery, but not subscribe', async () => {
		const { isDiscoveryOnlyBatch } = await import('../api/_lib/mcp-batch-price.js');
		expect(isDiscoveryOnlyBatch([{ method: 'resources/list' }, { method: 'prompts/get' }])).toBe(true);
		expect(isDiscoveryOnlyBatch([{ method: 'resources/subscribe' }])).toBe(false);
	});
});
