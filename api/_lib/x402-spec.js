// x402 protocol — facilitator-mediated micropayments.
// Spec: https://x402.org / https://github.com/coinbase/x402
//
// This module implements the *standard* x402 wire flow used by agentic.market,
// x402scan, and Coinbase's Bazaar. v2 wire format (April 2026 spec):
//
//   {
//     "x402Version": 2,
//     "error": "X-PAYMENT header is required",
//     "resource": { "url": "...", "description": "...", "mimeType": "application/json" },
//     "accepts": [
//       { "scheme": "exact", "network": "eip155:8453", "amount": "1000",
//         "asset": "0x...", "payTo": "0x...", "maxTimeoutSeconds": 60, "extra": {...} }
//     ],
//     "extensions": { "bazaar": { info: { input, output }, schema } }
//   }
//
// In addition to the body, the same envelope is emitted base64-encoded as the
// `payment-required` HTTP response header — required by agentic.market's
// Bazaar validator, which reads the header on its discovery probe.
//
// Networks use CAIP-2 IDs in v2: `eip155:<chainId>` for EVM, `solana:<genesis-prefix>`
// for Solana. The legacy `api/_lib/x402.js` is the unrelated Pump.fun agent-skill flow.
//
// Server flow on a paid resource:
//   1. No X-PAYMENT header → 402 with the body shape above.
//   2. Client retries with X-PAYMENT (base64-encoded PaymentPayload).
//   3. Server POSTs facilitator /verify with { x402Version, paymentPayload, paymentRequirements }
//      → { isValid, invalidReason?, payer? }
//   4. If isValid, do the work.
//   5. Server POSTs facilitator /settle (same body) → { success, transaction, network, payer }
//      Server attaches a base64 settlement object as `X-PAYMENT-RESPONSE` on the success reply.

import { env } from './env.js';

export const X402_VERSION = 2;

// CAIP-2 network IDs as advertised by Coinbase x402 facilitators (PayAI, CDP).
// Solana mainnet's CAIP-2 namespace uses the truncated genesis-block hash.
export const NETWORK_BASE_MAINNET = 'eip155:8453';
export const NETWORK_BASE_SEPOLIA = 'eip155:84532';
export const NETWORK_SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const NETWORK_SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export class X402Error extends Error {
	constructor(code, message, status = 402) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

// One v2 PaymentRequirements entry per supported network. Base mainnet first
// — agentic.market's validator inspects the first entry for its supported-network
// check, and Base is the most broadly recognized option in the Bazaar.
//
// In v2, `resource` / `description` / `mimeType` are top-level on the 402 body
// (not per-accepts), and the price field is `amount` (not `maxAmountRequired`).
export function paymentRequirements() {
	const common = {
		scheme: 'exact',
		amount: env.X402_MAX_AMOUNT_REQUIRED,
		maxTimeoutSeconds: 60,
	};
	const out = [];
	if (env.X402_PAY_TO_BASE) {
		out.push({
			...common,
			network: NETWORK_BASE_MAINNET,
			payTo: env.X402_PAY_TO_BASE,
			asset: env.X402_ASSET_ADDRESS_BASE,
			// `name` MUST match the on-chain EIP-712 domain. Base USDC's domain
			// name is "USD Coin" (not "USDC"); using "USDC" here makes the
			// facilitator recompute the wrong domain hash → invalid signature.
			extra: { name: 'USD Coin', version: '2', decimals: 6 },
		});
	}
	if (env.X402_PAY_TO_SOLANA) {
		out.push({
			...common,
			network: NETWORK_SOLANA_MAINNET,
			payTo: env.X402_PAY_TO_SOLANA,
			asset: env.X402_ASSET_MINT_SOLANA,
			// PayAI's Solana facilitator requires clients to build the SPL transfer
			// with this account as fee payer; without it, /verify rejects with
			// `missing_fee_payer`.
			extra: { name: 'USDC', decimals: 6, feePayer: env.X402_FEE_PAYER_SOLANA },
		});
	}
	return out;
}

function facilitatorFor(network) {
	if (
		network === NETWORK_SOLANA_MAINNET ||
		network === NETWORK_SOLANA_DEVNET ||
		network === 'solana'
	)
		return { url: env.X402_FACILITATOR_URL_SOLANA, token: env.X402_FACILITATOR_TOKEN_SOLANA };
	if (network === NETWORK_BASE_MAINNET || network === NETWORK_BASE_SEPOLIA || network === 'base')
		return { url: env.X402_FACILITATOR_URL_BASE, token: env.X402_FACILITATOR_TOKEN_BASE };
	throw new X402Error('unsupported_network', `unsupported network: ${network}`, 400);
}

function decodePaymentHeader(header) {
	if (!header) throw new X402Error('payment_required', 'X-PAYMENT header required', 402);
	let json;
	try {
		json = Buffer.from(String(header), 'base64').toString('utf8');
	} catch (err) {
		throw new X402Error(
			'invalid_payment',
			`X-PAYMENT base64 decode failed: ${err.message}`,
			400,
		);
	}
	let payload;
	try {
		payload = JSON.parse(json);
	} catch (err) {
		throw new X402Error('invalid_payment', `X-PAYMENT JSON parse failed: ${err.message}`, 400);
	}
	if (!payload || typeof payload !== 'object') {
		throw new X402Error('invalid_payment', 'X-PAYMENT must decode to a JSON object', 400);
	}
	return payload;
}

function hostOf(url) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

async function callFacilitator(network, path, body) {
	const { url: base, token } = facilitatorFor(network);
	const url = `${base}${path}`;
	const host = hostOf(base);
	const headers = { 'content-type': 'application/json', accept: 'application/json' };
	if (token) headers.authorization = `Bearer ${token}`;
	let res;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
	} catch (err) {
		throw new X402Error(
			'facilitator_unreachable',
			`facilitator ${path} (${host}, network=${network}) fetch failed: ${err.message}`,
			502,
		);
	}
	const text = await res.text();
	let data = {};
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			throw new X402Error(
				'facilitator_bad_response',
				`facilitator ${path} (${host}, network=${network}) returned non-JSON (status ${res.status})`,
				502,
			);
		}
	}
	if (!res.ok) {
		// PayAI returns 400 with { isValid: false } for invalid payments —
		// pass through so verifyPayment can emit a clean 402 to the caller.
		if (path === '/verify' && data.isValid === false) return data;
		throw new X402Error(
			'facilitator_error',
			`facilitator ${path} (${host}, network=${network}) ${res.status}: ${data.error || data.message || data.invalidReason || text.slice(0, 200)}`,
			502,
		);
	}
	return data;
}

