// SCIM 2.0 team provisioning (api/scim/v2.js over api/_lib/team-enterprise.js
// and api/_lib/scim.js), driven through the real HTTP handler on an in-process
// Postgres (PGlite) built from the teams and enterprise migrations, so the
// constraints under test are the ones production enforces.
//
// Covered: discovery documents, bearer scoping, create (and uniqueness), every
// filter Entra sends, each PATCH shape Entra emits (no-path object, path
// replace, active as a string, value-filtered emails, Remove, Groups member
// add/remove), deactivation revoking the member's tenant sessions and team
// access, DELETE, token rotation killing the old token, and the tenant join
// rules a claimed tenant applies on Microsoft sign-in.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

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
vi.mock('../api/_lib/r2.js', () => ({ publicUrlOrNull: () => null, thumbnailUrl: () => null }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.JWT_SECRET ||= 'scim-test-secret-scim-test-secret-scim-test';

const PRE_DDL = `
	create table users (
		id uuid primary key default gen_random_uuid(), email text unique, email_verified boolean not null default false,
		display_name text, password_hash text, deleted_at timestamptz
	);
	create table avatars (id uuid primary key default gen_random_uuid(), storage_key text, thumbnail_key text, deleted_at timestamptz);
	create table agent_identities (
		id uuid primary key default gen_random_uuid(), user_id uuid, name text, description text,
		avatar_id uuid, meta jsonb default '{}'::jsonb, deleted_at timestamptz
	);
	create table sessions (
		id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
		created_at timestamptz not null default now(), revoked_at timestamptz
	);
	create table user_identities (
		id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
		provider text not null, subject text not null, email text, email_verified boolean not null default false,
		display_name text, avatar_url text, linked_at timestamptz not null default now(), last_used_at timestamptz
	);
	create table audit_log (
		id bigserial primary key, user_id uuid, action text, resource_id text, meta jsonb, ip text, user_agent text,
		created_at timestamptz not null default now()
	);
`;

const OWNER = '11111111-1111-4111-8111-111111111111';
const ALICE = '22222222-2222-4222-8222-222222222222';
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const OTHER_TENANT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

let ent;
let runtime;
let scimHandler;
let teamsHandler;
let teamId;
let token;

beforeAll(async () => {
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	await holder.db.exec(PRE_DDL);
	await holder.db.exec(readFileSync(new URL('../api/_lib/migrations/20261010120000_teams.sql', import.meta.url), 'utf8'));
	await holder.db.exec(readFileSync(new URL('../api/_lib/migrations/20261111160232_enterprise_sso_scim.sql', import.meta.url), 'utf8'));
	ent = await import('../api/_lib/team-enterprise.js');
	runtime = await import('../api/_lib/teams/runtime.js');
	scimHandler = (await import('../api/scim/v2.js')).default;
	teamsHandler = (await import('../api/teams/[id].js')).default;
});

beforeEach(async () => {
	await holder.db.exec(`
		delete from team_enterprise_events; delete from team_scim_group_members; delete from team_scim_groups;
		delete from team_scim_tokens; delete from team_people; delete from team_tenant_claims;
		delete from team_findings; delete from team_members; delete from teams;
		delete from sessions; delete from user_identities; delete from users;
	`);
	await holder.db.query(`insert into users (id, email, email_verified) values ($1, 'owner@example.org', true), ($2, 'alice@contoso.example', true)`, [OWNER, ALICE]);
	const [row] = await holder.db.query(
		`insert into teams (owner_user_id, name, network, status, is_public) values ($1, 'Desk', 'devnet', 'active', false) returning id`,
		[OWNER],
	);
	teamId = row.id;
	await ent.claimTenant({ teamId, userId: OWNER, tenantId: TENANT, tenantName: 'contoso.example', verifiedBy: 'admin@contoso.example', verifiedRole: 'Global Administrator' });
	token = (await ent.issueScimToken({ teamId, userId: OWNER })).token;
	holder.auth = null;
});

// ── HTTP harness ─────────────────────────────────────────────────────────────

function invoke(handler, { method = 'GET', url, body, headers = {}, query = {} }) {
	return new Promise((resolve, reject) => {
		const out = { status: 200, headers: {}, body: '' };
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
			getHeader(k) { return out.headers[k.toLowerCase()]; },
			removeHeader(k) { delete out.headers[k.toLowerCase()]; },
			writeHead(s, h) { this.statusCode = s; for (const [k, v] of Object.entries(h || {})) out.headers[k.toLowerCase()] = v; return this; },
			write(chunk) { out.body += chunk; },
			end(chunk) {
				if (chunk) out.body += chunk;
				out.status = this.statusCode;
				try { out.json = out.body ? JSON.parse(out.body) : null; } catch { out.json = null; }
				resolve(out);
			},
		};
		const req = {
			method,
			url,
			query,
			headers: { host: 'localhost', 'content-type': 'application/scim+json', ...headers },
			body,
		};
		Promise.resolve(handler(req, res)).catch(reject);
	});
}

const scim = (method, path, body, bearer = token) => invoke(scimHandler, {
	method,
	url: `/scim/v2${path}`,
	body,
	headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
});

const newUser = (userName, over = {}) => ({
	schemas: [SCHEMA_USER, ENTERPRISE],
	userName,
	externalId: `ext-${userName}`,
	active: true,
	displayName: userName.split('@')[0],
	name: { givenName: 'Given', familyName: 'Family' },
	emails: [{ primary: true, type: 'work', value: userName }],
	[ENTERPRISE]: { department: 'Research' },
	...over,
});

const patch = (Operations) => ({ schemas: [SCHEMA_PATCH], Operations });

async function aliceSession(tenantId = TENANT) {
	const [row] = await holder.db.query(`insert into sessions (user_id, entra_tenant_id) values ($1, $2) returning id`, [ALICE, tenantId]);
	return row.id;
}

async function linkAlice() {
	await holder.db.query(
		`insert into user_identities (user_id, provider, subject, email, email_verified) values ($1, 'microsoft', $2, 'alice@contoso.example', false)`,
		[ALICE, `${TENANT}:00000000-0000-4000-8000-0000000000a1`],
	);
}

// ── discovery ────────────────────────────────────────────────────────────────

describe('discovery', () => {
	it('serves ServiceProviderConfig, ResourceTypes and Schemas without a token', async () => {
		const spc = await scim('GET', '/ServiceProviderConfig', undefined, null);
		expect(spc.status).toBe(200);
		expect(spc.headers['content-type']).toMatch(/^application\/scim\+json/);
		expect(spc.json.patch.supported).toBe(true);
		expect(spc.json.filter.supported).toBe(true);
		expect(spc.json.authenticationSchemes[0].type).toBe('oauthbearertoken');

		const rt = await scim('GET', '/ResourceTypes', undefined, null);
		expect(rt.json.Resources.map((r) => r.id).sort()).toEqual(['Group', 'User']);
		expect((await scim('GET', '/ResourceTypes/User', undefined, null)).json.endpoint).toBe('/Users');

		const sc = await scim('GET', '/Schemas', undefined, null);
		expect(sc.json.Resources.map((s) => s.id)).toEqual(expect.arrayContaining([SCHEMA_USER, SCHEMA_GROUP]));
		expect((await scim('GET', `/Schemas/${SCHEMA_USER}`, undefined, null)).json.id).toBe(SCHEMA_USER);
		expect((await scim('GET', '/Schemas/urn:nope', undefined, null)).status).toBe(404);
	});

	it('refuses writes to discovery endpoints', async () => {
		expect((await scim('POST', '/ServiceProviderConfig', {}, null)).status).toBe(405);
	});
});

// ── auth ─────────────────────────────────────────────────────────────────────

describe('bearer token', () => {
	it('requires the team token on Users and Groups', async () => {
		const none = await scim('GET', '/Users', undefined, null);
		expect(none.status).toBe(401);
		expect(none.headers['www-authenticate']).toMatch(/^Bearer/);
		expect(none.json.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
		expect((await scim('GET', '/Users', undefined, 'tws_scim_wrong')).status).toBe(401);
		expect((await scim('GET', '/Groups', undefined, 'not-a-scim-token')).status).toBe(401);
	});

	it('rotation kills the old token at once and the new one works', async () => {
		const old = token;
		const rotated = await ent.issueScimToken({ teamId, userId: OWNER });
		expect(rotated.token).not.toBe(old);
		expect(rotated.rotated_at).toBeTruthy();
		expect((await scim('GET', '/Users', undefined, old)).status).toBe(401);
		expect((await scim('GET', '/Users', undefined, rotated.token)).status).toBe(200);
		const view = await ent.enterpriseView(teamId);
		expect(view.events.map((e) => e.action)).toContain('scim_token_rotated');
		expect(view.scim.token_prefix).toBe(rotated.prefix);
	});

	it('revoking and unclaiming end the token', async () => {
		await ent.revokeScimToken({ teamId, userId: OWNER });
		expect((await scim('GET', '/Users')).status).toBe(401);
		const again = (await ent.issueScimToken({ teamId, userId: OWNER })).token;
		await ent.unclaimTenant({ teamId, userId: OWNER });
		expect((await scim('GET', '/Users', undefined, again)).status).toBe(401);
	});

	it('a token only sees its own team', async () => {
		const [other] = await holder.db.query(`insert into teams (owner_user_id, name, network, status) values ($1, 'Other', 'devnet', 'active') returning id`, [ALICE]);
		await ent.claimTenant({ teamId: other.id, userId: ALICE, tenantId: OTHER_TENANT });
		const otherToken = (await ent.issueScimToken({ teamId: other.id, userId: ALICE })).token;
		const created = await scim('POST', '/Users', newUser('bob@contoso.example'));
		expect((await scim('GET', `/Users/${created.json.id}`, undefined, otherToken)).status).toBe(404);
		expect((await scim('GET', '/Users', undefined, otherToken)).json.totalResults).toBe(0);
	});
});

// ── Users ────────────────────────────────────────────────────────────────────

describe('Users', () => {
	it('creates a user, answers 201 with Location, and refuses a duplicate userName', async () => {
		const res = await scim('POST', '/Users', newUser('bob@contoso.example'));
		expect(res.status).toBe(201);
		expect(res.headers.location).toMatch(new RegExp(`/scim/v2/Users/${res.json.id}$`));
		expect(res.json).toMatchObject({
			schemas: expect.arrayContaining([SCHEMA_USER]),
			userName: 'bob@contoso.example',
			externalId: 'ext-bob@contoso.example',
			active: true,
			name: { givenName: 'Given', familyName: 'Family' },
			meta: { resourceType: 'User' },
		});
		expect(res.json.emails[0]).toMatchObject({ value: 'bob@contoso.example', primary: true });

		const dup = await scim('POST', '/Users', newUser('BOB@contoso.example'));
		expect(dup.status).toBe(409);
		expect(dup.json.scimType).toBe('uniqueness');
		expect((await scim('POST', '/Users', { schemas: [SCHEMA_USER] })).status).toBe(400);
	});

	it('accepts application/json too and refuses other media types', async () => {
		const res = await invoke(scimHandler, {
			method: 'POST', url: '/scim/v2/Users', body: newUser('json@contoso.example'),
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		});
		expect(res.status).toBe(201);
		const bad = await invoke(scimHandler, {
			method: 'POST', url: '/scim/v2/Users', body: 'x',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
		});
		expect(bad.status).toBe(415);
	});

	it('filters the way Entra queries: userName, externalId, emails, displayName and paging', async () => {
		await scim('POST', '/Users', newUser('bob@contoso.example'));
		await scim('POST', '/Users', newUser('carol@contoso.example'));
		const q = async (f) => (await scim('GET', `/Users?filter=${encodeURIComponent(f)}`)).json;

		expect((await q('userName eq "BOB@contoso.example"')).Resources.map((r) => r.userName)).toEqual(['bob@contoso.example']);
		expect((await q('externalId eq "ext-carol@contoso.example"')).totalResults).toBe(1);
		expect((await q('emails[type eq "work"].value eq "carol@contoso.example"')).totalResults).toBe(1);
		expect((await q('displayName eq "bob"')).totalResults).toBe(1);
		expect((await q('userName eq "nobody@contoso.example"'))).toMatchObject({ totalResults: 0, Resources: [] });
		expect((await q('userName eq "bob@contoso.example" and active eq true')).totalResults).toBe(1);

		const all = (await scim('GET', '/Users?startIndex=2&count=1')).json;
		expect(all).toMatchObject({ totalResults: 2, startIndex: 2, itemsPerPage: 1 });
		expect((await scim('GET', '/Users?count=0')).json).toMatchObject({ totalResults: 2, Resources: [] });

		const bad = await scim('GET', `/Users?filter=${encodeURIComponent('userName co "bob"')}`);
		expect(bad.status).toBe(400);
		expect(bad.json.scimType).toBe('invalidFilter');
	});

	it('applies the no-path PATCH Entra sends (dotted keys, string booleans)', async () => {
		const { json: u } = await scim('POST', '/Users', newUser('bob@contoso.example'));
		const res = await scim('PATCH', `/Users/${u.id}`, patch([
			{ op: 'Replace', value: { displayName: 'Robert', 'name.givenName': 'Robert', 'name.familyName': 'Tables', externalId: 'ext-9' } },
		]));
		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({ displayName: 'Robert', externalId: 'ext-9', name: { givenName: 'Robert', familyName: 'Tables' } });
	});

	it('applies path replace, value-filtered emails, the enterprise extension and Remove', async () => {
		const { json: u } = await scim('POST', '/Users', newUser('bob@contoso.example'));
		const res = await scim('PATCH', `/Users/${u.id}`, patch([
			{ op: 'replace', path: 'userName', value: 'rob@contoso.example' },
			{ op: 'replace', path: 'emails[type eq "work"].value', value: 'rob@contoso.example' },
			{ op: 'Add', path: `${ENTERPRISE}:department`, value: 'Ops' },
			{ op: 'Remove', path: 'name.familyName' },
		]));
		expect(res.status).toBe(200);
		expect(res.json.userName).toBe('rob@contoso.example');
		expect(res.json.emails[0].value).toBe('rob@contoso.example');
		expect(res.json.name.familyName).toBeUndefined();
		expect((await scim('PATCH', `/Users/${u.id}`, { Operations: [{ op: 'replace', path: 'active', value: false }] })).status).toBe(400);
	});

	it('PUT replaces the user', async () => {
		const { json: u } = await scim('POST', '/Users', newUser('bob@contoso.example'));
		const res = await scim('PUT', `/Users/${u.id}`, newUser('bob@contoso.example', { displayName: 'Bobby', externalId: 'ext-2' }));
		expect(res.json).toMatchObject({ displayName: 'Bobby', externalId: 'ext-2' });
	});
});

// ── deactivation ─────────────────────────────────────────────────────────────

describe('deactivation', () => {
	it('active "False" ends team access and revokes only the member\'s tenant sessions', async () => {
		await linkAlice();
		const { json: u } = await scim('POST', '/Users', newUser('alice@contoso.example'));
		const tenantSession = await aliceSession(TENANT);
		const otherSession = await aliceSession(null);

		expect(await ent.isActivePerson(teamId, ALICE)).toBe(true);
		const { isMember } = await runtime.loadTeamFor(teamId, ALICE);
		expect(isMember).toBe(true);

		const res = await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'Replace', path: 'active', value: 'False' }]));
		expect(res.status).toBe(200);
		expect(res.json.active).toBe(false);

		const rows = await holder.db.query('select id, revoked_at from sessions where user_id = $1', [ALICE]);
		expect(rows.find((r) => r.id === tenantSession).revoked_at).not.toBeNull();
		expect(rows.find((r) => r.id === otherSession).revoked_at).toBeNull();

		const err = await runtime.loadTeamFor(teamId, ALICE).then(() => null, (e) => e);
		expect(err?.status).toBe(404);
		holder.auth = { userId: ALICE, source: 'session' };
		const viaApi = await invoke(teamsHandler, { url: `/api/teams/${teamId}` });
		expect(viaApi.status).toBe(404);

		const events = (await ent.enterpriseView(teamId)).events.map((e) => e.action);
		expect(events).toContain('user_deactivated');
	});

	it('reactivation restores access', async () => {
		await linkAlice();
		const { json: u } = await scim('POST', '/Users', newUser('alice@contoso.example', { active: false }));
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(false);
		await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'replace', value: { active: true } }]));
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(true);
		holder.auth = { userId: ALICE, source: 'session' };
		expect((await invoke(teamsHandler, { url: `/api/teams/${teamId}` })).status).toBe(200);
	});

	it('DELETE hides the user, revokes sessions and keeps auto-join from re-admitting them', async () => {
		await linkAlice();
		await ent.setJoinMode({ teamId, userId: OWNER, mode: 'auto' });
		const { json: u } = await scim('POST', '/Users', newUser('alice@contoso.example'));
		const s = await aliceSession();
		const del = await scim('DELETE', `/Users/${u.id}`);
		expect(del.status).toBe(204);
		expect((await scim('GET', `/Users/${u.id}`)).status).toBe(404);
		expect((await holder.db.query('select revoked_at from sessions where id = $1', [s]))[0].revoked_at).not.toBeNull();
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(false);

		const again = await ent.onMicrosoftSignIn({ userId: ALICE, claims: { tenant_id: TENANT, username: 'alice@contoso.example', email: 'alice@contoso.example' } });
		expect(again.outcome).toBe('blocked');
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(false);

		const revived = await scim('POST', '/Users', newUser('alice@contoso.example'));
		expect(revived.status).toBe(201);
		expect(revived.json.id).toBe(u.id);
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(true);
	});

	it('the owner removing a person also revokes their tenant sessions', async () => {
		await linkAlice();
		const { json: u } = await scim('POST', '/Users', newUser('alice@contoso.example'));
		const s = await aliceSession();
		const out = await ent.setPersonStatus({ teamId, personId: u.id, userId: OWNER, status: 'deactivated' });
		expect(out.sessions_revoked).toBe(1);
		expect((await holder.db.query('select revoked_at from sessions where id = $1', [s]))[0].revoked_at).not.toBeNull();
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(false);
	});
});

