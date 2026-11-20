import { describe, it, expect, vi, beforeEach } from 'vitest';

// Forge removal requests (issue #639): anyone can ask for a published model to
// come down; only a platform admin acts, and removing runs the full moderator
// delete. Pins validation, duplicate folding, the audit row for an off-form
// takedown, and the admin endpoint's gate.

const calls = [];
let responder = () => [];
const sqlMock = vi.fn(async (strings, ...values) => {
	const text = strings.join('?').replace(/\s+/g, ' ').trim();
	calls.push({ text, values });
	return responder(text, values);
});
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a), isDbUnavailableError: () => false }));
const alertMock = vi.fn(async () => {});
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: (...a) => alertMock(...a) }));

const auth = vi.fn();
vi.mock('../api/_lib/ops-auth.js', () => ({ authorizeOps: () => auth() }));
vi.mock('../api/_lib/admin-mfa.js', () => ({ respondMfaRequired: (res) => { res.statusCode = 403; res.end(JSON.stringify({ error: 'mfa_required' })); } }));
const deleteCreation = vi.fn();
vi.mock('../api/_lib/forge-store.js', () => ({ deleteCreation: (a) => deleteCreation(a) }));
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: async () => null }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { forgeRemovalWrite: async () => ({ success: true }), authedReadIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.9',
}));

const lib = await import('../api/_lib/forge-removal-requests.js');
const { default: publicHandler } = await import('../api/forge-removal-request.js');
const { default: adminHandler } = await import('../api/admin/forge-removals.js');

const CID = '301676f1-cddf-49f5-ab6e-351203c47d44';
const RID = 'a1b2c3d4-0000-4000-8000-000000000001';

function call(handler, { method = 'POST', url = '/', body, headers = {} } = {}) {
	return new Promise((resolve) => {
		const sent = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { sent[k.toLowerCase()] = v; },
			getHeader(k) { return sent[k.toLowerCase()]; },
			removeHeader(k) { delete sent[k.toLowerCase()]; },
			writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
			write() { return true; },
			end(out) { this.headersSent = true; resolve({ status: this.statusCode, body: out ? JSON.parse(String(out)) : null }); },
		};
		handler(
			{
				method,
				url,
				headers: { host: 'three.ws', 'content-type': 'application/json', ...headers },
				rawBody: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
				socket: { remoteAddress: '203.0.113.9' },
			},
			res,
		);
	});
}

beforeEach(() => {
	calls.length = 0;
	responder = () => [];
	sqlMock.mockClear();
	alertMock.mockClear();
	auth.mockReset();
	deleteCreation.mockReset();
});

describe('normalizeRemovalRequest', () => {
	it('accepts a maker asking for their own model without further detail', () => {
		expect(lib.normalizeRemovalRequest({ creation_id: CID.toUpperCase(), reason: 'my_content' })).toEqual({
			ok: true, creationId: CID, reason: 'my_content', details: null, contact: null,
		});
	});

	it('asks for details on every other reason, and rejects a bad id, reason or contact', () => {
		expect(lib.normalizeRemovalRequest({ creation_id: CID, reason: 'copyright' }).field).toBe('details');
		expect(lib.normalizeRemovalRequest({ creation_id: 'nope', reason: 'my_content' }).field).toBe('creation_id');
		expect(lib.normalizeRemovalRequest({ creation_id: CID, reason: 'because' }).field).toBe('reason');
		expect(lib.normalizeRemovalRequest({ creation_id: CID, reason: 'my_content', contact: 'not an email' }).field).toBe('contact');
	});
});

