import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentMemory, createAgentMemory, ThreeWsError, MemoryError, PaymentRequiredError } from '../src/index.js';

// A scripted fetch double: each call shifts the next queued response and records
// the request. No network, no real endpoints — we assert on request shaping and
// response parsing, which is all the SDK is responsible for.
function stubFetch(responses) {
	const calls = [];
	const queue = [...responses];
	const fetch = async (url, init) => {
		calls.push({ url: new URL(url), init });
		const next = queue.shift();
		if (!next) throw new Error('stubFetch: no more queued responses');
		const { status = 200, body = {}, headers = {} } = next;
		return {
			ok: status >= 200 && status < 300,
			status,
			headers: { get: (k) => headers[k.toLowerCase()] ?? null },
			text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
		};
	};
	return { fetch, calls };
}

const AGENT = 'agent_THREE_1';
// A decorated memory as the store's decorateMemory() emits it (camelCase, with a
// snake_case agent_id, score/match only on recall hits).
function storedMemory(extra = {}) {
	return {
		id: 'm1',
		agent_id: AGENT,
		type: 'project',
		content: 'User prefers Solana over EVM chains',
		tags: ['preference'],
		context: {},
		salience: 0.5,
		tier: 'recall',
		pinned: false,
		embedder: 'nvidia/nv-embedqa-e5-v5@1024',
		hasEmbedding: true,
		accessCount: 0,
		isPublic: false,
		tokens: 9,
		createdAt: 1700000000000,
		updatedAt: 1700000000000,
		lastAccessedAt: null,
		expiresAt: null,
		...extra,
	};
}

test('remember() posts { agentId, entry } and shapes the stored memory', async () => {
	const { fetch, calls } = stubFetch([{ status: 201, body: { entry: storedMemory() } }]);
	const memory = new AgentMemory({ agentId: AGENT, token: 'tok', fetch });

	const mem = await memory.remember('User prefers Solana over EVM chains', { tags: ['preference'] });

	assert.equal(calls[0].url.pathname, '/api/agent-memory');
	assert.equal(calls[0].init.method, 'POST');
	assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
	const sent = JSON.parse(calls[0].init.body);
	assert.equal(sent.agentId, AGENT);
	assert.equal(sent.entry.content, 'User prefers Solana over EVM chains');
	assert.deepEqual(sent.entry.tags, ['preference']);
	assert.ok(!('pinned' in sent.entry), 'unset pinned is pruned from the entry');
	assert.equal(mem.id, 'm1');
	assert.equal(mem.agentId, AGENT, 'snake_case agent_id is normalized to agentId');
	assert.equal(mem.tier, 'recall');
	assert.ok(mem.raw, 'raw escape hatch present');
});