// ── Groups ───────────────────────────────────────────────────────────────────

describe('Groups', () => {
	it('creates a group, filters by displayName and applies Entra member add and remove', async () => {
		const { json: a } = await scim('POST', '/Users', newUser('a@contoso.example'));
		const { json: b } = await scim('POST', '/Users', newUser('b@contoso.example'));
		const created = await scim('POST', '/Groups', { schemas: [SCHEMA_GROUP], displayName: 'Desk Ops', externalId: 'g-1', members: [] });
		expect(created.status).toBe(201);
		const gid = created.json.id;

		const found = (await scim('GET', `/Groups?filter=${encodeURIComponent('displayName eq "Desk Ops"')}&excludedAttributes=members`)).json;
		expect(found.totalResults).toBe(1);
		expect(found.Resources[0].members).toBeUndefined();

		await scim('PATCH', `/Groups/${gid}`, patch([{ op: 'Add', path: 'members', value: [{ value: a.id }, { value: b.id }] }]));
		expect((await scim('GET', `/Groups/${gid}`)).json.members.map((m) => m.value).sort()).toEqual([a.id, b.id].sort());

		await scim('PATCH', `/Groups/${gid}`, patch([{ op: 'Remove', path: `members[value eq "${a.id}"]` }]));
		expect((await scim('GET', `/Groups/${gid}`)).json.members.map((m) => m.value)).toEqual([b.id]);

		await scim('PATCH', `/Groups/${gid}`, patch([{ op: 'Remove', path: 'members', value: [{ value: b.id }] }]));
		expect((await scim('GET', `/Groups/${gid}`)).json.members).toEqual([]);

		await scim('PATCH', `/Groups/${gid}`, patch([{ op: 'Replace', path: 'displayName', value: 'Desk Ops 2' }]));
		expect((await scim('GET', `/Groups/${gid}`)).json.displayName).toBe('Desk Ops 2');

		const memberFilter = (await scim('GET', `/Groups?filter=${encodeURIComponent(`members eq "${a.id}"`)}`)).json;
		expect(memberFilter.totalResults).toBe(0);

		expect((await scim('DELETE', `/Groups/${gid}`)).status).toBe(204);
		expect((await scim('GET', `/Groups/${gid}`)).status).toBe(404);
	});
});

