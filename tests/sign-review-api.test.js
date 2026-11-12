// The native-signer review API (api/sign-review/[action].js over
// api/_lib/sign-review.js), end to end against an in-memory copy of the two
// review tables.
//
// What it holds:
//   - only a granted reviewer sees a queue or records a verdict; anyone can read
//     the aggregate status; only an admin grants or revokes
//   - a verdict names the content hash the reviewer watched, and a stale hash is
//     refused (409 sign_changed) instead of approving content that is gone
//   - one approval is not enough when two are required; the second approval
//     from a DIFFERENT reviewer makes the sign approved; a reject holds it
//   - a revoked reviewer's verdicts stop counting
//   - none of this changes what /api/sign serves (that reads the committed ledger)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

process.env.SIGN_REVIEW_FIXTURE = '1';

const db = { reviewers: [], reviews: [], users: [], seq: 0 };
const principal = { user: null, admin: false, csrf: true };

function norm(strings) {
	return strings.join('?').replace(/\s+/g, ' ').trim();
}

async function fakeSql(strings, ...v) {
	const q = norm(strings);
	const active = (r) => r.revoked_at == null;
	if (q.startsWith('select 1 from sign_reviewers')) {
		return db.reviewers.filter((r) => r.user_id === v[0] && r.pack === v[1] && active(r)).slice(0, 1).map(() => ({ '?column?': 1 }));
	}
	if (q.startsWith('select pack from sign_reviewers')) {
		return db.reviewers.filter((r) => r.user_id === v[0] && active(r)).map((r) => ({ pack: r.pack }));
	}
	if (q.includes('from sign_reviews r join sign_reviewers g')) {
		return db.reviews
			.filter((r) => r.pack === v[0])
			.flatMap((r) => {
				const g = db.reviewers.find((x) => x.user_id === r.reviewer_id && x.pack === r.pack && active(x));
				return g ? [{ ...r, display_name: g.display_name }] : [];
			})
			.sort((a, b) => a.updated_at - b.updated_at || a.id - b.id);
	}
	if (q.startsWith('insert into sign_reviews')) {
		const [pack, sign_key, content_hash, reviewer_id, verdict, note] = v;
		const hit = db.reviews.find((r) => r.pack === pack && r.sign_key === sign_key && r.content_hash === content_hash && r.reviewer_id === reviewer_id);
		if (hit) Object.assign(hit, { verdict, note, updated_at: ++db.seq });
		else db.reviews.push({ id: ++db.seq, pack, sign_key, content_hash, reviewer_id, verdict, note, updated_at: db.seq });
		return [];
	}
	if (q.startsWith('select count(*)::int as n from sign_reviewers')) {
		return [{ n: db.reviewers.filter((r) => r.pack === v[0] && active(r)).length }];
	}
	if (q.startsWith('insert into sign_reviewers')) {
		const [user_id, pack, display_name, credential_note, granted_by] = v;
		let row = db.reviewers.find((r) => r.user_id === user_id && r.pack === pack);
		if (row) Object.assign(row, { display_name, credential_note, granted_by, revoked_at: null });
		else db.reviewers.push((row = { user_id, pack, display_name, credential_note, granted_by, created_at: 'now', revoked_at: null }));
		return [row];
	}
	if (q.startsWith('update sign_reviewers set revoked_at')) {
		const row = db.reviewers.find((r) => r.user_id === v[0] && r.pack === v[1] && active(r));
		if (!row) return [];
		row.revoked_at = 'now';
		return [row];
	}
	if (q.startsWith('select id from users where id =')) return db.users.filter((u) => u.id === v[0]);
	if (q.startsWith('select id from users where lower(email)')) return db.users.filter((u) => u.email === v[0]);
	throw new Error(`unexpected query in test: ${q}`);
}

vi.mock('../api/_lib/db.js', () => ({
	sql: (...a) => fakeSql(...a),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authedReadIp: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: async () => principal.user }));
vi.mock('../api/_lib/admin.js', async () => {
	const { error } = await import('../api/_lib/http.js');
	return {
		isAdminUser: async (u) => Boolean(u) && principal.admin,
		requireAdmin: async (req, res) => {
			if (!principal.user) return error(res, 401, 'unauthorized', 'sign in required'), null;
			if (!principal.admin) return error(res, 403, 'forbidden', 'admin access required'), null;
			return principal.user;
		},
	};
});
vi.mock('../api/_lib/csrf.js', async () => {
	const { error } = await import('../api/_lib/http.js');
	return {
		requireCsrf: async (req, res) => {
			if (principal.csrf) return true;
			error(res, 403, 'csrf_missing', 'X-CSRF-Token header required');
			return false;
		},
	};
});

const { default: handler } = await import('../api/sign-review/[action].js');
const { default: FIXTURE } = await import('../src/sign-packs/review-fixture.js');
const { signContentHash } = await import('../src/sign-packs/hash.js');
const { compile } = await import('../api/sign.js');

