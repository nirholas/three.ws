// /api/memory/* owner routes, end to end through the real handler against the
// real learning schema (PGlite). Covers auth, scopes, validation, the
// unauthenticated 401, and the second-account 404 for every id-addressed route.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLearningDb, resetLearningDb, seedAccount } from '../helpers/learning-db.js';

const state = vi.hoisted(() => ({ pg: null, user: null }));
vi.mock('../../api/_lib/db.js', async () => {
	const { sqlOver: make } = await import('../helpers/learning-db.js');
	return { sql: make(() => state.pg), isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));
vi.mock('../../api/_lib/auth.js', () => ({
	getRequestUser: async () => state.user,
	requestUserHasScope: (user, scope) => user.source !== 'bearer' || user.scope.split(' ').includes(scope),
}));
vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../../api/_lib/env.js', () => ({ env: { APP_ORIGIN: 'http://localhost:3000', ISSUER: 'http://t', MCP_RESOURCE: 'http://t' } }));

const { default: handler } = await import('../../api/memory/[action].js');
const memory = await import('../../api/_lib/agent-learning/memory.js');
const um = await import('../../api/_lib/agent-learning/user-model.js');
const sd = await import('../../api/_lib/agent-learning/skill-drafts.js');

function mkReq(method, path, body) {
	return {
		method,
		url: path,
		headers: body === undefined ? {} : { 'content-type': 'application/json' },
		on(event, cb) {
			if (event === 'data' && body !== undefined) queueMicrotask(() => { cb(Buffer.from(JSON.stringify(body))); this._end?.(); });
			else if (event === 'end') this._end = cb;
		},
		destroy() {},
	};
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(b) { this.body = b; this.writableEnded = true; },
	};
}
// The router in vercel.json turns /api/memory/items/:id into ?action=items&id=:id.
const ROUTES = [
	[/^\/api\/memory\/settings$/, () => 'action=settings'],
	[/^\/api\/memory\/items\/([^/?]+)/, (m) => `action=items&id=${m[1]}`],
	[/^\/api\/memory\/items/, () => 'action=items'],
	[/^\/api\/memory\/user-model\/([^/?]+)/, (m) => `action=user-model&id=${m[1]}`],
	[/^\/api\/memory\/user-model/, () => 'action=user-model'],
	[/^\/api\/memory\/skills\/([^/?]+)\/(versions|review|rollback)/, (m) => `action=skills&id=${m[1]}&sub=${m[2]}`],
	[/^\/api\/memory\/skills\/([^/?]+)/, (m) => `action=skills&id=${m[1]}`],
	[/^\/api\/memory\/skills/, () => 'action=skills'],
];
async function call(method, path, body) {
	const [, rewrite] = ROUTES.find(([re]) => re.test(path));
	const m = ROUTES.find(([re]) => re.test(path))[0].exec(path);
	const [p, qs = ''] = path.split('?');
	const req = mkReq(method, `${p}?${rewrite(m)}${qs ? `&${qs}` : ''}`, body);
	const res = mkRes();
	await handler(req, res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

let a;
let b;
const asUser = (acct) => {
	state.user = { id: acct.userId, source: 'session' };
};

beforeEach(async () => {
	state.pg ||= await createLearningDb();
	await resetLearningDb(state.pg);
	a = await seedAccount(state.pg, 'alice');
	b = await seedAccount(state.pg, 'bob');
	asUser(a);
});

describe('auth', () => {
	it.each([
		['GET', '/api/memory/settings'],
		['PATCH', '/api/memory/settings', { enabled: false }],
		['GET', '/api/memory/items'],
		['DELETE', '/api/memory/items/11111111-1111-4111-8111-111111111111'],
		['GET', '/api/memory/user-model'],
		['POST', '/api/memory/user-model', { section: 'goals', content: 'x' }],
		['DELETE', '/api/memory/user-model?confirm=true'],
		['GET', '/api/memory/skills?agent_id=11111111-1111-4111-8111-111111111111'],
	])('%s %s answers 401 with no credential', async (method, path, body) => {
		state.user = null;
		expect((await call(method, path, body)).status).toBe(401);
	});

	it('refuses a bearer without memory:write on a write, allows memory:read on a read', async () => {
		state.user = { id: a.userId, source: 'bearer', scope: 'memory:read' };
		expect((await call('GET', '/api/memory/settings')).status).toBe(200);
		const denied = await call('PATCH', '/api/memory/settings', { enabled: false });
		expect(denied.status).toBe(403);
		expect(denied.body.error).toBe('insufficient_scope');
	});
});

describe('settings', () => {
	it('reads defaults, patches, and rejects unknown keys and out-of-range cadence', async () => {
		expect((await call('GET', '/api/memory/settings')).body.settings).toMatchObject({ enabled: true, nudge_every_turns: 6 });
		const ok = await call('PATCH', '/api/memory/settings', { enabled: false, nudge_every_turns: 12 });
		expect(ok.body.settings).toMatchObject({ enabled: false, nudge_every_turns: 12 });
		expect((await call('PATCH', '/api/memory/settings', { nudge_every_turns: 1 })).status).toBe(400);
		expect((await call('PATCH', '/api/memory/settings', { role: 'admin' })).status).toBe(400);
		asUser(b);
		expect((await call('GET', '/api/memory/settings')).body.settings.enabled).toBe(true);
	});
});

describe('items', () => {
	it('lists with counts, filters by kind and search, and forgets one memory', async () => {
		await memory.saveMemory({ agentId: a.agentId, userId: a.userId, kind: 'fact', content: 'the studio is in Lisbon' });
		const pref = await memory.saveMemory({ agentId: a.agentId, userId: a.userId, kind: 'preference', content: 'prefers metric units' });
		const all = await call('GET', '/api/memory/items');
		expect(all.body.memories).toHaveLength(2);
		expect(all.body.counts).toEqual({ fact: 1, preference: 1, procedure: 0 });
		expect((await call('GET', '/api/memory/items?kind=preference')).body.memories[0].content).toBe('prefers metric units');
		expect((await call('GET', '/api/memory/items?q=lisbon')).body.memories).toHaveLength(1);
		expect((await call('GET', '/api/memory/items?kind=bogus')).status).toBe(400);
		expect((await call('DELETE', `/api/memory/items/${pref.memory.id}`)).status).toBe(200);
		expect((await call('GET', '/api/memory/items')).body.memories).toHaveLength(1);
	});

	it("answers 404 for another account's memory and shows it nothing", async () => {
		const saved = await memory.saveMemory({ agentId: a.agentId, userId: a.userId, kind: 'fact', content: 'alice only' });
		asUser(b);
		expect((await call('DELETE', `/api/memory/items/${saved.memory.id}`)).status).toBe(404);
		expect((await call('GET', '/api/memory/items')).body.memories).toEqual([]);
		expect((await call('DELETE', '/api/memory/items/not-a-uuid')).status).toBe(400);
	});
});

describe('user model', () => {
	it('adds, edits, deletes a line and requires confirm to clear', async () => {
		const added = await call('POST', '/api/memory/user-model', { section: 'goals', content: 'Ship v1' });
		expect(added.status).toBe(201);
		const id = added.body.entry.id;
		const edited = await call('PATCH', `/api/memory/user-model/${id}`, { content: 'Ship v1 in June' });
		expect(edited.body.entry).toMatchObject({ content: 'Ship v1 in June', source: 'owner' });
		expect((await call('GET', '/api/memory/user-model')).body.count).toBe(1);

		expect((await call('DELETE', '/api/memory/user-model')).status).toBe(400);
		expect((await call('DELETE', '/api/memory/user-model?confirm=true')).body.cleared).toBe(1);
		expect((await call('DELETE', `/api/memory/user-model/${id}`)).status).toBe(404);
	});

	it('validates the body and keeps accounts apart', async () => {
		expect((await call('POST', '/api/memory/user-model', { section: 'secrets', content: 'x' })).status).toBe(400);
		expect((await call('POST', '/api/memory/user-model', { section: 'goals', content: '' })).status).toBe(400);
		expect((await call('POST', '/api/memory/user-model', { section: 'goals', content: 'x', extra: 1 })).status).toBe(400);
		const { entry } = await um.addUserModelEntry(a.userId, { section: 'goals', content: 'private' });
		asUser(b);
		expect((await call('PATCH', `/api/memory/user-model/${entry.id}`, { content: 'mine now' })).status).toBe(404);
		expect((await call('DELETE', `/api/memory/user-model/${entry.id}`)).status).toBe(404);
		expect((await call('GET', '/api/memory/user-model')).body.count).toBe(0);
	});

	it('still lets the owner delete a line while memory is off but refuses a new line', async () => {
		const { entry } = await um.addUserModelEntry(a.userId, { section: 'goals', content: 'old' });
		await call('PATCH', '/api/memory/settings', { enabled: false });
		expect((await call('POST', '/api/memory/user-model', { section: 'goals', content: 'new' })).status).toBe(409);
		expect((await call('DELETE', `/api/memory/user-model/${entry.id}`)).status).toBe(200);
	});
});

describe('learned skills', () => {
	const BODY = '## When to use\nWhen asked for a report.\n## Steps\n1. Call a tool.\n## Checks\nVerify.\n## Output\nA list.';
	async function seedSkill(acct) {
		const row = (
			await state.pg.query(
				`insert into agent_custom_skills (agent_id, user_id, slug, name, content, enabled, source, source_run_id)
				 values ($1, $2, 'report', 'Report', $3, false, 'experience', $4) returning id`,
				[acct.agentId, acct.userId, BODY, `run-${acct.userId}`],
			)
		).rows[0];
		return row.id;
	}

	it('lists drafts, enables one, edits it, and rolls the edit back', async () => {
		const skillId = await seedSkill(a);
		const list = await call('GET', `/api/memory/skills?agent_id=${a.agentId}`);
		expect(list.body.skills[0]).toMatchObject({ id: skillId, enabled: false, reviewed_at: null });

		const reviewed = await call('POST', `/api/memory/skills/${skillId}/review`, { agent_id: a.agentId, enable: true });
		expect(reviewed.body.skill).toMatchObject({ enabled: true });

		const edit = await call('PATCH', `/api/memory/skills/${skillId}`, { agent_id: a.agentId, content: `${BODY}\nAlso cite sources.` });
		expect(edit.status).toBe(200);
		expect(edit.body.skill.version).toBe('1.0.1');

		const versions = await call('GET', `/api/memory/skills/${skillId}/versions?agent_id=${a.agentId}`);
		expect(versions.body.versions.map((v) => v.author)).toEqual(['owner', 'experience']);

		const back = await call('POST', `/api/memory/skills/${skillId}/rollback`, { agent_id: a.agentId, version: 1 });
		expect(back.body.skill.content).toBe(BODY);
		expect(back.body.skill.version).toBe('1.0.2');
	});

	it("answers 404 for another account's agent and skill, and 400 for a malformed request", async () => {
		const skillId = await seedSkill(a);
		asUser(b);
		expect((await call('GET', `/api/memory/skills?agent_id=${a.agentId}`)).status).toBe(404);
		expect((await call('POST', `/api/memory/skills/${skillId}/review`, { agent_id: a.agentId, enable: true })).status).toBe(404);
		expect((await call('POST', `/api/memory/skills/${skillId}/rollback`, { agent_id: a.agentId, version: 1 })).status).toBe(404);
		expect((await call('GET', '/api/memory/skills')).status).toBe(400);
		expect((await call('POST', `/api/memory/skills/${skillId}/review`, { agent_id: 'nope', enable: true })).status).toBe(400);
	});

	it('refuses an owner edit that changes nothing', async () => {
		const skillId = await seedSkill(a);
		const out = await call('PATCH', `/api/memory/skills/${skillId}`, { agent_id: a.agentId, content: BODY });
		expect(out.status).toBe(409);
		void sd;
	});
});