// Probe `/supported` on each configured facilitator and report whether the
// scheme/network pairs we advertise are actually supported. Used by
// /api/x402-status to surface misconfigurations before a paying client hits them.
export async function probeFacilitators() {
	const targets = [
		{ network: NETWORK_BASE_MAINNET, ...facilitatorFor(NETWORK_BASE_MAINNET) },
		{ network: NETWORK_SOLANA_MAINNET, ...facilitatorFor(NETWORK_SOLANA_MAINNET) },
	];
	const seen = new Map();
	const results = [];
	for (const t of targets) {
		if (!t.url) {
			results.push({
				network: t.network,
				ok: false,
				reason: 'no facilitator URL configured',
			});
			continue;
		}
		let entry = seen.get(t.url);
		if (!entry) {
			entry = (async () => {
				try {
					const probeUrl = `${t.url}/supported`;
					const headers = { accept: 'application/json' };
					if (t.kind === 'cdp') headers.authorization = cdpAuthHeader('GET', probeUrl);
					const res = await fetch(probeUrl, {
						headers,
						signal: AbortSignal.timeout(10_000),
					});
					if (!res.ok) return { error: `status ${res.status}` };
					const json = await res.json();
					return { kinds: Array.isArray(json?.kinds) ? json.kinds : [] };
				} catch (err) {
					return { error: err.message };
				}
			})();
			seen.set(t.url, entry);
		}
		const data = await entry;
		if (data.error) {
			results.push({
				network: t.network,
				url: t.url,
				ok: false,
				reason: `/supported probe failed: ${data.error}`,
			});
			continue;
		}
		const supports = data.kinds.some(
			(k) =>
				k.scheme === 'exact' &&
				k.network === t.network &&
				(k.x402Version ?? 1) === X402_VERSION,
		);
		results.push({
			network: t.network,
			url: t.url,
			ok: supports,
			reason: supports
				? `facilitator advertises exact/${t.network}`
				: `facilitator does NOT advertise scheme=exact network=${t.network} (configure X402_FACILITATOR_URL_${t.network.toUpperCase()} to a facilitator that does)`,
		});
	}
	return results;
}

// Match the decoded payload to one of the offered requirements (by network).
// Falls back to the first requirement when the payload omits an explicit network field.
function selectRequirement(paymentPayload, allRequirements) {
	const network = paymentPayload?.network || paymentPayload?.paymentRequirements?.network;
	if (network) {
		const found = allRequirements.find((r) => r.network === network);
		if (!found)
			throw new X402Error(
				'unsupported_network',
				`payment network "${network}" is not offered`,
				402,
			);
		return found;
	}
	return allRequirements[0];
}

// Verify a base64 X-PAYMENT header against the offered requirements.
// Returns { paymentPayload, requirement, payer } on success.
export async function verifyPayment({ paymentHeader, requirements }) {
	const all = Array.isArray(requirements) ? requirements : [requirements];
	const paymentPayload = decodePaymentHeader(paymentHeader);
	const requirement = selectRequirement(paymentPayload, all);
	const result = await callFacilitator(requirement.network, '/verify', {
		x402Version: X402_VERSION,
		paymentPayload,
		paymentRequirements: requirement,
	});
	if (!result.isValid) {
		throw new X402Error(
			'invalid_payment',
			`payment rejected: ${result.invalidReason || 'unknown reason'}`,
			402,
		);
	}
	return { paymentPayload, requirement, payer: result.payer || null };
}

