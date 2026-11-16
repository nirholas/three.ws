// Account two-step verification end to end, on an in-process Postgres (PGlite)
// carrying the full production schema: the real createSession/getSessionUser
// (api/_lib/auth.js), the real /api/auth/mfa/* handler, /api/auth/me and the
// team gate in loadTeamFor. Only the rate limiter and CSRF check are stubbed.
//
// The load-bearing assertions: once two-step is on, no sign-in yields a usable
// session until a code passes; a pending session is never accepted as signed
// in; a TOTP code works once; a recovery code works once; five wrong codes end
// the pending sign-in; and a team that requires two-step admits its people
// only through a verified browser session.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';
import { invoke } from './_helpers/scim-harness.js';
import { base32Decode, generateTotp } from '../api/_lib/totp.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const ok = { success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000 };
	return { ...actual, clientIp: () => '203.0.113.9', limits: new Proxy({}, { get: () => async () => ok }) };
});
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.WALLET_ENCRYPTION_KEY ||= 'test-wallet-encryption-key-0123456789abcdef';

let fullPg;
let auth;
let mfa;
let runtime;
let mfaHandler;
let authHandler;
let userId;
let ownerId;
let clock;

const cookieFor = (token) => ({ cookie: `__Host-sid=${token}` });
const jsonHeaders = (token) => ({ 'content-type': 'application/json', ...(token ? cookieFor(token) : {}) });
const reqFor = (token) => ({ headers: token ? cookieFor(token) : {} });
const tokenFromSetCookie = (h) => String(Array.isArray(h) ? h[0] : h).match(/__Host-sid=([^;]+)/)[1];

const call = (action, { token, method = 'POST', body } = {}) =>
	invoke(mfaHandler, { method, url: `/api/auth/mfa/${action}`, query: { action }, headers: jsonHeaders(token), body });

function tick(seconds = 30) {
	clock += seconds * 1000;
	vi.setSystemTime(clock);
}
const codeFor = (secret) => generateTotp(base32Decode(secret), Math.floor(Date.now() / 1000));

async function fullSession(id = userId) {
	return auth.createSession({ userId: id, userAgent: 'vitest', ip: '203.0.113.9', mfaVerified: true });
}

/** Turn two-step on for `id`; returns { secret, recovery, token } (token is verified). */
async function enrol(id = userId) {
	const token = await auth.createSession({ userId: id, userAgent: 'vitest', ip: null });
	const setup = await call('setup', { token });
	expect(setup.status).toBe(200);
	const enable = await call('enable', { token, body: { code: codeFor(setup.json.secret) } });
	expect(enable.status).toBe(200);
	tick();
	return { secret: setup.json.secret, recovery: enable.json.recovery_codes, token };
}

beforeAll(async () => {
	({ pg: fullPg } = await createFullSchemaDb());
	holder.db = createPgliteSql({ pg: fullPg });
	auth = await import('../api/_lib/auth.js');
	mfa = await import('../api/_lib/account-mfa.js');
	runtime = await import('../api/_lib/teams/runtime.js');
	mfaHandler = (await import('../api/auth/mfa/[action].js')).default;
	authHandler = (await import('../api/auth/[action].js')).default;
}, 300_000);

beforeEach(async () => {
	holder.db = createPgliteSql({ pg: fullPg });
	clock = Date.UTC(2026, 10, 16, 12, 0, 0);
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(clock);
	const { sql } = holder.db;
	await sql`delete from user_mfa_recovery_codes`;
	await sql`delete from user_mfa`;
	await sql`delete from team_people`;
	await sql`delete from teams`;
	await sql`delete from sessions`;
	await sql`delete from users where email like '%@mfa.test'`;
	[{ id: userId }] = await sql`insert into users (email, display_name) values ('ada@mfa.test', 'Ada') returning id`;
	[{ id: ownerId }] = await sql`insert into users (email, display_name) values ('owner@mfa.test', 'Owner') returning id`;
});

afterEach(() => vi.useRealTimers());

describe('enrolment', () => {
	it('issues a secret and QR code, then turns on with the first code and returns ten recovery codes', async () => {
		const token = await fullSession();
		const setup = await call('setup', { token });
		expect(setup.status).toBe(200);
		expect(setup.json.secret).toMatch(/^[A-Z2-7]{32}$/);
		expect(setup.json.uri).toContain('otpauth://totp/three.ws%3Aada%40mfa.test?');
		expect(setup.json.qr_svg).toContain('<svg');

		const [stored] = await holder.db.sql`select secret_enc, enabled_at from user_mfa where user_id = ${userId}`;
		expect(stored.secret_enc).not.toContain(setup.json.secret);
		expect(stored.enabled_at).toBeNull();

		const wrong = await call('enable', { token, body: { code: '000000' } });
		expect(wrong.status).toBe(400);

		const enable = await call('enable', { token, body: { code: codeFor(setup.json.secret) } });
		expect(enable.status).toBe(200);
		expect(enable.json.recovery_codes).toHaveLength(10);
		for (const c of enable.json.recovery_codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);

		const status = await call('status', { token, method: 'GET' });
		expect(status.json).toMatchObject({ enabled: true, recovery_codes_remaining: 10 });
		expect((await call('setup', { token })).status).toBe(409);

		const codes = await holder.db.sql`select code_hash from user_mfa_recovery_codes where user_id = ${userId}`;
		expect(codes.map((r) => r.code_hash)).not.toContain(enable.json.recovery_codes[0]);
	});
});

