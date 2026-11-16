// Teams identity mapping on real SQL (PGlite) and the code paths that feed it:
// the bot's installationUpdate and `link <code>` handling, the Forge settle
// announcement, the preferences merge, and the tab deep link parser.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

const id = await import('../api/_lib/teams-identity.js');
const { handleActivity } = await import('../api/_lib/teams-bot.js');
const { announceSettled, forgeKey } = await import('../api/_lib/teams-forge.js');
const { mergeStored } = await import('../api/notifications/preferences.js');
const { parseSub } = await import('../src/microsoft-teams-deeplink.js');

const migration = readFileSync('api/_lib/migrations/20261116120000_teams_identities.sql', 'utf8');
const TENANT = '11111111-1111-4111-8111-111111111111';
const AAD = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WHO = { tenantId: TENANT, aadObjectId: AAD };

const row = async () => (await holder.db.sql`select * from teams_identities where aad_object_id = ${AAD}`)[0];
const activity = (over = {}) => ({
	type: 'message', id: 'a1', serviceUrl: 'https://smba.trafficmanager.net/amer/',
	conversation: { id: 'c1' }, from: { aadObjectId: AAD }, channelData: { tenant: { id: TENANT } }, ...over,
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec('create table users (id uuid primary key)');
	await holder.db.exec(migration);
	await holder.db.sql`insert into users (id) values (${USER})`;
});

describe('identityOf and linkCommandCode', () => {
	it('needs a tenant id and an Entra object id, both GUIDs', () => {
		expect(id.identityOf(activity())).toEqual(WHO);
		expect(id.identityOf(activity({ from: {} }))).toBeNull();
		expect(id.identityOf(activity({ channelData: {} }))).toBeNull();
		expect(id.identityOf(activity({ from: { aadObjectId: 'nope' } }))).toBeNull();
	});
	it('reads the link command, with or without a code', () => {
		expect(id.linkCommandCode('link abcd-efgh')).toBe('ABCDEFGH');
		expect(id.linkCommandCode('<at>three.ws</at> link ABCDEFGH')).toBeNull();
		expect(id.linkCommandCode('/link')).toBe('');
		expect(id.linkCommandCode('link 0000')).toBe('');
		expect(id.linkCommandCode('hello')).toBeNull();
	});
});

describe('install state', () => {
	it('records an install, and uninstall clears the account link', async () => {
		await id.markInstalled(WHO);
		expect(await row()).toMatchObject({ installed: true, user_id: null });
		const { code } = await id.createLinkCode(USER);
		expect(await id.redeemLinkCode(code, WHO)).toBe(USER);
		expect(await id.userForIdentity(WHO)).toBe(USER);
		await id.markUninstalled(WHO);
		expect(await row()).toMatchObject({ installed: false, user_id: null, linked_at: null });
		expect(await id.userForIdentity(WHO)).toBeNull();
		await id.markInstalled(WHO);
		expect(await id.userForIdentity(WHO)).toBeNull();
	});
	it('a not_installed failure stops later sends; other failures keep the install', async () => {
		await id.markInstalled(WHO);
		await id.recordFailure(WHO, 'consent_missing');
		expect(await row()).toMatchObject({ installed: true, last_error_code: 'consent_missing' });
		await id.recordFailure(WHO, 'not_installed');
		expect((await row()).installed).toBe(false);
		await id.markInstalled(WHO);
		expect(await row()).toMatchObject({ installed: true, last_error_code: null });
	});
});

describe('link codes', () => {
	it('work once, link the account, and list it for that user', async () => {
		const { code } = await id.createLinkCode(USER);
		expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
		expect(await id.redeemLinkCode(code, WHO)).toBe(USER);
		expect(await id.redeemLinkCode(code, WHO)).toBeNull();
		const rows = await id.identitiesForUser(USER);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ tenant_id: TENANT, aad_object_id: AAD, installed: true });
		await id.unlinkUser(USER);
		expect(await id.identitiesForUser(USER)).toHaveLength(0);
	});
	it('reject an unknown code', async () => {
		expect(await id.redeemLinkCode('ZZZZZZZZ', WHO)).toBeNull();
	});
});

