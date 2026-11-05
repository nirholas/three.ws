// GET /api/animations/clips/:id must hand back a clip that THREE.AnimationClip
// .parse() accepts as-is. Every published community clip was stored by the
// motion seed pipeline with `userData` as an object, and parse() runs
// JSON.parse on that field, so serving the stored body verbatim made every
// community preview on /animations fail and broke any embed that copies the
// documented `THREE.AnimationClip.parse(json)` snippet.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnimationClip } from 'three';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({
	sql: (...a) => sqlMock(...a),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => null,
	authenticateBearer: async () => null,
	extractBearer: () => null,
	hasScope: () => false,
}));

const getObjectBufferMock = vi.fn();
vi.mock('../api/_lib/r2.js', () => ({
	getObjectBuffer: (...a) => getObjectBufferMock(...a),
	thumbnailUrl: () => null,
	putObject: vi.fn(),
	publicUrl: () => null,
}));

const { default: handler } = await import('../api/animations/[id].js');
const { toThreeClipJSON } = await import('../api/animations/clips.js');

const ID = '345b05d0-f81e-4f6c-9df8-c3f73572716c';

const storedClip = {
	name: 'gen-wave-hello-71ed3f8f6a66',
	duration: 1,
	tracks: [
		{ name: 'Hips.quaternion', type: 'quaternion', times: [0, 1], values: [0, 0, 0, 1, 0, 0, 0, 1] },
	],
	uuid: 'c0ffee00-0000-4000-8000-000000000000',
	blendMode: 2500,
	userData: { source: 'text2motion', prompt_id: 'wave-hello', loop: false },
};

const row = (over = {}) => ({
	id: ID,
	owner_id: 'owner-1',
	avatar_id: null,
	slug: 'gen-wave-hello-71ed3f8f6a66',
	name: 'Wave Hello (take 3)',
	description: '',
	kind: 'animation',
	format: 'three.ws.animation.v1',
	duration_ms: 1000,
	frame_count: 2,
	fps: 30,
	loop: false,
	clip: null,
	storage_key: 'animations/library/clips/gen-wave-hello-71ed3f8f6a66.json',
	editor_doc: null,
	thumbnail_key: null,
	tags: ['wave'],
	visibility: 'public',
	price_amount: 0,
	price_currency: null,
	listed: true,
	play_count: 0,
	purchase_count: 0,
	created_at: new Date(0),
	updated_at: new Date(0),
	...over,
});

function mkReq(url) {
	return { method: 'GET', url, headers: {}, query: { id: ID }, on() {}, destroy() {} };
}

function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b;
			this.writableEnded = true;
		},
	};
}

beforeEach(() => {
	sqlMock.mockReset();
	getObjectBufferMock.mockReset();
});

describe('GET /api/animations/clips/:id', () => {
	it('serves an R2-offloaded seeded clip that AnimationClip.parse accepts', async () => {
		sqlMock.mockResolvedValue([row()]);
		getObjectBufferMock.mockResolvedValue(Buffer.from(JSON.stringify(storedClip)));
		const res = mkRes();
		await handler(mkReq(`/api/animations/clips/${ID}`), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(typeof body.clip.clip.userData).toBe('string');
		const parsed = AnimationClip.parse(body.clip.clip);
		expect(parsed.tracks).toHaveLength(1);
		expect(parsed.userData).toEqual(storedClip.userData);
	});

	it('serves an inline seeded clip that AnimationClip.parse accepts', async () => {
		sqlMock.mockResolvedValue([row({ clip: storedClip, storage_key: null })]);
		const res = mkRes();
		await handler(mkReq(`/api/animations/clips/${ID}`), res);
		expect(res.statusCode).toBe(200);
		expect(() => AnimationClip.parse(JSON.parse(res.body).clip.clip)).not.toThrow();
	});
});

describe('toThreeClipJSON', () => {
	it('stringifies object userData and leaves the rest of the clip alone', () => {
		const out = toThreeClipJSON(storedClip);
		expect(out.userData).toBe(JSON.stringify(storedClip.userData));
		expect(out.tracks).toBe(storedClip.tracks);
		expect(storedClip.userData).toEqual({ source: 'text2motion', prompt_id: 'wave-hello', loop: false });
	});

	it('passes string userData, missing userData and null clips through', () => {
		const str = { ...storedClip, userData: '{"a":1}' };
		expect(toThreeClipJSON(str)).toBe(str);
		const { userData: _drop, ...bare } = storedClip;
		expect(toThreeClipJSON(bare)).toBe(bare);
		expect(toThreeClipJSON(null)).toBe(null);
	});
});
