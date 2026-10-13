// The product + media half of the app: list a shop's products with their
// current media, stage-upload a GLB, and attach it to a product.
//
// Shopify auto-derives the USDZ iOS AR Quick Look asset from an uploaded GLB
// (shopify.dev/docs/apps/build/online-store/product-media: "Shopify serves
// models in both GLB (web) and USDZ (iOS AR) formats" from one uploaded file),
// so this app uploads exactly one MODEL_3D media entry per product rather
// than generating and attaching a second USDZ file itself: one upload, one
// GraphQL round trip, one thing that can fail instead of two.

import { adminGraphql, assertNoUserErrors, ShopifyApiError } from './graphql.js';

const PRODUCTS_QUERY = `
	query Products($first: Int!, $after: String) {
		products(first: $first, after: $after, sortKey: TITLE) {
			pageInfo { hasNextPage endCursor }
			nodes {
				id
				title
				images(first: 10) { nodes { id url altText } }
				media(first: 5) { nodes { mediaContentType } }
			}
		}
	}
`;

export async function listProducts(shop, accessToken, { first = 25, after = null } = {}) {
	const data = await adminGraphql(shop, accessToken, PRODUCTS_QUERY, { first, after });
	return {
		products: data.products.nodes.map((p) => ({
			id: p.id,
			title: p.title,
			images: p.images.nodes,
			has3dModel: p.media.nodes.some((m) => m.mediaContentType === 'MODEL_3D'),
		})),
		pageInfo: data.products.pageInfo,
	};
}

const STAGED_UPLOADS_CREATE = `
	mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
		stagedUploadsCreate(input: $input) {
			stagedTargets { url resourceUrl parameters { name value } }
			userErrors { field message }
		}
	}
`;

/**
 * Stages a GLB upload and PUTs the bytes, returning the resourceUrl
 * productCreateMedia needs as `originalSource`.
 */
export async function stageAndUploadGlb(shop, accessToken, { filename, bytes }) {
	const data = await adminGraphql(shop, accessToken, STAGED_UPLOADS_CREATE, {
		input: [
			{
				resource: 'MODEL_3D',
				filename,
				mimeType: 'model/gltf-binary',
				httpMethod: 'POST',
				fileSize: String(bytes.length),
			},
		],
	});
	assertNoUserErrors(data, 'stagedUploadsCreate');
	const target = data.stagedUploadsCreate.stagedTargets[0];
	if (!target) throw new ShopifyApiError('stagedUploadsCreate returned no target', { status: 502 });

	const form = new FormData();
	for (const { name, value } of target.parameters) form.append(name, value);
	form.append('file', new Blob([bytes], { type: 'model/gltf-binary' }), filename);

	const res = await fetch(target.url, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new ShopifyApiError(`staged upload to Shopify's storage returned ${res.status}: ${text.slice(0, 300)}`, {
			status: 502,
		});
	}
	return target.resourceUrl;
}

const PRODUCT_CREATE_MEDIA = `
	mutation productCreateMedia($media: [CreateMediaInput!]!, $productId: ID!) {
		productCreateMedia(media: $media, productId: $productId) {
			media { id alt mediaContentType status }
			mediaUserErrors { field message }
		}
	}
`;

export async function attachModel3d(shop, accessToken, { productId, resourceUrl, alt }) {
	const data = await adminGraphql(shop, accessToken, PRODUCT_CREATE_MEDIA, {
		productId,
		media: [{ originalSource: resourceUrl, mediaContentType: 'MODEL_3D', alt: alt || '3D model' }],
	});
	const errors = data.productCreateMedia.mediaUserErrors;
	if (Array.isArray(errors) && errors.length) {
		throw new ShopifyApiError(errors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; '), {
			status: 422,
			userErrors: errors,
		});
	}
	return data.productCreateMedia.media[0];
}
