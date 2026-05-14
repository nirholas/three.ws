// GET /api/x402/mint-to-mesh?mint=<solana-mint>
//
// Paid endpoint cataloged by the CDP x402 Bazaar (agentic.market). For $0.01
// USDC on Base mainnet the server reads the token's on-chain Metaplex metadata,
// resolves the off-chain JSON, fetches the image (when one is exposed), and
// returns a themed binary glTF cube ready for any Three.js / Babylon.js /
// model-viewer instance to render.
//
// The cube is procedurally synthesized per request via @gltf-transform — no
// templated asset, no headless WebGL, no S3. Output ships as base64 inside a
// JSON envelope so x402 facilitators that struggle with binary bodies still
// receive a clean response.
//
// Wire stack: plain Node handler + our internal x402-spec.js (same path
// /api/mcp uses). 402 challenge stays alive even when CDP creds are absent so
// the bazaar can index the endpoint. Verify+settle routes via
// X402_FACILITATOR_URL_BASE (PayAI by default).

import { wrap, cors, error } from '../_lib/http.js';
import {
	NETWORK_BASE_MAINNET,
	send402,
	verifyPayment,
	settlePayment,
	encodePaymentResponseHeader,
	resolveResourceUrl,
} from '../_lib/x402-spec.js';
import { env } from '../_lib/env.js';
import { createThemedGLB, colorFromMint } from '../_lib/glb-themer.js';
import { fetchTokenMeta } from '../_lib/solana-token-meta.js';

const ROUTE = '/api/x402/mint-to-mesh';

const ROUTE_DESCRIPTION =
	'three.ws Mint to Mesh — pass a Solana fungible-token mint, get back a binary ' +
	'glTF (GLB) cube themed for that token. The cube is colored from a stable hash ' +
	'of the mint and (when the off-chain metadata exposes a PNG/JPEG) carries the ' +
	'token image as a baseColor texture on every face. Asset.extras carry the full ' +
	'on-chain Metaplex metadata so downstream agents can introspect mint, name, ' +
	'symbol, and timestamp. Useful for any agent that needs an instantly renderable ' +
	'3D representation of a token (in-game items, leaderboards, NFT-of-token, AR ' +
	'previews). Pay-per-call in USDC on Base mainnet.';

const DISCOVERY_INPUT_EXAMPLE = {
	mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

const DISCOVERY_INPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['mint'],
	properties: {
		mint: {
			type: 'string',
			minLength: 32,
			maxLength: 64,
			description: 'Base58 SPL mint address on Solana mainnet.',
		},
	},
};

const DISCOVERY_OUTPUT_EXAMPLE = {
	mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
	theme: {
		name: 'Bonk',
		symbol: 'Bonk',
		color: [0.92, 0.45, 0.18],
		imageUrl: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
		hasImage: true,
	},
	glb: {
		mimeType: 'model/gltf-binary',
		bytes: 50768,
		base64: 'Z2xURgIAAADQxAAA…(truncated; full GLB bytes are returned on a real call)',
	},
};

const DISCOVERY_OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['mint', 'theme', 'glb'],
	properties: {
		mint: { type: 'string' },
		theme: {
			type: 'object',
			required: ['name', 'symbol', 'color', 'hasImage'],
			properties: {
				name: { type: ['string', 'null'] },
				symbol: { type: ['string', 'null'] },
				color: {
					type: 'array',
					minItems: 3,
					maxItems: 3,
					items: { type: 'number', minimum: 0, maximum: 1 },
					description: 'RGB triplet in [0,1] used as baseColorFactor.',
				},
				imageUrl: { type: ['string', 'null'], format: 'uri' },
				hasImage: {
					type: 'boolean',
					description:
						'True when a PNG/JPEG image was fetched and embedded as a baseColor texture.',
				},
			},
		},
		glb: {
			type: 'object',
			required: ['mimeType', 'bytes', 'base64'],
			properties: {
				mimeType: { type: 'string', const: 'model/gltf-binary' },
				bytes: { type: 'integer', minimum: 1 },
				base64: {
					type: 'string',
					description: 'Base64-encoded binary glTF (GLB). Decode for the raw .glb file.',
				},
			},
		},
	},
};

