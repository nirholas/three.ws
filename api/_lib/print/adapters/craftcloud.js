// @ts-check
// The `craftcloud` fulfillment adapter: Craftcloud (All3DP), a public,
// unauthenticated v5 API in front of roughly 186 print and CNC shops.
//
// Verified live on 2026-10-13, no account or key required for any of the
// calls this adapter makes:
//   POST {CUSTOMER_API}/model/upload/initiate  {fileName, fileUnit}
//     -> 201 { uploadId, uploadUrl }            uploadUrl is a presigned S3 PUT
//   PUT  {uploadUrl}  <raw file bytes>           -> 200 from S3 directly
//   POST {CUSTOMER_API}/model/upload/confirm    {uploadId}
//     -> 201 [{ modelId, isParsing, dimensions, volume, ... }]
//   GET  {CUSTOMER_API}/model/{modelId}?refresh=false
//     -> 200 { ...same shape, isParsing: false once the mesh is analyzed }
//   POST {API}/v5/price  {currency, countryCode, models:[{modelId, quantity}]}
//     -> 201 { priceId }
//   GET  {API}/v5/price/{priceId}
//     -> 200 { allComplete, quotes:[...], shippings:[...], minimumProductionPrice }
//   POST {API}/v5/cart  {shippingIds, currency, quotes:[{id}], voucherCode?}
//     -> 201 { cartId, amounts, models, quotes, shippings, ... }
//
// `CUSTOMER_API` and `API` are two different hosts (reverse-engineered from
// Craftcloud's own production frontend bundle; their published OpenAPI spec at
// api.craftcloud3d.com/api-docs.json documents the API host's /v5/* routes but
// says nothing about model upload, which only exists on the customer-api host).
// Both answered every call above with wide-open CORS and no auth challenge,
// which is the API working as designed, not a gap we are exploiting.
//
// WHERE THIS STOPS, ON PURPOSE: creating an order (`POST /v5/order`) requires
// buyer shipping/billing and immediately exposes a payment step
// (`/v5/payment/{adyen,paypal,stripe,invoice}`). Calling that from here would
// make three.ws responsible for an actual charge, which is a spend the
// operating rules forbid an unattended build from making. This adapter goes
// exactly as far as reserving a cart (price locked, quote and shipping
// selected, voucher applied if one is configured) and hands the rest to a
// human: an operator opens the cart on Craftcloud and completes checkout.
// That is also why `status()` and `cancel()` do not poll an upstream order:
// there is no order yet, by design, until an operator makes one.
//
// REFERRAL VOUCHER: `POST/GET /v5/referral` both answered `401 Unauthorized`
// with no credentials attempted (verified 2026-10-13), meaning a voucher code
// belongs to a logged-in Craftcloud account, not a server API key. There is no
// way for this adapter to generate one. PRINT_CRAFTCLOUD_VOUCHER_CODE is read
// if an owner pastes a code in after creating that account by hand; absent it,
// carts are still created, just without the referral discount applied.
//
// MATERIAL CATALOG: Craftcloud has no "pick one material id" input on `submit`,
// because its network prices a model against its whole catalog at once and the
// cheapest real quote differs by part geometry. `fetchMaterialCatalog()` below
// fetches the same `{CUSTOMER_API}/material-catalog` their own frontend reads,
// for the UI to show human names (materialConfigId -> "SLS Nylon PA12 Standard
// (Solid White)") next to a quote. The adapter does not require it: it prices
// the whole catalog and takes the cheapest live quote, exactly like a buyer
// comparing shops by hand would.

import { AdapterUpstreamError } from './contract.js';
import { fetchUpstream, fetchUpstreamJson } from '../../upstream-fetch.js';

export const key = 'craftcloud';
export const label = 'Craftcloud (All3DP) global print network';

export const capabilities = Object.freeze({
	// Craftcloud routes to whichever of its ~186 shops can run the job; the
	// catalog's own largest declared envelope (FDM Nylon / Glass Fiber FDM
	// Nylon, material-catalog 2026-10-13) is the real ceiling, not a guess.
	materials: '*',
	maxBboxMm: { x: 1120, y: 720, z: 620 },
	shipsFrom: 'US',
	leadTimeDays: 14,
});

