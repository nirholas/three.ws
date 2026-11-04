// get_learning_status on /api/mcp-agent: the owner's read of the learning loop
// (memory switch, memory counts, user-model size, learned skills awaiting
// review). Real migrations in PGlite; only the rate limiter, the notification
// write and the drafting model are swapped out.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLearningDb, resetLearningDb, seedAccount } from './helpers/learning-db.js';

const state = vi.hoisted(() => ({ pg: null }));
vi.mock('../api/_lib/db.js', async () => {
	const { sqlOver: make } = await import('./helpers/learning-db.js');
	return { sql: make(() => state.pg), isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));
const rate = vi.hoisted(() => ({ ok: true }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcpAgent: async () => (rate.ok ? { success: true } : { success: false, reset: Date.now() + 30_000 }) },
}));

const { learningToolDefs } = await import('../api/_mcpagent/learning-tools.js');
const sd = await import('../api/_lib/agent-learning/skill-drafts.js');
const { updateMemorySettings } = await import('../api/_lib/agent-learning/settings.js');
const um = await import('../api/_lib/agent-learning/user-model.js');
const { TOOL_CATALOG } = await import('../api/_mcpagent/catalog.js');
const { POLICY } = await import('../packages/mcp-policy/src/table.js');

const tool = learningToolDefs.find((t) => t.name === 'get_learning_status');
const call = (auth) => tool.handler({}, auth);

const DRAFT = {
	name: 'Check token holders',
	description: 'When asked who holds a token and how concentrated it is.',
	tags: ['tokens'],
	content: ['## When to use', 'The owner asks who holds a token.', '## Steps', '1. Call get_token_holders.', '## Checks', 'Confirm the mint.', '## Output', 'Top holders.'].join('\n'),
};
const complete = vi.fn(async () => ({ text: JSON.stringify(DRAFT), model: 'test-model' }));
const calls = Array.from({ length: 5 }, (_, i) => ({ tool: ['get_token_holders', 'get_token_supply'][i % 2], args: {}, result: { ok: true } }));
const draft = (acct, runRef) =>
	sd.draftSkillFromRun({ agentId: acct.agentId, userId: acct.userId, runRef, goal: 'who holds the token', toolCalls: calls, finalAnswer: 'Top holder owns 12%.', complete });

const memory = (acct, kind, content) =>
	state.pg.query(`insert into agent_memories (agent_id, user_id, type, kind, content) values ($1, $2, 'user', $3, $4)`, [acct.agentId, acct.userId, kind, content]);

let a;
let b;
beforeEach(async () => {
	state.pg ||= await createLearningDb();
	await resetLearningDb(state.pg);
	a = await seedAccount(state.pg, 'alice');
	b = await seedAccount(state.pg, 'bob');
	rate.ok = true;
	complete.mockClear();
});

describe('get_learning_status', () => {
	it('is registered on the agent MCP server as a read in the agents group', () => {
		expect(TOOL_CATALOG.map((t) => t.name)).toContain('get_learning_status');
		expect(POLICY['threews-agent'].get_learning_status).toEqual({ group: 'agents', tier: 'read' });
		expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
	});

	it('refuses an anonymous caller and a credential without memory scope', async () => {
		expect(await call({ userId: null })).toMatchObject({ isError: true, structuredContent: { reason: 'auth_required' } });
		expect(await call({ userId: a.userId, scope: 'wallet:read' })).toMatchObject({
			isError: true,
			structuredContent: { reason: 'insufficient_scope', required: 'memory:read' },
		});
	});

	it('throws the JSON-RPC rate-limit error when the caller is over budget', async () => {
		rate.ok = false;
		await expect(call({ userId: a.userId, scope: 'memory:read' })).rejects.toMatchObject({ code: -32000, data: { retry_after: expect.any(Number) } });
	});

	it('reports the defaults for an account that never touched its settings', async () => {
		const out = await call({ userId: a.userId, scope: 'memory:read' });
		expect(out.isError).toBeUndefined();
		expect(out.structuredContent).toMatchObject({
			ok: true,
			settings: { enabled: true, skill_drafts_enabled: true, nudge_every_turns: 6, updated_at: null },
			memories: { fact: 0, preference: 0, procedure: 0, total: 0 },
			user_model: { entries: 0, max_entries: um.MAX_ENTRIES_PER_ACCOUNT },
			learned_skills: { awaiting_review: 0, enabled: 0, total: 0 },
			settings_url: 'https://three.ws/settings/memory',
		});
		expect(out.content[0].text).toContain('Memory is on.');
	});

	it('counts memories, user-model lines and learned skills, drafts awaiting review first', async () => {
		await memory(a, 'fact', 'works in Lisbon');
		await memory(a, 'preference', 'prefers short answers');
		await memory(a, 'preference', 'writes in British English');
		await um.addUserModelEntry(a.userId, { section: 'goals', content: 'Launch in March' });
		const first = await draft(a, 'run-1');
		await draft(a, 'run-2');
		await sd.reviewLearnedSkill({ agentId: a.agentId, userId: a.userId, skillId: first.skill.id, enable: true });

		const out = await call({ userId: a.userId, scope: 'memory:write' });
		expect(out.structuredContent.memories).toEqual({ fact: 1, preference: 2, procedure: 0, total: 3 });
		expect(out.structuredContent.user_model.entries).toBe(1);
		expect(out.structuredContent.learned_skills).toEqual({ awaiting_review: 1, enabled: 1, total: 2 });
		expect(out.content[0].text).toContain('1 learned skill waits for your review');
	});

	it('says plainly when memory is switched off', async () => {
		await updateMemorySettings(a.userId, { enabled: false });
		const out = await call({ userId: a.userId, scope: 'memory:read' });
		expect(out.structuredContent.settings.enabled).toBe(false);
		expect(out.content[0].text).toContain('Memory is off');
		expect(out.content[0].text).toContain('Skill drafting from experience is off.');
	});

	it("never counts another account's memories, user model or skills", async () => {
		await memory(b, 'fact', 'bob secret');
		await um.addUserModelEntry(b.userId, { section: 'goals', content: 'Bob goal' });
		await draft(b, 'run-b');
		const out = await call({ userId: a.userId, scope: 'memory:read' });
		expect(out.structuredContent.memories.total).toBe(0);
		expect(out.structuredContent.user_model.entries).toBe(0);
		expect(out.structuredContent.learned_skills.total).toBe(0);
	});

	it('drops skills on a deleted agent from the tally', async () => {
		await draft(a, 'run-1');
		await state.pg.query('update agent_identities set deleted_at = now() where id = $1', [a.agentId]);
		const out = await call({ userId: a.userId, scope: 'memory:read' });
		expect(out.structuredContent.learned_skills.total).toBe(0);
	});
});
