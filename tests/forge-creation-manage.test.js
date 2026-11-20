import { describe, it, expect, vi, beforeEach } from 'vitest';

// Issue #639: a Forge API caller who made a model without an x-forge-client id
// (or who lost it) had no way to delete it, and every headerless caller shared
// one 'anon' bucket. /api/forge-creation now takes any one owner credential
// (browser id, signed-in account, or the per-creation manage token the forge
// returned), never the anon bucket, and lets the owner change visibility.

const owner = vi.fn();
const del = vi.fn();
const setVis = vi.fn();
const session = vi.fn();
const publicCreation = vi.fn();

vi.mock('../api/_lib/forge-store.js', () => ({
	forgeStoreEnabled: () => true,
	hashClient: (c) => (c ? `h:${c}` : 'anon'),
	ownerClientKey: (k) => (k && k !== 'anon' ? k : null),
	CREATION_VISIBILITIES: ['public', 'unlisted', 'private'],
	isCreationOwner: (args) => owner(args),
	deleteCreation: (args) => del(args),
	setCreationVisibility: (args) => setVis(args),
	getPublicCreation: (args) => publicCreation(args),
	listRelated: vi.fn(async () => []),
	recordCreationView: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/creation-descriptions.js', () => ({ setOwnerTags: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: () => session() }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcp3dStatus: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));

const { default: handler } = await import('../api/forge-creation.js');

const ID = '301676f1-cddf-49f5-ab6e-351203c47d44';

function call(methodName, { body, headers = {} } = {}) {
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
			end(out) { this.headersSent = true; resolve({ status: this.statusCode, body: out ? JSON.parse(String(out)) : null, headers: sent }); },
		};
		handler(
			{
				method: methodName,
				url: `/api/forge-creation?id=${ID}`,
				headers: { host: 'three.ws', 'content-type': 'application/json', ...headers },
				rawBody: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
				socket: { remoteAddress: '127.0.0.1' },
			},
			res,
		);
	});
}

beforeEach(() => {
	for (const m of [owner, del, setVis, session, publicCreation]) m.mockReset();
	session.mockResolvedValue(null);
});

describe('DELETE /api/forge-creation', () => {
	it('deletes with the manage token alone, no client id needed', async () => {
		del.mockResolvedValue('deleted');
		const got = await call('DELETE', { headers: { 'x-forge-manage-token': 'fm1.abc.def' } });
		expect(got.status).toBe(200);
		expect(got.body).toEqual({ deleted: true });
		expect(del).toHaveBeenCalledWith({ id: ID, clientKey: null, userId: null, manageToken: 'fm1.abc.def' });
	});

	it('deletes for the signed-in account the model was forged under', async () => {
		session.mockResolvedValue({ id: 'user-1' });
		del.mockResolvedValue('deleted');
		const got = await call('DELETE');
		expect(got.status).toBe(200);
		expect(del).toHaveBeenCalledWith({ id: ID, clientKey: null, userId: 'user-1' });
	});

	it('still deletes with the forging browser id', async () => {
		del.mockResolvedValue('deleted');
		const got = await call('DELETE', { headers: { 'x-forge-client': 'cid-1' } });
		expect(got.status).toBe(200);
		expect(del).toHaveBeenCalledWith({ id: ID, clientKey: 'h:cid-1', userId: null });
	});

	it('answers 401 with a way forward when no credential is present, and never touches the store', async () => {
		const got = await call('DELETE');
		expect(got.status).toBe(401);
		expect(got.body.error).toBe('missing_credentials');
		expect(got.body.message).toMatch(/forge-removal-request/);
		expect(del).not.toHaveBeenCalled();
	});

	it('answers 404 for a creation the caller does not own', async () => {
		del.mockResolvedValue('not_found');
		const got = await call('DELETE', { headers: { 'x-forge-client': 'someone-else' } });
		expect(got.status).toBe(404);
	});
});