const ROUTE_BAZAAR = {
	discoverable: true,
	info: {
		input: {
			type: 'http',
			method: 'GET',
			queryParams: DISCOVERY_INPUT_EXAMPLE,
			queryParamsSchema: DISCOVERY_INPUT_SCHEMA,
		},
		output: { type: 'json', example: DISCOVERY_OUTPUT_EXAMPLE },
	},
	schema: DISCOVERY_OUTPUT_SCHEMA,
};

function buildRequirements() {
	return [
		{
			scheme: 'exact',
			network: NETWORK_BASE_MAINNET,
			amount: env.X402_MAX_AMOUNT_REQUIRED,
			payTo: env.X402_PAY_TO_BASE,
			asset: env.X402_ASSET_ADDRESS_BASE,
			maxTimeoutSeconds: 60,
			extra: { name: 'USD Coin', version: '2', decimals: 6 },
		},
	];
}

// Loose Solana base58 sanity check. Real validation happens in solanaPubkey()
// inside fetchTokenMeta — this just rejects obvious garbage early so we don't
// pay for an RPC round trip on it.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function buildMesh(mint) {
	let meta;
	try {
		meta = await fetchTokenMeta(mint);
	} catch (err) {
		const e = new Error(err.message || 'failed to read on-chain metadata');
		e.code = err.code || 'meta_fetch_failed';
		e.status = err.status || 502;
		throw e;
	}
	const color = colorFromMint(mint);
	const glb = await createThemedGLB({
		mint: meta.mint,
		name: meta.name,
		symbol: meta.symbol,
		image: meta.image?.bytes || null,
		imageMimeType: meta.image?.mimeType || null,
		color,
		extras: {
			description: meta.description || undefined,
			imageUrl: meta.imageUrl || undefined,
			externalUrl: meta.externalUrl || undefined,
			offchainUri: meta.uri || undefined,
		},
	});
	return {
		mint: meta.mint,
		theme: {
			name: meta.name,
			symbol: meta.symbol,
			color,
			imageUrl: meta.imageUrl,
			hasImage: !!meta.image,
		},
		glb: {
			mimeType: 'model/gltf-binary',
			bytes: glb.byteLength,
			base64: Buffer.from(glb).toString('base64'),
		},
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (req.method !== 'GET') {
		res.setHeader('allow', 'GET');
		return error(res, 405, 'method_not_allowed', 'use GET');
	}

	const resourceUrl = resolveResourceUrl(req, ROUTE);
	const requirements = buildRequirements();
	const challenge = {
		resourceUrl,
		accepts: requirements,
		description: ROUTE_DESCRIPTION,
		bazaar: ROUTE_BAZAAR,
	};

	const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];
	if (!paymentHeader) return send402(res, challenge);

	let verified;
	try {
		verified = await verifyPayment({ paymentHeader, requirements });
	} catch (err) {
		if (err.status === 402) return send402(res, { ...challenge, error: err.message });
		return error(res, err.status || 502, err.code || 'verify_failed', err.message);
	}

	const mint = String(req.query?.mint || '').trim();
	if (!mint) return error(res, 400, 'missing_mint', 'query param "mint" is required');
	if (!BASE58_RE.test(mint))
		return error(res, 400, 'invalid_mint', 'mint must be a base58 SPL address (32–44 chars)');

	let result;
	try {
		result = await buildMesh(mint);
	} catch (err) {
		return error(res, err.status || 500, err.code || 'internal_error', err.message);
	}

	let settled;
	try {
		settled = await settlePayment({
			paymentPayload: verified.paymentPayload,
			requirement: verified.requirement,
		});
	} catch (err) {
		return error(res, err.status || 502, err.code || 'settle_failed', err.message);
	}

	res.setHeader('x-payment-response', encodePaymentResponseHeader(settled));
	res.setHeader('cache-control', 'no-store');
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify(result));
});