// ── tenant join ──────────────────────────────────────────────────────────────

describe('tenant join on Microsoft sign-in', () => {
	const claims = { tenant_id: TENANT, username: 'alice@contoso.example', email: 'alice@contoso.example', display_name: 'Alice' };

	it('offer mode offers the team; joining makes the person a member who can read the private team', async () => {
		await linkAlice();
		expect((await ent.onMicrosoftSignIn({ userId: ALICE, claims })).outcome).toBe('offer');
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(false);
		holder.auth = { userId: ALICE, source: 'session' };
		const offer = await invoke(teamsHandler, { url: `/api/teams/${teamId}/join` });
		expect(offer.json.data).toMatchObject({ team: { name: 'Desk' }, tenant_name: 'contoso.example', status: null });
		const joined = await invoke(teamsHandler, { method: 'POST', url: `/api/teams/${teamId}/join`, body: { decision: 'join' }, headers: { 'content-type': 'application/json' } });
		expect(joined.json.data.status).toBe('active');
		expect((await invoke(teamsHandler, { url: `/api/teams/${teamId}` })).status).toBe(200);
		expect((await invoke(teamsHandler, { url: `/api/teams/${teamId}/enterprise` })).status).toBe(404);
	});

	it('auto mode adds the person on sign-in', async () => {
		await ent.setJoinMode({ teamId, userId: OWNER, mode: 'auto' });
		expect((await ent.onMicrosoftSignIn({ userId: ALICE, claims })).outcome).toBe('joined');
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(true);
	});

	it('a sign-in from another tenant, or a personal account, is not offered anything', async () => {
		expect(await ent.onMicrosoftSignIn({ userId: ALICE, claims: { ...claims, tenant_id: OTHER_TENANT } })).toBeNull();
		expect(await ent.onMicrosoftSignIn({ userId: ALICE, claims: { ...claims, personal: true } })).toBeNull();
		holder.auth = { userId: ALICE, source: 'session' };
		expect((await invoke(teamsHandler, { url: `/api/teams/${teamId}/join` })).status).toBe(404);
	});

	it('a person SCIM provisioned before the first sign-in is bound by that sign-in', async () => {
		await scim('POST', '/Users', newUser('alice@contoso.example'));
		expect((await ent.onMicrosoftSignIn({ userId: ALICE, claims })).outcome).toBe('bound');
		expect(await ent.isActivePerson(teamId, ALICE)).toBe(true);
	});

	it('a second team cannot claim a tenant already claimed', async () => {
		const [other] = await holder.db.query(`insert into teams (owner_user_id, name, network, status) values ($1, 'Other', 'devnet', 'active') returning id`, [ALICE]);
		const err = await ent.claimTenant({ teamId: other.id, userId: ALICE, tenantId: TENANT }).then(() => null, (e) => e);
		expect(err?.code).toBe('tenant_claimed');
	});
});

