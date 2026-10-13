// POST /api/print/craftcloud-quote: live prices from Craftcloud's 186-shop
// network for a Forge model or any GLB, with no three.ws checkout involved.
//
// This is the "Get it printed" button, not Materialize. Materialize is our own
// print pipeline: we take payment in USDC, screen, submit to a fulfillment
// adapter and ship a certificate. "Get it printed" is the opposite: the model
// is uploaded straight to Craftcloud (All3DP), priced across whichever of
// their ~186 shops can run it, and the buyer pays Craftcloud directly on
// Craftcloud's own site. three.ws never touches the money.
//
// Craftcloud's v5 API has no endpoint that hands a server-created cart back to
// a browser for checkout (verified against their production frontend bundle,
// api/_lib/print/adapters/craftcloud.js), so there is no "continue to
// checkout" redirect here. The honest handoff is: show the real prices this
// upload got, then point the buyer at Craftcloud's own upload page with the
// exact STL already generated, so pasting it in reproduces the same prices in
// their own, authenticated session where checkout actually exists.

import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { getPublicCreation } from '../_lib/forge-store.js';
import { loadMeshFromUrl, MeshIoError } from '../_lib/print/mesh-io.js';
import { exportStl } from '../_lib/print/export-stl.js';
import { placeOnBed } from '../_lib/print/slicer.js';
import craftcloud from '../_lib/print/adapters/craftcloud.js';
import { AdapterContractError, AdapterUpstreamError } from '../_lib/print/adapters/contract.js';

const MESH_ERROR_STATUS = {
	invalid_model: 422,
	no_geometry: 422,
	too_large: 413,
	too_complex: 413,
	invalid_url: 400,
	fetch_failed: 502,
};

const CRAFTCLOUD_UPLOAD_PAGE = 'https://craftcloud3d.com/upload';
const MAX_QUOTES_RETURNED = 60;

function slug(text) {
	return (
		String(text || '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'model'
	);
}

async function resolveSource(body) {
	const creationId = typeof body.creationId === 'string' ? body.creationId.trim() : '';
	if (creationId) {
		const creation = await getPublicCreation({ id: creationId });
		if (!creation) return { error: { status: 404, code: 'creation_not_found', message: 'No finished public creation with that id.' } };
		if (!creation.glb_url) return { error: { status: 409, code: 'creation_has_no_model', message: 'That creation has no finished model to print yet.' } };
		return { url: creation.glb_url, title: creation.prompt };
	}
	const glbUrl = typeof body.glbUrl === 'string' ? body.glbUrl.trim() : '';
	if (!glbUrl) return { error: { status: 400, code: 'validation_error', message: 'Pass a creationId or a glbUrl to quote.' } };
	return { url: glbUrl, title: null };
}

/** Group a Craftcloud price result into one row per (vendor, material), cheapest shipping attached. */
function groupedQuotes(priceResult, catalog) {
	const quotes = Array.isArray(priceResult?.quotes) ? priceResult.quotes : [];
	const rows = quotes
		.map((q) => {
			const price = Number(q?.priceInclVat ?? q?.price);
			if (!Number.isFinite(price)) return null;
			const shipping = craftcloud.cheapestShippingFor(priceResult, q.vendorId);
			return {
				vendorId: q.vendorId,
				materialConfigId: q.materialConfigId,
				materialLabel: craftcloud.materialConfigLabel(catalog, q.materialConfigId) || q.materialConfigId,
				printingMethodId: q.printingMethodId,
				price,
				currency: q.currency,
				productionTimeDays: q.productionTimeFast ?? q.productionTimeSlow ?? null,
				shipping: shipping
					? { price: Number(shipping.priceInclVat ?? shipping.price), currency: shipping.currency, deliveryTime: shipping.deliveryTime, carrier: shipping.carrier || null }
					: null,
			};
		})
		.filter(Boolean)
		.sort((a, b) => a.price - b.price);
	return rows.slice(0, MAX_QUOTES_RETURNED);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rate = await limits.craftcloudQuoteIp(clientIp(req));
	if (!rate.success) return rateLimited(res, rate, 'too many Craftcloud quote requests');

	const body = await readJson(req, 8_000).catch(() => null);
	if (!body || typeof body !== 'object') return error(res, 400, 'validation_error', 'a JSON body is required');

	const source = await resolveSource(body);
	if (source.error) return error(res, source.error.status, source.error.code, source.error.message);

	const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'USD';
	const countryCode = typeof body.country === 'string' && /^[A-Z]{2}$/.test(body.country) ? body.country : 'US';
	const quantity = Number.isInteger(body.quantity) && body.quantity > 0 && body.quantity <= 100 ? body.quantity : 1;

	let mesh;
	try {
		mesh = await loadMeshFromUrl(source.url);
	} catch (err) {
		if (err instanceof MeshIoError) return error(res, MESH_ERROR_STATUS[err.code] ?? 422, err.code, err.message, err.extra || {});
		throw err;
	}

	const placed = placeOnBed(mesh.positions);
	const stlBytes = exportStl(
		{ positions: placed.positions, indices: mesh.indices, colors: mesh.colors },
		{ scale: 1, header: `three.ws ${slug(source.title)} mm ${placed.sizeMm.map((n) => n.toFixed(1)).join(' x ')}` },
	);
	const fileName = `${slug(source.title)}.stl`;

	let priceResult;
	let model;
	try {
		model = await craftcloud.uploadModel(stlBytes, fileName);
		if (model.isParsing) model = (await craftcloud.pollModelParsed(model.modelId)) || model;
		priceResult = await craftcloud.priceModel(model.modelId, { currency, countryCode, quantity });
	} catch (err) {
		if (err instanceof AdapterUpstreamError || err instanceof AdapterContractError) {
			return error(res, 502, 'craftcloud_unavailable', err.message);
		}
		throw err;
	}

	const catalog = await craftcloud.fetchMaterialCatalog().catch(() => null);
	const quotes = groupedQuotes(priceResult, catalog || { materialStructure: [] });
	const cheapest = quotes[0] || null;

	return json(
		res,
		200,
		{
			modelId: model.modelId,
			currency,
			countryCode,
			quantity,
			vendorCount: new Set(quotes.map((q) => q.vendorId)).size,
			quoteCount: quotes.length,
			minimumProductionPrice: priceResult.minimumProductionPrice ?? null,
			allComplete: priceResult.allComplete === true,
			expiresAt: priceResult.expiresAt ?? null,
			quotes,
			cheapest,
			voucherApplied: Boolean(craftcloud.voucherCode()),
			// Craftcloud's API has no buyer-facing checkout URL for a server-created
			// cart, so the handoff is a direct link to Craftcloud's own upload page
			// plus the exact STL file this quote used: pasting it there reproduces
			// these prices in the buyer's own session, where checkout exists.
			checkoutUrl: null,
			uploadPageUrl: CRAFTCLOUD_UPLOAD_PAGE,
			stlFileName: fileName,
		},
		{ 'cache-control': 'no-store' },
	);
});
