// Microsoft Entra provisioning conformance for the three.ws SCIM 2.0 endpoint.
//
// The Entra app gallery accepts a provisioning listing only when the endpoint
// passes the checks Microsoft's SCIM validator runs and meets the gallery
// requirements in "Develop and plan provisioning for a SCIM endpoint". This
// suite reproduces those cases one by one against the real handler
// (api/scim/v2.js) on an in-process Postgres built from the production
// migrations, so a regression shows up here before an Entra admin sees it.
//
// Each `it` names the validator case it mirrors. Covered:
//   discovery    ServiceProviderConfig, ResourceTypes and Schemas agree, and
//                every schema a ResourceType names is served
//   users        list, Test Connection probe, create, get, filter on userName
//                (any case) and externalId, duplicate, PATCH replace / add /
//                remove, the no-path object with Entra casing and string
//                booleans, disable and re-enable, PUT, DELETE, get / patch /
//                delete after delete, 404s, paging
//   groups       create, get with and without members, filter on displayName
//                and externalId, the id-and-members membership probe, add
//                several members in one PATCH, remove by filter and by list,
//                rename, duplicate, DELETE
//   errors       RFC 7644 3.12 bodies with scimType for each failure Entra
//                expects
//   gallery      at least 25 requests per second per tenant

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { buildScimSchema, resetScimTables, invoke } from './_helpers/scim-harness.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, limits: new Proxy({}, { get: () => async () => ({ success: true }) }), clientIp: () => '127.0.0.1' };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.JWT_SECRET ||= 'scim-conformance-secret-scim-conformance-secret';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

let ent;
let handler;
let token;

beforeAll(async () => {
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	await buildScimSchema(holder.db);
	ent = await import('../api/_lib/team-enterprise.js');
	handler = (await import('../api/scim/v2.js')).default;
});

beforeEach(async () => {
	await resetScimTables(holder.db);
	await holder.db.query(`insert into users (id, email, email_verified) values ($1, 'owner@example.org', true)`, [OWNER]);
	const [row] = await holder.db.query(
		`insert into teams (owner_user_id, name, network, status, is_public) values ($1, 'Desk', 'devnet', 'active', false) returning id`,
		[OWNER],
	);
	await ent.claimTenant({ teamId: row.id, userId: OWNER, tenantId: TENANT, tenantName: 'contoso.example', verifiedBy: 'admin@contoso.example', verifiedRole: 'Global Administrator' });
	token = (await ent.issueScimToken({ teamId: row.id, userId: OWNER })).token;
});

const scim = (method, path, body, bearer = token) => invoke(handler, {
	method,
	url: `/scim/v2${path}`,
	body,
	headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
});

const q = (filter) => `filter=${encodeURIComponent(filter)}`;
const patch = (Operations) => ({ schemas: [SCHEMA_PATCH], Operations });

/** The user body Entra's default attribute mapping produces. */
const entraUser = (upn, over = {}) => ({
	schemas: [SCHEMA_USER, ENTERPRISE],
	externalId: upn.split('@')[0],
	userName: upn,
	active: true,
	displayName: 'Grace Hopper',
	title: 'Rear Admiral',
	preferredLanguage: 'en-US',
	emails: [{ primary: true, type: 'work', value: upn }],
	name: { formatted: 'Grace Hopper', familyName: 'Hopper', givenName: 'Grace' },
	addresses: [{ type: 'work', streetAddress: '1 Navy Way', locality: 'Arlington', country: 'US', primary: false }],
	phoneNumbers: [{ type: 'work', value: '+1 555 0100' }, { type: 'mobile', value: '+1 555 0101' }],
	roles: [],
	[ENTERPRISE]: { employeeNumber: '42', department: 'Research', manager: { value: 'mgr-1' } },
	...over,
});

async function created(upn, over) {
	const out = await scim('POST', '/Users', entraUser(upn, over));
	expect(out.status).toBe(201);
	return out.json;
}