describe('PATCH /api/forge-creation visibility', () => {
	it('lets the owner unlist a model with the manage token', async () => {
		setVis.mockResolvedValue({ outcome: 'updated', visibility: 'unlisted' });
		const got = await call('PATCH', { body: { visibility: 'unlisted' }, headers: { 'x-forge-manage-token': 'fm1.abc.def' } });
		expect(got.status).toBe(200);
		expect(got.body).toEqual({ visibility: 'unlisted' });
		expect(setVis).toHaveBeenCalledWith({ id: ID, clientKey: null, userId: null, manageToken: 'fm1.abc.def', visibility: 'unlisted' });
	});

	it('rejects an unknown visibility before touching the store', async () => {
		const got = await call('PATCH', { body: { visibility: 'everyone' }, headers: { 'x-forge-client': 'cid-1' } });
		expect(got.status).toBe(400);
		expect(got.body.error).toBe('invalid_visibility');
		expect(setVis).not.toHaveBeenCalled();
	});

	it('answers 404 to a non-owner', async () => {
		setVis.mockResolvedValue({ outcome: 'not_found' });
		const got = await call('PATCH', { body: { visibility: 'private' }, headers: { 'x-forge-client': 'someone-else' } });
		expect(got.status).toBe(404);
	});

	// Listing a model publicly puts it in front of everyone, so someone has to
	// answer for it: a browser id or a manage token alone can hide a model, but
	// only a signed-in account can publish one.
	it('refuses to make a model public without a signed-in account', async () => {
		for (const headers of [{ 'x-forge-manage-token': 'fm1.abc.def' }, { 'x-forge-client': 'cid-1' }]) {
			const got = await call('PATCH', { body: { visibility: 'public' }, headers });
			expect(got.status).toBe(401);
			expect(got.body).toMatchObject({ error: 'sign_in_required', sign_in_url: '/login' });
			expect(got.body.message).toMatch(/Sign in to make a model public/);
		}
		expect(setVis).not.toHaveBeenCalled();
	});

	it('lets a signed-in owner make a model public', async () => {
		session.mockResolvedValue({ id: 'user-1' });
		setVis.mockResolvedValue({ outcome: 'pending' });
		const got = await call('PATCH', { body: { visibility: 'public' }, headers: { cookie: 'sid=1' } });
		expect(got.status).toBe(202);
		expect(setVis).toHaveBeenCalledWith({ id: ID, clientKey: null, userId: 'user-1', visibility: 'public' });
	});
});

describe('GET /api/forge-creation owner flag', () => {
	it('reports is_owner for the manage-token holder', async () => {
		publicCreation.mockResolvedValue({ id: ID, glb_url: 'https://three.ws/cdn/x.glb' });
		owner.mockResolvedValue(true);
		const got = await call('GET', { headers: { 'x-forge-manage-token': 'fm1.abc.def' } });
		expect(got.status).toBe(200);
		expect(got.body.creation.is_owner).toBe(true);
		expect(owner).toHaveBeenCalledWith({ id: ID, clientKey: null, userId: null, manageToken: 'fm1.abc.def' });
	});

	// Making a model private must not lock its maker out: they still need the
	// page to make it public again or delete it.
	it('serves a private model to its owner, uncached, so they can manage it', async () => {
		publicCreation.mockImplementation(async ({ includePrivate }) =>
			includePrivate ? { id: ID, glb_url: 'https://three.ws/cdn/x.glb', visibility: 'private' } : null,
		);
		owner.mockResolvedValue(true);
		const got = await call('GET', { headers: { 'x-forge-client': 'cid-1' } });
		expect(got.status).toBe(200);
		expect(got.body.creation.visibility).toBe('private');
		expect(got.body.creation.is_owner).toBe(true);
		expect(got.headers['cache-control']).toBe('private, no-store');
	});

	it('still answers 404 for a private model to anyone but its owner', async () => {
		publicCreation.mockImplementation(async ({ includePrivate }) =>
			includePrivate ? { id: ID, glb_url: 'https://three.ws/cdn/x.glb', visibility: 'private' } : null,
		);
		owner.mockResolvedValue(false);
		const got = await call('GET', { headers: { 'x-forge-client': 'someone-else' } });
		expect(got.status).toBe(404);
		expect(got.body.creation).toBeNull();
		const anon = await call('GET');
		expect(anon.status).toBe(404);
		expect(publicCreation).not.toHaveBeenCalledWith(expect.objectContaining({ includePrivate: true }));
	});

	it('never treats the anonymous public read as an owner, and skips the ownership query', async () => {
		publicCreation.mockResolvedValue({ id: ID, glb_url: 'https://three.ws/cdn/x.glb' });
		const got = await call('GET');
		expect(got.status).toBe(200);
		expect(got.body.creation.is_owner).toBe(false);
		expect(owner).not.toHaveBeenCalled();
		expect(session).not.toHaveBeenCalled();
	});
});
