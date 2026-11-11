import { describe, it, expect, vi, beforeEach } from 'vitest';

// PATCH /api/forge-creation?id=<uuid> { tags } is the owner tag editor on /m/<id>
// (work order 819). Only the forging browser or the account the model was forged
// under may edit; anyone else gets the same 404 a missing id gets, and a body that
// is not a short list of strings never reaches the store.

const owner = vi.fn();
const setOwnerTags = vi.fn();
const session = vi.fn();

vi.mock('../api/_lib/forge-store.js', () => ({
	forgeStoreEnabled: () => true,
	hashClient: (c) => `h:${c}`,
	isCreationOwner: (args) => owner(args),
	getPublicCreation: vi.fn(),
	listRelated: vi.fn(),
	recordCreationView: vi.fn(),
	deleteCreation: vi.fn(),
}));
vi.mock('../api/_lib/creation-descriptions.js', () => ({ setOwnerTags: (args) => setOwnerTags(args) }));
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: () => session() }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcp3dStatus: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));

const { default: handler } = await import('../api/forge-creation.js');

const ID = '0b7f2a52-6a3e-4f1c-9d55-1f4f8a2b9c10';

function patch(body, headers = {}) {
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
				method: 'PATCH',
				url: `/api/forge-creation?id=${ID}`,
				headers: { host: 'three.ws', 'content-type': 'application/json', ...headers },
				rawBody: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
				socket: { remoteAddress: '127.0.0.1' },
			},
			res,
		);
	});
}

beforeEach(() => {
	owner.mockReset();
	setOwnerTags.mockReset();
	session.mockReset();
	session.mockResolvedValue(null);
});

describe('PATCH /api/forge-creation tags', () => {
	it('answers 404 to a caller who does not own the creation, and stores nothing', async () => {
		owner.mockResolvedValue(false);
		const got = await patch({ tags: ['lantern'] }, { 'x-forge-client': 'someone-else' });
		expect(got.status).toBe(404);
		expect(owner).toHaveBeenCalledWith({ id: ID, clientKey: 'h:someone-else', userId: null });
		expect(setOwnerTags).not.toHaveBeenCalled();
	});

	it('accepts the signed-in account the model was forged under', async () => {
		session.mockResolvedValue({ id: 'user-1' });
		owner.mockResolvedValue(true);
		setOwnerTags.mockResolvedValue({ tags: ['lantern'], generatedTags: ['lantern', 'chimney'] });
		const got = await patch({ tags: ['Lantern'] });
		expect(owner).toHaveBeenCalledWith({ id: ID, clientKey: null, userId: 'user-1' });
		expect(got.status).toBe(200);
		expect(got.body).toEqual({ tags: ['lantern'], generatedTags: ['lantern', 'chimney'] });
		expect(setOwnerTags).toHaveBeenCalledWith({ creationId: ID, tags: ['Lantern'] });
	});

	it('lets the owner clear every tag with an empty list', async () => {
		owner.mockResolvedValue(true);
		setOwnerTags.mockResolvedValue({ tags: [], generatedTags: ['lantern'] });
		const got = await patch({ tags: [] }, { 'x-forge-client': 'mine' });
		expect(got.status).toBe(200);
		expect(got.body.tags).toEqual([]);
	});

	it.each([
		['no tags field', { names: ['x'] }],
		['tags not an array', { tags: 'lantern' }],
		['a non-string tag', { tags: ['lantern', 7] }],
		['more than 50 entries', { tags: Array.from({ length: 51 }, (_, i) => `tag${i}`) }],
		['invalid JSON', '{"tags": ['],
	])('rejects %s with 400 before touching the store', async (_label, body) => {
		owner.mockResolvedValue(true);
		const got = await patch(body, { 'x-forge-client': 'mine' });
		expect(got.status).toBe(400);
		expect(got.body.error).toBe('invalid_tags');
		expect(setOwnerTags).not.toHaveBeenCalled();
	});
});
