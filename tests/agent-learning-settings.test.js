// The account-level memory switch and the memory store it governs, run against
// the real learning migration in PGlite. The off switch must stop every write
// and every injection, forgetting must reach the next prompt, and one account's
// memories must never surface for another.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLearningDb, resetLearningDb, seedAccount } from './helpers/learning-db.js';

const state = vi.hoisted(() => ({ pg: null }));
vi.mock('../api/_lib/db.js', async () => {
	const { sqlOver: make } = await import('./helpers/learning-db.js');
	return { sql: make(() => state.pg), isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));

const { getMemorySettings, updateMemorySettings, settingsPatchSchema, MEMORY_DEFAULTS } = await import('../api/_lib/agent-learning/settings.js');
const memory = await import('../api/_lib/agent-learning/memory.js');
const { addUserModelEntry, getUserModel } = await import('../api/_lib/agent-learning/user-model.js');

let a;
let b;

beforeEach(async () => {
	state.pg ||= await createLearningDb();
	await resetLearningDb(state.pg);
	a = await seedAccount(state.pg, 'alice');
	b = await seedAccount(state.pg, 'bob');
});

describe('settingsPatchSchema', () => {
	it('rejects unknown keys and empty patches', () => {
		expect(settingsPatchSchema.safeParse({ enabled: false, admin: true }).success).toBe(false);
		expect(settingsPatchSchema.safeParse({}).success).toBe(false);
	});

	it('keeps nudge_every_turns between 2 and 50', () => {
		expect(settingsPatchSchema.safeParse({ nudge_every_turns: 1 }).success).toBe(false);
		expect(settingsPatchSchema.safeParse({ nudge_every_turns: 51 }).success).toBe(false);
		expect(settingsPatchSchema.safeParse({ nudge_every_turns: 2.5 }).success).toBe(false);
		expect(settingsPatchSchema.safeParse({ nudge_every_turns: 2 }).success).toBe(true);
		expect(settingsPatchSchema.safeParse({ nudge_every_turns: 50 }).success).toBe(true);
	});
});

describe('settings storage', () => {
	it('reads the defaults without writing a row', async () => {
		const s = await getMemorySettings(a.userId);
		expect(s).toMatchObject(MEMORY_DEFAULTS);
		const { rows } = await state.pg.query('select count(*)::int as n from account_memory_settings');
		expect(rows[0].n).toBe(0);
	});

	it('merges a patch over the current values and persists it', async () => {
		await updateMemorySettings(a.userId, { nudge_every_turns: 10 });
		const next = await updateMemorySettings(a.userId, { enabled: false });
		expect(next).toMatchObject({ enabled: false, skill_drafts_enabled: true, nudge_every_turns: 10 });
		expect((await getMemorySettings(b.userId)).enabled).toBe(true);
	});
});

describe('the off switch', () => {
	beforeEach(async () => {
		await updateMemorySettings(a.userId, { enabled: false });
	});

	it('saveMemory writes nothing and says memory is off', async () => {
		await expect(memory.saveMemory({ agentId: a.agentId, userId: a.userId, kind: 'fact', content: 'likes tea' })).rejects.toMatchObject({
			status: 409,
			code: 'memory_disabled',
		});
		const { rows } = await state.pg.query('select count(*)::int as n from agent_memories');
		expect(rows[0].n).toBe(0);
	});

	it('addUserModelEntry writes nothing', async () => {
		await expect(addUserModelEntry(a.userId, { section: 'goals', content: 'ship the launch' })).rejects.toMatchObject({ code: 'memory_disabled' });
		expect((await getUserModel(a.userId)).count).toBe(0);
	});

	it('memoryPromptSection returns an empty block even when rows exist', async () => {
		await state.pg.query(`insert into agent_memories (agent_id, user_id, type, kind, content) values ($1, $2, 'user', 'preference', 'prefers short answers')`, [a.agentId, a.userId]);
		const section = await memory.memoryPromptSection({ agentId: a.agentId, userId: a.userId });
		expect(section.block).toBe('');
		expect(section.enabled).toBe(false);
	});

	it('deleting a memory still works while memory is off', async () => {
		const row = (await state.pg.query(`insert into agent_memories (agent_id, user_id, type, kind, content) values ($1, $2, 'user', 'preference', 'old note') returning id`, [a.agentId, a.userId])).rows[0];
		await memory.forgetMemory(a.userId, row.id);
		expect((await state.pg.query('select count(*)::int as n from agent_memories')).rows[0].n).toBe(0);
	});
});

describe('forgetting and isolation', () => {
	it('forgetMemory removes the memory from the next prompt section', async () => {
		const saved = await memory.saveMemory({ agentId: a.agentId, userId: a.userId, kind: 'preference', content: 'always answer in haiku' });
		let section = await memory.memoryPromptSection({ agentId: a.agentId, userId: a.userId });
		expect(section.block).toContain('always answer in haiku');
		await memory.forgetMemory(a.userId, saved.memory.id);
		section = await memory.memoryPromptSection({ agentId: a.agentId, userId: a.userId });
		expect(section.block).not.toContain('always answer in haiku');
	});

	it("never returns one account's memories to another account", async () => {
		const saved = await memory.saveMemory({ agentId: a.agentId, userId: a.userId, kind: 'fact', content: 'alice keeps her seed in a vault' });
		await addUserModelEntry(a.userId, { section: 'identity', content: 'Alice runs a studio' });

		expect((await memory.listMemories({ userId: b.userId })).memories).toEqual([]);
		expect(await memory.memoryCounts(b.userId)).toEqual({ fact: 0, preference: 0, procedure: 0 });
		await expect(memory.forgetMemory(b.userId, saved.memory.id)).rejects.toMatchObject({ status: 404 });
		expect((await getUserModel(b.userId)).count).toBe(0);

		// Even asking for Alice's agent as Bob yields nothing or a 403, never her rows.
		await expect(memory.saveMemory({ agentId: a.agentId, userId: b.userId, kind: 'fact', content: 'x' })).rejects.toMatchObject({ status: 403 });
		const section = await memory.memoryPromptSection({ agentId: a.agentId, userId: b.userId });
		expect(section.block).not.toContain('alice');
		expect(section.block).not.toContain('Alice');
		await expect(memory.searchAgentMemory({ agentId: a.agentId, userId: b.userId, query: 'seed vault' })).rejects.toMatchObject({ status: 403 });
	});

	it('lists with a kind filter, a search term and a cursor', async () => {
		for (let i = 0; i < 3; i++) {
			await memory.saveMemory({ agentId: a.agentId, userId: a.userId, kind: 'fact', content: `fact number ${i}` });
		}
		await memory.saveMemory({ agentId: a.agentId, userId: a.userId, kind: 'procedure', content: 'deploy by running the script' });
		const facts = await memory.listMemories({ userId: a.userId, kind: 'fact', limit: 2 });
		expect(facts.memories).toHaveLength(2);
		expect(facts.has_more).toBe(true);
		const rest = await memory.listMemories({ userId: a.userId, kind: 'fact', limit: 2, before: facts.next_before });
		expect(rest.memories.length).toBeGreaterThanOrEqual(1);
		const found = await memory.listMemories({ userId: a.userId, q: 'deploy' });
		expect(found.memories.map((m) => m.kind)).toEqual(['procedure']);
		expect(await memory.memoryCounts(a.userId)).toEqual({ fact: 3, preference: 0, procedure: 1 });
	});
});

