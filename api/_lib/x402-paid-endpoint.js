// Helper for building paid x402 endpoints with minimal boilerplate.
//
// A paid endpoint goes through the same 7-step dance every time: CORS →
// method-check → 402 challenge (when no payment header) → verify → run the
// actual work → settle → respond with the X-PAYMENT-RESPONSE header. We
// factor that into `paidEndpoint(spec)` so each new /api/x402/* file only
// has to declare its route metadata + a handler that returns JSON.
//
// Pricing: each endpoint gets its own `priceAtomics` (USDC has 6 decimals,
// so "1000" = $0.001). Networks default to Base mainnet only; pass
// `networks: ['base', 'solana']` to advertise both. The bazaar discovery
// extension is required — agentic.market's catalog rejects entries without
// it. See api/_lib/x402-spec.js for the v2 wire-format details.

import { cors, error } from './http.js';
import { env } from './env.js';
import { PAYMENT_EVENT_TOPIC as BSC_PAYMENT_EVENT_TOPIC } from './x402-bsc-direct.js';
import {
	NETWORK_BASE_MAINNET,
	NETWORK_BSC_MAINNET,
	NETWORK_SOLANA_MAINNET,
	X402Error,
	encodePaymentResponseHeader,
	resolveResourceUrl,
	send402,
	settlePayment,
	verifyPayment,
} from './x402-spec.js';

const NETWORK_ALIASES = {
	base: NETWORK_BASE_MAINNET,
	'base-mainnet': NETWORK_BASE_MAINNET,
	bsc: NETWORK_BSC_MAINNET,
	'bsc-mainnet': NETWORK_BSC_MAINNET,
	solana: NETWORK_SOLANA_MAINNET,
	'solana-mainnet': NETWORK_SOLANA_MAINNET,
};

function resolveNetwork(name) {
	return NETWORK_ALIASES[name] || name;
}

function buildAccept(network, priceAtomics, resourceUrl) {
	const common = {
		scheme: 'exact',
		amount: String(priceAtomics),
		maxTimeoutSeconds: 60,
		resource: resourceUrl,
	};
	if (network === NETWORK_BASE_MAINNET) {
		return {
			...common,
			network: NETWORK_BASE_MAINNET,
			payTo: env.X402_PAY_TO_BASE,
			asset: env.X402_ASSET_ADDRESS_BASE,
			// EIP-712 domain name must match the on-chain USDC contract — Base
			// USDC's domain is "USD Coin" (not "USDC"), or signatures fail.
			extra: { name: 'USD Coin', version: '2', decimals: 6 },
		};
	}
	if (network === NETWORK_SOLANA_MAINNET) {
		return {
			...common,
			network: NETWORK_SOLANA_MAINNET,
			payTo: env.X402_PAY_TO_SOLANA,
			asset: env.X402_ASSET_MINT_SOLANA,
			// PayAI requires this account as fee payer; without it /verify rejects.
			extra: { name: 'USDC', decimals: 6, feePayer: env.X402_FEE_PAYER_SOLANA },
		};
	}
	if (network === NETWORK_BSC_MAINNET) {
		// Contract-mediated "direct" scheme — the client calls
		// ThreeWSPayments.pay(bytes32) from their own wallet (see x402-bsc-direct.js).
		return {
			...common,
			scheme: 'direct',
			network: NETWORK_BSC_MAINNET,
			payTo: env.X402_PAY_TO_BSC,
			asset: env.X402_ASSET_ADDRESS_BSC,
			extra: {
				name: 'Binance-Peg USD Coin',
				decimals: 6,
				contract: env.X402_PAY_TO_BSC,
				method: 'pay(bytes32)',
				eventTopic: BSC_PAYMENT_EVENT_TOPIC,
			},
		};
	}
	throw new X402Error('unsupported_network', `paidEndpoint: unsupported network ${network}`, 500);
}

