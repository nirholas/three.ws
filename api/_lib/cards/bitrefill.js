// Bitrefill card adapter: gift cards for major merchants and prepaid Visa and
// Mastercard cards, settled in USDC on Solana.
//
// Why this provider: API-first (REST v2 at api.bitrefill.com), a price-locked
// USDC-on-Solana invoice per purchase (payment method `usdc_solana`, so an
// agent wallet pays with a plain SPL transfer to the invoice address), a real
// catalog of gift cards plus the `payment-cards` category of prepaid cards,
// and free test products for a sandbox that runs against the real API.
//
// Modes
//   sandbox  Bitrefill's own test products (ids starting `test-`). Paid from
//            the account balance with auto-pay, which the provider does not
//            charge for test products. No agent funds move.
//   live     any real product. The quote creates an unpaid `usdc_solana`
//            invoice; the service pays it from the agent wallet.
//
// Credential: BITREFILL_API_KEY (Personal API key, Bearer auth).
// Docs: https://docs.bitrefill.com/docs/api-overview

import { CardProviderError } from './provider.js';

const BASE_URL = 'https://api.bitrefill.com/v2';
const IMAGE_BASE = 'https://res.cloudinary.com/bitrefill/image/upload/c_pad,h_160,w_240,f_auto/';
const TIMEOUT_MS = 20_000;
const USDC_DECIMALS = 6;
const PREPAID_CATEGORY = 'payment-cards';

// Bitrefill order status -> the adapter contract's normalized status.
const ORDER_STATUS = {
	created: 'awaiting_payment',
	payment_detected: 'processing',
	payment_confirmed: 'processing',
	processing: 'processing',
	pending: 'processing',
	delivered: 'delivered',
	failed: 'failed',
	permanent_failure: 'failed',
	refunded: 'refunded',
	blocked: 'needs_verification',
	denied: 'failed',
	payment_error: 'failed',
};

const SECRET_FIELDS = ['code', 'pin', 'link', 'barcode_value'];

export function isSandboxProductId(id) {
	return typeof id === 'string' && id.startsWith('test-');
}

