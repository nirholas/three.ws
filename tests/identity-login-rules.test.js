// One login rule for every OpenID provider (api/_lib/identities.js
// decideIdentityLogin). Microsoft sign-in must link to an existing account
// under exactly the rules Google follows: only a provider-verified email may
// reach an existing account, only an account this platform verified may be
// linked, and the owner confirms the link. The single, deliberate difference
// is that Microsoft (whose email claim is often unverified) may still CREATE an
// account for an unvouched address, and that account never receives the
// unproven address. Runs on PGlite with the real identity tables.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '127.0.0.1',
}));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.JWT_SECRET ||= 'identity-login-rules-secret-identity-login-rules';

const USERS_DDL = `
	create table users (
		id uuid primary key default gen_random_uuid(),
		email text unique,
		email_verified boolean not null default false,
		display_name text,
		password_hash text,
		deleted_at timestamptz
	);
`;
const IDENTITIES_DDL = readFileSync(new URL('../api/_lib/migrations/20260922190000_account_social_sso.sql', import.meta.url), 'utf8')
	.match(/create table if not exists user_identities[\s\S]*?user_identities_user_provider_uidx[^;]*;/)[0]
	.replace(/check \(provider in \('google'\)\)/, "check (provider in ('google', 'x', 'telegram', 'microsoft'))");

let identities;
let microsoft;

beforeAll(async () => {
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	await holder.db.exec(USERS_DDL);
	await holder.db.exec(IDENTITIES_DDL);
	identities = await import('../api/_lib/identities.js');
	microsoft = await import('../api/auth/microsoft/[action].js');
});

beforeEach(async () => {
	await holder.db.exec('delete from user_identities; delete from users;');
});

async function user({ email, verified = true, deleted = false, password = null }) {
	const [row] = await holder.db.query(
		`insert into users (email, email_verified, deleted_at, password_hash) values ($1, $2, $3, $4) returning id`,
		[email, verified, deleted ? new Date().toISOString() : null, password],
	);
	return row.id;
}

const claims = (provider, over = {}) => ({
	subject: provider === 'google' ? 'g-123' : '72f988bf-86f1-41af-91ab-2d7cd011db47:00000000-0000-4000-8000-0000000000a1',
	tenant_id: '72f988bf-86f1-41af-91ab-2d7cd011db47',
	object_id: '00000000-0000-4000-8000-0000000000a1',
	email: 'ada@example.org',
	email_verified: true,
	display_name: 'Ada',
	avatar_url: null,
	...over,
});

const decide = (provider, c) => identities.decideIdentityLogin({
	provider, claims: c, allowUnverifiedSignup: provider === 'microsoft',
});

// Each case runs for both providers; the expected decision is the same.
const SHARED_CASES = [
	{
		name: 'a verified email matching a verified account asks the owner to confirm the link',
		setup: () => user({ email: 'ada@example.org' }),
		over: {},
		expect: (d, uid) => expect(d).toEqual({ kind: 'confirm', userId: uid }),
	},
	{
		name: 'a verified email matching an account the platform never verified is refused',
		setup: () => user({ email: 'ada@example.org', verified: false }),
		over: {},
		expect: (d) => expect(d).toEqual({ kind: 'error', code: 'unverified_account' }),
	},
	{
		name: 'a verified email matching a deleted account is refused',
		setup: () => user({ email: 'ada@example.org', deleted: true }),
		over: {},
		expect: (d) => expect(d).toEqual({ kind: 'error', code: 'account_deleted' }),
	},
	{
		name: 'a verified email with no account creates one, born verified',
		setup: async () => null,
		over: {},
		expect: (d) => expect(d).toEqual({ kind: 'create', emailVerified: true, email: 'ada@example.org' }),
	},
	{
		name: 'an unverified email never reaches the account holding it',
		setup: () => user({ email: 'ada@example.org' }),
		over: { email_verified: false },
		expect: (d) => expect(d).toEqual({ kind: 'error', code: 'email_unverified' }),
	},
];

describe.each(['google', 'microsoft'])('%s login decision', (provider) => {
	for (const c of SHARED_CASES) {
		it(c.name, async () => {
			const uid = await c.setup();
			c.expect(await decide(provider, claims(provider, c.over)), uid);
		});
	}

	it('an already linked identity signs straight in, whatever the email says now', async () => {
		const uid = await user({ email: 'someone-else@example.org' });
		const c = claims(provider, { email: 'changed@example.org', email_verified: false });
		await identities.linkIdentity({ userId: uid, provider, claims: c });
		const d = await decide(provider, c);
		expect(d.kind).toBe('signin');
		expect(d.userId).toBe(uid);
	});
});

describe('the one deliberate difference: an unvouched address with no account', () => {
	it('Google refuses', async () => {
		expect(await decide('google', claims('google', { email_verified: false }))).toEqual({ kind: 'error', code: 'email_unverified' });
	});

	it('Microsoft creates an account that does not carry the unproven address', async () => {
		const c = claims('microsoft', { email_verified: false });
		const d = await decide('microsoft', c);
		expect(d).toEqual({ kind: 'create', emailVerified: false, email: null });
		const id = await microsoft.createMicrosoftUser(c, d);
		const [row] = await holder.db.query('select email, email_verified from users where id = $1', [id]);
		expect(row.email).toBe(`ms-${c.tenant_id}-${c.object_id}@wallet.local`);
		expect(row.email).not.toContain('ada@');
		expect(row.email_verified).toBe(false);
	});

	it('a squatted placeholder gets a random suffix rather than the squatter\'s account', async () => {
		const c = claims('microsoft', { email_verified: false });
		const squatter = await user({ email: `ms-${c.tenant_id}-${c.object_id}@wallet.local`, password: 'hash' });
		const id = await microsoft.createMicrosoftUser(c, { kind: 'create', emailVerified: false, email: null });
		expect(id).not.toBe(squatter);
		const [row] = await holder.db.query('select email from users where id = $1', [id]);
		expect(row.email).toMatch(new RegExp(`^ms-${c.tenant_id}-${c.object_id}\\.[a-z0-9_-]{8,}@wallet\\.local$`));
	});

	it('a verified Microsoft create is born email_verified with the real address', async () => {
		const c = claims('microsoft');
		const id = await microsoft.createMicrosoftUser(c, await decide('microsoft', c));
		const [row] = await holder.db.query('select email, email_verified from users where id = $1', [id]);
		expect(row).toEqual({ email: 'ada@example.org', email_verified: true });
	});
});
