// GET /api/animations/clips/:id resolves an offloaded clip body from object
// storage. While the production R2 secret was rejected, every signed read came
// back `Unauthorized`, the GCS fallback only holds objects written during the
// outage, and this route answered `502 storage_error` for every clip stored
// before it (116 times in a day), although the same bytes stayed readable on the
// bucket's public domain, which /cdn and the avatar GLB route already fall back
// to. The permission and paywall gates run before the read, so reading through
// the public-tolerant helper changes where the bytes come from, never who may
// see them.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CLIP_ID = '0b3a9c6e-1f2d-4e5a-8b7c-9d0e1f2a3b4c';
const OWNER = '11111111-1111-4111-8111-111111111111';
const STORED = { name: 'wave', duration: 1, tracks: [] };
let row;

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => (row ? [row] : [])),
}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => null),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
	hasScope: vi.fn(() => false),
}));
vi.mock('../api/_lib/http.js', () => ({
	wrap: (fn) => fn,
	cors: () => false,
	method: () => true,
	readJson: async () => ({}),
	error: (res, status, code, message) => {
		res._json = { status, body: { error: code, error_description: message } };
		return res;
	},
	json: (res, status, body) => {
		res._json = { status, body };
		return res;
	},
}));
vi.mock('../api/_lib/r2.js', () => {
	const rejected = Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', $metadata: { httpStatusCode: 401 } });
	return {
		getObjectBuffer: vi.fn(async () => { throw rejected; }),
		getPublicObjectBuffer: vi.fn(async () => Buffer.from(JSON.stringify(STORED))),
		putObject: vi.fn(),
		thumbnailUrl: () => null,
	};
});

const { default: handler } = await import('../api/animations/[id].js');

async function get() {
	const res = { setHeader() {}, end() {}, statusCode: 200 };
	await handler({ method: 'GET', url: `/api/animations/clips/${CLIP_ID}?play=1`, headers: {}, query: { id: CLIP_ID } }, res);
	return res._json;
}

beforeEach(() => {
	row = {
		id: CLIP_ID, owner_id: OWNER, avatar_id: null, slug: 'wave', name: 'Wave', description: '',
		kind: 'animation', format: 'three-clip', duration_ms: 1000, frame_count: 30, fps: 30, loop: true,
		clip: null, storage_key: `u/${OWNER}/animations/clip-wave-1764000000000.json`, editor_doc: null,
		thumbnail_key: null, tags: [], visibility: 'public', price_amount: null, price_currency: null,
		listed: false, play_count: 0, purchase_count: 0, created_at: new Date(), updated_at: new Date(),
	};
});

describe('clip body read while the R2 credential is rejected', () => {
	it('serves the clip from the public-tolerant read instead of a 502', async () => {
		const out = await get();
		expect(out.status).toBe(200);
		expect(out.body.clip.clip).toBeTruthy();
	});

	it('still hides a private clip from a visitor before any storage read', async () => {
		row.visibility = 'private';
		const out = await get();
		expect(out.status).toBe(404);
	});
});
