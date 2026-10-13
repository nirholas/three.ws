// api/_lib/shopify/graphql.js, media.js, billing.js: the Admin GraphQL
// client and the two higher-level call shapes it backs (product media,
// usage billing), against a mocked fetch that returns Shopify-shaped
// responses. Asserts the exact request shape (endpoint, headers, variables)
// so a future refactor can't silently drop the access token or mis-shape a
// mutation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

process.env.SHOPIFY_API_KEY = 'test-api-key';
process.env.SHOPIFY_API_SECRET = 'test-api-secret';

const { adminGraphql, assertNoUserErrors, ShopifyApiError } = await import('../api/_lib/shopify/graphql.js');
const { listProducts, stageAndUploadGlb, attachModel3d } = await import('../api/_lib/shopify/media.js');
const { createUsageSubscription, fetchActiveSubscription, recordUsage } = await import(
	'../api/_lib/shopify/billing.js'
);

const SHOP = 'example.myshopify.com';
const TOKEN = 'offline-access-token';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
	return { ok, status, json: async () => body };
}

describe('adminGraphql', () => {
	let fetchSpy;
	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});
	afterEach(() => fetchSpy.mockRestore());

	it('posts to the versioned Admin API endpoint with the access token header', async () => {
		fetchSpy.mockResolvedValue(jsonResponse({ data: { ok: true } }));
		await adminGraphql(SHOP, TOKEN, 'query { shop { name } }', { a: 1 });

		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe(`https://${SHOP}/admin/api/2026-10/graphql.json`);
		expect(init.method).toBe('POST');
		expect(init.headers['x-shopify-access-token']).toBe(TOKEN);
		expect(JSON.parse(init.body)).toEqual({ query: 'query { shop { name } }', variables: { a: 1 } });
	});

	it('throws ShopifyApiError on a non-2xx response', async () => {
		fetchSpy.mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }));
		await expect(adminGraphql(SHOP, TOKEN, 'query {}')).rejects.toMatchObject({ status: 401 });
	});

	it('throws ShopifyApiError when the GraphQL body carries top-level errors', async () => {
		fetchSpy.mockResolvedValue(jsonResponse({ errors: [{ message: 'Throttled' }] }));
		await expect(adminGraphql(SHOP, TOKEN, 'query {}')).rejects.toBeInstanceOf(ShopifyApiError);
	});
});

describe('assertNoUserErrors', () => {
	it('is a no-op when userErrors is empty', () => {
		expect(() => assertNoUserErrors({ stagedUploadsCreate: { userErrors: [] } }, 'stagedUploadsCreate')).not.toThrow();
	});

	it('throws with the field path when userErrors is non-empty', () => {
		expect(() =>
			assertNoUserErrors(
				{ stagedUploadsCreate: { userErrors: [{ field: ['input', 'filename'], message: 'is required' }] } },
				'stagedUploadsCreate'
			)
		).toThrow(/filename: is required/);
	});
});

describe('listProducts', () => {
	let fetchSpy;
	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});
	afterEach(() => fetchSpy.mockRestore());

	it('maps products and computes has3dModel from existing media', async () => {
		fetchSpy.mockResolvedValue(
			jsonResponse({
				data: {
					products: {
						pageInfo: { hasNextPage: false, endCursor: null },
						nodes: [
							{
								id: 'gid://shopify/Product/1',
								title: 'Mug',
								images: { nodes: [{ id: 'img1', url: 'https://x/mug.jpg', altText: null }] },
								media: { nodes: [{ mediaContentType: 'IMAGE' }] },
							},
							{
								id: 'gid://shopify/Product/2',
								title: 'Lamp',
								images: { nodes: [] },
								media: { nodes: [{ mediaContentType: 'MODEL_3D' }] },
							},
						],
					},
				},
			})
		);

		const { products, pageInfo } = await listProducts(SHOP, TOKEN);
		expect(pageInfo).toEqual({ hasNextPage: false, endCursor: null });
		expect(products).toEqual([
			{ id: 'gid://shopify/Product/1', title: 'Mug', images: [{ id: 'img1', url: 'https://x/mug.jpg', altText: null }], has3dModel: false },
			{ id: 'gid://shopify/Product/2', title: 'Lamp', images: [], has3dModel: true },
		]);
	});
});

describe('stageAndUploadGlb', () => {
	let fetchSpy;
	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});
	afterEach(() => fetchSpy.mockRestore());

	it('stages the upload then PUTs the bytes, returning the resourceUrl', async () => {
		fetchSpy
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						stagedUploadsCreate: {
							stagedTargets: [
								{
									url: 'https://shopify-staged.example.com/upload',
									resourceUrl: 'https://shopify-staged.example.com/resource/abc',
									parameters: [{ name: 'key', value: 'uploads/abc.glb' }],
								},
							],
							userErrors: [],
						},
					},
				})
			)
			.mockResolvedValueOnce({ ok: true, text: async () => '' });

		const resourceUrl = await stageAndUploadGlb(SHOP, TOKEN, { filename: 'model.glb', bytes: Buffer.from('glb-bytes') });
		expect(resourceUrl).toBe('https://shopify-staged.example.com/resource/abc');

		const [stageUrl, stageInit] = fetchSpy.mock.calls[0];
		expect(stageUrl).toContain('/admin/api/2026-10/graphql.json');
		const stageVars = JSON.parse(stageInit.body).variables;
		expect(stageVars.input[0]).toMatchObject({ resource: 'MODEL_3D', filename: 'model.glb', mimeType: 'model/gltf-binary' });

		const [uploadUrl, uploadInit] = fetchSpy.mock.calls[1];
		expect(uploadUrl).toBe('https://shopify-staged.example.com/upload');
		expect(uploadInit.method).toBe('POST');
	});

	it('throws when Shopify storage rejects the upload', async () => {
		fetchSpy
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						stagedUploadsCreate: {
							stagedTargets: [{ url: 'https://shopify-staged.example.com/upload', resourceUrl: 'https://x/resource', parameters: [] }],
							userErrors: [],
						},
					},
				})
			)
			.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' });

		await expect(
			stageAndUploadGlb(SHOP, TOKEN, { filename: 'model.glb', bytes: Buffer.from('x') })
		).rejects.toBeInstanceOf(ShopifyApiError);
	});
});

