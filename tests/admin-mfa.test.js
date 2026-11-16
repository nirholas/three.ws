// Admin two-factor authentication (Microsoft 365 Certification OS 16, a hard
// fail without it). TOTP must match the RFC 6238 reference vectors, refuse a
// replayed code, and requireAdmin must refuse an admin session that has not
// passed a recent TOTP check.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUser = vi.fn(async () => null);
const sql = vi.fn(async () => []);
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser }));
vi.mock('../api/_lib/db.js', () => ({ sql }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn(async () => {}) }));

const mfa = await import('../api/_lib/admin-mfa.js');

// RFC 6238 Appendix B, SHA-1 key "12345678901234567890", last six digits.
const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');
const VECTORS = [
	[59, '287082'],
	[1111111109, '081804'],
	[1111111111, '050471'],
	[1234567890, '005924'],
	[2000000000, '279037'],
];

describe('TOTP core', () => {
	it.each(VECTORS)('matches the RFC 6238 vector at T=%i', (t, code) => {
		expect(mfa.generateTotp(RFC_KEY, t)).toBe(code);
	});

	it('round-trips base32 secrets', () => {
		const bytes = Buffer.from('12345678901234567890', 'ascii');
		const b32 = mfa.base32Encode(bytes);
		expect(b32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
		expect(Buffer.compare(mfa.base32Decode(b32), bytes)).toBe(0);
		expect(Buffer.compare(mfa.base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), bytes)).toBe(0);
	});

	it('accepts one step of clock drift and returns the matched step', () => {
		const now = 1234567890;
		const prev = mfa.generateTotp(RFC_KEY, now - 30);
		expect(mfa.matchTotp(RFC_KEY, prev, { nowSec: now })).toBe(Math.floor((now - 30) / 30));
		const old = mfa.generateTotp(RFC_KEY, now - 90);
		expect(mfa.matchTotp(RFC_KEY, old, { nowSec: now })).toBeNull();
	});

	it('refuses a code whose step was already used (replay)', () => {
		const now = 1234567890;
		const code = mfa.generateTotp(RFC_KEY, now);
		const step = Math.floor(now / 30);
		expect(mfa.matchTotp(RFC_KEY, code, { nowSec: now, afterStep: step })).toBeNull();
		expect(mfa.matchTotp(RFC_KEY, code, { nowSec: now, afterStep: step - 1 })).toBe(step);
	});

	it('rejects malformed codes without throwing', () => {
		expect(mfa.matchTotp(RFC_KEY, '12345', { nowSec: 59 })).toBeNull();
		expect(mfa.matchTotp(RFC_KEY, 'abcdef', { nowSec: 59 })).toBeNull();
		expect(mfa.matchTotp(RFC_KEY, undefined, { nowSec: 59 })).toBeNull();
	});

	it('builds an otpauth URI an authenticator app can scan', () => {
		const uri = mfa.otpauthUri({ secret: 'GEZDGNBVGY3TQOJQ', account: 'owner@example.com' });
		expect(uri).toBe('otpauth://totp/three.ws%3Aowner%40example.com?secret=GEZDGNBVGY3TQOJQ&issuer=three.ws&algorithm=SHA1&digits=6&period=30');
	});
});

function fakeRes() {
	return {
		statusCode: 200, headers: {}, body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; },
	};
}
const req = { method: 'POST', url: '/api/admin/accounting-export', headers: {} };

describe('requireAdmin MFA gate', () => {
	let requireAdmin;
	beforeEach(async () => {
		vi.clearAllMocks();
		delete process.env.ADMIN_MFA_ENFORCE;
		getSessionUser.mockResolvedValue({ id: 'u-admin', sid: 's-1', is_admin: true });
		vi.resetModules();
		({ requireAdmin } = await import('../api/_lib/admin.js'));
	});

	it('refuses an admin session with no TOTP verification', async () => {
		sql.mockResolvedValue([{ mfa_verified_at: null }]);
		const res = fakeRes();
		expect(await requireAdmin(req, res)).toBeNull();
		expect(res.statusCode).toBe(403);
		const body = JSON.parse(res.body);
		expect(body.error).toBe('mfa_required');
		expect(body.verify_url).toBe('/admin/mfa');
	});

	it('refuses a verification older than the freshness window', async () => {
		sql.mockResolvedValue([{ mfa_verified_at: new Date(Date.now() - (mfa.MFA_FRESH_SEC + 60) * 1000) }]);
		const res = fakeRes();
		expect(await requireAdmin(req, res)).toBeNull();
		expect(JSON.parse(res.body).error).toBe('mfa_required');
	});

	it('admits an admin session verified within the window', async () => {
		sql.mockResolvedValue([{ mfa_verified_at: new Date(Date.now() - 60_000) }]);
		const user = await requireAdmin(req, fakeRes());
		expect(user?.id).toBe('u-admin');
	});

	it('lets the enrollment endpoint skip the gate with { mfa: false }', async () => {
		sql.mockResolvedValue([{ mfa_verified_at: null }]);
		const user = await requireAdmin(req, fakeRes(), { mfa: false });
		expect(user?.id).toBe('u-admin');
	});

	it('honours the documented emergency switch ADMIN_MFA_ENFORCE=0', async () => {
		process.env.ADMIN_MFA_ENFORCE = '0';
		sql.mockResolvedValue([{ mfa_verified_at: null }]);
		expect((await requireAdmin(req, fakeRes()))?.id).toBe('u-admin');
	});
});