describe('sign-in', () => {
	it('makes every new session pending until a code passes, and the pending one is never signed in', async () => {
		const { secret } = await enrol();
		const pending = await auth.createSession({ userId, userAgent: 'vitest', ip: null });
		expect(pending.startsWith(mfa.PENDING_PREFIX)).toBe(true);
		expect(await auth.getSessionUser(reqFor(pending))).toBeNull();

		const me = await invoke(authHandler, { url: '/api/auth/me', query: { action: 'me' }, headers: cookieFor(pending) });
		expect(me.status).toBe(401);
		expect(me.json.error).toBe('mfa_required');
		expect(me.headers['set-cookie']).toBeUndefined();

		expect((await call('pending', { token: pending, method: 'GET' })).json.mode).toBe('sign_in');

		const bad = await call('verify', { token: pending, body: { code: '123456', next: '/teams' } });
		expect(bad.status).toBe(400);

		const ok = await call('verify', { token: pending, body: { code: codeFor(secret), next: '/teams' } });
		expect(ok.status).toBe(200);
		expect(ok.json).toMatchObject({ ok: true, next: '/teams', method: 'totp' });
		const full = tokenFromSetCookie(ok.headers['set-cookie']);
		expect(full.startsWith(mfa.PENDING_PREFIX)).toBe(false);
		const user = await auth.getSessionUser(reqFor(full));
		expect(user.id).toBe(userId);
		expect(user.mfa_verified_at).toBeTruthy();

		// The pending session is gone once used.
		expect((await call('verify', { token: pending, body: { code: codeFor(secret) } })).status).toBe(401);
		const audit = await holder.db.sql`select action from audit_log where user_id = ${userId} order by id`;
		expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(['mfa_enabled', 'mfa_failed', 'mfa_verified', 'login']));
	});

	it('refuses the same TOTP code twice', async () => {
		const { secret } = await enrol();
		const code = codeFor(secret);
		const a = await auth.createSession({ userId, userAgent: 'vitest', ip: null });
		expect((await call('verify', { token: a, body: { code } })).status).toBe(200);
		const b = await auth.createSession({ userId, userAgent: 'vitest', ip: null });
		const replay = await call('verify', { token: b, body: { code } });
		expect(replay.status).toBe(400);
		expect(replay.json.error).toBe('invalid_code');
	});

	it('accepts each recovery code exactly once, typed loosely', async () => {
		const { recovery } = await enrol();
		const a = await auth.createSession({ userId, userAgent: 'vitest', ip: null });
		const used = await call('verify', { token: a, body: { code: ` ${recovery[3].toUpperCase().replace('-', ' ')} ` } });
		expect(used.status).toBe(200);
		expect(used.json).toMatchObject({ method: 'recovery', recovery_codes_left: 9 });
		const b = await auth.createSession({ userId, userAgent: 'vitest', ip: null });
		expect((await call('verify', { token: b, body: { code: recovery[3] } })).status).toBe(400);
	});

	it('ends the pending sign-in after five wrong codes, even if the sixth is right', async () => {
		const { secret } = await enrol();
		const pending = await auth.createSession({ userId, userAgent: 'vitest', ip: null });
		for (let i = 0; i < mfa.MAX_ATTEMPTS; i++) {
			expect((await call('verify', { token: pending, body: { code: '000000' } })).status).toBe(400);
		}
		const locked = await call('verify', { token: pending, body: { code: codeFor(secret) } });
		expect(locked.status).toBe(429);
		expect(locked.json.error).toBe('too_many_attempts');
		expect((await call('pending', { token: pending, method: 'GET' })).json.mode).toBe('expired');
	});

	it('lets machine jobs, rotations and Entra MFA sign-ins through without a code', async () => {
		const { token } = await enrol();
		expect((await auth.createSession({ userId, userAgent: 'cron', ip: null, machine: true })).startsWith(mfa.PENDING_PREFIX)).toBe(false);
		const entra = await auth.createSession({ userId, userAgent: 'vitest', ip: null, mfaVerified: true, entraTenantId: 'tid' });
		expect((await auth.getSessionUser(reqFor(entra))).mfa_verified_at).toBeTruthy();
		const me = await auth.getSessionUser(reqFor(token));
		const rotated = await auth.rotateSession({ currentSid: me.sid, userId, userAgent: 'vitest', ip: null });
		expect((await auth.getSessionUser(reqFor(rotated))).mfa_verified_at).toBeTruthy();
	});

	it('does not ask accounts without two-step for anything', async () => {
		const token = await auth.createSession({ userId, userAgent: 'vitest', ip: null });
		expect(token.startsWith(mfa.PENDING_PREFIX)).toBe(false);
		expect((await auth.getSessionUser(reqFor(token))).id).toBe(userId);
	});
});