const API_BASE = (process.env.PRINT_CRAFTCLOUD_API_BASE || 'https://api.craftcloud3d.com').replace(/\/+$/, '');
const CUSTOMER_API_BASE = (process.env.PRINT_CRAFTCLOUD_CUSTOMER_API_BASE || 'https://customer-api.craftcloud3d.com').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 30_000;
const PRICE_POLL_TIMEOUT_MS = 45_000;
const PRICE_POLL_INTERVAL_MS = 2_000;
const PARSE_POLL_TIMEOUT_MS = 20_000;
const PARSE_POLL_INTERVAL_MS = 2_000;

/**
 * Craftcloud's core flow (upload, price, cart) takes no API key: it is public,
 * unauthenticated client use by design (wide-open CORS, verified 2026-10-13).
 * Always registered; there is no credential to be missing.
 */
export function configured() {
	return true;
}

/** @returns {string} the owner's referral voucher, or '' when none is configured */
export function voucherCode() {
	return (process.env.PRINT_CRAFTCLOUD_VOUCHER_CODE || '').trim();
}

/**
 * @param {string} base
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number }} [init]
 */
async function callJson(base, path, init = {}) {
	const { timeoutMs, ...rest } = init;
	try {
		return await fetchUpstreamJson(
			`${base}${path}`,
			{ ...rest, headers: { 'content-type': 'application/json', ...(rest.headers || {}) } },
			{ name: `print:${key}`, timeoutMs: timeoutMs ?? REQUEST_TIMEOUT_MS, attempts: 2 },
		);
	} catch (err) {
		throw new AdapterUpstreamError(key, `${path}: ${err?.message || String(err)}`, err?.status || 0);
	}
}

/**
 * Upload one file to Craftcloud: initiate, PUT the bytes to the presigned S3
 * URL it hands back, confirm. Returns the model record Craftcloud created,
 * which carries `modelId` and an `isParsing` flag that only becomes `false`
 * once the mesh has been analyzed server-side.
 * @param {Buffer} bytes
 * @param {string} fileName
 * @param {string} [fileUnit]
 */
export async function uploadModel(bytes, fileName, fileUnit = 'mm') {
	const initiate = await callJson(CUSTOMER_API_BASE, '/model/upload/initiate', {
		method: 'POST',
		body: JSON.stringify({ fileName, fileUnit }),
	});
	const uploadUrl = initiate?.uploadUrl;
	const uploadId = initiate?.uploadId;
	if (!uploadUrl || !uploadId) throw new AdapterUpstreamError(key, 'upload/initiate did not return an uploadId/uploadUrl');

	await fetchUpstream(
		uploadUrl,
		{ method: 'PUT', body: bytes },
		{ name: `print:${key}:s3`, timeoutMs: UPLOAD_TIMEOUT_MS, attempts: 2 },
	).catch((err) => {
		throw new AdapterUpstreamError(key, `uploading to the presigned S3 URL failed: ${err?.message || String(err)}`, err?.status || 0);
	});

	const confirmed = await callJson(CUSTOMER_API_BASE, '/model/upload/confirm', {
		method: 'POST',
		body: JSON.stringify({ uploadId }),
	});
	const model = Array.isArray(confirmed) ? confirmed[0] : confirmed;
	if (!model?.modelId) throw new AdapterUpstreamError(key, 'upload/confirm did not return a modelId');
	return model;
}

/**
 * Craftcloud parses dimensions/volume asynchronously after confirm. Poll until
 * `isParsing` clears so the price request below sees a real bounding box.
 * @param {string} modelId
 */
export async function pollModelParsed(modelId, { timeoutMs = PARSE_POLL_TIMEOUT_MS } = {}) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await callJson(CUSTOMER_API_BASE, `/model/${encodeURIComponent(modelId)}?refresh=false`);
		if (last?.isParsing === false) return last;
		await new Promise((r) => setTimeout(r, PARSE_POLL_INTERVAL_MS));
	}
	return last;
}

/**
 * Ask Craftcloud's whole vendor network for a price on an uploaded model, and
 * poll until every shop has answered (`allComplete`). Returns the full
 * `{ quotes, shippings, minimumProductionPrice }` the way their own frontend
 * reads it, so the caller can show every material/shop combination, not just
 * one the adapter picked.
 * @param {string} modelId
 * @param {{ currency?: string, countryCode?: string, quantity?: number }} [opts]
 */
