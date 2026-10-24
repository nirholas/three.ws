// Real-DB regression test for the account_link_codes name collision.
//
// 20261011003000_account_linking.sql's `create table if not exists
// account_link_codes (...)` silently no-op'd against a same-named table
// already created by 20260922130000_agents_v1_api.sql (a different,
// agent-identity-linking feature). Production ran the old (agents-v1) shape
// under the new feature's name, so every call into
// api/_lib/account-link/link-codes.js (mint/claim/poll/pending/decide/
// devices/revoke) threw NeonDbError 42703 ("column status does not exist").
//
// tests/account-link.test.js mocks the DB entirely and cannot see this; run
// this file against the real database the repo already points at:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/account-link-codes-schema.test.js

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const hasDb = Boolean(process.env.DATABASE_URL);
const liveDb = describe.skipIf(!hasDb);

liveDb('account_link_codes schema', () => {
	/** @type {import('@neondatabase/serverless').NeonQueryFunction} */
	let sql;
	let user;

	beforeAll(async () => {
		({ sql } = await import('../api/_lib/db.js'));
		const stamp = Date.now();
		[user] = await sql`insert into users (email) values (${`link-codes-schema-${stamp}@qa.three.ws`}) returning id`;
	}, 60_000);

	afterAll(async () => {
		if (sql && user) {
			await sql`delete from account_link_codes where user_id = ${user.id}`;
			await sql`delete from users where id = ${user.id}`;
		}
	});

	it('has the device-linking columns, not the agents-v1 columns the name collision used to leave in place', async () => {
		const rows = await sql`
			select column_name from information_schema.columns
			where table_name = 'account_link_codes'
			order by ordinal_position
		`;
		const columns = rows.map((r) => r.column_name);
		expect(columns).toEqual(expect.arrayContaining(['status', 'device_kind', 'claim_secret_hash', 'claimed_at', 'decided_at', 'consumed_at']));
		expect(columns).not.toContain('agent_id');
	});

	it('preserves the renamed agents-v1 table instead of dropping its rows', async () => {
		const [row] = await sql`select to_regclass('account_link_codes_agents_v1_legacy') as t`;
		expect(row.t).not.toBeNull();
	});

	it('listPendingLinkCodes resolves instead of throwing 42703', async () => {
		const { listPendingLinkCodes } = await import('../api/_lib/account-link/link-codes.js');
		await expect(listPendingLinkCodes(user.id)).resolves.toEqual([]);
	});
});
