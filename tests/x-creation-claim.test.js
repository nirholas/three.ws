// Claiming what the X mention bot made, on Postgres semantics (PGlite) and the
// real migrations for x_mention_events, forge_creations.x_author_id and
// x_creation_claims. users, social_connections and forge_creations are reduced
// to the columns the claim touches.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const claim = await import('../api/_lib/x-creation-claim.js');
const make = await import('../api/_lib/x-mention-make.js');
const store = await import('../api/_lib/x-mention-store.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const read = (f) => readFileSync(new URL(f, MIG), 'utf8');

const SCHEMA = `
	create table users (
		id uuid primary key default gen_random_uuid(), email text not null unique, display_name text, username text,
		plan text not null default 'free', email_verified boolean not null default false,
		service_account boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now()
	);
	create unique index users_username_unique on users(lower(username)) where username is not null;
	create table social_connections (
		id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
		provider text not null, provider_uid text not null, username text not null,
		connected_at timestamptz not null default now(), disconnected_at timestamptz, unique (user_id, provider)
	);
	create table forge_creations (
		id uuid primary key, user_id uuid, visibility text, prompt text, status text, glb_url text,
		preview_image_url text, created_at timestamptz default now(), updated_at timestamptz default now()
	);
`;

const X_ME = '1800000000000000042';
const X_OTHER = '1800000000000000077';
const C1 = '6f1d3a52-0c2e-4b7e-9a58-1f0a9a4b7c10';
const C2 = '6f1d3a52-0c2e-4b7e-9a58-1f0a9a4b7c11';
const C3 = '6f1d3a52-0c2e-4b7e-9a58-1f0a9a4b7c12';

async function addUser(email) {
	const [u] = (await dbState.pg.query('insert into users (email, username) values ($1, $2) returning id', [email, email.split('@')[0]])).rows;
	return u.id;
}
async function link(userId, uid) {
	await dbState.pg.query(`insert into social_connections (user_id, provider, provider_uid, username) values ($1, 'x', $2, 'handle')`, [userId, uid]);
}
async function ownerOf(id) {
	return (await dbState.pg.query('select user_id from forge_creations where id = $1', [id])).rows[0].user_id;
}
async function botMade(id, authorId) {
	await dbState.pg.query('insert into forge_creations (id, prompt, status) values ($1, $2, $3)', [id, `prompt ${id.slice(-2)}`, 'done']);
	await make.attributeCreation({ creationId: id, authorId });
}

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(SCHEMA);
	await dbState.pg.exec(read('20261008170000_x_mention_events.sql'));
	await dbState.pg.exec(read('20261009201500_forge_creations_x_author.sql'));
	await dbState.pg.exec(read('20261009213000_x_creation_claims.sql'));
});

describe('claiming on link', () => {
	it('moves only creations whose x_author_id equals the linked X id, and logs each move', async () => {
		await botMade(C1, X_ME);
		await botMade(C2, X_ME);
		await botMade(C3, X_OTHER);
		const bot = await make.ensureBotUser();
		const me = await addUser('me@example.test');
		await link(me, X_ME);

		const claimed = await claim.claimForUser(me, { source: 'link' });

		expect(claimed.sort()).toEqual([C1, C2]);
		expect(await ownerOf(C1)).toBe(me);
		expect(await ownerOf(C2)).toBe(me);
		expect(await ownerOf(C3)).toBe(bot);
		const rows = (await dbState.pg.query('select * from x_creation_claims order by creation_id')).rows;
		expect(rows.map((r) => [r.creation_id, r.x_author_id, r.user_id, r.source])).toEqual([
			[C1, X_ME, me, 'link'],
			[C2, X_ME, me, 'link'],
		]);
	});

	it('never moves anything for a user whose linked X id matches nothing, or who has no link', async () => {
		await botMade(C1, X_ME);
		const bot = await make.ensureBotUser();
		const stranger = await addUser('stranger@example.test');
		await link(stranger, X_OTHER);
		const unlinked = await addUser('unlinked@example.test');

		expect(await claim.claimForUser(stranger)).toEqual([]);
		expect(await claim.claimForUser(unlinked)).toEqual([]);
		expect(await ownerOf(C1)).toBe(bot);
		expect((await dbState.pg.query('select count(*)::int as n from x_creation_claims')).rows[0].n).toBe(0);
	});

	it('ignores a disconnected link and a creation a person already owns', async () => {
		await botMade(C1, X_ME);
		const bot = await make.ensureBotUser();
		const me = await addUser('me@example.test');
		await link(me, X_ME);
		await dbState.pg.query(`update social_connections set disconnected_at = now() where user_id = $1`, [me]);
		expect(await claim.claimForUser(me)).toEqual([]);
		expect(await ownerOf(C1)).toBe(bot);

		await dbState.pg.query(`update social_connections set disconnected_at = null where user_id = $1`, [me]);
		expect(await claim.claimForUser(me)).toEqual([C1]);
		expect(await claim.claimForUser(me)).toEqual([]);
	});

	it('claims only the ids asked for, and never an id outside the linked author', async () => {
		await botMade(C1, X_ME);
		await botMade(C2, X_ME);
		await botMade(C3, X_OTHER);
		const me = await addUser('me@example.test');
		await link(me, X_ME);
		expect(await claim.claimForUser(me, { ids: [C1, C3] })).toEqual([C1]);
		expect((await claim.listClaimable(me)).map((r) => r.id)).toEqual([C2]);
	});
});

describe('a creation made for an author who already linked', () => {
	it('lands in their library at attribution time', async () => {
		const me = await addUser('me@example.test');
		await link(me, X_ME);
		await botMade(C1, X_ME);
		expect(await ownerOf(C1)).toBe(me);
		expect((await dbState.pg.query('select source from x_creation_claims')).rows).toEqual([{ source: 'mention' }]);
	});
});

describe('reply line', () => {
	async function mention(authorId, tweetId) {
		const mentionRow = {
			id: tweetId, userId: authorId, username: 'asker', text: '@trythreews make a dragon', conversationId: tweetId,
			account: { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' },
		};
		await store.recordMention({ mention: mentionRow, parsed: { intent: 'make', args: { prompt: 'a dragon' }, reason: 'command:make' }, dryRun: true });
	}

	it('says saved to your library for a linked author', async () => {
		await link(await addUser('me@example.test'), X_ME);
		await mention(X_ME, '1900000000000000001');
		const reply = { kind: 'success', text: 'Here is your 3D model.' };
		await claim.withClaimNote(reply, { tweetId: '1900000000000000001', base: 'https://three.test' });
		expect(reply.text).toBe('Here is your 3D model.\nSaved to your library.');
	});

	it('includes the claim link for an unlinked author', async () => {
		await mention(X_OTHER, '1900000000000000002');
		const reply = { kind: 'success', text: 'Here is your 3D model.' };
		await claim.withClaimNote(reply, { tweetId: '1900000000000000002', base: 'https://three.test' });
		expect(reply.text).toBe('Here is your 3D model.\nClaim it: https://three.test/x/claim');
	});

	it('leaves failure replies and over-long replies alone', async () => {
		await mention(X_OTHER, '1900000000000000003');
		const failure = { kind: 'failure', text: 'Could not finish.' };
		await claim.withClaimNote(failure, { tweetId: '1900000000000000003', base: 'https://three.test' });
		expect(failure.text).toBe('Could not finish.');
		const long = { kind: 'success', text: 'x'.repeat(270) };
		await claim.withClaimNote(long, { tweetId: '1900000000000000003', base: 'https://three.test' });
		expect(long.text).toBe('x'.repeat(270));
	});
});
