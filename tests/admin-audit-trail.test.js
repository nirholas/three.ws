// Microsoft 365 Certification OS 17 and OS 20: every privileged (admin) action
// must leave an audit-log entry, and a denied attempt at an admin endpoint
// must be logged and raise an operator alert.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUser = vi.fn(async () => null);
const sql = vi.fn(async () => []);
const logAudit = vi.fn();
const sendOpsAlert = vi.fn(async () => {});

vi.mock('../api/_lib/auth.js', () => ({ getSessionUser }));
vi.mock('../api/_lib/db.js', () => ({ sql }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit }));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert }));
vi.mock('../api/_lib/admin-mfa.js', () => ({ mfaEnforced: () => true, sessionHasFreshMfa: async () => true }));

let requireAdmin;

function fakeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; this.ended = true; },
		writeHead(code) { this.statusCode = code; },
	};
}

const req = (method, url = '/api/admin/accounting-export') => ({
	method,
	url,
	headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'vitest' },
});

beforeEach(async () => {
	vi.clearAllMocks();
	getSessionUser.mockResolvedValue(null);
	delete process.env.ADMIN_ADDRESSES;
	vi.resetModules();
	({ requireAdmin } = await import('../api/_lib/admin.js'));
});

describe('requireAdmin audit trail', () => {
	it('records a state-changing admin request as admin_action', async () => {
		getSessionUser.mockResolvedValue({ id: 'u-admin', is_admin: true });
		const r = req('POST', '/api/admin-payouts-pause?x=1');
		const user = await requireAdmin(r, fakeRes());
		expect(user?.id).toBe('u-admin');
		expect(logAudit).toHaveBeenCalledTimes(1);
		const entry = logAudit.mock.calls[0][0];
		expect(entry.userId).toBe('u-admin');
		expect(entry.action).toBe('admin_action');
		expect(entry.meta).toEqual({ method: 'POST', path: '/api/admin-payouts-pause' });
		expect(entry.req).toBe(r);
	});

	it('does not write an audit row for a read-only admin GET', async () => {
		getSessionUser.mockResolvedValue({ id: 'u-admin', is_admin: true });
		await requireAdmin(req('GET'), fakeRes());
		expect(logAudit).not.toHaveBeenCalled();
	});

	it('logs and alerts on a signed-in non-admin hitting an admin endpoint', async () => {
		getSessionUser.mockResolvedValue({ id: 'u-plain', is_admin: false });
		const res = fakeRes();
		const user = await requireAdmin(req('DELETE', '/api/feedback/abc'), res);
		expect(user).toBeNull();
		expect(res.statusCode).toBe(403);
		expect(logAudit).toHaveBeenCalledTimes(1);
		const entry = logAudit.mock.calls[0][0];
		expect(entry.action).toBe('admin_access_denied');
		expect(entry.userId).toBe('u-plain');
		expect(entry.meta).toEqual({ method: 'DELETE', path: '/api/feedback/abc' });
		expect(sendOpsAlert).toHaveBeenCalledTimes(1);
		const [title, , opts] = sendOpsAlert.mock.calls[0];
		expect(title).toMatch(/admin/i);
		expect(opts.signature).toBe('admin-access-denied:/api/feedback/abc');
	});

	it('returns 401 without auditing when nobody is signed in', async () => {
		const res = fakeRes();
		expect(await requireAdmin(req('POST'), res)).toBeNull();
		expect(res.statusCode).toBe(401);
		expect(logAudit).not.toHaveBeenCalled();
		expect(sendOpsAlert).not.toHaveBeenCalled();
	});
});
