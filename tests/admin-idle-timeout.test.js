// Admin session idle timeout (Microsoft 365 Certification control: unattended
// privileged sessions must not stay usable). A signed-in admin whose session
// saw no request for longer than ADMIN_IDLE_TIMEOUT_MIN minutes (default 60)
// is refused with 401 admin_session_idle and must sign in again. Ordinary
// users are unaffected, and the emergency switch ADMIN_IDLE_TIMEOUT_MIN=0
// turns the rule off.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUser = vi.fn(async () => null);
const sql = vi.fn(async () => [{ mfa_verified_at: new Date('2026-11-01T00:00:00Z') }]);
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser }));
vi.mock('../api/_lib/db.js', () => ({ sql }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn(async () => {}) }));

function fakeRes() {
	return {
		statusCode: 200, headers: {}, body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; },
	};
}
const req = { method: 'GET', url: '/api/admin/overview', headers: {} };
const MIN = 60_000;

let requireAdmin;
let isVerifiedAdmin;
beforeEach(async () => {
	vi.clearAllMocks();
	delete process.env.ADMIN_IDLE_TIMEOUT_MIN;
	delete process.env.ADMIN_MFA_ENFORCE;
	sql.mockResolvedValue([{ mfa_verified_at: new Date('2026-11-01T00:00:00Z') }]);
	vi.resetModules();
	({ requireAdmin, isVerifiedAdmin } = await import('../api/_lib/admin.js'));
});

describe('admin idle timeout', () => {
	it('refuses an admin session idle for longer than the default 60 minutes', async () => {
		getSessionUser.mockResolvedValue({ id: 'a', sid: 's', is_admin: true, idle_ms: 61 * MIN });
		const res = fakeRes();
		expect(await requireAdmin(req, res)).toBeNull();
		expect(res.statusCode).toBe(401);
		expect(JSON.parse(res.body).error).toBe('admin_session_idle');
	});

	it('admits an admin session active within the window', async () => {
		getSessionUser.mockResolvedValue({ id: 'a', sid: 's', is_admin: true, idle_ms: 5 * MIN });
		expect((await requireAdmin(req, fakeRes()))?.id).toBe('a');
	});

	it('honours ADMIN_IDLE_TIMEOUT_MIN', async () => {
		process.env.ADMIN_IDLE_TIMEOUT_MIN = '10';
		getSessionUser.mockResolvedValue({ id: 'a', sid: 's', is_admin: true, idle_ms: 11 * MIN });
		expect(await requireAdmin(req, fakeRes())).toBeNull();
	});

	it('is switched off by ADMIN_IDLE_TIMEOUT_MIN=0', async () => {
		process.env.ADMIN_IDLE_TIMEOUT_MIN = '0';
		getSessionUser.mockResolvedValue({ id: 'a', sid: 's', is_admin: true, idle_ms: 9999 * MIN });
		expect((await requireAdmin(req, fakeRes()))?.id).toBe('a');
	});

	it('does not touch a non-admin, who still gets forbidden', async () => {
		getSessionUser.mockResolvedValue({ id: 'u', sid: 's2', is_admin: false, idle_ms: 9999 * MIN });
		const res = fakeRes();
		expect(await requireAdmin(req, res)).toBeNull();
		expect(JSON.parse(res.body).error).toBe('forbidden');
	});

	it('isVerifiedAdmin is false for an idle admin session', async () => {
		expect(await isVerifiedAdmin({ id: 'a', sid: 's', is_admin: true, idle_ms: 61 * MIN })).toBe(false);
		expect(await isVerifiedAdmin({ id: 'a', sid: 's', is_admin: true, idle_ms: MIN })).toBe(true);
	});
});
