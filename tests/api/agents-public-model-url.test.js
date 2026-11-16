// GET /api/agents/public must hand browsers an avatar_model_url they can load.
//
// Regression: the bucket's public *.r2.dev domain stopped serving (Cloudflare
// answers 404 "Public access" for every key), yet avatar_model_url was built
// with publicUrlOrNull() and pointed at that domain. On 2026-11-16, 28 of the
// first 50 agents in production carried a dead model URL, so the directory,
// the Teams tab and the desktop campus could not load their 3D bodies. The
// same objects answer 200 through the first-party /cdn/<key> proxy.
//
// Real r2.js with env stubbed; the database returns two real-shaped rows: a
// bucket key, and a legacy storage_key that holds an absolute r2.dev URL.

import { describe, it, expect, vi, beforeAll } from 'vitest';

const DEAD_PUBLIC_DOMAIN = 'https://pub-0000000000000000000000000000test.r2.dev';

beforeAll(() => {
	Object.assign(process.env, {
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: DEAD_PUBLIC_DOMAIN,
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
		PUBLIC_APP_ORIGIN: 'https://three.ws',
	});
});

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));

const row = (id, storageKey) => ({
	id,
	name: `Agent ${id.slice(0, 4)}`,
	description: null,
	skills: [],
	home_url: null,
	chat_count: 3,
	created_at: '2026-07-01T00:00:00.000Z',
	meta: {},
	erc8004_agent_id: null,
	chain_id: null,
	avatar_thumbnail_key: 'u/1/thumb.png',
	avatar_storage_key: storageKey,
	avatar_visibility: 'public',
});

const ROWS = [
	row('27a0f649-3b59-4552-bb0b-faf616ac448b', 'u/68690bbe/craft-eb39f4.glb'),
	row('9d1c2e0a-5b7f-4c3e-8a21-0f6b4d2c9e11', `${DEAD_PUBLIC_DOMAIN}/forge/a5beaca37804/c3093d37.glb`),
];

vi.mock('../../api/_lib/db.js', () => ({
	sql: () => Promise.resolve(ROWS),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; this.writableEnded = true; },
	};
}

describe('GET /api/agents/public avatar_model_url', () => {
	it('serves every bucket-backed body through /cdn/, never the raw bucket domain', async () => {
		const { default: handler } = await import('../../api/agents/public.js');
		const res = makeRes();
		await handler({ url: '/api/agents/public?sort=popular&limit=5', method: 'GET', headers: { host: 'three.ws' } }, res);
		expect(res.statusCode).toBe(200);
		const urls = JSON.parse(res._body).agents.map((a) => a.avatar_model_url);
		expect(urls).toEqual([
			'https://three.ws/cdn/u/68690bbe/craft-eb39f4.glb',
			'https://three.ws/cdn/forge/a5beaca37804/c3093d37.glb',
		]);
	});
});
