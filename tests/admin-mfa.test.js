// Admin two-factor rule (Microsoft 365 Certification OS 16, a hard fail
// without it): requireAdmin and isVerifiedAdmin refuse an admin whose session
// has not passed a second factor, answer 403 mfa_required pointing at
// /login/verify, and honour the documented emergency switch.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUser = vi.fn(async () => null);
const sql = vi.fn(async () => []);
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
const req = { method: 'POST', url: '/api/admin/accounting-export', headers: {} };
const ADMIN = { id: 'u-admin', sid: 's-1', is_admin: true };

let requireAdmin;
let isVerifiedAdmin;
let mfa;
beforeEach(async () => {
	vi.clearAllMocks();
	delete process.env.ADMIN_MFA_ENFORCE;
	delete process.env.ADMIN_ADDRESSES;
	getSessionUser.mockResolvedValue(ADMIN);
	sql.mockResolvedValue([]);
	vi.resetModules();
	({ requireAdmin, isVerifiedAdmin } = await import('../api/_lib/admin.js'));
	mfa = await import('../api/_lib/admin-mfa.js');
});

describe('requireAdmin two-factor rule', () => {
	it('refuses an admin session that has not passed a second factor', async () => {
		sql.mockResolvedValue([{ mfa_verified_at: null }]);
		const res = fakeRes();
		expect(await requireAdmin(req, res)).toBeNull();
		expect(res.statusCode).toBe(403);
		const body = JSON.parse(res.body);
		expect(body.error).toBe('mfa_required');
		expect(body.verify_url).toBe('/login/verify');
		expect(sql.mock.calls[0][1]).toBe('s-1');
	});

	it('refuses a session id that no longer exists', async () => {
		sql.mockResolvedValue([]);
		const res = fakeRes();
		expect(await requireAdmin(req, res)).toBeNull();
		expect(JSON.parse(res.body).error).toBe('mfa_required');
	});

	it('admits an admin session that passed a second factor', async () => {
		sql.mockResolvedValue([{ mfa_verified_at: new Date('2026-11-01T00:00:00Z') }]);
		expect((await requireAdmin(req, fakeRes()))?.id).toBe('u-admin');
	});

	it('still answers a non-admin with forbidden, not an MFA prompt', async () => {
		getSessionUser.mockResolvedValue({ id: 'u-x', sid: 's-x', is_admin: false });
		const res = fakeRes();
		expect(await requireAdmin(req, res)).toBeNull();
		expect(JSON.parse(res.body).error).toBe('forbidden');
	});

	it('honours the documented emergency switch ADMIN_MFA_ENFORCE=0', async () => {
		process.env.ADMIN_MFA_ENFORCE = '0';
		sql.mockResolvedValue([{ mfa_verified_at: null }]);
		expect((await requireAdmin(req, fakeRes()))?.id).toBe('u-admin');
	});
});

describe('isVerifiedAdmin', () => {
	it('is false for an admin without a second factor and true with one', async () => {
		sql.mockResolvedValueOnce([{ mfa_verified_at: null }]);
		expect(await isVerifiedAdmin(ADMIN)).toBe(false);
		sql.mockResolvedValueOnce([{ mfa_verified_at: new Date() }]);
		expect(await isVerifiedAdmin(ADMIN)).toBe(true);
	});

	it('is false for a non-admin whatever the session says', async () => {
		sql.mockResolvedValue([{ mfa_verified_at: new Date() }]);
		expect(await isVerifiedAdmin({ id: 'u-x', sid: 's-x', is_admin: false })).toBe(false);
	});
});

describe('sessionPassedMfa', () => {
	it('is false without a session id and never queries', async () => {
		expect(await mfa.sessionPassedMfa(undefined)).toBe(false);
		expect(sql).not.toHaveBeenCalled();
	});
});