// ── owner settings API ───────────────────────────────────────────────────────

describe('team enterprise settings API', () => {
	it('owner reads the state, switches join mode, rotates the token and unclaims', async () => {
		holder.auth = { userId: OWNER, source: 'session' };
		const view = await invoke(teamsHandler, { url: `/api/teams/${teamId}/enterprise` });
		expect(view.status).toBe(200);
		expect(view.json.data.claim).toMatchObject({ tenant_id: TENANT, join_mode: 'offer' });
		expect(view.json.data.scim.has_token).toBe(true);
		expect(view.json.data.scim_base_url).toMatch(/\/scim\/v2$/);

		const mode = await invoke(teamsHandler, { method: 'PATCH', url: `/api/teams/${teamId}/enterprise`, body: { join_mode: 'auto' }, headers: { 'content-type': 'application/json' } });
		expect(mode.json.data.claim.join_mode).toBe('auto');
		const badMode = await invoke(teamsHandler, { method: 'PATCH', url: `/api/teams/${teamId}/enterprise`, body: { join_mode: 'all' }, headers: { 'content-type': 'application/json' } });
		expect(badMode.status).toBe(400);

		const rotated = await invoke(teamsHandler, { method: 'POST', url: `/api/teams/${teamId}/enterprise/scim-token` });
		expect(rotated.status).toBe(201);
		expect(rotated.json.data.token).toMatch(/^tws_scim_/);
		expect((await scim('GET', '/Users')).status).toBe(401);
		expect((await scim('GET', '/Users', undefined, rotated.json.data.token)).status).toBe(200);

		const unclaimed = await invoke(teamsHandler, { method: 'DELETE', url: `/api/teams/${teamId}/enterprise` });
		expect(unclaimed.json.data.claim).toBeNull();
		expect(unclaimed.json.data.scim.has_token).toBe(false);
		const noClaimToken = await invoke(teamsHandler, { method: 'POST', url: `/api/teams/${teamId}/enterprise/scim-token` });
		expect(noClaimToken.status).toBe(409);
	});

	it('a non-owner cannot read or change the enterprise settings', async () => {
		holder.auth = { userId: ALICE, source: 'session' };
		expect((await invoke(teamsHandler, { url: `/api/teams/${teamId}/enterprise` })).status).toBe(404);
		expect((await invoke(teamsHandler, { method: 'POST', url: `/api/teams/${teamId}/enterprise/scim-token` })).status).toBe(404);
	});
});
