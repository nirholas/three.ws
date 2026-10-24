// Summary-first MCP results (api/_lib/mcp-expand.js), the expand tool, and the
// search_docs tool. The handlers under test are the real ones; only the database
// is replaced by an in-memory stand-in that answers the queries they issue.

import { describe, it, expect, vi, beforeAll } from 'vitest';

process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';

const db = { agents: [], memories: [] };

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const q = strings.join('?').replace(/\s+/g, ' ').trim();
		if (q.startsWith('SELECT user_id FROM agent_identities')) {
			return values[0] === AGENT ? [{ user_id: OWNER }] : [];
		}
		if (q.includes('FROM agent_identities') && q.includes("meta->>'solana_address'")) {
			return values[0] === OWNER ? db.agents.slice(0, values[1]) : [];
		}
		if (q.startsWith('SELECT * FROM agent_memories')) return db.memories;
		return [];
	}),
}));

const { toolDefs: agentTools } = await import('../api/_mcp/tools/agents.js');
const { toolDefs: memoryTools } = await import('../api/_mcp/tools/memory.js');
const { toolDefs: docsTools } = await import('../api/_mcp/tools/docs.js');
const { toolDefs: expandTools } = await import('../api/_mcp/tools/expand.js');
const { summarizeList, expandHandle, decodeHandle, principalKey, approxTokens } = await import('../api/_lib/mcp-expand.js');
const { findRows } = await import('../api/_mcp/tools/crypto-data.js');

const tool = (defs, name) => defs.find((d) => d.name === name);
const listMyAgents = tool(agentTools, 'list_my_agents');
const recall = tool(memoryTools, 'recall');
const expand = tool(expandTools, 'expand');
const searchDocsTool = tool(docsTools, 'search_docs');

const ownerAuth = { userId: OWNER, scope: 'agents:read memory:read', source: 'oauth' };
const strangerAuth = { userId: STRANGER, scope: 'agents:read memory:read', source: 'oauth' };

function seed(agentCount, memoryCount) {
	db.agents = Array.from({ length: agentCount }, (_, i) => ({
		id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
		name: `Agent ${i} the explorer of long named things`,
		description: 'Walks the market every hour, writes a short note about what moved, and keeps its wallet within the daily limit set by its owner.',
		is_published: i % 3 === 0,
		created_at: new Date(2026, 9, 1, 0, i).toISOString(),
		solana_address: '11111111111111111111111111111111',
		model: 'anthropic',
	}));
	db.memories = Array.from({ length: memoryCount }, (_, i) => ({
		id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
		agent_id: AGENT,
		type: ['user', 'feedback', 'project', 'reference'][i % 4],
		content: `The owner prefers report number ${i} to lead with the wallet balance, then the three largest moves, then anything that needs a decision. Keep it under two hundred words.`,
		tags: ['reports', 'style'],
		context: { source: 'chat', turn: i },
		salience: 0.5,
		created_at: new Date(2026, 9, 1, 0, i).toISOString(),
		expires_at: null,
	}));
}

describe('summarizeList', () => {
	it('returns null for a list that fits one page', async () => {
		expect(await summarizeList({ tool: 't', auth: ownerAuth, items: [1, 2, 3], pageSize: 5, summary: 's' })).toBeNull();
	});

	it('returns null for callers with no stable identity, so they get the whole answer', async () => {
		const items = Array.from({ length: 20 }, (_, i) => ({ i }));
		expect(await summarizeList({ tool: 't', auth: { userId: null, source: 'free' }, items, pageSize: 5, summary: 's' })).toBeNull();
		expect(await summarizeList({ tool: 't', auth: { userId: null, source: 'x402', payer: 'p' }, items, pageSize: 5, summary: 's' })).toBeNull();
	});

	it('answers with summary, handle, count and the first page', async () => {
		const items = Array.from({ length: 20 }, (_, i) => ({ i }));
		const r = await summarizeList({ tool: 't', auth: ownerAuth, items, pageSize: 5, summary: 'twenty rows' });
		expect(r.structuredContent).toMatchObject({ summary: 'twenty rows', count: 20, offset: 0, limit: 5, next_offset: 5 });
		expect(r.structuredContent.items).toHaveLength(5);
		expect(r.structuredContent.handle).toMatch(/^mx1\./);
		expect(r.content[0].text).toContain(r.structuredContent.handle);
		expect(decodeHandle(r.structuredContent.handle)).toMatchObject({ tool: 't' });
	});
});

