// Parse a 402 Payment Required response into a normalised list of payment
// requirements. three.ws (and every CDP-x402 / agentic.market merchant) emits the
// v2 envelope both as the JSON body and as the base64 `PAYMENT-REQUIRED` response
// header; we read the header first (it survives an already-consumed body and a
// non-JSON content-type) and fall back to the body.
//
//   { x402Version: 2, error, resource: { url, ... },
//     accepts: [{ scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra }],
//     extensions }

// Base USDC — the asset/network this wrapper signs for locally (EIP-3009).
export const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const NETWORK_BASE = 'eip155:8453';

// Pinned (network -> USDC contract). The 402 challenge is server-controlled, so
// neither the asset nor its decimals are trusted: only these contracts are
// signed for, and their decimals come from this table, never from the challenge.
const PINNED_USDC = {
	'eip155:8453': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
	'eip155:84532': '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
	'eip155:42161': '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
	'eip155:1': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
	'eip155:10': '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
};
const PINNED_DECIMALS = 6;

function isPinnedAsset(accept) {
	const pinned = PINNED_USDC[accept?.network];
	return typeof accept?.asset === 'string' && !!pinned && accept.asset.toLowerCase() === pinned;
}

function b64decodeJson(str) {
	if (!str) return null;
	try {
		const json =
			typeof Buffer !== 'undefined'
				? Buffer.from(str, 'base64').toString('utf8')
				: decodeURIComponent(escape(atob(str)));
		return JSON.parse(json);
	} catch {
		return null;
	}
}

function isEvmNetwork(net) {
	return typeof net === 'string' && net.startsWith('eip155:');
}

// EIP-3009 transferWithAuthorization is the only EVM asset-transfer method this
// zero-dep wrapper signs. Skip Permit2 siblings (extra.assetTransferMethod ===
// 'permit2') — signing typed data against them yields a payload the facilitator
// rejects.
function isEip3009Accept(accept) {
	if (!isEvmNetwork(accept?.network)) return false;
	if (accept.scheme && accept.scheme !== 'exact') return false;
	if (!isPinnedAsset(accept)) return false;
	const method = accept?.extra?.assetTransferMethod;
	return !method || method === 'eip3009';
}

// Auth-hint placeholders (amount "0" / extra.authRequired) are never payable.
function isPayable(accept) {
	if (!accept || typeof accept !== 'object') return false;
	if (accept.extra?.authRequired != null) return false;
	return String(accept.amount ?? accept.maxAmountRequired ?? '') !== '0';
}

// Coerce the spec's `maxAmountRequired` alias onto `amount`.
function normalizeAccept(accept) {
	const amount = accept.amount ?? accept.maxAmountRequired;
	return amount != null && accept.amount == null ? { ...accept, amount: String(amount) } : accept;
}

/**
 * Read the challenge envelope from a 402 Response.
 * @param {Response} response
 * @returns {Promise<{ accepts: any[], resource: any, raw: any } | null>}
 */
export async function parseChallenge(response) {
	let envelope = b64decodeJson(
		response.headers.get('payment-required') || response.headers.get('x-payment-required'),
	);
	if (!envelope) {
		const ct = response.headers.get('content-type') || '';
		if (!ct.includes('json')) return null;
		try {
			envelope = await response.clone().json();
		} catch {
			return null;
		}
	}
	const accepts = Array.isArray(envelope?.accepts)
		? envelope.accepts.map(normalizeAccept)
		: [];
	return { accepts, resource: envelope?.resource || null, raw: envelope };
}

/**
 * Select the payment requirement this wrapper can satisfy. Prefers Base USDC
 * (the spec target), then any other EVM EIP-3009 USDC entry.
 * @param {any[]} accepts
 * @param {{ preferNetwork?: string }} [opts]
 * @returns {any | null}
 */
export function selectRequirement(accepts, { preferNetwork } = {}) {
	const payable = accepts.filter((a) => isPayable(a) && isEip3009Accept(a));
	if (!payable.length) return null;
	if (preferNetwork) {
		const want = payable.find((a) => a.network === preferNetwork);
		if (want) return want;
	}
	const base = payable.find((a) => a.network === NETWORK_BASE);
	return base || payable[0];
}

/**
 * Atomic price to USD float using the pinned USDC decimals. Anything that is not
 * a finite, non-negative amount on a pinned asset prices as Infinity so every
 * spend cap trips.
 */
export function amountToUsd(accept) {
	if (!isPinnedAsset(accept)) return Infinity;
	const atomic = Number(accept?.amount);
	if (!Number.isFinite(atomic) || atomic < 0) return Infinity;
	return atomic / 10 ** PINNED_DECIMALS;
}

export { isEvmNetwork, isEip3009Accept };
