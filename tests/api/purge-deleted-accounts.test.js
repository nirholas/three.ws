// Deleted accounts are permanently purged 30 days after the owner deletes them,
// which is what public/legal/privacy.html section 5 promises. Before this suite
// existed nothing performed that purge: DELETE /api/auth/me soft-deleted the
// row and every email, wallet link and upload lived forever.
//
// Runs the real purge against a real Postgres (PGlite) carrying the real
// account_purge migration, so cascade, SET NULL, NO ACTION and RESTRICT
// semantics are the database's own. Object storage is stubbed at its boundary
// only (deleteObject), so the test can see exactly which keys were removed.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../../api/_lib/db.js', () => {
	const run = async (text, params) => (await dbState.pg.query(text, params)).rows;
	const lazy = (text, params) => ({
		text,
		params,
		then: (resolve, reject) => run(text, params).then(resolve, reject),
	});
	const sql = (first, ...values) => {
		if (typeof first === 'string') return lazy(first, values[0] || []);
		const text = first.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		return lazy(text, values);
	};
	sql.transaction = async (queries) => {
		await dbState.pg.exec('begin');
		try {
			const out = [];
			for (const q of queries) out.push((await dbState.pg.query(q.text, q.params)).rows);
			await dbState.pg.exec('commit');
			return out;
		} catch (err) {
			await dbState.pg.exec('rollback');
			throw err;
		}
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const r2State = { deleted: [], failKeys: new Set() };
vi.mock('../../api/_lib/r2.js', () => ({
	objectStorageConfigured: () => true,
	keyFromPublicUrl: (url) =>
		typeof url === 'string' && url.startsWith('https://cdn.test/') ? url.slice('https://cdn.test/'.length) : null,
	deleteObject: vi.fn(async (key) => {
		if (r2State.failKeys.has(key)) throw new Error('storage unavailable');
		r2State.deleted.push(key);
	}),
}));

await import('../../api/_lib/db.js');
const { purgeDeletedAccounts, countPurgeable, RETAINED_TABLES, userRef } = await import('../../api/_lib/account-purge.js');

const MIGRATION = readFileSync(
	new URL('../../api/_lib/migrations/20261104180000_account_purge.sql', import.meta.url),
	'utf8',
);

const SCHEMA = `
create table users (
	id uuid primary key default gen_random_uuid(),
	email text unique,
	display_name text,
	username text,
	wallet_address text unique,
	avatar_url text,
	banner_url text,
	referred_by_id uuid references users(id),
	password_hash text,
	deleted_at timestamptz,
	updated_at timestamptz default now()
);
create table user_wallets (
	id bigserial primary key,
	user_id uuid not null references users(id) on delete cascade,
	address text not null unique,
	chain_type text,
	is_primary boolean default false,
	last_used_at timestamptz
);
create table sessions (id bigserial primary key, user_id uuid not null references users(id) on delete cascade, revoked_at timestamptz);
create table avatars (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid not null references users(id) on delete cascade,
	storage_key text,
	thumbnail_key text,
	parent_avatar_id uuid references avatars(id),
	deleted_at timestamptz
);
create table agent_identities (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	avatar_url text,
	deleted_at timestamptz
);
create table widgets (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, deleted_at timestamptz);
create table legal_signatures (id bigserial primary key, user_id uuid, signature_name text not null, created_at timestamptz default now());
create table audit_log (id bigserial primary key, user_id uuid references users(id) on delete set null, action text, meta jsonb);
create table agent_withdrawals (
	id bigserial primary key,
	user_id uuid not null references users(id),
	agent_id uuid references agent_identities(id),
	to_address text not null,
	tx_signature text
);
create table payment_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade);
create table payment_session_executions (
	id bigserial primary key,
	user_id uuid not null references users(id),
	session_id uuid not null references payment_sessions(id) on delete restrict,
	payer_address text,
	amount numeric
);
create table agent_listings (
	id uuid primary key default gen_random_uuid(),
	seller_user_id uuid not null references users(id),
	agent_id uuid not null references agent_identities(id)
);
create table agent_listing_bids (
	id bigserial primary key,
	listing_id uuid not null references agent_listings(id),
	bidder_user_id uuid not null references users(id)
);
create table home_invites (id bigserial primary key, email text not null);
create table avatar_regen_jobs (id bigserial primary key, user_id uuid);
create table orders (id bigserial primary key, user_id uuid not null, total numeric);
create table x402_receipts (id bigserial primary key, payer text not null, amount numeric);
`;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

async function q(text, params = []) {
	return (await dbState.pg.query(text, params)).rows;
}

async function makeUser({ email, wallet, deletedDaysAgo = null, avatarKey = null }) {
	const [u] = await q(
		`insert into users (email, display_name, wallet_address, avatar_url, deleted_at)
		 values ($1, $2, $3, $4, $5) returning id`,
		[email, email.split('@')[0], wallet, avatarKey ? `https://cdn.test/${avatarKey}` : null, deletedDaysAgo == null ? null : ago(deletedDaysAgo)],
	);
	if (wallet) await q(`insert into user_wallets (user_id, address, chain_type) values ($1, $2, 'solana')`, [u.id, wallet]);
	await q(`insert into sessions (user_id) values ($1)`, [u.id]);
	return u.id;
}

async function giveContent(userId, tag) {
	const [avatar] = await q(
		`insert into avatars (owner_id, storage_key, thumbnail_key) values ($1, $2, $3) returning id`,
		[userId, `u/${tag}/body.glb`, `u/${tag}/thumb.webp`],
	);
	const [agent] = await q(`insert into agent_identities (user_id) values ($1) returning id`, [userId]);
	await q(`insert into widgets (user_id) values ($1)`, [userId]);
	return { avatarId: avatar.id, agentId: agent.id };
}

async function countRows(table, where, params) {
	const [r] = await q(`select count(*)::int as n from ${table} where ${where}`, params);
	return r.n;
}

// Every text and jsonb column in the database, scanned for a value. Returns the
// table.column pairs that still hold it.
async function findValueAnywhere(value) {
	const cols = await q(`
		select table_name, column_name, data_type from information_schema.columns
		where table_schema = current_schema() and data_type in ('text', 'jsonb')
	`);
	const hits = [];
	for (const c of cols) {
		const expr = c.data_type === 'jsonb' ? `"${c.column_name}"::text like '%' || $1 || '%'` : `lower("${c.column_name}") = lower($1)`;
		const [r] = await q(`select count(*)::int as n from "${c.table_name}" where ${expr}`, [value]);
		if (r.n > 0) hits.push(`${c.table_name}.${c.column_name}`);
	}
	return hits;
}

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(SCHEMA);
	await dbState.pg.exec(MIGRATION);
	r2State.deleted = [];
	r2State.failKeys = new Set();
});