function expectError(out, status, scimType) {
	expect(out.status).toBe(status);
	expect(out.headers['content-type']).toMatch(/^application\/scim\+json/);
	expect(out.json.schemas).toEqual([SCHEMA_ERROR]);
	expect(out.json.status).toBe(String(status));
	expect(typeof out.json.detail).toBe('string');
	if (scimType) expect(out.json.scimType).toBe(scimType);
}

// ── discovery ────────────────────────────────────────────────────────────────

describe('discovery (schema discovery is a gallery recommendation)', () => {
	it('every schema and schema extension a ResourceType names is served under /Schemas', async () => {
		const types = (await scim('GET', '/ResourceTypes', undefined, null)).json.Resources;
		const served = (await scim('GET', '/Schemas', undefined, null)).json.Resources.map((s) => s.id);
		for (const t of types) {
			expect(served).toContain(t.schema);
			for (const ext of t.schemaExtensions || []) expect(served).toContain(ext.schema);
		}
	});

	it('ServiceProviderConfig declares patch, filter and the bearer token scheme Entra uses', async () => {
		const spc = (await scim('GET', '/ServiceProviderConfig', undefined, null)).json;
		expect(spc.patch.supported).toBe(true);
		expect(spc.filter).toMatchObject({ supported: true });
		expect(spc.filter.maxResults).toBeGreaterThanOrEqual(100);
		expect(spc.authenticationSchemes.map((a) => a.type)).toContain('oauthbearertoken');
	});
});

// ── users ────────────────────────────────────────────────────────────────────