test('remember() forces tier=working when pinned', async () => {
	const { fetch, calls } = stubFetch([{ status: 201, body: { entry: storedMemory({ pinned: true, tier: 'working' }) } }]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	await memory.remember('Never risk more than 2% per trade', { tags: ['strategy'], pinned: true });
	const sent = JSON.parse(calls[0].init.body);
	assert.equal(sent.entry.pinned, true);
});

test('recall() posts to /api/memory/search and maps results to camelCase with score/match', async () => {
	const { fetch, calls } = stubFetch([{
		body: { results: [storedMemory({ score: 0.8312, match: 'semantic' })], provider: true, scored: 1 },
	}]);
	const memory = new AgentMemory({ agentId: AGENT, fetch });

	const hits = await memory.recall('which blockchain does the user like?', { topK: 5 });

	assert.equal(calls[0].url.pathname, '/api/memory/search');
	assert.equal(calls[0].init.method, 'POST');
	const sent = JSON.parse(calls[0].init.body);
	assert.equal(sent.agentId, AGENT);
	assert.equal(sent.query, 'which blockchain does the user like?');
	assert.equal(sent.topK, 5);
	assert.equal(hits[0].content, 'User prefers Solana over EVM chains');
	assert.equal(hits[0].score, 0.8312);
	assert.equal(hits[0].match, 'semantic');
});

test('list() puts agentId + filters on the query string', async () => {
	const { fetch, calls } = stubFetch([{ body: { entries: [storedMemory()] } }]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	const out = await memory.list({ type: 'project', limit: 50, since: 1700000000000 });
	assert.equal(calls[0].url.pathname, '/api/agent-memory');
	assert.equal(calls[0].url.searchParams.get('agentId'), AGENT);
	assert.equal(calls[0].url.searchParams.get('type'), 'project');
	assert.equal(calls[0].url.searchParams.get('limit'), '50');
	assert.equal(out.length, 1);
});

test('graph() shapes nodes + edges; entities() ranks by mentions', async () => {
	const { fetch } = stubFetch([{
		body: {
			nodes: [
				{ id: 'e1', kind: 'strategy', label: 'Never risk more than 2%…', mentions: 1, salience: 0.5 },
				{ id: 'e2', kind: 'ticker', label: '$THREE', mentions: 3, salience: 0.6 },
			],
			edges: [{ source: 'e1', target: 'e2', weight: 2 }],
			stats: { entities: 2, edges: 1 },
		},
	}]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	const g = await memory.graph();
	assert.equal(g.nodes.length, 2);
	assert.equal(g.edges[0].weight, 2);
	assert.equal(g.stats.entities, 2);

	const { fetch: fetch2 } = stubFetch([{
		body: {
			nodes: [
				{ id: 'e1', kind: 'strategy', label: 'a', mentions: 1 },
				{ id: 'e2', kind: 'ticker', label: '$THREE', mentions: 3 },
			],
			edges: [],
			stats: { entities: 2, edges: 0 },
		},
	}]);
	const memory2 = createAgentMemory({ agentId: AGENT, fetch: fetch2 });
	const ents = await memory2.entities();
	assert.equal(ents[0].label, '$THREE', 'ranked by mention count desc');
});

test('memoriesFor() targets graph?entityId=', async () => {
	const { fetch, calls } = stubFetch([{ body: { memories: [storedMemory()] } }]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	const mems = await memory.memoriesFor('e2');
	assert.equal(calls[0].url.pathname, '/api/memory/graph');
	assert.equal(calls[0].url.searchParams.get('entityId'), 'e2');
	assert.equal(mems[0].id, 'm1');
});

test('context() reads the working set with a token budget', async () => {
	const { fetch, calls } = stubFetch([{
		body: { entries: [storedMemory({ pinned: true, tier: 'working' })], tokens: 41, budget: 2000, overBudget: false, counts: { total: 1, working: 1, recall: 0, archival: 0, embedded: 1 } },
	}]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	const ctx = await memory.context();
	assert.equal(calls[0].url.pathname, '/api/memory/context');
	assert.equal(ctx.tokens, 41);
	assert.equal(ctx.budget, 2000);
	assert.equal(ctx.overBudget, false);
	assert.equal(ctx.entries[0].pinned, true);
});

test('curation: pin/retier/setSalience hit /api/memory/curate with the right op', async () => {
	const { fetch, calls } = stubFetch([
		{ body: { entry: storedMemory({ pinned: true, tier: 'working' }) } },
		{ body: { entry: storedMemory({ tier: 'archival' }) } },
		{ body: { entry: storedMemory({ salience: 0.9 }) } },
	]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });

	await memory.pin('m1');
	await memory.retier('m1', 'archival');
	await memory.setSalience('m1', 0.9);

	assert.equal(calls[0].url.pathname, '/api/memory/curate');
	assert.equal(JSON.parse(calls[0].init.body).op, 'pin');
	assert.equal(JSON.parse(calls[1].init.body).op, 'tier');
	assert.equal(JSON.parse(calls[1].init.body).tier, 'archival');
	const s = JSON.parse(calls[2].init.body);
	assert.equal(s.op, 'salience');
	assert.equal(s.salience, 0.9);
});

test('forget() returns { ok, id } from the curate forget op', async () => {
	const { fetch, calls } = stubFetch([{ body: { ok: true, forgot: 'm1' } }]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	const res = await memory.forget('m1');
	assert.equal(JSON.parse(calls[0].init.body).op, 'forget');
	assert.deepEqual(res, { ok: true, id: 'm1' });
});

test('merge() requires >= 2 ids and returns the survivor + count', async () => {
	const { fetch, calls } = stubFetch([{ body: { entry: storedMemory(), merged: 1 } }]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	const res = await memory.merge(['m1', 'm2']);
	assert.equal(JSON.parse(calls[0].init.body).op, 'merge');
	assert.deepEqual(JSON.parse(calls[0].init.body).memoryIds, ['m1', 'm2']);
	assert.equal(res.merged, 1);
	assert.equal(res.entry.id, 'm1');
});

test('input validation rejects before any network call', async () => {
	const { fetch, calls } = stubFetch([]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	await assert.rejects(() => memory.remember(''), /needs `content`/);
	await assert.rejects(() => memory.remember('x', { tier: 'cold' }), /Invalid tier/);
	await assert.rejects(() => memory.remember('x', { salience: 2 }), /0\.\.1/);
	await assert.rejects(() => memory.recall('   '), /non-empty query/);
	await assert.rejects(() => memory.retier('m1', 'cold'), /Invalid tier/);
	await assert.rejects(() => memory.setSalience('m1', -1), /0\.\.1/);
	await assert.rejects(() => memory.merge(['only-one']), /at least 2/);
	assert.equal(calls.length, 0);
	// A missing agentId is rejected at construction.
	assert.throws(() => createAgentMemory({ fetch }), /agentId/);
});

test('a 401 write surfaces as a typed MemoryError (=== ThreeWsError) with code', async () => {
	const { fetch } = stubFetch([{ status: 401, body: { error: 'unauthorized', message: 'sign in required' } }]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	await assert.rejects(() => memory.remember('x'), (e) => {
		assert.ok(e instanceof ThreeWsError);
		assert.ok(e instanceof MemoryError);
		assert.equal(e.code, 'unauthorized');
		assert.equal(e.status, 401);
		return true;
	});
});

test('a 402 surfaces as PaymentRequiredError carrying the x402 challenge', async () => {
	const accepts = [{ scheme: 'exact', asset: 'USDC', network: 'eip155:8453', maxAmountRequired: '150000' }];
	const { fetch } = stubFetch([{ status: 402, body: { error: 'payment_required', message: 'pay', accepts } }]);
	const memory = createAgentMemory({ agentId: AGENT, fetch });
	await assert.rejects(() => memory.recall('q'), (e) => {
		assert.ok(e instanceof PaymentRequiredError);
		assert.deepEqual(e.accepts, accepts);
		return true;
	});
});

// ── Temporal validity and provenance ────────────────────────────────────────

import { asOf, supersede, isCurrent, isValidAt, currentFirst } from '../src/index.js';

const T = (iso) => Date.parse(iso);

test('supersede() closes the prior interval at the new validFrom and links the versions', () => {
	const paris = { id: 'a', content: 'Alice lives in Paris', validFrom: T('2025-01-01'), validTo: null };
	const next = supersede([paris], { id: 'b', content: 'Alice lives in Berlin', validFrom: '2026-03-01', sourceRef: 'message:4812', supersedes: ['a'] });

	assert.equal(next[0].validTo, T('2026-03-01'));
	assert.equal(next[0].supersededBy, 'b');
	assert.equal(next[1].validTo, null);
	assert.equal(next[1].sourceRef, 'message:4812');
	assert.equal(paris.validTo, null, 'input is not mutated');
});

test('supersede() never closes an interval before it began, and refuses a closed or unknown fact', () => {
	const late = { id: 'a', content: 'x', validFrom: T('2026-06-01'), validTo: null };
	const [closed] = supersede([late], { id: 'b', content: 'y', validFrom: '2026-01-01', supersedes: ['a'] });
	assert.equal(closed.validTo, T('2026-06-01'));
	assert.throws(() => supersede([closed], { id: 'c', content: 'z', supersedes: ['a'] }), /already superseded/);
	assert.throws(() => supersede([late], { id: 'c', content: 'z', supersedes: ['nope'] }), /unknown fact/);
});

test('asOf() returns the version that was true at the given moment', () => {
	const facts = supersede(
		[{ id: 'a', content: 'Paris', validFrom: T('2025-01-01'), validTo: null }],
		{ id: 'b', content: 'Berlin', validFrom: '2026-03-01', supersedes: ['a'] },
	);
	assert.deepEqual(asOf(facts, '2025-07-01').map((f) => f.content), ['Paris']);
	assert.deepEqual(asOf(facts, '2026-03-01').map((f) => f.content), ['Berlin']);
	assert.deepEqual(asOf(facts, '2024-01-01'), []);
	assert.equal(isValidAt(facts[0], T('2026-03-01')), false, 'validTo is exclusive');
	assert.equal(isCurrent(facts[1]), true);
	assert.deepEqual(currentFirst(facts).map((f) => f.content), ['Berlin', 'Paris']);
});

test('remember() sends validFrom, sourceRef and supersedes; the stored provenance round-trips', async () => {
	const { fetch, calls } = stubFetch([
		{ status: 201, body: { entry: storedMemory({ id: 'm2', content: 'Alice lives in Berlin', validFrom: T('2026-03-01'), validTo: null, sourceRef: 'message:4812', supersededBy: undefined }) } },
	]);
	const memory = new AgentMemory({ agentId: AGENT, token: 'tok', fetch });

	const mem = await memory.remember('Alice lives in Berlin', { validFrom: '2026-03-01T00:00:00Z', sourceRef: 'message:4812', supersedes: 'm1' });

	const body = JSON.parse(calls[0].init.body);
	assert.equal(body.entry.validFrom, '2026-03-01T00:00:00Z');
	assert.equal(body.entry.sourceRef, 'message:4812');
	assert.deepEqual(body.entry.supersedes, ['m1']);
	assert.equal(mem.validFrom, T('2026-03-01'));
	assert.equal(mem.sourceRef, 'message:4812');
	assert.equal(mem.validTo, null);
});

test('remember() rejects a validFrom that is not a time before any request', async () => {
	const { fetch, calls } = stubFetch([]);
	const memory = new AgentMemory({ agentId: AGENT, token: 'tok', fetch });
	await assert.rejects(() => memory.remember('x', { validFrom: 'last tuesday' }), (e) => e instanceof ThreeWsError && e.code === 'invalid_input');
	assert.equal(calls.length, 0);
});

test('recall() forwards asOf and includeHistory', async () => {
	const { fetch, calls } = stubFetch([{ body: { results: [] } }]);
	const memory = new AgentMemory({ agentId: AGENT, token: 'tok', fetch });
	await memory.recall('where does Alice live', { asOf: '2025-07-01T00:00:00Z', includeHistory: true });
	const body = JSON.parse(calls[0].init.body);
	assert.equal(body.asOf, '2025-07-01T00:00:00Z');
	assert.equal(body.includeHistory, true);
});

test('list() filters by asOf and current locally', async () => {
	const rows = [
		storedMemory({ id: 'a', validFrom: T('2025-01-01'), validTo: T('2026-03-01') }),
		storedMemory({ id: 'b', validFrom: T('2026-03-01'), validTo: null }),
	];
	const make = () => new AgentMemory({ agentId: AGENT, token: 'tok', fetch: stubFetch([{ body: { entries: rows } }]).fetch });
	assert.deepEqual((await make().list({ asOf: '2025-07-01' })).map((m) => m.id), ['a']);
	assert.deepEqual((await make().list({ current: true })).map((m) => m.id), ['b']);
	assert.deepEqual((await make().list()).map((m) => m.id), ['b', 'a']);
});