describe('purgeDeletedAccounts', () => {
	it('hard-deletes an account soft-deleted 31 days ago with its avatars, agents, widgets, sessions and wallet links', async () => {
		const id = await makeUser({ email: 'gone@example.test', wallet: 'THREEsyntheticWalletGone1111111111111111111', deletedDaysAgo: 31, avatarKey: 'profile/gone.png' });
		await giveContent(id, 'gone');

		const result = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });

		expect(result.purged).toBe(1);
		expect(result.failed).toEqual([]);
		for (const [table, col] of [['users', 'id'], ['avatars', 'owner_id'], ['agent_identities', 'user_id'], ['widgets', 'user_id'], ['sessions', 'user_id'], ['user_wallets', 'user_id']]) {
			expect(await countRows(table, `${col} = $1`, [id])).toBe(0);
		}
		expect(r2State.deleted.sort()).toEqual(['profile/gone.png', 'u/gone/body.glb', 'u/gone/thumb.webp']);

		const [receipt] = await q(`select user_hash, counts, r2_objects from account_purge_log`);
		expect(receipt.user_hash).toBe(userRef(id));
		expect(receipt.r2_objects).toBe(3);
		expect(JSON.stringify(receipt)).not.toMatch(/gone@example|THREEsynthetic/);
	});

	it('leaves an account soft-deleted 29 days ago untouched', async () => {
		const id = await makeUser({ email: 'recent@example.test', wallet: 'THREEsyntheticWalletRecent11111111111111111', deletedDaysAgo: 29 });
		await giveContent(id, 'recent');

		const result = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });

		expect(result.purged).toBe(0);
		expect(await countRows('users', 'id = $1', [id])).toBe(1);
		expect(await countRows('avatars', 'owner_id = $1', [id])).toBe(1);
		expect(await countRows('user_wallets', 'user_id = $1', [id])).toBe(1);
		expect(r2State.deleted).toEqual([]);
	});

	it('leaves an active account untouched', async () => {
		const id = await makeUser({ email: 'active@example.test', wallet: 'THREEsyntheticWalletActive11111111111111111' });
		await giveContent(id, 'active');

		await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });

		expect(await countRows('users', 'id = $1', [id])).toBe(1);
		expect(await countRows('avatars', 'owner_id = $1', [id])).toBe(1);
		expect(await countRows('sessions', 'user_id = $1', [id])).toBe(1);
	});

	it('keeps legal acceptance records for the purged account', async () => {
		const id = await makeUser({ email: 'signer@example.test', wallet: null, deletedDaysAgo: 40 });
		await q(`insert into legal_signatures (user_id, signature_name) values ($1, 'Signer Name')`, [id]);

		const result = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });

		expect(result.purged).toBe(1);
		expect(await countRows('legal_signatures', 'user_id = $1', [id])).toBe(1);
		expect(RETAINED_TABLES).toContain('legal_signatures');
	});

	it('keeps financial records but strips every link to the email and wallet of the purged account', async () => {
		const wallet = 'THREEsyntheticWalletPaid1111111111111111111';
		const email = 'paid@example.test';
		const id = await makeUser({ email, wallet, deletedDaysAgo: 45 });
		const { avatarId, agentId } = await giveContent(id, 'paid');

		// Withdrawal to the user's own wallet, by the user's agent: retained, anonymized.
		const [w] = await q(
			`insert into agent_withdrawals (user_id, agent_id, to_address, tx_signature) values ($1, $2, $3, 'sigW') returning id`,
			[id, agentId, wallet],
		);
		// Payment execution under a RESTRICT session link: retained, anonymized.
		const [ps] = await q(`insert into payment_sessions (user_id) values ($1) returning id`, [id]);
		const [pe] = await q(
			`insert into payment_session_executions (user_id, session_id, payer_address, amount) values ($1, $2, $3, 5) returning id`,
			[id, ps.id, wallet],
		);
		// An order with no foreign key at all.
		const [o] = await q(`insert into orders (user_id, total) values ($1, 9) returning id`, [id]);
		// Another person's avatar forked from the purged user's avatar: kept, unlinked.
		const other = await makeUser({ email: 'other@example.test', wallet: 'THREEsyntheticWalletOther111111111111111111' });
		const [fork] = await q(
			`insert into avatars (owner_id, storage_key, parent_avatar_id) values ($1, 'u/other/fork.glb', $2) returning id`,
			[other, avatarId],
		);
		// The purged user's listing, with a bid on it from the other person.
		const [listing] = await q(`insert into agent_listings (seller_user_id, agent_id) values ($1, $2) returning id`, [id, agentId]);
		await q(`insert into agent_listing_bids (listing_id, bidder_user_id) values ($1, $2)`, [listing.id, other]);
		// Content and links the platform holds about the person without a foreign key.
		await q(`insert into avatar_regen_jobs (user_id) values ($1)`, [id]);
		await q(`insert into home_invites (email) values ($1)`, [email]);
		await q(`insert into audit_log (user_id, action, meta) values ($1, 'delete_account', $2)`, [id, JSON.stringify({ released_username: 'paiduser', avatars: 1 })]);

		const result = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });
		expect(result.failed).toEqual([]);
		expect(result.purged).toBe(1);

		const [wRow] = await q(`select user_id, agent_id, to_address, tx_signature from agent_withdrawals where id = $1`, [w.id]);
		expect(wRow).toMatchObject({ user_id: null, agent_id: null, tx_signature: 'sigW' });
		expect(wRow.to_address).not.toBe(wallet);
		const [peRow] = await q(`select user_id, session_id, payer_address, amount from payment_session_executions where id = $1`, [pe.id]);
		expect(peRow).toMatchObject({ user_id: null, session_id: null, payer_address: null });
		expect(Number(peRow.amount)).toBe(5);
		const [oRow] = await q(`select user_id, total from orders where id = $1`, [o.id]);
		expect(oRow.user_id).toBeNull();
		const [forkRow] = await q(`select owner_id, parent_avatar_id from avatars where id = $1`, [fork.id]);
		expect(forkRow).toEqual({ owner_id: other, parent_avatar_id: null });
		expect(await countRows('agent_listings', 'id = $1', [listing.id])).toBe(0);
		expect(await countRows('agent_listing_bids', 'listing_id = $1', [listing.id])).toBe(0);
		expect(await countRows('avatar_regen_jobs', 'user_id = $1', [id])).toBe(0);
		const [audit] = await q(`select user_id, meta from audit_log where action = 'delete_account'`);
		expect(audit.user_id).toBeNull();
		expect(audit.meta).toEqual({ avatars: 1 });

		// Nothing outside a retained table still holds the email, the wallet or the handle.
		const isRetained = (hit) => RETAINED_TABLES.includes(hit.split('.')[0]);
		expect((await findValueAnywhere(email)).filter((h) => !isRetained(h))).toEqual([]);
		expect((await findValueAnywhere(wallet)).filter((h) => !isRetained(h))).toEqual([]);
		expect((await findValueAnywhere('paiduser')).filter((h) => !isRetained(h))).toEqual([]);
		// The other person is unaffected.
		expect(await countRows('users', 'id = $1', [other])).toBe(1);
	});

	it('is a no-op when run twice', async () => {
		const id = await makeUser({ email: 'twice@example.test', wallet: 'THREEsyntheticWalletTwice11111111111111111', deletedDaysAgo: 60 });
		await giveContent(id, 'twice');

		const first = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });
		const deletedAfterFirst = [...r2State.deleted];
		const second = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });

		expect(first.purged).toBe(1);
		expect(second).toMatchObject({ scanned: 0, purged: 0, failed: [] });
		expect(r2State.deleted).toEqual(deletedAfterFirst);
		expect(await countRows('account_purge_log', 'true', [])).toBe(1);
	});

	it('isolates a failing account from the batch and retries it on the next tick', async () => {
		const stuck = await makeUser({ email: 'stuck@example.test', wallet: 'THREEsyntheticWalletStuck11111111111111111', deletedDaysAgo: 50 });
		const fine = await makeUser({ email: 'fine@example.test', wallet: 'THREEsyntheticWalletFine111111111111111111', deletedDaysAgo: 50 });
		await giveContent(stuck, 'stuck');
		await giveContent(fine, 'fine');
		// A blocking foreign key nobody has classified yet: the purge must refuse
		// to guess, fail this one account, and keep going.
		await q(`create table mystery_holds (id serial primary key, user_id uuid not null references users(id))`);
		await q(`insert into mystery_holds (user_id) values ($1)`, [stuck]);

		const first = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });

		expect(first.purged).toBe(1);
		expect(first.failed).toEqual([{ ref: userRef(stuck).slice(0, 12), code: 'unclassified_fk:mystery_holds.user_id' }]);
		expect(JSON.stringify(first)).not.toMatch(/@example\.test|THREEsynthetic/);
		expect(await countRows('users', 'id = $1', [fine])).toBe(0);
		expect(await countRows('users', 'id = $1', [stuck])).toBe(1);
		expect(await countRows('avatars', 'owner_id = $1', [stuck])).toBe(1);
		const [failure] = await q(`select attempts, last_error from account_purge_failures where user_id = $1`, [stuck]);
		expect(failure).toEqual({ attempts: 1, last_error: 'unclassified_fk:mystery_holds.user_id' });

		// The blocker is resolved (the hold is released); the next tick purges it.
		await q(`delete from mystery_holds`);
		const second = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });
		expect(second.purged).toBe(1);
		expect(second.failed).toEqual([]);
		expect(await countRows('users', 'id = $1', [stuck])).toBe(0);
		expect(await countRows('account_purge_failures', 'true', [])).toBe(0);
	});

	it('leaves rows intact when object storage fails, so the next tick can retry', async () => {
		const id = await makeUser({ email: 'r2fail@example.test', wallet: null, deletedDaysAgo: 35 });
		await giveContent(id, 'r2fail');
		r2State.failKeys.add('u/r2fail/body.glb');

		const result = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });

		expect(result.purged).toBe(0);
		expect(result.failed).toEqual([{ ref: userRef(id).slice(0, 12), code: 'storage_delete_failed' }]);
		expect(await countRows('avatars', 'owner_id = $1', [id])).toBe(1);
	});

	it('never deletes a storage object another account still references', async () => {
		const id = await makeUser({ email: 'shared@example.test', wallet: null, deletedDaysAgo: 35 });
		const keeper = await makeUser({ email: 'keeper@example.test', wallet: null });
		await q(`insert into avatars (owner_id, storage_key) values ($1, 'shared/body.glb')`, [id]);
		await q(`insert into avatars (owner_id, storage_key) values ($1, 'shared/body.glb')`, [keeper]);

		const result = await purgeDeletedAccounts({ olderThanDays: 30, limit: 25 });

		expect(result.purged).toBe(1);
		expect(r2State.deleted).toEqual([]);
	});

	it('counts purgeable accounts without changing anything', async () => {
		await makeUser({ email: 'a@example.test', wallet: null, deletedDaysAgo: 31 });
		await makeUser({ email: 'b@example.test', wallet: null, deletedDaysAgo: 10 });
		await makeUser({ email: 'c@example.test', wallet: null });

		expect(await countPurgeable({ olderThanDays: 30 })).toEqual({ purgeable: 1, pending: 1 });
		expect(await countRows('users', 'true', [])).toBe(3);
	});

	it('hashes the user id into the receipt reference', () => {
		const id = '11111111-1111-4111-8111-111111111111';
		expect(userRef(id)).toBe(createHash('sha256').update(id).digest('hex'));
	});
});