describe('POST /api/forge-removal-request', () => {
	it('files a request for an existing model and alerts ops', async () => {
		responder = (text) => {
			if (text.startsWith('select id, prompt')) return [{ id: CID, prompt: 'my character' }];
			if (text.startsWith('insert into forge_removal_requests')) return [{ id: RID, creation_id: CID, reason: 'my_content', status: 'open' }];
			return [];
		};
		const got = await call(publicHandler, { body: { creation_id: CID, reason: 'my_content', contact: 'me@example.com' } });
		expect(got.status).toBe(201);
		expect(got.body.id).toBe(RID);
		expect(alertMock).toHaveBeenCalledTimes(1);
		expect(alertMock.mock.calls[0][1]).toContain(`/m/${CID}`);
		const insert = calls.find((c) => c.text.startsWith('insert into forge_removal_requests'));
		expect(insert.values).not.toContain('203.0.113.9');
	});

	it('folds a repeat from the same person into the open request', async () => {
		responder = (text) => (text.startsWith('select id, prompt') ? [{ id: CID }] : []);
		const got = await call(publicHandler, { body: { creation_id: CID, reason: 'my_content' } });
		expect(got.status).toBe(200);
		expect(got.body.duplicate).toBe(true);
		expect(alertMock).not.toHaveBeenCalled();
	});

	it('answers 404 for a model that does not exist', async () => {
		const got = await call(publicHandler, { body: { creation_id: CID, reason: 'my_content' } });
		expect(got.status).toBe(404);
	});

	it('answers 400 with the field to fix before touching the database', async () => {
		const got = await call(publicHandler, { body: { creation_id: CID, reason: 'likeness' } });
		expect(got.status).toBe(400);
		expect(got.body.field).toBe('details');
		expect(sqlMock).not.toHaveBeenCalled();
	});
});

describe('/api/admin/forge-removals', () => {
	it('refuses a caller who is not an admin', async () => {
		auth.mockResolvedValue({ ok: false });
		const got = await call(adminHandler, { method: 'GET', url: '/api/admin/forge-removals' });
		expect(got.status).toBe(401);
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('removes the model with the moderator grant and closes the request', async () => {
		auth.mockResolvedValue({ ok: true, actor: 'user:admin' });
		deleteCreation.mockResolvedValue('deleted');
		responder = (text) => {
			if (text.startsWith('select id, creation_id, status')) return [{ id: RID, creation_id: CID, status: 'open' }];
			if (text.startsWith('select * from forge_removal_requests')) return [{ id: RID, creation_id: CID, status: 'removed' }];
			return [];
		};
		const got = await call(adminHandler, { body: { id: RID, action: 'remove', resolution: 'maker confirmed' } });
		expect(got.status).toBe(200);
		expect(deleteCreation).toHaveBeenCalledWith({ id: CID, moderator: true });
		expect(got.body.request.status).toBe('removed');
		expect(calls.some((c) => c.text.startsWith("update forge_removal_requests set status = 'removed'"))).toBe(true);
	});

	it('keeps the request open when the delete fails', async () => {
		auth.mockResolvedValue({ ok: true, actor: 'user:admin' });
		deleteCreation.mockResolvedValue('error');
		responder = (text) => (text.startsWith('select id, creation_id, status') ? [{ id: RID, creation_id: CID, status: 'open' }] : []);
		const got = await call(adminHandler, { body: { id: RID, action: 'remove', resolution: 'maker confirmed' } });
		expect(got.status).toBe(503);
		expect(calls.some((c) => c.text.startsWith('update forge_removal_requests'))).toBe(false);
	});

	it('requires a resolution before closing', async () => {
		auth.mockResolvedValue({ ok: true, actor: 'user:admin' });
		const got = await call(adminHandler, { body: { id: RID, action: 'dismiss' } });
		expect(got.status).toBe(400);
	});
});

describe('recordTakedown', () => {
	it('writes a closed audit row when the takedown came from outside the form', async () => {
		responder = (text) => (text.startsWith('insert into forge_removal_requests') ? [{ id: RID }] : []);
		const ids = await lib.recordTakedown({ creationId: CID, reason: 'my_content', details: 'GitHub issue #639', resolution: 'removed at maker request', reviewedBy: 'ops-cli' });
		expect(ids).toEqual([RID]);
		const insert = calls.find((c) => c.text.startsWith('insert into forge_removal_requests'));
		expect(insert.text).toContain("'removed'");
	});

	it('closes the open requests instead when someone already filed', async () => {
		responder = (text) => (text.startsWith('update forge_removal_requests') ? [{ id: RID }] : []);
		const ids = await lib.recordTakedown({ creationId: CID, resolution: 'removed', reviewedBy: 'ops-cli' });
		expect(ids).toEqual([RID]);
		expect(calls.some((c) => c.text.startsWith('insert'))).toBe(false);
	});
});