describe('expand', () => {
	async function issue(auth = ownerAuth, n = 23) {
		const items = Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}`, detail: { a: i, b: 'x' } }));
		const r = await summarizeList({ tool: 'list_my_agents', auth, items, pageSize: 10, summary: 's' });
		return r.structuredContent.handle;
	}

	it('pages through the whole list and ends cleanly', async () => {
		const handle = await issue();
		const p2 = await expand.handler({ handle, offset: 10 }, ownerAuth);
		expect(p2.structuredContent).toMatchObject({ count: 23, offset: 10, next_offset: 20 });
		expect(p2.structuredContent.items.map((x) => x.id)[0]).toBe('row-10');
		const p3 = await expand.handler({ handle, offset: 20 }, ownerAuth);
		expect(p3.structuredContent.items).toHaveLength(3);
		expect(p3.structuredContent.next_offset).toBeNull();
		const past = await expand.handler({ handle, offset: 99 }, ownerAuth);
		expect(past.isError).toBeUndefined();
		expect(past.structuredContent.items).toEqual([]);
	});

	it('narrows rows to the requested fields, dot paths included', async () => {
		const handle = await issue();
		const r = await expand.handler({ handle, offset: 0, limit: 2, fields: ['id', 'detail.a', 'missing'] }, ownerAuth);
		expect(r.structuredContent.items).toEqual([
			{ id: 'row-0', detail: { a: 0 } },
			{ id: 'row-1', detail: { a: 1 } },
		]);
	});

	it('refuses a handle that belongs to another account', async () => {
		const handle = await issue(ownerAuth);
		const r = await expand.handler({ handle }, strangerAuth);
		expect(r.isError).toBe(true);
		expect(r.structuredContent.error).toBe('invalid_handle');
		expect(JSON.stringify(r)).not.toContain('row-');
	});

	it('refuses a handle with an edited payload or signature', async () => {
		const handle = await issue();
		const [prefix, payload, sig] = handle.split('.');
		const other = Buffer.from(JSON.stringify({ i: 'x', p: 'x', t: 'x', e: Date.now() + 1e6 })).toString('base64url');
		for (const bad of [`${prefix}.${other}.${sig}`, `${prefix}.${payload}.${sig.slice(0, -2)}AA`, 'mx1.garbage', 'not-a-handle']) {
			const r = await expand.handler({ handle: bad }, ownerAuth);
			expect(r.isError).toBe(true);
			expect(r.structuredContent.error).toBe('invalid_handle');
		}
	});

	it('fails cleanly once the handle has expired', async () => {
		const handle = await issue();
		const r = await expandHandle({ handle, auth: ownerAuth, now: Date.now() + 16 * 60 * 1000 });
		expect(r.isError).toBe(true);
		expect(r.structuredContent.error).toBe('handle_expired');
		expect(r.content[0].text).toContain('Call list_my_agents again');
	});

	it('tells an anonymous caller to sign in rather than leaking anything', async () => {
		const handle = await issue();
		const r = await expand.handler({ handle }, { userId: null, source: 'free' });
		expect(r.isError).toBe(true);
		expect(r.structuredContent.error).toBe('sign_in_required');
	});

	it('binds API-key principals separately from accounts', () => {
		expect(principalKey({ apiKeyId: 'k1' })).toBe('key:k1');
		expect(principalKey({ userId: OWNER, apiKeyId: 'k1' })).toBe(`user:${OWNER}`);
		expect(principalKey({ source: 'x402', payer: 'p' })).toBeNull();
	});
});

describe('findRows', () => {
	it('finds a top-level list, a nested list, and none', () => {
		expect(findRows([1, 2]).path).toEqual([]);
		expect(findRows({ ok: true, data: { pairs: [1, 2, 3], tags: [1] } }).path).toEqual(['data', 'pairs']);
		expect(findRows({ price: 1, nested: { a: 2 } })).toBeNull();
	});
});

describe('tools wired to the envelope', () => {
	it('list_my_agents keeps a short list whole', async () => {
		seed(4, 0);
		const r = await listMyAgents.handler({ limit: 50 }, ownerAuth);
		expect(r.structuredContent.agents).toHaveLength(4);
		expect(r.structuredContent.handle).toBeUndefined();
	});

	it('list_my_agents summarizes a long list and expand returns every row', async () => {
		seed(50, 0);
		const full = JSON.stringify({ count: 50, agents: db.agents });
		const r = await listMyAgents.handler({ limit: 50 }, ownerAuth);
		expect(r.structuredContent.count).toBe(50);
		expect(r.structuredContent.items).toHaveLength(10);
		expect(r.structuredContent.summary).toMatch(/50 agents/);
		expect(approxTokens(r)).toBeLessThan(approxTokens(full) / 2);
		const seen = [...r.structuredContent.items];
		let next = r.structuredContent.next_offset;
		while (next !== null) {
			const page = await expand.handler({ handle: r.structuredContent.handle, offset: next, limit: 20 }, ownerAuth);
			seen.push(...page.structuredContent.items);
			next = page.structuredContent.next_offset;
		}
		expect(seen.map((a) => a.id)).toEqual(db.agents.map((a) => a.id));
	});

	it('recall summarizes past five memories and refuses a foreign handle', async () => {
		seed(0, 40);
		const r = await recall.handler({ agent_id: AGENT, query: 'report wallet balance', limit: 30 }, ownerAuth);
		expect(r.structuredContent.items).toHaveLength(5);
		expect(r.structuredContent.count).toBe(30);
		const stolen = await expand.handler({ handle: r.structuredContent.handle }, strangerAuth);
		expect(stolen.isError).toBe(true);
	});

	it('recall with a small limit is unchanged', async () => {
		seed(0, 40);
		const r = await recall.handler({ agent_id: AGENT, query: 'report', limit: 3 }, ownerAuth);
		expect(r.structuredContent.memories).toHaveLength(3);
	});
});

describe('search_docs', () => {
	beforeAll(async () => {
		await searchDocsTool.handler({ query: 'warm up' }, {}, undefined);
	}, 60_000);

	it.each([
		['how do I fund an agent wallet', /wallet/i],
		['what is the x402 payment flow', /x402|payment/i],
		['how do I embed a 3D avatar on my site', /embed|avatar/i],
	])('answers %s', async (query, expected) => {
		const r = await searchDocsTool.handler({ query, limit: 3 }, {}, undefined);
		expect(r.structuredContent.count).toBeGreaterThan(0);
		for (const hit of r.structuredContent.results) {
			expect(hit.url).toMatch(/^https:\/\/three\.ws\/docs#/);
			expect(hit.snippet.length).toBeGreaterThan(20);
			expect(hit.title.length).toBeGreaterThan(0);
		}
		expect(JSON.stringify(r.structuredContent.results)).toMatch(expected);
	});

	it('says so when nothing matches', async () => {
		const r = await searchDocsTool.handler({ query: 'zzqxv qqwwzz' }, {}, undefined);
		expect(r.structuredContent.count).toBe(0);
		expect(r.isError).toBeUndefined();
	});
});