describe('attachModel3d', () => {
	let fetchSpy;
	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});
	afterEach(() => fetchSpy.mockRestore());

	it('attaches with mediaContentType MODEL_3D and returns the created media', async () => {
		fetchSpy.mockResolvedValue(
			jsonResponse({
				data: {
					productCreateMedia: {
						media: [{ id: 'gid://shopify/MediaImage/9', alt: '3D model', mediaContentType: 'MODEL_3D', status: 'UPLOADED' }],
						mediaUserErrors: [],
					},
				},
			})
		);

		const media = await attachModel3d(SHOP, TOKEN, {
			productId: 'gid://shopify/Product/1',
			resourceUrl: 'https://shopify-staged.example.com/resource/abc',
			alt: 'Mug 3D model',
		});
		expect(media).toEqual({ id: 'gid://shopify/MediaImage/9', alt: '3D model', mediaContentType: 'MODEL_3D', status: 'UPLOADED' });

		const variables = JSON.parse(fetchSpy.mock.calls[0][1].body).variables;
		expect(variables.media[0]).toMatchObject({ originalSource: 'https://shopify-staged.example.com/resource/abc', mediaContentType: 'MODEL_3D' });
	});

	it('throws ShopifyApiError on mediaUserErrors', async () => {
		fetchSpy.mockResolvedValue(
			jsonResponse({
				data: {
					productCreateMedia: {
						media: [],
						mediaUserErrors: [{ field: ['media'], message: 'could not process the model' }],
					},
				},
			})
		);
		await expect(
			attachModel3d(SHOP, TOKEN, { productId: 'gid://shopify/Product/1', resourceUrl: 'https://x', alt: 'x' })
		).rejects.toBeInstanceOf(ShopifyApiError);
	});
});

describe('billing', () => {
	let fetchSpy;
	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});
	afterEach(() => fetchSpy.mockRestore());

	it('creates a usage subscription with the capped amount and confirmation URL', async () => {
		fetchSpy.mockResolvedValue(
			jsonResponse({
				data: {
					appSubscriptionCreate: {
						appSubscription: { id: 'gid://shopify/AppSubscription/1', lineItems: [{ id: 'gid://shopify/AppSubscriptionLineItem/1' }] },
						confirmationUrl: 'https://example.myshopify.com/admin/charges/1/confirm',
						userErrors: [],
					},
				},
			})
		);

		const result = await createUsageSubscription(SHOP, TOKEN, 'https://three.ws/api/shopify/billing/confirm');
		expect(result).toMatchObject({
			subscriptionId: 'gid://shopify/AppSubscription/1',
			lineItemId: 'gid://shopify/AppSubscriptionLineItem/1',
			confirmationUrl: 'https://example.myshopify.com/admin/charges/1/confirm',
		});

		const variables = JSON.parse(fetchSpy.mock.calls[0][1].body).variables;
		expect(variables.cappedAmount).toEqual({ amount: '100.00', currencyCode: 'USD' });
		expect(variables.returnUrl).toBe('https://three.ws/api/shopify/billing/confirm');
	});

	it('reads the active subscription or null when none exists', async () => {
		fetchSpy.mockResolvedValue(jsonResponse({ data: { currentAppInstallation: { activeSubscriptions: [] } } }));
		expect(await fetchActiveSubscription(SHOP, TOKEN)).toBeNull();

		fetchSpy.mockResolvedValue(
			jsonResponse({ data: { currentAppInstallation: { activeSubscriptions: [{ id: 'sub-1', status: 'ACTIVE', lineItems: [] }] } } })
		);
		expect(await fetchActiveSubscription(SHOP, TOKEN)).toMatchObject({ id: 'sub-1', status: 'ACTIVE' });
	});

	it('records usage priced at the configured per-conversion rate', async () => {
		fetchSpy.mockResolvedValue(
			jsonResponse({ data: { appUsageRecordCreate: { appUsageRecord: { id: 'gid://shopify/AppUsageRecord/1' }, userErrors: [] } } })
		);
		const id = await recordUsage(SHOP, TOKEN, { lineItemId: 'gid://shopify/AppSubscriptionLineItem/1', description: 'Mug converted' });
		expect(id).toBe('gid://shopify/AppUsageRecord/1');

		const variables = JSON.parse(fetchSpy.mock.calls[0][1].body).variables;
		expect(variables.price).toEqual({ amount: '0.49', currencyCode: 'USD' });
	});
});