describe('step-up, disable and recovery-code regeneration', () => {
	it('steps up a session that was not verified', async () => {
		const { secret } = await enrol();
		const phone = await auth.createSession({ userId, userAgent: 'phone', ip: null, inheritMfa: { verifiedAt: null } });
		expect((await call('pending', { token: phone, method: 'GET' })).json.mode).toBe('step_up');
		expect((await call('verify', { token: phone, body: { code: codeFor(secret), next: '//evil.example' } })).json.next).toBe('/dashboard');
		expect((await call('pending', { token: phone, method: 'GET' })).json.mode).toBe('verified');
	});

	it('regenerates recovery codes and disables only with a valid code', async () => {
		const { secret, recovery, token } = await enrol();
		expect((await call('recovery-codes', { token, body: { code: '000000' } })).status).toBe(400);
		const regen = await call('recovery-codes', { token, body: { code: codeFor(secret) } });
		expect(regen.status).toBe(200);
		expect(regen.json.recovery_codes).toHaveLength(10);
		tick();
		expect((await call('disable', { token, body: { code: recovery[0] } })).status).toBe(400);
		expect((await call('disable', { token, body: { code: regen.json.recovery_codes[0] } })).status).toBe(200);
		expect(await mfa.userHasMfa(userId)).toBe(false);
		expect((await auth.createSession({ userId, userAgent: 'vitest', ip: null })).startsWith(mfa.PENDING_PREFIX)).toBe(false);
	});
});

describe('team enforcement', () => {
	async function privateTeamWithMember() {
		const [team] = await holder.db.sql`
			insert into teams (owner_user_id, name, status, is_public) values (${ownerId}, 'Desk', 'active', false) returning *
		`;
		await holder.db.sql`insert into team_people (team_id, user_id, source) values (${team.id}, ${userId}, 'tenant_join')`;
		return team;
	}

	it('needs the owner to have two-step before requiring it, then blocks the owner from turning theirs off', async () => {
		const team = await privateTeamWithMember();
		const { team: loaded } = await runtime.loadTeamFor(team.id, ownerId, { write: true });
		await expect(runtime.updateTeam(loaded, ownerId, { require_mfa: true })).rejects.toMatchObject({ code: 'owner_needs_mfa' });

		const { secret, token } = await enrol(ownerId);
		const updated = await runtime.updateTeam(loaded, ownerId, { require_mfa: true });
		expect(updated.require_mfa).toBe(true);
		const events = await holder.db.sql`select action, detail from team_enterprise_events where team_id = ${team.id}`;
		expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'team_mfa_required_changed' })]));

		const off = await call('disable', { token, body: { code: codeFor(secret) } });
		expect(off.status).toBe(409);
		expect(off.json.error).toBe('team_requires_mfa');
	});

	it('admits a member only through a verified browser session', async () => {
		const team = await privateTeamWithMember();
		await holder.db.sql`update teams set require_mfa = true where id = ${team.id}`;

		const bearer = { userId, source: 'bearer', mfaVerified: false };
		await expect(runtime.loadTeamFor(team.id, userId, { viewer: bearer })).rejects.toMatchObject({ status: 403, code: 'mfa_required' });
		const unverified = { userId, source: 'session', mfaVerified: false };
		await expect(runtime.loadTeamFor(team.id, userId, { viewer: unverified })).rejects.toMatchObject({ code: 'mfa_required' });
		await expect(runtime.loadTeamFor(team.id, userId)).rejects.toMatchObject({ code: 'mfa_required' });

		const verified = { userId, source: 'session', mfaVerified: true };
		const { isMember } = await runtime.loadTeamFor(team.id, userId, { viewer: verified });
		expect(isMember).toBe(true);

		// The owner is never gated by the switch on their own team.
		expect((await runtime.loadTeamFor(team.id, ownerId)).isOwner).toBe(true);
	});

	it('falls back to the public view of a public team instead of refusing', async () => {
		const team = await privateTeamWithMember();
		await holder.db.sql`update teams set require_mfa = true, is_public = true where id = ${team.id}`;
		const { isMember } = await runtime.loadTeamFor(team.id, userId, { viewer: { userId, source: 'session', mfaVerified: false } });
		expect(isMember).toBe(false);
	});
});