describe('Users', () => {
	it('Test Connection: a filter for a random userName answers an empty ListResponse, not 404', async () => {
		const out = await scim('GET', `/Users?${q('userName eq "a8c1b0f2-5b5e-4b0c-9d7e-1c1e0f4c2d11"')}`);
		expect(out.status).toBe(200);
		expect(out.json).toMatchObject({ schemas: [SCHEMA_LIST], totalResults: 0, Resources: [] });
	});

	it('Test Connection with a wrong token is 401 with a SCIM error body', async () => {
		expectError(await scim('GET', `/Users?${q('userName eq "x"')}`, undefined, 'tws_scim_wrong'), 401);
	});

	it('Create User: 201 with id, meta, Location, and the stored attributes echoed', async () => {
		const out = await scim('POST', '/Users', entraUser('grace@contoso.example'));
		expect(out.status).toBe(201);
		expect(out.headers.location).toBe(out.json.meta.location);
		expect(out.json).toMatchObject({
			schemas: [SCHEMA_USER],
			userName: 'grace@contoso.example',
			externalId: 'grace',
			active: true,
			displayName: 'Grace Hopper',
			name: { givenName: 'Grace', familyName: 'Hopper' },
			emails: [{ value: 'grace@contoso.example', type: 'work', primary: true }],
			meta: { resourceType: 'User' },
		});
		expect(out.json.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('Create User with active as the string "True"', async () => {
		expect((await created('str@contoso.example', { active: 'True' })).active).toBe(true);
	});

	it('Create duplicate User: 409 uniqueness, also when only the case differs', async () => {
		await created('grace@contoso.example');
		expectError(await scim('POST', '/Users', entraUser('grace@contoso.example')), 409, 'uniqueness');
		expectError(await scim('POST', '/Users', entraUser('GRACE@Contoso.Example')), 409, 'uniqueness');
	});

	it('Get User by id, and 404 for an unknown or malformed id', async () => {
		const u = await created('grace@contoso.example');
		const out = await scim('GET', `/Users/${u.id}`);
		expect(out.status).toBe(200);
		expect(out.json.id).toBe(u.id);
		expectError(await scim('GET', '/Users/7c0e4a3b-0000-4000-8000-000000000000'), 404);
		expectError(await scim('GET', '/Users/not-a-uuid'), 404);
	});

	it('Filter by userName, case-insensitively, and by externalId, case-exactly', async () => {
		const u = await created('grace@contoso.example');
		for (const f of ['userName eq "grace@contoso.example"', 'userName eq "GRACE@CONTOSO.EXAMPLE"', 'UserName eq "grace@contoso.example"']) {
			const out = await scim('GET', `/Users?${q(f)}`);
			expect(out.json.totalResults).toBe(1);
			expect(out.json.Resources[0].id).toBe(u.id);
		}
		expect((await scim('GET', `/Users?${q('externalId eq "grace"')}`)).json.totalResults).toBe(1);
		expect((await scim('GET', `/Users?${q('externalId eq "GRACE"')}`)).json.totalResults).toBe(0);
		expect((await scim('GET', `/Users?${q('emails[type eq "work"].value eq "grace@contoso.example"')}`)).json.totalResults).toBe(1);
		expect((await scim('GET', `/Users?${q(`${SCHEMA_USER}:userName eq "grace@contoso.example"`)}`)).json.totalResults).toBe(1);
	});

	it('Patch User, replace attributes by path (the validator\'s update case)', async () => {
		const u = await created('grace@contoso.example');
		const out = await scim('PATCH', `/Users/${u.id}`, patch([
			{ op: 'Replace', path: 'displayName', value: 'Amazing Grace' },
			{ op: 'Replace', path: 'name.givenName', value: 'Amazing' },
			{ op: 'Replace', path: 'name.familyName', value: 'Hopper-Murray' },
			{ op: 'Replace', path: 'emails[type eq "work"].value', value: 'amazing@contoso.example' },
			{ op: 'Replace', path: 'externalId', value: 'amazing' },
			{ op: 'Replace', path: 'title', value: 'Commodore' },
			{ op: 'Replace', path: 'phoneNumbers[type eq "work"].value', value: '+1 555 0199' },
			{ op: 'Replace', path: 'addresses[type eq "work"].locality', value: 'Washington' },
			{ op: 'Replace', path: `${ENTERPRISE}:department`, value: 'Fleet' },
			{ op: 'Replace', path: `${ENTERPRISE}:manager`, value: 'mgr-2' },
		]));
		expect(out.status).toBe(200);
		expect(out.json).toMatchObject({
			displayName: 'Amazing Grace',
			externalId: 'amazing',
			name: { givenName: 'Amazing', familyName: 'Hopper-Murray' },
			emails: [{ value: 'amazing@contoso.example' }],
		});
		expect((await scim('GET', `/Users/${u.id}`)).json.displayName).toBe('Amazing Grace');
	});

	it('Patch User, change userName', async () => {
		const u = await created('grace@contoso.example');
		const out = await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'replace', path: 'userName', value: 'ghopper@contoso.example' }]));
		expect(out.json.userName).toBe('ghopper@contoso.example');
		expect((await scim('GET', `/Users?${q('userName eq "ghopper@contoso.example"')}`)).json.totalResults).toBe(1);
	});

	it('Patch User, change userName to one another user holds is 409 uniqueness', async () => {
		await created('ada@contoso.example');
		const u = await created('grace@contoso.example');
		expectError(await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'replace', path: 'userName', value: 'ada@contoso.example' }])), 409, 'uniqueness');
	});

	it('Patch User, the no-path object Entra sends with dotted and filtered keys', async () => {
		const u = await created('grace@contoso.example');
		const out = await scim('PATCH', `/Users/${u.id}`, patch([{
			op: 'Replace',
			value: {
				displayName: 'G. Hopper',
				'name.givenName': 'G.',
				'emails[type eq "work"].value': 'g@contoso.example',
				[`${ENTERPRISE}:employeeNumber`]: '43',
				active: 'True',
			},
		}]));
		expect(out.status).toBe(200);
		expect(out.json).toMatchObject({ displayName: 'G. Hopper', name: { givenName: 'G.' }, emails: [{ value: 'g@contoso.example' }], active: true });
	});

	it('Patch User, Add attributes the user did not have', async () => {
		const u = await created('bare@contoso.example', { displayName: undefined, name: undefined, emails: undefined, externalId: undefined });
		expect(u.displayName).toBeUndefined();
		const out = await scim('PATCH', `/Users/${u.id}`, patch([
			{ op: 'Add', path: 'displayName', value: 'Bare Person' },
			{ op: 'Add', path: 'emails[type eq "work"].value', value: 'bare@contoso.example' },
			{ op: 'Add', path: 'name.givenName', value: 'Bare' },
			{ op: 'Add', path: 'externalId', value: 'bare' },
		]));
		expect(out.json).toMatchObject({ displayName: 'Bare Person', externalId: 'bare', name: { givenName: 'Bare' }, emails: [{ value: 'bare@contoso.example' }] });
	});

	it('Patch User, Remove an attribute', async () => {
		const u = await created('grace@contoso.example');
		const out = await scim('PATCH', `/Users/${u.id}`, patch([
			{ op: 'Remove', path: 'displayName' },
			{ op: 'Remove', path: 'name.familyName' },
			{ op: 'Remove', path: 'emails[type eq "work"].value' },
		]));
		expect(out.status).toBe(200);
		expect(out.json.displayName).toBeUndefined();
		expect(out.json.emails).toBeUndefined();
		expect(out.json.name).toEqual({ givenName: 'Grace', formatted: 'Grace' });
	});

	it('Disable User with active "False" (string) and false (boolean), then re-enable', async () => {
		const u = await created('grace@contoso.example');
		expect((await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'Replace', path: 'active', value: 'False' }]))).json.active).toBe(false);
		expect((await scim('GET', `/Users?${q('active eq false')}`)).json.totalResults).toBe(1);
		expect((await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'replace', value: { active: true } }]))).json.active).toBe(true);
		expect((await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'replace', path: 'active', value: false }]))).json.active).toBe(false);
	});

	it('Replace User with PUT', async () => {
		const u = await created('grace@contoso.example');
		const out = await scim('PUT', `/Users/${u.id}`, entraUser('grace@contoso.example', { displayName: 'Replaced', externalId: 'replaced' }));
		expect(out.status).toBe(200);
		expect(out.json).toMatchObject({ id: u.id, displayName: 'Replaced', externalId: 'replaced' });
		expectError(await scim('PUT', '/Users/7c0e4a3b-0000-4000-8000-000000000000', entraUser('x@contoso.example')), 404);
	});

	it('Delete User: 204, then GET, PATCH and DELETE all answer 404 and filters no longer find it', async () => {
		const u = await created('grace@contoso.example');
		const del = await scim('DELETE', `/Users/${u.id}`);
		expect(del.status).toBe(204);
		expect(del.body).toBe('');
		expectError(await scim('GET', `/Users/${u.id}`), 404);
		expectError(await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'replace', path: 'active', value: true }])), 404);
		expectError(await scim('DELETE', `/Users/${u.id}`), 404);
		expect((await scim('GET', `/Users?${q('userName eq "grace@contoso.example"')}`)).json.totalResults).toBe(0);
	});

	it('Create a User again after it was deleted', async () => {
		const u = await created('grace@contoso.example');
		await scim('DELETE', `/Users/${u.id}`);
		const again = await scim('POST', '/Users', entraUser('grace@contoso.example'));
		expect(again.status).toBe(201);
		expect(again.json.active).toBe(true);
	});

	it('Paging: 1-based startIndex, count, totalResults across pages, and count=0', async () => {
		for (let i = 1; i <= 5; i++) await created(`p${i}@contoso.example`);
		const one = (await scim('GET', '/Users?startIndex=1&count=2')).json;
		const two = (await scim('GET', '/Users?startIndex=3&count=2')).json;
		const three = (await scim('GET', '/Users?startIndex=5&count=2')).json;
		expect([one.totalResults, two.totalResults, three.totalResults]).toEqual([5, 5, 5]);
		expect([one.itemsPerPage, two.itemsPerPage, three.itemsPerPage]).toEqual([2, 2, 1]);
		expect([one.startIndex, two.startIndex, three.startIndex]).toEqual([1, 3, 5]);
		const ids = [...one.Resources, ...two.Resources, ...three.Resources].map((r) => r.id);
		expect(new Set(ids).size).toBe(5);
		const none = (await scim('GET', '/Users?count=0')).json;
		expect(none).toMatchObject({ totalResults: 5, itemsPerPage: 0, Resources: [] });
		expect((await scim('GET', '/Users?startIndex=0&count=1')).json.startIndex).toBe(1);
		expect((await scim('GET', '/Users?startIndex=99')).json).toMatchObject({ totalResults: 5, Resources: [] });
	});
});

