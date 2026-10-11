// user_identities.provider started out google-only (20260922190000_account_social_sso.sql).
// 20261011210000_user_identities_x_provider.sql widens the check constraint to
// also allow 'x', the provider api/auth/x/[action].js's new login action
// writes through api/_lib/identities.js. Run against a real database so the
// constraint actually in the schema is what's exercised, not a guess about it:
//   DATABASE_URL=... npx vitest run tests/user-identities-provider-constraint.test.js

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const hasDb = Boolean(process.env.DATABASE_URL);
const liveDb = describe.skipIf(!hasDb);

liveDb('user_identities provider check constraint', () => {
	/** @type {import('@neondatabase/serverless').NeonQueryFunction} */
	let sql;
	let user;

	beforeAll(async () => {
		({ sql } = await import('../api/_lib/db.js'));
		const stamp = Date.now();
		[user] = await sql`insert into users (email) values (${`identity-constraint-${stamp}@qa.three.ws`}) returning id`;
	}, 60_000);

	afterAll(async () => {
		if (sql && user) {
			await sql`delete from user_identities where user_id = ${user.id}`;
			await sql`delete from users where id = ${user.id}`;
		}
	});

	it('allows provider = x', async () => {
		const [row] = await sql`
			insert into user_identities (user_id, provider, subject)
			values (${user.id}, 'x', 'x-subject-1')
			returning id, provider
		`;
		expect(row.provider).toBe('x');
	});

	it('still allows provider = google', async () => {
		const [row] = await sql`
			insert into user_identities (user_id, provider, subject)
			values (${user.id}, 'google', 'google-subject-1')
			returning id, provider
		`;
		expect(row.provider).toBe('google');
	});

	it('rejects any other provider', async () => {
		await expect(
			sql`insert into user_identities (user_id, provider, subject) values (${user.id}, 'facebook', 'fb-subject-1')`,
		).rejects.toThrow();
	});

	it('still enforces one identity per provider per account', async () => {
		await expect(
			sql`insert into user_identities (user_id, provider, subject) values (${user.id}, 'x', 'x-subject-2')`,
		).rejects.toThrow();
	});
});