function imageUrl(image) {
	if (!image || typeof image !== 'string') return null;
	if (/^https?:\/\//.test(image)) return image;
	return `${IMAGE_BASE}${encodeURIComponent(image).replace(/%2F/g, '/')}`;
}

function kindOf(p) {
	return Array.isArray(p?.categories) && p.categories.includes(PREPAID_CATEGORY) ? 'prepaid_card' : 'gift_card';
}

/** Normalize one Bitrefill product into the adapter's product shape. */
export function normalizeProduct(p) {
	const packages = (Array.isArray(p.packages) ? p.packages : [])
		.map((pk) => ({
			id: String(pk.id ?? pk.package_id ?? ''),
			value: Number(pk.amount ?? pk.value),
		}))
		.filter((pk) => pk.id && Number.isFinite(pk.value) && pk.value > 0)
		.sort((a, b) => a.value - b.value);
	const r = p.range && typeof p.range === 'object' ? p.range : null;
	return {
		id: String(p.id),
		name: String(p.name || p.id),
		merchant: String(p.base_name || p.name || p.id),
		kind: kindOf(p),
		country_code: p.country_code || null,
		country_name: p.country_name || null,
		currency: String(p.currency || 'USD'),
		categories: Array.isArray(p.categories) ? p.categories : [],
		redemption_methods: Array.isArray(p.redemption_methods) ? p.redemption_methods : [],
		image_url: imageUrl(p.image),
		in_stock: p.in_stock !== false,
		sandbox: isSandboxProductId(p.id),
		packages,
		range: r && Number.isFinite(Number(r.min)) && Number.isFinite(Number(r.max))
			? { min: Number(r.min), max: Number(r.max), step: Number(r.step) || 0.01 }
			: null,
		terms: typeof p.termsAndConditions === 'string' ? p.termsAndConditions.slice(0, 2000) : null,
	};
}

/**
 * Resolve a requested face value against a product's packages and range.
 * Returns `{ value, packageId }` or throws invalid_amount naming what is allowed.
 */
export function resolveDenomination(product, amount) {
	const v = Number(amount);
	if (!Number.isFinite(v) || v <= 0) {
		throw new CardProviderError('invalid_amount', 'amount must be a positive number');
	}
	const pkg = product.packages.find((pk) => Math.abs(pk.value - v) < 1e-9);
	if (pkg) return { value: pkg.value, packageId: pkg.id };
	const r = product.range;
	if (r && v >= r.min - 1e-9 && v <= r.max + 1e-9) {
		const steps = (v - r.min) / r.step;
		if (Math.abs(steps - Math.round(steps)) < 1e-6) return { value: v, packageId: null };
	}
	const allowed = product.packages.map((pk) => pk.value);
	const rangeText = r ? `any value from ${r.min} to ${r.max} in steps of ${r.step}` : null;
	throw new CardProviderError(
		'invalid_amount',
		`${product.name} does not sell a ${v} ${product.currency} card. Choose ${[
			allowed.length ? `one of ${allowed.join(', ')}` : null,
			rangeText,
		].filter(Boolean).join(', or ')}.`,
		{ detail: { packages: allowed, range: r } },
	);
}

function firstOrder(invoice) {
	return Array.isArray(invoice?.orders) && invoice.orders.length ? invoice.orders[0] : null;
}

function normalizeStatus(invoice, order) {
	const s = order?.status ? ORDER_STATUS[order.status] : null;
	if (s) return s;
	const inv = invoice?.status ? ORDER_STATUS[invoice.status] : null;
	return inv || 'processing';
}

/** Mask a redemption value: keep only its last four characters. */
export function maskSecret(value) {
	const s = String(value ?? '').replace(/\s+/g, '');
	if (!s) return null;
	if (/^https?:\/\//i.test(s)) return 'Redemption link';
	const tail = s.slice(-4);
	return `•••• ${tail}`;
}

/** Split Bitrefill redemption_info into the secret part and the public part. */
export function splitRedemption(info) {
	const r = info && typeof info === 'object' ? info : {};
	const secret = {};
	for (const k of SECRET_FIELDS) {
		if (r[k] != null && String(r[k]).trim() !== '') secret[k] = String(r[k]);
	}
	const extra = r.extra_fields && typeof r.extra_fields === 'object' ? r.extra_fields : {};
	for (const [k, v] of Object.entries(extra)) {
		if (v != null && String(v).trim() !== '') secret[`extra_${k}`] = String(v);
	}
	const primary = secret.code ?? secret.link ?? secret.barcode_value ?? null;
	return {
		secret,
		fields: Object.keys(secret),
		masked: maskSecret(primary),
		instructions: typeof r.instructions === 'string' ? r.instructions.slice(0, 2000) : null,
		expires_on: r.expiration_date ? String(r.expiration_date) : null,
	};
}

/**
 * @param {object} [opts]
 * @param {string} [opts.apiKey]      defaults to BITREFILL_API_KEY
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string} [opts.baseUrl]
 */
export function createBitrefillProvider({ apiKey, fetchImpl, baseUrl = BASE_URL } = {}) {
	const doFetch = fetchImpl || ((...a) => fetch(...a));
	const key = () => apiKey ?? process.env.BITREFILL_API_KEY ?? '';

	async function call(path, { method = 'GET', body, query } = {}) {
		const k = key();
		if (!k) {
			throw new CardProviderError('not_configured', 'Card purchases are not configured on this server (BITREFILL_API_KEY is missing).');
		}
		const url = new URL(baseUrl + path);
		for (const [q, v] of Object.entries(query || {})) {
			if (v !== undefined && v !== null && v !== '') url.searchParams.set(q, String(v));
		}
		let res;
		try {
			res = await doFetch(url.toString(), {
				method,
				headers: {
					authorization: `Bearer ${k}`,
					accept: 'application/json',
					...(body ? { 'content-type': 'application/json' } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch (e) {
			throw new CardProviderError('upstream', 'The card provider did not respond. Try again in a moment.', {
				detail: { reason: e?.name === 'TimeoutError' ? 'timeout' : 'network' },
			});
		}
		let payload = null;
		try {
			payload = await res.json();
		} catch {
			payload = null;
		}
		if (res.status === 429) {
			throw new CardProviderError('rate_limited', 'The card provider is rate limiting requests. Try again in a minute.');
		}
		if (res.status === 401 || res.status === 403) {
			throw new CardProviderError('not_configured', 'The card provider rejected this server\'s credential.', { status: 503 });
		}
		const code = payload?.error_code;
		if (!res.ok || code) {
			const message = typeof payload?.message === 'string' ? payload.message.slice(0, 300) : `card provider error (HTTP ${res.status})`;
			if (code === 'not_found' || res.status === 404) throw new CardProviderError('not_found', message);
			if (code === 'out_of_stock') throw new CardProviderError('out_of_stock', message);
			if (['wrong_value', 'invalid_value', 'invalid_package_id', 'invalid_param', 'missing_param'].includes(code)) {
				throw new CardProviderError('invalid_amount', message);
			}
			throw new CardProviderError('upstream', message, { detail: { provider_code: code || null, http: res.status } });
		}
		return payload;
	}

	async function getProduct(productId) {
		const id = String(productId || '').trim();
		if (!id || id.length > 200) throw new CardProviderError('not_found', 'product id is required');
		const payload = await call(`/products/${encodeURIComponent(id)}`);
		if (!payload?.data) throw new CardProviderError('not_found', 'product not found');
		return normalizeProduct(payload.data);
	}

	async function searchProducts({ q, country, category, merchant, kind, sandbox = false, limit = 24, start = 0 } = {}) {
		const lim = Math.min(50, Math.max(1, Number(limit) || 24));
		const query = typeof q === 'string' ? q.trim().slice(0, 100) : '';
		const cat = kind === 'prepaid_card' ? PREPAID_CATEGORY : (category || undefined);
		let payload;
		if (query || sandbox) {
			payload = await call('/products/search', {
				query: {
					q: query || 'test',
					limit: sandbox ? 50 : lim,
					start: Number(start) || 0,
					include_test_products: sandbox ? 'true' : undefined,
				},
			});
		} else {
			payload = await call('/products', {
				query: { country: country || undefined, category: cat, limit: lim, start: Number(start) || 0 },
			});
		}
		let items = (Array.isArray(payload?.data) ? payload.data : []).map(normalizeProduct);
		if (sandbox) items = items.filter((p) => p.sandbox && !p.id.endsWith('-fail') && !p.categories.includes('esim'));
		if (country) items = items.filter((p) => !p.country_code || p.country_code === country.toUpperCase());
		if (cat && (query || sandbox)) items = items.filter((p) => p.categories.includes(cat));
		if (kind === 'gift_card') items = items.filter((p) => p.kind === 'gift_card');
		if (merchant) {
			const m = String(merchant).toLowerCase();
			items = items.filter((p) => p.merchant.toLowerCase() === m);
		}
		const total = Number(payload?.meta?.total_results ?? payload?.meta?.total ?? items.length);
		return {
			items: items.slice(0, lim),
			total,
			has_more: Boolean(payload?.meta?._next),
			next_start: payload?.meta?._next ? (Number(start) || 0) + lim : null,
		};
	}

	async function searchMerchants(opts = {}) {
		const { items, total, has_more } = await searchProducts({ ...opts, limit: 50 });
		const byMerchant = new Map();
		for (const p of items) {
			const k = p.merchant.toLowerCase();
			const m = byMerchant.get(k) || {
				name: p.merchant,
				kind: p.kind,
				image_url: p.image_url,
				categories: new Set(),
				countries: new Set(),
				product_count: 0,
				sandbox: p.sandbox,
			};
			m.product_count += 1;
			p.categories.forEach((c) => m.categories.add(c));
			if (p.country_code) m.countries.add(p.country_code);
			byMerchant.set(k, m);
		}
		const lim = Math.min(50, Math.max(1, Number(opts.limit) || 24));
		return {
			items: [...byMerchant.values()].slice(0, lim).map((m) => ({
				...m,
				categories: [...m.categories],
				countries: [...m.countries].sort(),
			})),
			total_products: total,
			has_more,
		};
	}

	/**
	 * Create the provider invoice that locks the price.
	 * @returns normalized quote with the exact USDC amount (atomic) and address.
	 */
	async function quote({ product, value, packageId, mode, refundAddress }) {
		const item = { product_id: product.id, quantity: 1 };
		if (packageId) item.package_id = packageId;
		else item.value = value;
		const body = mode === 'sandbox'
			? { products: [item], payment_method: 'balance', auto_pay: false }
			: {
				products: [item],
				payment_method: 'usdc_solana',
				...(refundAddress ? { refund_address: refundAddress } : {}),
			};
		const payload = await call('/invoices', { method: 'POST', body });
		const inv = payload?.data;
		const order = firstOrder(inv);
		if (!inv?.id || !order?.id) throw new CardProviderError('upstream', 'the card provider returned an incomplete invoice');
		if (mode === 'sandbox') {
			return {
				provider_invoice_id: String(inv.id),
				provider_order_id: String(order.id),
				pay_address: null,
				total_atomic: 0n,
				total_usdc: 0,
				fee_usdc: 0,
				provider_status: order.status || inv.status || null,
			};
		}
		const pay = inv.payment || {};
		if (pay.currency !== 'USDC' || !pay.address || !Number.isFinite(Number(pay.price))) {
			throw new CardProviderError('upstream', 'the card provider did not return a USDC payment request');
		}
		const totalAtomic = BigInt(Math.round(Number(pay.price)));
		const totalUsdc = Number(totalAtomic) / 10 ** USDC_DECIMALS;
		return {
			provider_invoice_id: String(inv.id),
			provider_order_id: String(order.id),
			pay_address: String(pay.address),
			total_atomic: totalAtomic,
			total_usdc: totalUsdc,
			fee_usdc: Math.max(0, Number((totalUsdc - Number(value)).toFixed(6))),
			provider_status: order.status || inv.status || null,
		};
	}

	/** Read an invoice's payment request so the service can re-verify it before paying. */
	async function paymentRequest(invoiceId) {
		const payload = await call(`/invoices/${encodeURIComponent(invoiceId)}`);
		const pay = payload?.data?.payment || {};
		return {
			status: pay.status || null,
			address: pay.address || null,
			currency: pay.currency || null,
			total_atomic: Number.isFinite(Number(pay.price)) ? BigInt(Math.round(Number(pay.price))) : null,
		};
	}

	/**
	 * Start fulfillment. Sandbox pays the invoice from the account balance
	 * (free for test products). Live invoices are paid by the agent's on-chain
	 * transfer, so there is nothing to call here.
	 */
	async function create({ card }) {
		if (card.mode === 'sandbox') {
			await call(`/invoices/${encodeURIComponent(card.provider_invoice_id)}/pay`, { method: 'POST' });
		}
		return status({ card });
	}

	async function status({ card }) {
		if (!card.provider_invoice_id) throw new CardProviderError('not_found', 'this card has no provider invoice');
		const payload = await call(`/invoices/${encodeURIComponent(card.provider_invoice_id)}`);
		const inv = payload?.data;
		const order = (inv?.orders || []).find((o) => String(o.id) === String(card.provider_order_id)) || firstOrder(inv);
		const normalized = normalizeStatus(inv, order);
		// The invoice read carries redemption_info once delivered. Only its
		// non-secret shape leaves this function; the secret goes through reveal().
		const split = order?.redemption_info ? splitRedemption(order.redemption_info) : null;
		return {
			status: normalized,
			provider_status: order?.status || inv?.status || null,
			payment_status: inv?.payment?.status || null,
			delivered_at: order?.delivered_time || null,
			error: normalized === 'failed' ? (order?.error || 'The provider could not deliver this card.') : null,
			card_data: split ? { masked: split.masked, fields: split.fields, instructions: split.instructions, expires_on: split.expires_on } : null,
		};
	}

	async function fetchRedemption(card) {
		if (!card.provider_order_id) throw new CardProviderError('not_found', 'this card has no provider order');
		const payload = await call(`/orders/${encodeURIComponent(card.provider_order_id)}`);
		const order = payload?.data;
		if (!order) throw new CardProviderError('not_found', 'order not found');
		if (order.status !== 'delivered') {
			throw new CardProviderError('unsupported', 'This card has not been delivered yet, so there is nothing to reveal.', { status: 409 });
		}
		return splitRedemption(order.redemption_info);
	}

	async function cardData({ card }) {
		const r = await fetchRedemption(card);
		return { masked: r.masked, fields: r.fields, instructions: r.instructions, expires_on: r.expires_on };
	}

	async function reveal({ card }) {
		const r = await fetchRedemption(card);
		return r.secret;
	}

	async function balance() {
		throw new CardProviderError(
			'unsupported',
			'This provider does not report a remaining balance. A gift card holds its face value until it is redeemed at the merchant.',
		);
	}

	async function cancel({ card }) {
		if (card.status !== 'quoted') {
			throw new CardProviderError(
				'unsupported',
				'This provider cannot cancel a card once it has been paid for. Delivered cards are final; failed ones are refunded automatically.',
			);
		}
		// An unpaid provider invoice simply lapses. Nothing to call.
		return { cancelled: true };
	}

	async function withdraw() {
		throw new CardProviderError('unsupported', 'This provider does not support moving a card balance back to USDC.');
	}

	async function connectLink() {
		// Bitrefill is the merchant of record for the platform account: no
		// per-owner identity step exists, so there is never a link to open.
		return { required: false, status: 'ready', url: null };
	}

	return {
		name: 'bitrefill',
		label: 'Bitrefill',
		capabilities: {
			settlement: ['usdc_solana'],
			sandbox: true,
			gift_cards: true,
			prepaid_cards: true,
			balance: false,
			cancel: 'unpaid_only',
			withdraw: false,
			connect: false,
		},
		configured: () => Boolean(key()),
		isSandboxProduct: isSandboxProductId,
		searchMerchants,
		searchProducts,
		getProduct,
		quote,
		paymentRequest,
		create,
		status,
		cardData,
		balance,
		reveal,
		cancel,
		refresh: status,
		withdraw,
		connectLink,
	};
}