function buildRequirements({ priceAtomics, networks, resourceUrl }) {
	const out = [];
	for (const name of networks) {
		const net = resolveNetwork(name);
		if (net === NETWORK_BASE_MAINNET && !env.X402_PAY_TO_BASE) continue;
		if (net === NETWORK_SOLANA_MAINNET && !env.X402_PAY_TO_SOLANA) continue;
		if (net === NETWORK_BSC_MAINNET && !env.X402_PAY_TO_BSC) continue;
		out.push(buildAccept(net, priceAtomics, resourceUrl));
	}
	if (!out.length) {
		throw new X402Error(
			'no_payto_configured',
			'paidEndpoint: no X402_PAY_TO_* configured for any requested network',
			500,
		);
	}
	return out;
}

// `spec.bazaar` is the v2 discoverable extension shape: { discoverable: true,
// info: { input, output }, schema }. See model-check.js for a worked example.
// `spec.handler({ req, res, requirement, payer })` is called only AFTER the
// payment verifies. It should return a JSON-serializable result; throwing an
// Error with .status + .code maps to a clean error response. Throwing an
// X402Error with status=402 re-emits the 402 challenge (e.g. wrong network).
export function paidEndpoint(spec) {
	const {
		route,
		method = 'GET',
		priceAtomics = env.X402_MAX_AMOUNT_REQUIRED,
		networks = ['base', 'solana'],
		description,
		mimeType = 'application/json',
		bazaar,
		handler,
	} = spec;

	if (!route) throw new Error('paidEndpoint: route is required');
	if (!description) throw new Error('paidEndpoint: description is required');
	if (!bazaar) throw new Error('paidEndpoint: bazaar discovery extension is required');
	if (typeof handler !== 'function') throw new Error('paidEndpoint: handler must be a function');

	const allowMethods = `${method.toUpperCase()},OPTIONS`;

	return async function paidHandler(req, res) {
		if (cors(req, res, { methods: allowMethods, origins: '*' })) return;
		if (req.method !== method.toUpperCase()) {
			res.setHeader('allow', method.toUpperCase());
			return error(res, 405, 'method_not_allowed', `use ${method.toUpperCase()}`);
		}

		const resourceUrl = resolveResourceUrl(req, route);
		let requirements;
		try {
			requirements = buildRequirements({ priceAtomics, networks, resourceUrl });
		} catch (err) {
			return error(
				res,
				err.status || 500,
				err.code || 'misconfigured',
				err.message || 'paid endpoint misconfigured',
			);
		}

		const challenge = { resourceUrl, accepts: requirements, description, mimeType, bazaar };

		const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];
		if (!paymentHeader) return send402(res, challenge);

		let verified;
		try {
			verified = await verifyPayment({ paymentHeader, requirements });
		} catch (err) {
			if (err.status === 402) return send402(res, { ...challenge, error: err.message });
			return error(res, err.status || 502, err.code || 'verify_failed', err.message);
		}

		let result;
		try {
			result = await handler({
				req,
				res,
				requirement: verified.requirement,
				payer: verified.payer,
			});
		} catch (err) {
			if (err instanceof X402Error && err.status === 402) {
				return send402(res, { ...challenge, error: err.message });
			}
			return error(res, err.status || 500, err.code || 'internal_error', err.message);
		}

		// Handler may end the response itself (e.g. binary body); only settle +
		// emit JSON when it returned a value and didn't already flush.
		if (res.writableEnded) return;

		let settled;
		try {
			settled = await settlePayment({
				paymentPayload: verified.paymentPayload,
				requirement: verified.requirement,
				directVerified: verified.directVerified,
			});
		} catch (err) {
			return error(res, err.status || 502, err.code || 'settle_failed', err.message);
		}

		res.setHeader('x-payment-response', encodePaymentResponseHeader(settled));
		res.setHeader('cache-control', 'no-store');
		res.setHeader('content-type', `${mimeType}; charset=utf-8`);
		res.end(typeof result === 'string' ? result : JSON.stringify(result));
	};
}
