import { readFileSync } from 'node:fs';
// Temporal validity and provenance for agent memory: superseding a fact closes
// the old interval, an as-of query returns the version that was true then, and
// provenance round-trips. Real migrations in PGlite; only the sql tag is swapped.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLearningDb, resetLearningDb, seedAccount } from './helpers/learning-db.js';

const state = vi.hoisted(() => ({ pg: null }));
vi.mock('../api/_lib/db.js', async () => {
	const { sqlOver: make } = await import('./helpers/learning-db.js');
	return { sql: make(() => state.pg), isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));
vi.mock('../api/_lib/memory-store.js', async (orig) => ({
	...(await orig()),
	searchMemories: vi.fn(async () => ({ results: [] })),
}));

const memory = await import('../api/_lib/agent-learning/memory.js');
const temporal = await import('../api/_lib/agent-learning/temporal.js');
const { runLearningTool } = await import('../api/_lib/agent-learning/tools.js');

let acct;
beforeEach(async () => {
	state.pg ||= await createLearningDb();
	await resetLearningDb(state.pg);
	acct = await seedAccount(state.pg, 'alice');
});

const save = (content, extra = {}) =>
	memory.saveMemory({ agentId: acct.agentId, userId: acct.userId, kind: 'fact', content, ...extra });
const search = (query, extra = {}) =>
	memory.searchAgentMemory({ agentId: acct.agentId, userId: acct.userId, query, ...extra });

describe('temporal helpers', () => {
	it('treats valid_to as exclusive and valid_from as inclusive', () => {
		const row = { valid_from: '2026-01-01T00:00:00Z', valid_to: '2026-06-01T00:00:00Z' };
		expect(temporal.isValidAt(row, Date.parse('2026-01-01T00:00:00Z'))).toBe(true);
		expect(temporal.isValidAt(row, Date.parse('2026-05-31T23:59:59Z'))).toBe(true);
		expect(temporal.isValidAt(row, Date.parse('2026-06-01T00:00:00Z'))).toBe(false);
		expect(temporal.isValidAt(row, Date.parse('2025-12-31T00:00:00Z'))).toBe(false);
	});

	it('never closes an interval before it began', () => {
		const prior = { valid_from: '2026-03-01T00:00:00Z' };
		expect(temporal.closingInstant(prior, new Date('2026-01-01T00:00:00Z')).toISOString()).toBe('2026-03-01T00:00:00.000Z');
	});

	it('rejects an unparseable instant with a 400', () => {
		expect(() => temporal.parseInstant('last tuesday', 'as_of')).toThrowError(/as_of/);
	});
});

describe('superseding a fact', () => {
	it('closes the prior interval at the new fact valid_from and links the two', async () => {
		const paris = await save('Alice lives in Paris', { validFrom: '2025-01-01T00:00:00Z' });
		const berlin = await save('Alice lives in Berlin', { validFrom: '2026-03-01T00:00:00Z', supersedes: [paris.memory.id] });

		expect(berlin.superseded).toHaveLength(1);
		const [old] = (await state.pg.query('select valid_from, valid_to, superseded_by from agent_memories where id = $1', [paris.memory.id])).rows;
		expect(new Date(old.valid_to).toISOString()).toBe('2026-03-01T00:00:00.000Z');
		expect(old.superseded_by).toBe(berlin.memory.id);
		expect(berlin.memory.valid_to).toBeNull();
		expect(berlin.memory.current).toBe(true);
	});

	it('refuses to supersede a memory that is already closed', async () => {
		const a = await save('Alice drives a Fiat', { validFrom: '2024-01-01T00:00:00Z' });
		await save('Alice drives a Volvo', { validFrom: '2025-01-01T00:00:00Z', supersedes: [a.memory.id] });
		await expect(save('Alice drives a Saab', { supersedes: [a.memory.id] })).rejects.toMatchObject({ status: 409, code: 'already_superseded' });
	});

	it('refuses an unknown or foreign memory id and writes nothing', async () => {
		const other = await seedAccount(state.pg, 'bob');
		const theirs = await memory.saveMemory({ agentId: other.agentId, userId: other.userId, kind: 'fact', content: 'Bob likes tea' });
		await expect(save('Alice likes tea', { supersedes: [theirs.memory.id] })).rejects.toMatchObject({ status: 404 });
		const n = (await state.pg.query('select count(*)::int as n from agent_memories where agent_id = $1', [acct.agentId])).rows[0].n;
		expect(n).toBe(0);
	});

	it('does not let a repeated sentence reinforce a closed fact', async () => {
		const first = await save('Alice lives in Paris', { validFrom: '2025-01-01T00:00:00Z' });
		await save('Alice lives in Berlin', { validFrom: '2026-01-01T00:00:00Z', supersedes: [first.memory.id] });
		const back = await save('Alice lives in Paris', { validFrom: '2026-09-01T00:00:00Z' });
		expect(back.status).toBe('saved');
		expect(back.memory.id).not.toBe(first.memory.id);
	});
});

describe('as-of search', () => {
	let paris;
	let berlin;
	beforeEach(async () => {
		paris = (await save('Alice lives in Paris', { validFrom: '2025-01-01T00:00:00Z' })).memory;
		berlin = (await save('Alice lives in Berlin', { validFrom: '2026-03-01T00:00:00Z', supersedes: [paris.id] })).memory;
	});

	it('returns only the current fact by default', async () => {
		const out = await search('where does Alice live');
		expect(out.results.map((m) => m.id)).toEqual([berlin.id]);
		expect(out.as_of).toBeNull();
	});

	it('returns the version that was true at the requested moment', async () => {
		const out = await search('where does Alice live', { asOf: '2025-07-01T00:00:00Z' });
		expect(out.results.map((m) => m.id)).toEqual([paris.id]);
		expect(out.as_of).toBe('2025-07-01T00:00:00.000Z');
	});

	it('returns nothing from before the fact existed', async () => {
		const out = await search('where does Alice live', { asOf: '2024-01-01T00:00:00Z' });
		expect(out.results).toEqual([]);
	});

	it('lists history with the current version first when asked', async () => {
		const out = await search('where does Alice live', { includeHistory: true });
		expect(out.results.map((m) => m.id)).toEqual([berlin.id, paris.id]);
		expect(out.results[1].current).toBe(false);
	});

	it('rejects a malformed as_of', async () => {
		await expect(search('alice', { asOf: 'soon' })).rejects.toMatchObject({ status: 400 });
	});

	it('keeps the prompt section on current facts only', async () => {
		const { block } = await memory.memoryPromptSection({ agentId: acct.agentId, userId: acct.userId, query: 'Alice lives' });
		expect(block).toContain('Berlin');
		expect(block).not.toContain('Paris');
	});
});

describe('provenance', () => {
	it('round-trips source_ref and valid_from', async () => {
		const saved = await save('Alice prefers window seats', { sourceRef: 'message:4812', validFrom: '2026-02-02T10:00:00Z' });
		const [row] = (await state.pg.query('select source_ref, valid_from from agent_memories where id = $1', [saved.memory.id])).rows;
		expect(row.source_ref).toBe('message:4812');
		expect(new Date(row.valid_from).toISOString()).toBe('2026-02-02T10:00:00.000Z');
		const found = await search('window seats');
		expect(found.results[0]).toMatchObject({ source_ref: 'message:4812', current: true });
	});

	it('derives source_ref from the message id when none is given', async () => {
		const saved = await save('Alice has a dog named Pip', { sourceMessageId: 77 });
		expect(saved.memory.source_ref).toBe('message:77');
	});

	it('backfills valid_from from created_at in the migration', async () => {
		const sqlText = readFileSync(new URL('../api/_lib/migrations/20261105020000_agent_memory_temporal_facts.sql', import.meta.url), 'utf8');
		const backfill = sqlText.match(/UPDATE agent_memories SET valid_from = created_at WHERE valid_from IS NULL;/)?.[0];
		expect(backfill).toBeTruthy();
		await state.pg.query(`alter table agent_memories alter column valid_from drop not null`);
		await state.pg.query(
			`insert into agent_memories (agent_id, user_id, type, kind, content, created_at, valid_from) values ($1, $2, 'reference', 'fact', 'old row', '2025-05-05T00:00:00Z', null)`,
			[acct.agentId, acct.userId],
		);
		await state.pg.query(backfill);
		const [row] = (await state.pg.query(`select valid_from, valid_to from agent_memories where content = 'old row'`)).rows;
		expect(new Date(row.valid_from).toISOString()).toBe('2025-05-05T00:00:00.000Z');
		expect(row.valid_to).toBeNull();
		await state.pg.query(`alter table agent_memories alter column valid_from set not null`);
	});
});

describe('learning tools', () => {
	it('memory_save supersedes and memory_search answers as_of through the tool surface', async () => {
		const ctx = { agentId: acct.agentId, userId: acct.userId, source: 'tool' };
		const first = await runLearningTool('memory_save', { kind: 'fact', content: 'Alice works at Acme', valid_from: '2025-01-01T00:00:00Z' }, ctx);
		const second = await runLearningTool('memory_save', { kind: 'fact', content: 'Alice works at Globex', valid_from: '2026-01-01T00:00:00Z', supersedes: [first.memory.id] }, ctx);
		expect(second.superseded.map((m) => m.id)).toEqual([first.memory.id]);
		const past = await runLearningTool('memory_search', { query: 'where does Alice work', as_of: '2025-06-01T00:00:00Z' }, ctx);
		expect(past.memories.map((m) => m.content)).toEqual(['Alice works at Acme']);
		const now = await runLearningTool('memory_search', { query: 'where does Alice work' }, ctx);
		expect(now.memories.map((m) => m.content)).toEqual(['Alice works at Globex']);
	});
});