const ADMIN = { id: '00000000-0000-4000-8000-00000000000a' };
const ANA = { id: '00000000-0000-4000-8000-0000000000a1', email: 'ana@example.test' };
const RADU = { id: '00000000-0000-4000-8000-0000000000a2', email: 'radu@example.test' };
const HELLO_HASH = signContentHash(FIXTURE.signs.HELLO);

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		headersSent: false,
		setHeader(k, val) { this._headers[k.toLowerCase()] = val; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		writeHead(s, h) { this.statusCode = s; Object.assign(this._headers, h || {}); return this; },
		end(b) { this._body = b || ''; this.headersSent = true; },
		get body() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

async function call(httpMethod, action, { query = '', body } = {}) {
	const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
	req.method = httpMethod;
	req.url = `/api/sign-review/${action}${query ? `?${query}` : ''}`;
	req.query = { action };
	req.headers = { host: 'localhost', origin: 'http://localhost:3000', 'content-type': 'application/json' };
	const res = mockRes();
	await handler(req, res);
	return { status: res.statusCode, body: res.body };
}

const as = (user, admin = false) => {
	principal.user = user;
	principal.admin = admin;
};

async function grant(user, pack = 'qfx') {
	as(ADMIN, true);
	return call('POST', 'reviewer', { body: { pack, email: user.email, display_name: `Reviewer ${user.email}` } });
}

beforeEach(() => {
	db.reviewers = [];
	db.reviews = [];
	db.users = [ADMIN, ANA, RADU];
	principal.csrf = true;
	as(null);
});

describe('who may do what', () => {
	it('lists packs under review to anyone, and grants only to the signed-in', async () => {
		const anon = await call('GET', 'packs');
		expect(anon.status).toBe(200);
		expect(anon.body.packs.map((p) => p.id)).toEqual(['qfx']);
		expect(anon.body.packs[0]).toMatchObject({ total: 6, required_approvals: 2, served: 0 });
		expect(anon.body).not.toHaveProperty('granted');

		await grant(ANA);
		as(ANA);
		const signedIn = await call('GET', 'packs');
		expect(signedIn.body.granted).toEqual(['qfx']);
		expect(signedIn.body.is_admin).toBe(false);
	});

	it('answers 401 to an anonymous queue and 403 not_a_reviewer to a signed-in stranger', async () => {
		expect((await call('GET', 'queue', { query: 'pack=qfx' })).status).toBe(401);
		as(RADU);
		const stranger = await call('GET', 'queue', { query: 'pack=qfx' });
		expect(stranger.status).toBe(403);
		expect(stranger.body.error).toBe('not_a_reviewer');
	});

	it('refuses a grant from a non-admin and an unknown pack or user', async () => {
		as(ANA);
		expect((await call('POST', 'reviewer', { body: { pack: 'qfx', email: ANA.email, display_name: 'Ana' } })).status).toBe(403);
		as(ADMIN, true);
		expect((await call('POST', 'reviewer', { body: { pack: 'rms', email: ANA.email, display_name: 'Ana' } })).status).toBe(404);
		const nobody = await call('POST', 'reviewer', { body: { pack: 'qfx', email: 'nobody@example.test', display_name: 'X' } });
		expect(nobody.body.error).toBe('unknown_user');
		const badId = await call('POST', 'reviewer', { body: { pack: 'qfx', user_id: 'not-a-uuid', display_name: 'X' } });
		expect(badId.status).toBe(400);
	});

	it('needs a CSRF token to record a verdict', async () => {
		await grant(ANA);
		as(ANA);
		principal.csrf = false;
		const res = await call('POST', 'review', { body: { pack: 'qfx', sign: 'HELLO', hash: HELLO_HASH, verdict: 'approve' } });
		expect(res.status).toBe(403);
		expect(db.reviews).toHaveLength(0);
	});

	it('does not offer the fixture pack when the fixture flag is off', async () => {
		delete process.env.SIGN_REVIEW_FIXTURE;
		try {
			expect((await call('GET', 'packs')).body.packs).toEqual([]);
			expect((await call('GET', 'status', { query: 'pack=qfx' })).status).toBe(404);
		} finally {
			process.env.SIGN_REVIEW_FIXTURE = '1';
		}
	});
});

describe('the review flow', () => {
	it('approves a sign only after two different reviewers approve its current content', async () => {
		await grant(ANA);
		await grant(RADU);

		as(ANA);
		const queue = await call('GET', 'queue', { query: 'pack=qfx' });
		expect(queue.body.items).toHaveLength(6);
		const hello = queue.body.items.find((i) => i.key === 'HELLO');
		expect(hello).toMatchObject({ hash: HELLO_HASH, state: 'unreviewed', approvals: 0, required: 2 });
		expect(hello.gloss).toBe(FIXTURE.signs.HELLO.gloss);
		expect(hello.sign).toEqual(FIXTURE.signs.HELLO);

		const first = await call('POST', 'review', { body: { pack: 'qfx', sign: 'hello', hash: HELLO_HASH, verdict: 'approve' } });
		expect(first.body).toMatchObject({ sign: 'HELLO', state: 'in_review', approvals: 1 });

		// Ana's queue drops HELLO; Radu still sees it.
		expect((await call('GET', 'queue', { query: 'pack=qfx' })).body.items.map((i) => i.key)).not.toContain('HELLO');
		// Ana approving again does not count twice.
		const again = await call('POST', 'review', { body: { pack: 'qfx', sign: 'HELLO', hash: HELLO_HASH, verdict: 'approve' } });
		expect(again.body.approvals).toBe(1);

		as(RADU);
		expect((await call('GET', 'queue', { query: 'pack=qfx' })).body.items.map((i) => i.key)).toContain('HELLO');
		const second = await call('POST', 'review', { body: { pack: 'qfx', sign: 'HELLO', hash: HELLO_HASH, verdict: 'approve' } });
		expect(second.body).toMatchObject({ state: 'approved', approvals: 2 });

		as(null);
		const status = await call('GET', 'status', { query: 'pack=qfx' });
		expect(status.body.counts).toEqual({ approved: 1, in_review: 0, needs_change: 0, rejected: 0, unreviewed: 5 });
		expect(status.body.reviewers).toBe(2);
		// Workspace approvals never reach serving until exported into the ledger.
		expect(status.body.pack.served).toBe(0);
		const served = compile({ text: 'hello', hand: 'right', speed: 1, max_seconds: 60, format: 'timeline' }, 'http://x', FIXTURE);
		expect(served.signed).toEqual([]);
		expect(served.unsupported).toEqual(['HELLO']);
	});

	it('refuses a verdict on content that changed since the reviewer loaded it', async () => {
		await grant(ANA);
		as(ANA);
		const stale = await call('POST', 'review', { body: { pack: 'qfx', sign: 'HELLO', hash: 'a'.repeat(64), verdict: 'approve' } });
		expect(stale.status).toBe(409);
		expect(stale.body.error).toBe('sign_changed');
		expect(db.reviews).toHaveLength(0);
	});

	it('holds a sign on a reject, and asks for a note when the verdict is not an approval', async () => {
		await grant(ANA);
		await grant(RADU);
		as(ANA);
		const noNote = await call('POST', 'review', { body: { pack: 'qfx', sign: 'YES', hash: signContentHash(FIXTURE.signs.YES), verdict: 'reject' } });
		expect(noNote.status).toBe(400);
		expect(noNote.body.error).toBe('note_required');
		await call('POST', 'review', { body: { pack: 'qfx', sign: 'YES', hash: signContentHash(FIXTURE.signs.YES), verdict: 'reject', note: 'The fist should nod from the wrist.' } });
		as(RADU);
		const second = await call('POST', 'review', { body: { pack: 'qfx', sign: 'YES', hash: signContentHash(FIXTURE.signs.YES), verdict: 'approve' } });
		expect(second.body.state).toBe('rejected');
	});

	it('rejects an unknown verdict or sign', async () => {
		await grant(ANA);
		as(ANA);
		expect((await call('POST', 'review', { body: { pack: 'qfx', sign: 'HELLO', hash: HELLO_HASH, verdict: 'maybe' } })).body.error).toBe('invalid_verdict');
		expect((await call('POST', 'review', { body: { pack: 'qfx', sign: 'NOPE', hash: HELLO_HASH, verdict: 'approve' } })).body.error).toBe('unknown_sign');
	});

	it('stops counting a revoked reviewer and closes their access', async () => {
		await grant(ANA);
		await grant(RADU);
		for (const u of [ANA, RADU]) {
			as(u);
			await call('POST', 'review', { body: { pack: 'qfx', sign: 'HELLO', hash: HELLO_HASH, verdict: 'approve' } });
		}
		as(ADMIN, true);
		const revoked = await call('POST', 'reviewer', { body: { pack: 'qfx', email: RADU.email, revoke: true } });
		expect(revoked.body.revoked).toBe(true);
		expect(db.reviews).toHaveLength(2);

		as(null);
		expect((await call('GET', 'status', { query: 'pack=qfx' })).body.counts.approved).toBe(0);
		as(RADU);
		expect((await call('GET', 'queue', { query: 'pack=qfx' })).status).toBe(403);
		as(ADMIN, true);
		expect((await call('POST', 'reviewer', { body: { pack: 'qfx', email: RADU.email, revoke: true } })).status).toBe(404);
	});

	it('answers 404 for an unknown action or pack', async () => {
		expect((await call('GET', 'nope')).status).toBe(404);
		expect((await call('GET', 'status', { query: 'pack=zzz' })).body.error).toBe('unknown_pack');
	});
});
