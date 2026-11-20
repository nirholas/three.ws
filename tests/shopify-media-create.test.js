// POST /api/shopify/media/create starts a Forge image-to-3D job for a merchant's
// product photo. The merchant has no three.ws account; the Shopify app is the
// accountable party, so the job runs as an on-behalf platform job: unlisted, out
// of the public showcase, never a public showcase seed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../api/_lib/shopify/auth-request.js', () => ({
	RequestAuthError: class RequestAuthError extends Error {},
	authenticateEmbeddedRequest: vi.fn(async () => ({ shop: 'synthetic-shop.myshopify.com' })),
}));
vi.mock('../api/_lib/shopify/store.js', () => ({
	createMediaJob: vi.fn(async () => 'media-1'),
	setMediaJobForgeId: vi.fn(async () => {}),
	setMediaJobFailed: vi.fn(async () => {}),
}));
vi.mock('../api/_mcp-studio/forge-client.js', () => ({
	originFromReq: () => 'https://three.ws',
	startForge: vi.fn(async () => ({ status: 'pending', job_id: 'f1.shopify.job' })),
}));

const { startForge } = await import('../api/_mcp-studio/forge-client.js');
const { default: handler } = await import('../api/shopify/media/create.js');

function makeReq(body) {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]);
	req.method = 'POST';
	req.url = '/api/shopify/media/create';
	req.headers = { 'content-type': 'application/json', authorization: 'Bearer shopify-session' };
	return req;
}
function makeRes() {
	return {
		statusCode: 200, _body: '', _headers: {},
		setHeader(k, v) { this._headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this._headers[String(k).toLowerCase()]; },
		end(b) { this._body = b ? String(b) : ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/shopify/media/create', () => {
	it('submits the product photo as an unlisted on-behalf platform job', async () => {
		vi.stubEnv('CRON_SECRET', 'shop-secret');
		const res = makeRes();
		await handler(makeReq({ productId: 'gid://shopify/Product/1', productTitle: 'Mug', imageUrl: 'https://cdn.example.com/mug.jpg' }), res);
		expect(res.statusCode).toBe(202);
		expect(res.json).toMatchObject({ jobId: 'media-1', forgeJobId: 'f1.shopify.job' });
		const args = startForge.mock.calls[0][1];
		expect(args.imageUrls).toEqual(['https://cdn.example.com/mug.jpg']);
		expect(args.auth).toEqual({ 'x-forge-seed': 'shop-secret', 'x-forge-on-behalf': '1' });
	});
});