// ── groups ───────────────────────────────────────────────────────────────────

describe('Groups', () => {
	async function group(displayName, members = []) {
		const out = await scim('POST', '/Groups', { schemas: [SCHEMA_GROUP], displayName, externalId: `ext-${displayName}`, members: members.map((value) => ({ value })) });
		expect(out.status).toBe(201);
		return out.json;
	}

	it('Create Group: 201 with id, Location and members', async () => {
		const u = await created('grace@contoso.example');
		const g = await group('Engineering', [u.id]);
		expect(g).toMatchObject({ schemas: [SCHEMA_GROUP], displayName: 'Engineering', externalId: 'ext-Engineering', meta: { resourceType: 'Group' } });
		expect(g.members.map((m) => m.value)).toEqual([u.id]);
	});

	it('Create duplicate Group: 409 uniqueness', async () => {
		await group('Engineering');
		expectError(await scim('POST', '/Groups', { schemas: [SCHEMA_GROUP], displayName: 'Engineering' }), 409, 'uniqueness');
	});

	it('Get Group with excludedAttributes=members, as Entra reads it', async () => {
		const u = await created('grace@contoso.example');
		const g = await group('Engineering', [u.id]);
		const lean = await scim('GET', `/Groups/${g.id}?excludedAttributes=members`);
		expect(lean.status).toBe(200);
		expect(lean.json.members).toBeUndefined();
		expect((await scim('GET', `/Groups/${g.id}`)).json.members).toHaveLength(1);
		expectError(await scim('GET', '/Groups/7c0e4a3b-0000-4000-8000-000000000000'), 404);
	});

	it('Filter Groups by displayName (any case) and externalId', async () => {
		const g = await group('Engineering');
		expect((await scim('GET', `/Groups?excludedAttributes=members&${q('displayName eq "engineering"')}`)).json.Resources.map((r) => r.id)).toEqual([g.id]);
		expect((await scim('GET', `/Groups?${q('externalId eq "ext-Engineering"')}`)).json.totalResults).toBe(1);
		expect((await scim('GET', `/Groups?${q('displayName eq "Nobody"')}`)).json).toMatchObject({ totalResults: 0, Resources: [] });
	});

	it('Membership probe: id eq and members eq, as Entra checks a member before removing it', async () => {
		const a = await created('a@contoso.example');
		const b = await created('b@contoso.example');
		const g = await group('Engineering', [a.id]);
		expect((await scim('GET', `/Groups?excludedAttributes=members&${q(`id eq "${g.id}" and members eq "${a.id}"`)}`)).json.totalResults).toBe(1);
		expect((await scim('GET', `/Groups?excludedAttributes=members&${q(`id eq "${g.id}" and members eq "${b.id}"`)}`)).json.totalResults).toBe(0);
	});

	it('Patch Group: add several members in one request (gallery recommendation)', async () => {
		const ids = [];
		for (let i = 1; i <= 4; i++) ids.push((await created(`m${i}@contoso.example`)).id);
		const g = await group('Engineering');
		const out = await scim('PATCH', `/Groups/${g.id}`, patch([{ op: 'Add', path: 'members', value: ids.map((value) => ({ value })) }]));
		expect(out.status).toBe(200);
		expect(out.json.members.map((m) => m.value).sort()).toEqual([...ids].sort());
	});

	it('Patch Group: remove members by value filter and by value list', async () => {
		const ids = [];
		for (let i = 1; i <= 3; i++) ids.push((await created(`r${i}@contoso.example`)).id);
		const g = await group('Engineering', ids);
		await scim('PATCH', `/Groups/${g.id}`, patch([{ op: 'Remove', path: `members[value eq "${ids[0]}"]` }]));
		const out = await scim('PATCH', `/Groups/${g.id}`, patch([{ op: 'Remove', path: 'members', value: [{ value: ids[1] }] }]));
		expect(out.json.members.map((m) => m.value)).toEqual([ids[2]]);
	});

	it('Patch Group: replace displayName, by path and in a no-path object', async () => {
		const g = await group('Engineering');
		expect((await scim('PATCH', `/Groups/${g.id}`, patch([{ op: 'Replace', path: 'displayName', value: 'Platform' }]))).json.displayName).toBe('Platform');
		expect((await scim('PATCH', `/Groups/${g.id}`, patch([{ op: 'Replace', value: { displayName: 'Core', externalId: 'core' } }]))).json).toMatchObject({ displayName: 'Core', externalId: 'core' });
	});

	it('Delete Group: 204, then 404', async () => {
		const g = await group('Engineering');
		expect((await scim('DELETE', `/Groups/${g.id}`)).status).toBe(204);
		expectError(await scim('GET', `/Groups/${g.id}`), 404);
		expectError(await scim('DELETE', `/Groups/${g.id}`), 404);
	});

	it('a deleted User leaves every group', async () => {
		const u = await created('grace@contoso.example');
		const g = await group('Engineering', [u.id]);
		await scim('DELETE', `/Users/${u.id}`);
		expect((await scim('GET', `/Groups/${g.id}`)).json.members).toEqual([]);
	});
});