export async function priceModel(modelId, opts = {}) {
	const { currency = 'USD', countryCode = 'US', quantity = 1 } = opts;
	const created = await callJson(API_BASE, '/v5/price', {
		method: 'POST',
		body: JSON.stringify({ currency, countryCode, models: [{ modelId, quantity }] }),
	});
	const priceId = created?.priceId;
	if (!priceId) throw new AdapterUpstreamError(key, 'price request did not return a priceId');

	const deadline = Date.now() + PRICE_POLL_TIMEOUT_MS;
	let last = null;
	while (Date.now() < deadline) {
		last = await callJson(API_BASE, `/v5/price/${encodeURIComponent(priceId)}`);
		if (last?.allComplete === true) return last;
		await new Promise((r) => setTimeout(r, PRICE_POLL_INTERVAL_MS));
	}
	if (!last || !Array.isArray(last.quotes) || last.quotes.length === 0) {
		throw new AdapterUpstreamError(key, 'Craftcloud returned no quotes before the price poll timed out');
	}
	return last; // partial but usable: some vendors answered, which is real data
}

/** The lowest-priced quote in a price result, by net price incl. VAT. */
export function cheapestQuote(priceResult) {
	const quotes = Array.isArray(priceResult?.quotes) ? priceResult.quotes : [];
	return quotes.reduce((best, q) => {
		const p = Number(q?.priceInclVat ?? q?.price);
		if (!Number.isFinite(p)) return best;
		if (!best || p < Number(best.priceInclVat ?? best.price)) return q;
		return best;
	}, null);
}

/** The cheapest shipping option Craftcloud offers for a given vendor. */
export function cheapestShippingFor(priceResult, vendorId) {
	const shippings = Array.isArray(priceResult?.shippings) ? priceResult.shippings : [];
	return shippings
		.filter((s) => s?.vendorId === vendorId)
		.reduce((best, s) => {
			const p = Number(s?.priceInclVat ?? s?.price);
			if (!Number.isFinite(p)) return best;
			if (!best || p < Number(best.priceInclVat ?? best.price)) return s;
			return best;
		}, null);
}

/**
 * Reserve a cart: one quote, its vendor's cheapest shipping, and the referral
 * voucher if one is configured. Nothing is charged by this call.
 * @param {{ quoteId: string, shippingId: string, currency: string, note?: string }} args
 */
