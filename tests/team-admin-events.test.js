// Admin activity for teams: GET /api/teams/:id/events (api/teams/[id].js over
// api/_lib/team-enterprise.js), driven through the real handler on PGlite built
// from the teams and enterprise migrations.
//
// Covered: owner-only access, cursor paging, CSV and JSON downloads, CSV
// escaping and formula-injection guard, and that owner actions that used to
// leave no trace (rename, visibility, member add and remove, archive) now log.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { buildScimSchema, resetScimTables, invoke } from './_helpers/scim-harness.js';

const holder = vi.hoisted(() => ({ db: null, auth: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/account-auth.js', () => ({ resolveAccount: async () => holder.auth }));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/r2.js', () => ({ storedObjectUrl: () => null, thumbnailUrl: () => null }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.JWT_SECRET ||= 'team-events-test-secret-team-events-test-secret';

const OWNER = '11111111-1111-4111-8111-111111111111';
const ALICE = '22222222-2222-4222-8222-222222222222';
const JSON_HEADERS = { 'content-type': 'application/json' };

let ent;
let teamsHandler;
let teamId;

beforeAll(async () => {
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	await buildScimSchema(holder.db);
	ent = await import('../api/_lib/team-enterprise.js');
	teamsHandler = (await import('../api/teams/[id].js')).default;
});

beforeEach(async () => {
	await resetScimTables(holder.db);
	await holder.db.exec('delete from agent_identities');
	await holder.db.query(`insert into users (id, email, email_verified) values ($1, 'owner@example.org', true), ($2, 'alice@example.org', true)`, [OWNER, ALICE]);
	const [row] = await holder.db.query(
		`insert into teams (owner_user_id, name, network, status, is_public) values ($1, 'Desk', 'devnet', 'active', false) returning id`,
		[OWNER],
	);
	teamId = row.id;
	holder.auth = { userId: OWNER, source: 'session' };
});

const get = (qs = '', id = teamId) => invoke(teamsHandler, { url: `/api/teams/${id}/events${qs}` });
const actions = async () => (await get('?limit=200')).json.data.map((e) => e.action);

describe('GET /api/teams/:id/events', () => {
	it('is owner-only', async () => {
		holder.auth = { userId: ALICE, source: 'session' };
		expect([403, 404]).toContain((await get()).status);
		expect([403, 404]).toContain((await get('?format=csv')).status);
		holder.auth = null;
		expect((await get()).status).toBe(401);
	});

	it('pages newest first with a stable cursor and rejects a bad one', async () => {
		for (let i = 0; i < 5; i++) await ent.logEvent(teamId, { actor: 'owner', actorUserId: OWNER, action: `step_${i}` });
		const first = await get('?limit=2');
		expect(first.status).toBe(200);
		expect(first.json.data.map((e) => e.action)).toEqual(['step_4', 'step_3']);
		expect(first.json.has_more).toBe(true);
		const second = await get(`?limit=2&cursor=${first.json.next_cursor}`);
		expect(second.json.data.map((e) => e.action)).toEqual(['step_2', 'step_1']);
		const last = await get(`?limit=2&cursor=${second.json.next_cursor}`);
		expect(last.json.data.map((e) => e.action)).toEqual(['step_0']);
		expect(last.json.next_cursor).toBeNull();
		expect((await get('?cursor=abc')).status).toBe(400);
		expect((await get('?format=xml')).status).toBe(400);
	});

	it('exports JSON and CSV as attachments with the whole history', async () => {
		for (let i = 0; i < 3; i++) await ent.logEvent(teamId, { actor: 'owner', actorUserId: OWNER, action: `step_${i}`, detail: { n: i } });
		const j = await get('?format=json');
		expect(j.headers['content-disposition']).toMatch(/^attachment; filename="team-desk-admin-activity-.*\.json"$/);
		expect(j.json.events).toHaveLength(3);
		const c = await get('?format=csv');
		expect(c.headers['content-disposition']).toMatch(/\.csv"$/);
		expect(c.headers['content-type']).toMatch(/^text\/csv/);
		const lines = c.body.trim().split('\n');
		expect(lines[0]).toBe('time,actor,action,person,detail,event_id');
		expect(lines).toHaveLength(4);
		expect(lines[1]).toContain('step_2');
	});

	it('escapes CSV cells and neutralizes formula injection', async () => {
		await ent.logEvent(teamId, { actor: 'owner', actorUserId: OWNER, action: 'team_updated', detail: { name: '=HYPERLINK("http://x","a"),b' } });
		await ent.logEvent(teamId, { actor: 'owner', actorUserId: OWNER, action: '=cmd|calc' });
		const csv = (await get('?format=csv')).body;
		expect(csv).toContain(`'=cmd|calc`);
		expect(csv).not.toMatch(/(^|,)=cmd/m);
		// detail is JSON text starting with "{", so quotes are doubled inside one quoted cell
		expect(csv).toContain('"{""name"":""=HYPERLINK(');
	});
});

describe('owner actions are logged', () => {
	it('records rename, visibility change, member add and remove, and archive', async () => {
		const patch = await invoke(teamsHandler, { method: 'PATCH', url: `/api/teams/${teamId}`, body: { name: 'Desk Two', is_public: true }, headers: JSON_HEADERS });
		expect(patch.status).toBe(200);
		const [agent] = await holder.db.query(`insert into agent_identities (user_id, name) values ($1, 'Helper') returning id`, [OWNER]);
		const add = await invoke(teamsHandler, { method: 'POST', url: `/api/teams/${teamId}/members`, body: { agent_id: agent.id }, headers: JSON_HEADERS });
		expect(add.status).toBe(201);
		const memberId = add.json.data.member_id;
		const narrow = await invoke(teamsHandler, { method: 'PATCH', url: `/api/teams/${teamId}/members/${memberId}`, body: { permissions: ['findings.read'] }, headers: JSON_HEADERS });
		expect(narrow.status).toBe(200);
		expect((await invoke(teamsHandler, { method: 'DELETE', url: `/api/teams/${teamId}/members/${memberId}` })).status).toBe(200);
		expect((await invoke(teamsHandler, { method: 'DELETE', url: `/api/teams/${teamId}` })).status).toBe(200);

		const got = await get('?limit=200');
		expect(got.json.data.map((e) => e.action)).toEqual([
			'team_archived', 'member_removed', 'member_permissions_changed', 'member_added', 'team_updated',
		]);
		const updated = got.json.data.find((e) => e.action === 'team_updated');
		expect(updated.actor).toBe('owner');
		expect(updated.detail).toMatchObject({ fields: ['name', 'visibility'], name: 'Desk Two', is_public: true });
	});

	it('a no-op edit logs nothing', async () => {
		await invoke(teamsHandler, { method: 'PATCH', url: `/api/teams/${teamId}`, body: { name: 'Desk' }, headers: JSON_HEADERS });
		expect(await actions()).toEqual([]);
	});
});
