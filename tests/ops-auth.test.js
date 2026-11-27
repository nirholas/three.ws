// The shared ops-dashboard gate: admin session OR dedicated OPS_SECRET,
// fail-closed in production, never CRON_SECRET.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUser = vi.fn(async () => null);
const isAdminUser = vi.fn(async () => false);
const sessionPassedMfa = vi.fn(async () => true);

vi.mock('../api/_lib/auth.js', () => ({ getSessionUser }));
const logAudit = vi.fn();
const sendOpsAlert = vi.fn(async () => {});
vi.mock('../api/_lib/admin.js', () => ({ isAdminUser }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit }));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert }));
vi.mock('../api/_lib/admin-mfa.js', () => ({
	mfaEnforced: () => process.env.ADMIN_MFA_ENFORCE !== '0',
	sessionPassedMfa,
	adminSessionIdle: () => false,
}));

let authorizeOps;

async function loadFresh() {
	vi.resetModules();
	({ authorizeOps } = await import('../api/_lib/ops-auth.js'));
}

beforeEach(() => {
	vi.clearAllMocks();
	getSessionUser.mockResolvedValue(null);
	isAdminUser.mockResolvedValue(false);
	sessionPassedMfa.mockResolvedValue(true);
	delete process.env.ADMIN_MFA_ENFORCE;
	delete process.env.OPS_SECRET;
	delete process.env.CRON_SECRET;
	delete process.env.NODE_ENV;
	delete process.env.VERCEL_ENV;
});

const reqWith = (headers = {}) => ({ headers });

describe('authorizeOps', () => {
	it('authorizes a signed-in admin with their identity as actor', async () => {
		getSessionUser.mockResolvedValue({ id: 7, wallet_address: 'Wa11etAdmin' });
		isAdminUser.mockResolvedValue(true);
		await loadFresh();
		const r = await authorizeOps(reqWith());
		expect(r.ok).toBe(true);
		expect(r.actor).toBe('Wa11etAdmin');
	});

	it('does not let an admin session that skipped two-step verification through in production', async () => {
		process.env.VERCEL_ENV = 'production';
		getSessionUser.mockResolvedValue({ id: 7, sid: 's-7', wallet_address: 'Wa11etAdmin' });
		isAdminUser.mockResolvedValue(true);
		sessionPassedMfa.mockResolvedValue(false);
		await loadFresh();
		expect(await authorizeOps(reqWith())).toEqual({ ok: false, actor: 'dev', mfaRequired: true });
		expect(sessionPassedMfa).toHaveBeenCalledWith('s-7');
	});

	// Production has OPS_SECRET set, so this is the path a real admin takes. The
	// secret branch used to return before mfaRequired was attached, and an
	// unverified admin was told to sign in (401) instead of to verify (403).
	it('still asks an unverified admin to verify when OPS_SECRET is configured and no secret is sent', async () => {
		process.env.VERCEL_ENV = 'production';
		process.env.OPS_SECRET = 'super-secret-value';
		getSessionUser.mockResolvedValue({ id: 7, sid: 's-7', wallet_address: 'Wa11etAdmin' });
		isAdminUser.mockResolvedValue(true);
		sessionPassedMfa.mockResolvedValue(false);
		await loadFresh();
		expect(await authorizeOps(reqWith())).toEqual({ ok: false, actor: '', mfaRequired: true });
		expect(logAudit).not.toHaveBeenCalled();
	});

	it('an unverified admin can still use the dedicated OPS_SECRET', async () => {
		process.env.OPS_SECRET = 'super-secret-value';
		getSessionUser.mockResolvedValue({ id: 7, sid: 's-7', wallet_address: 'Wa11etAdmin' });
		isAdminUser.mockResolvedValue(true);
		sessionPassedMfa.mockResolvedValue(false);
		await loadFresh();
		const r = await authorizeOps(reqWith({ 'x-ops-secret': 'super-secret-value' }));
		expect(r).toEqual({ ok: true, actor: 'ops-secret' });
	});

	it('rejects a signed-in NON-admin (falls through, no secret) in production', async () => {
		process.env.VERCEL_ENV = 'production';
		getSessionUser.mockResolvedValue({ id: 8, wallet_address: 'notadmin' });
		isAdminUser.mockResolvedValue(false);
		await loadFresh();
		expect((await authorizeOps(reqWith())).ok).toBe(false);
	});

	it('accepts the correct OPS_SECRET via x-ops-secret', async () => {
		process.env.OPS_SECRET = 'super-secret-value';
		await loadFresh();
		expect((await authorizeOps(reqWith({ 'x-ops-secret': 'super-secret-value' }))).ok).toBe(true);
		expect((await authorizeOps(reqWith({ 'x-ops-secret': 'wrong' }))).ok).toBe(false);
		expect((await authorizeOps(reqWith())).ok).toBe(false);
	});

	it('accepts OPS_SECRET via Authorization: Bearer', async () => {
		process.env.OPS_SECRET = 'sek';
		await loadFresh();
		expect((await authorizeOps(reqWith({ authorization: 'Bearer sek' }))).ok).toBe(true);
	});

	it('audits and alerts on a presented but wrong OPS_SECRET, never logging the value', async () => {
		process.env.OPS_SECRET = 'right-value';
		await loadFresh();
		const req = { headers: { 'x-ops-secret': 'guess-123' }, method: 'GET', url: '/api/ops/health?x=1' };
		expect((await authorizeOps(req)).ok).toBe(false);
		expect(logAudit).toHaveBeenCalledTimes(1);
		const entry = logAudit.mock.calls[0][0];
		expect(entry.action).toBe('ops_secret_rejected');
		expect(entry.userId).toBeNull();
		expect(entry.meta).toEqual({ method: 'GET', path: '/api/ops/health' });
		expect(JSON.stringify(entry.meta)).not.toContain('guess-123');
		expect(sendOpsAlert).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(sendOpsAlert.mock.calls[0])).not.toContain('guess-123');
		expect(sendOpsAlert.mock.calls[0][2].signature).toBe('ops-secret-rejected:/api/ops/health');
	});

	it('does not audit an anonymous request that presents no secret', async () => {
		process.env.OPS_SECRET = 'right-value';
		await loadFresh();
		expect((await authorizeOps(reqWith())).ok).toBe(false);
		expect(logAudit).not.toHaveBeenCalled();
	});

	it('does NOT accept CRON_SECRET (decoupled from the cron credential)', async () => {
		process.env.VERCEL_ENV = 'production';
		process.env.CRON_SECRET = 'cron-key';
		// OPS_SECRET intentionally unset
		await loadFresh();
		expect((await authorizeOps(reqWith({ 'x-ops-secret': 'cron-key' }))).ok).toBe(false);
	});

	it('FAILS CLOSED in production when no OPS_SECRET is configured', async () => {
		process.env.VERCEL_ENV = 'production';
		await loadFresh();
		expect((await authorizeOps(reqWith())).ok).toBe(false);
		expect((await authorizeOps(reqWith({ 'x-ops-secret': 'anything' }))).ok).toBe(false);
	});

	it('is open in local dev (no secret, not production) for developer convenience', async () => {
		// neither NODE_ENV nor VERCEL_ENV = production, no secret
		await loadFresh();
		expect((await authorizeOps(reqWith())).ok).toBe(true);
	});
});