export async function createCart({ quoteId, shippingId, currency, note }) {
	const body = {
		shippingIds: [shippingId],
		currency,
		quotes: [{ id: quoteId }],
	};
	if (note) body.note = String(note).slice(0, 1024);
	const code = voucherCode();
	if (code) body.voucherCode = code;
	return callJson(API_BASE, '/v5/cart', { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Fetch Craftcloud's material catalog (groups -> materials -> finish groups ->
 * materialConfigs), the same payload their own frontend caches for two hours.
 * `materialConfigId` here is the id a quote's `materialConfigId` refers to, so
 * the UI can show a human label next to a price. Cached in-process for the
 * same window Craftcloud's own frontend uses.
 * @param {string} [locale]
 */
export async function fetchMaterialCatalog(locale = 'en') {
	const now = Date.now();
	if (_catalogCache.body && now - _catalogCache.at < _CATALOG_TTL_MS && _catalogCache.locale === locale) {
		return _catalogCache.body;
	}
	const body = await callJson(CUSTOMER_API_BASE, `/material-catalog?locale=${encodeURIComponent(locale)}`, { timeoutMs: 20_000 });
	_catalogCache = { body, at: now, locale };
	return body;
}

const _CATALOG_TTL_MS = 2 * 60 * 60 * 1000; // matches Craftcloud's own frontend revalidate window
let _catalogCache = { body: null, at: 0, locale: '' };

/** Look up the human label for a quote's materialConfigId. Returns null if the catalog hasn't been fetched or the id is unknown. */
export function materialConfigLabel(catalog, materialConfigId) {
	for (const group of catalog?.materialStructure || []) {
		for (const material of group.materials || []) {
			for (const finish of material.finishGroups || []) {
				const found = (finish.materialConfigs || []).find((c) => c.id === materialConfigId);
				if (found) return found.name;
			}
		}
	}
	return null;
}

/**
 * Upload the order's STL, price it across Craftcloud's whole network, and
 * reserve a cart on the cheapest live quote. Stops there: placing the order
 * and paying for it is a human operator's step, done on Craftcloud directly.
 * @param {object} order
 * @param {{ stl?: string, '3mf'?: string, glb?: string }} [assets]
 */
export async function submit(order, assets = {}) {
	const stlUrl = assets?.stl;
	if (!stlUrl) throw new AdapterUpstreamError(key, 'no STL asset available to upload to Craftcloud');

	const fetched = await fetchUpstream(stlUrl, {}, { name: `print:${key}:asset`, timeoutMs: UPLOAD_TIMEOUT_MS, attempts: 2 }).catch((err) => {
		throw new AdapterUpstreamError(key, `could not fetch the order's STL to upload: ${err?.message || String(err)}`, err?.status || 0);
	});
	const bytes = Buffer.from(await fetched.arrayBuffer());
	const fileName = `${String(order?.id || 'model').replace(/[^a-zA-Z0-9_-]/g, '')}.stl`;

	let model = await uploadModel(bytes, fileName);
	if (model.isParsing) model = (await pollModelParsed(model.modelId)) || model;

	const currency = order?.currency || 'USD';
	const countryCode = order?.shipping?.country || 'US';
	const quantity = Number(order?.quantity) || 1;
	const priceResult = await priceModel(model.modelId, { currency, countryCode, quantity });

	const best = cheapestQuote(priceResult);
	if (!best) throw new AdapterUpstreamError(key, 'Craftcloud priced the model but returned no usable quote');
	const shipping = cheapestShippingFor(priceResult, best.vendorId);
	if (!shipping) throw new AdapterUpstreamError(key, `Craftcloud returned no shipping option for vendor '${best.vendorId}'`);

	const cart = await createCart({
		quoteId: best.quoteId,
		shippingId: shipping.shippingId,
		currency: best.currency || currency,
		note: `three.ws order ${order?.id || ''}`.trim(),
	});
	if (!cart?.cartId) throw new AdapterUpstreamError(key, 'cart creation did not return a cartId');

	const total = cart?.amounts?.total?.totalGrossPrice;
	return {
		providerOrderId: cart.cartId,
		status: 'submitted',
		leadTimeDays: capabilities.leadTimeDays,
		note: Number.isFinite(total)
			? `Reserved a Craftcloud cart at ${total} ${cart.currency || currency}. An operator completes checkout on Craftcloud to place and pay for the order.`
			: 'Reserved a Craftcloud cart. An operator completes checkout on Craftcloud to place and pay for the order.',
		state: { modelId: model.modelId, quote: best, shipping, cart },
	};
}

/**
 * Craftcloud's v5 API has no endpoint to read back an unpurchased cart. There
 * is deliberately no order yet (see the module header), so there is nothing
 * upstream to poll; `status: null` is the contract's own vocabulary for "no
 * news", which is the honest answer here.
 * @param {string} providerOrderId
 */
export async function status(providerOrderId) {
	return {
		status: null,
		note: `Cart ${providerOrderId} is reserved on Craftcloud; nothing to poll until an operator places the order there.`,
		state: { cartId: providerOrderId },
	};
}

/**
 * Nothing was charged by submit(), so there is nothing upstream to cancel: the
 * cart simply expires on Craftcloud's side (price results and carts carry
 * their own `expiresAt`). This tells the operator to stop before completing
 * checkout.
 * @param {object} order
 * @param {string} [reason]
 */
export async function cancel(order, reason = '') {
	return {
		ok: true,
		note: `Nothing was charged. Do not complete checkout for cart ${order?.provider_order_id || ''} on Craftcloud.${reason ? ` Reason: ${reason}` : ''}`,
		state: { cartId: order?.provider_order_id || '', reason },
	};
}

/**
 * Craftcloud's public v5 API has no webhook or callback mechanism (confirmed
 * against the full OpenAPI spec and their production frontend bundle,
 * 2026-10-13): there is nothing for this to verify. Refusing outright is the
 * only correct answer, exactly like the manual lane.
 */
export function verifyWebhook() {
	return { ok: false, deliveryId: '', reason: "Craftcloud's v5 API has no webhook or callback endpoint; status is read with status(), not pushed" };
}

/** Unreachable in practice (verifyWebhook always refuses), and says so. */
export function parseWebhook() {
	throw new Error('craftcloud adapter receives no webhooks');
}

export default {
	key,
	label,
	capabilities,
	configured,
	submit,
	status,
	cancel,
	verifyWebhook,
	parseWebhook,
	voucherCode,
	uploadModel,
	pollModelParsed,
	priceModel,
	cheapestQuote,
	cheapestShippingFor,
	createCart,
	fetchMaterialCatalog,
	materialConfigLabel,
};