// ── errors ───────────────────────────────────────────────────────────────────

describe('error formats', () => {
	it('an unsupported filter is 400 invalidFilter, never an unfiltered list', async () => {
		expectError(await scim('GET', `/Users?${q('title eq "x"')}`), 400, 'invalidFilter');
		expectError(await scim('GET', `/Users?${q('userName co "x"')}`), 400, 'invalidFilter');
		expectError(await scim('GET', `/Users?${q('userName eq "x" or userName eq "y"')}`), 400, 'invalidFilter');
	});

	it('a User without userName is 400 invalidValue', async () => {
		expectError(await scim('POST', '/Users', entraUser('x@contoso.example', { userName: undefined })), 400, 'invalidValue');
	});

	it('a PATCH without the PatchOp schema, or with an unknown op, is 400 invalidSyntax', async () => {
		const u = await created('grace@contoso.example');
		expectError(await scim('PATCH', `/Users/${u.id}`, { Operations: [{ op: 'replace', path: 'displayName', value: 'x' }] }), 400, 'invalidSyntax');
		expectError(await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'Move', path: 'displayName', value: 'x' }])), 400, 'invalidSyntax');
	});

	it('active that is not a boolean is 400 invalidValue', async () => {
		const u = await created('grace@contoso.example');
		expectError(await scim('PATCH', `/Users/${u.id}`, patch([{ op: 'replace', path: 'active', value: 'maybe' }])), 400, 'invalidValue');
	});

	it('an unknown resource is 404 and a wrong method is 405 with Allow', async () => {
		expectError(await scim('GET', '/Widgets'), 404);
		const out = await scim('DELETE', '/Users');
		expectError(out, 405);
		expect(out.headers.allow).toBe('GET, POST');
	});
});

// ── gallery requirements ─────────────────────────────────────────────────────

describe('gallery requirements', () => {
	it('allows at least 25 requests per second per tenant', async () => {
		const { SCIM_TEAM_LIMIT } = await import('../api/_lib/rate-limit.js');
		expect(SCIM_TEAM_LIMIT.window).toBe('1 m');
		expect(SCIM_TEAM_LIMIT.limit / 60).toBeGreaterThanOrEqual(25);
	});
});
