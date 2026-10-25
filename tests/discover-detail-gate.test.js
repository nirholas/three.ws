// A token-gated avatar must not have its model URL baked into the public
// discover page. resolve.js withholds glbUrl until the gate is unlocked; the
// server-rendered detail shell must hold to the same promise.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { rows: [], gate: null };
vi.mock('../api/_lib/db.js', () => ({
	sql: async () => state.rows,
}));
vi.mock('../api/_lib/http.js', () => ({
	cors: () => false,
	method: () => true,
	wrap: (fn) => fn,
}));
vi.mock('../api/_lib/r2.js', () => ({
	publicUrl: (k) => `https://cdn.example.test/${k}`,
	thumbnailUrl: (k) => (k ? `https://cdn.example.test/${k}` : null),
}));
vi.mock('../api/_lib/env.js', () => ({ env: { APP_ORIGIN: 'https://app.example.test' } }));
vi.mock('../api/_lib/embed-gate.js', () => ({
	readEmbedGateByAsset: vi.fn(async () => state.gate),
}));

const { default: handler } = await import('../api/discover-detail.js');

const ID = '3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f';

function run() {
	return new Promise(async (resolve) => {
		const res = {
			headers: {},
			setHeader(k, v) {
				this.headers[k] = v;
			},
			end(body) {
				resolve(String(body));
			},
		};
		await handler({ method: 'GET', url: `/api/discover-detail?kind=avatar&id=${ID}`, headers: {} }, res);
	});
}

describe('discover-detail for gated avatars', () => {
	beforeEach(() => {
		state.rows = [
			{
				id: ID,
				slug: 's',
				name: 'Gated One',
				description: '',
				storage_key: 'secret-model-key.glb',
				thumbnail_key: 'thumb.png',
				tags: [],
				created_at: new Date(0).toISOString(),
				source: null,
				featured: false,
				view_count: 0,
			},
		];
		state.gate = null;
	});

	it('keeps the model URL for an ungated avatar', async () => {
		const html = await run();
		expect(html).toContain('secret-model-key.glb');
	});

	it('withholds the model URL and viewer link when a gate is active', async () => {
		state.gate = { id: 'g1', mint: 'x', min_amount: 1, chain: 'solana' };
		const html = await run();
		expect(html).toContain('Gated One');
		expect(html).not.toContain('secret-model-key.glb');
	});
});