describe('bot activities', () => {
	const connector = () => ({ connectorConfigured: () => true, replyToActivity: vi.fn(async () => ({})) });

	it('installationUpdate add then remove maps and clears the identity', async () => {
		await handleActivity(activity({ type: 'installationUpdate', action: 'add' }), { deps: { connector: connector() } });
		expect(await row()).toMatchObject({ installed: true });
		const { code } = await id.createLinkCode(USER);
		await id.redeemLinkCode(code, WHO);
		await handleActivity(activity({ type: 'installationUpdate', action: 'remove' }), { deps: { connector: connector() } });
		expect(await row()).toMatchObject({ installed: false, user_id: null });
	});
	it('the link command redeems the code and replies', async () => {
		const c = connector();
		const { display } = await id.createLinkCode(USER);
		const out = await handleActivity(activity({ text: `link ${display}` }), { deps: { connector: c } });
		expect(out).toBeNull();
		expect(await id.userForIdentity(WHO)).toBe(USER);
		expect(c.replyToActivity.mock.calls[0][0].activity.text).toMatch(/^Linked\./);
	});
	it('a bad code is refused and links nothing', async () => {
		const c = connector();
		await handleActivity(activity({ text: 'link ZZZZZZZZ' }), { deps: { connector: c } });
		expect(await id.userForIdentity(WHO)).toBeNull();
		expect(c.replyToActivity.mock.calls[0][0].activity.text).toMatch(/not valid/);
	});
});

describe('announceSettled', () => {
	const key = forgeKey('c1', 'a1');
	const record = (over = {}) => ({ key, state: 'done', prompt: 'a red fox', by: { ...WHO }, result: { posterUrl: 'https://p/x.png', viewerUrl: 'https://v/x' }, ...over });

	it('notifies the linked requester exactly once with the job key', async () => {
		const { code } = await id.createLinkCode(USER);
		await id.redeemLinkCode(code, WHO);
		const notify = vi.fn(async () => {});
		await announceSettled(record(), { notify });
		await announceSettled(record(), { notify });
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(USER, 'forge_complete', expect.objectContaining({ prompt: 'a red fox', teams_job_key: key }));
	});
	it('reports a failure as forge_failed and skips an unlinked or unsettled job', async () => {
		const { code } = await id.createLinkCode(USER);
		await id.redeemLinkCode(code, WHO);
		const notify = vi.fn(async () => {});
		await announceSettled(record({ key: forgeKey('c2', 'a2'), state: 'failed', error: 'boom' }), { notify });
		expect(notify.mock.calls[0][1]).toBe('forge_failed');
		await announceSettled(record({ key: forgeKey('c3', 'a3'), state: 'running' }), { notify });
		await announceSettled(record({ key: forgeKey('c4', 'a4'), by: { tenantId: TENANT, aadObjectId: '44444444-4444-4444-8444-444444444444' } }), { notify });
		expect(notify).toHaveBeenCalledTimes(1);
	});
});

describe('mergeStored', () => {
	it('keeps the Teams preferences when the category matrix is saved', () => {
		const stored = { categories: {}, telegram_chat_id: null, teams: { events: { forgeJobFailed: false } } };
		const next = mergeStored(stored, { categories: { sales: { push: false } } }, {});
		expect(next.teams).toEqual({ events: { forgeJobFailed: false } });
		expect(next.categories.sales).toEqual({ push: false });
	});
});

describe('parseSub', () => {
	const uuid = '3f2b6a1c-9d4e-4f7a-8b2c-1e5d7a9c0b4f';
	it('accepts agent and job ids and nothing else', () => {
		expect(parseSub(`agent:${uuid}`)).toEqual({ kind: 'agent', id: uuid });
		expect(parseSub(`job:${uuid}`)).toEqual({ kind: 'job', id: uuid });
		expect(parseSub(`job:${forgeKey('c', 'a')}`)).toEqual({ kind: 'job', id: forgeKey('c', 'a') });
		for (const bad of ['', null, 'agent:../../x', 'job:1', 'x:' + uuid, `agent:${uuid}/..`]) expect(parseSub(bad)).toBeNull();
	});
});