// Settle the verified payment on-chain via the matching facilitator.
export async function settlePayment({ paymentPayload, requirement }) {
	const result = await callFacilitator(requirement.network, '/settle', {
		x402Version: X402_VERSION,
		paymentPayload,
		paymentRequirements: requirement,
	});
	if (!result.success) {
		throw new X402Error(
			'settle_failed',
			`settle failed: ${result.errorReason || 'unknown reason'}`,
			502,
		);
	}
	return result;
}

export function encodePaymentResponseHeader(settleResult) {
	const body = {
		success: true,
		transaction: settleResult.transaction,
		network: settleResult.network,
		payer: settleResult.payer,
	};
	return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
}

// Long-form description used for the top-level `resource.description` and
// (lightly trimmed) for the bazaar extension. Stays in one place so the 402
// challenge, the /.well-known/x402.json discovery file, and any operator
// dashboards stay in sync.
export const RESOURCE_DESCRIPTION =
	'three.ws MCP — Streamable HTTP transport (MCP 2025-06-18) exposing 3D avatar viewer, glTF/GLB model validation/inspection/optimization, and Solana agent data as JSON-RPC 2.0 tool calls. Pay-per-call in USDC on Base mainnet (eip155:8453) or Solana mainnet. ≤256 tools/call output, ≤32-message JSON-RPC batches. Operated by three.ws.';

// Bazaar discovery extension — shape required by agentic.market's validator.
// `info.input.{type,method,body|queryParams|pathParams}` describes how to call
// the resource; `info.output.{type,example}` shows what comes back; top-level
// `schema` is the JSON Schema for the response body.
//
// This is the v2 `declareDiscoveryExtension` shape. The flat
// `{method,input,inputSchema,output:{example,schema}}` shape v1 used is no
// longer indexed by the CDP Bazaar.
export function bazaarExtension() {
	const exampleBody = {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: {
			name: 'validate_model',
			arguments: { url: 'https://example.com/model.glb' },
		},
	};
	const exampleResponse = {
		jsonrpc: '2.0',
		id: 1,
		result: {
			content: [
				{ type: 'text', text: '{"ok":true,"warnings":[],"meta":{"vertices":12345}}' },
			],
		},
	};
	return {
		discoverable: true,
		info: {
			input: {
				type: 'http',
				method: 'POST',
				body: exampleBody,
				bodyType: 'json',
				bodySchema: {
					$schema: 'https://json-schema.org/draft/2020-12/schema',
					type: 'object',
					required: ['jsonrpc', 'method'],
					properties: {
						jsonrpc: { type: 'string', const: '2.0' },
						id: { type: ['string', 'number'] },
						method: {
							type: 'string',
							enum: ['initialize', 'tools/list', 'tools/call', 'ping'],
							description: 'MCP JSON-RPC method.',
						},
						params: {
							type: 'object',
							description:
								'For tools/call: { name, arguments }. Tool names include validate_model, inspect_model, optimize_model, search_public_avatars, solana_register, solana_reputation, and others — see tools/list.',
						},
					},
				},
			},
			output: {
				type: 'json',
				example: exampleResponse,
			},
		},
		schema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				jsonrpc: { type: 'string', const: '2.0' },
				id: { type: ['string', 'number'] },
				result: {
					type: 'object',
					properties: {
						content: {
							type: 'array',
							items: {
								type: 'object',
								required: ['type', 'text'],
								properties: {
									type: { type: 'string', enum: ['text'] },
									text: { type: 'string' },
								},
							},
						},
					},
				},
				error: {
					type: 'object',
					properties: {
						code: { type: 'number' },
						message: { type: 'string' },
					},
				},
			},
		},
	};
}

// Build the v2 PaymentRequired body. Top-level `resource` carries url/description/
// mimeType (per v2 spec); per-accept entries no longer repeat them.
//
// `description`, `mimeType`, and `bazaar` are per-route — each paid endpoint
// wants its own catalog entry on agentic.market, not the MCP boilerplate.
export function build402Body({
	resourceUrl,
	accepts,
	error = 'X-PAYMENT header is required',
	description = RESOURCE_DESCRIPTION,
	mimeType = 'application/json',
	bazaar = bazaarExtension(),
}) {
	return {
		x402Version: X402_VERSION,
		error,
		resource: { url: resourceUrl, description, mimeType },
		accepts: Array.isArray(accepts) ? accepts : [accepts],
		extensions: { bazaar },
	};
}

export function send402(res, opts = {}) {
	res.statusCode = 402;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	// Also expose the envelope as the `payment-required` header (base64-JSON),
	// matching the v2 wire format that agentic.market's validator inspects.
	const body = build402Body(opts);
	res.setHeader('payment-required', Buffer.from(JSON.stringify(body), 'utf8').toString('base64'));
	res.end(JSON.stringify(body));
}

// Resolve the canonical resource URL the client hit, so the facilitator can
// match the payer's signed payload against the same string we advertise.
export function resolveResourceUrl(req, path) {
	const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
	const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
	if (host) return `${proto}://${host}${path}`;
	return `${env.APP_ORIGIN}${path}`;
}
