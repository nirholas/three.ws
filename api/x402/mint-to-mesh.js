// GET /api/x402/mint-to-mesh?mint=<solana-mint>
//
// Paid endpoint cataloged by the CDP x402 Bazaar (agentic.market). For $0.01
// USDC on Base or Arbitrum mainnet the server reads the token's on-chain
// Metaplex metadata, resolves the off-chain JSON, fetches the image (when one
// is exposed), and returns a themed binary glTF cube ready for any Three.js /
// Babylon.js / model-viewer instance to render.
//
// The cube is procedurally synthesized per request via @gltf-transform — no
// templated asset, no headless WebGL, no S3. Output ships as base64 inside a
// JSON envelope so x402 facilitators that struggle with binary bodies still
// receive a clean response.
//
// Wire stack (matches /api/x402/model-check):
//   • @x402/express     paymentMiddleware → Express adapter
//   • @x402/core        x402ResourceServer + HTTPFacilitatorClient
//   • @x402/evm         ExactEvmScheme (eip155:* networks)
//   • @x402/extensions  declareDiscoveryExtension → bazaar discovery shape
//   • @coinbase/x402    facilitator config with ES256 JWT auth (CDP)

import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { facilitator as cdpFacilitator } from '@coinbase/x402';

import { env } from '../_lib/env.js';
import { createThemedGLB, colorFromMint } from '../_lib/glb-themer.js';
import { fetchTokenMeta } from '../_lib/solana-token-meta.js';

const NETWORK_BASE = 'eip155:8453';
const NETWORK_ARBITRUM = 'eip155:42161';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ASSET_FOR_NETWORK = {
	[NETWORK_BASE]: USDC_BASE,
	[NETWORK_ARBITRUM]: env.X402_ASSET_ADDRESS_ARBITRUM,
};

const PAY_TO = env.X402_PAY_TO_BASE;
const PRICE = '$0.01';
const ROUTE = '/api/x402/mint-to-mesh';

function buildAccepts() {
	return env.X402_EVM_NETWORKS
		.filter((n) => ASSET_FOR_NETWORK[n])
		.map((network) => ({
			scheme: 'exact',
			network,
			price: PRICE,
			payTo: PAY_TO,
			asset: ASSET_FOR_NETWORK[network],
			extra: { name: 'USDC', version: '2', decimals: 6 },
		}));
}

const facilitatorClient = new HTTPFacilitatorClient(cdpFacilitator);

let resourceServer = new x402ResourceServer(facilitatorClient);
for (const network of env.X402_EVM_NETWORKS) {
	if (!ASSET_FOR_NETWORK[network]) continue;
	resourceServer = resourceServer.register(network, new ExactEvmScheme());
}

const ROUTE_DESCRIPTION =
	'three.ws Mint to Mesh — pass a Solana fungible-token mint, get back a binary ' +
	'glTF (GLB) cube themed for that token. The cube is colored from a stable hash ' +
	'of the mint and (when the off-chain metadata exposes a PNG/JPEG) carries the ' +
	'token image as a baseColor texture on every face. Asset.extras carry the full ' +
	'on-chain Metaplex metadata so downstream agents can introspect mint, name, ' +
	'symbol, and timestamp. Useful for any agent that needs an instantly renderable ' +
	'3D representation of a token (in-game items, leaderboards, NFT-of-token, AR ' +
	'previews). Pay-per-call in USDC on Base or Arbitrum mainnet.';

const DISCOVERY_INPUT_EXAMPLE = {
	mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

const DISCOVERY_INPUT_SCHEMA = {
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
		base64:
			'Z2xURgIAAADQxAAA…(truncated; full GLB bytes are returned on a real call)',
	},
};

const DISCOVERY_OUTPUT_SCHEMA = {
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

const routeConfig = {
	[`GET ${ROUTE}`]: {
		accepts: buildAccepts(),
		description: ROUTE_DESCRIPTION,
		mimeType: 'application/json',
		extensions: {
			...declareDiscoveryExtension({
				input: DISCOVERY_INPUT_EXAMPLE,
				inputSchema: DISCOVERY_INPUT_SCHEMA,
				output: {
					example: DISCOVERY_OUTPUT_EXAMPLE,
					schema: DISCOVERY_OUTPUT_SCHEMA,
				},
			}),
		},
	},
};

const app = express();

// Middleware initializes by hitting the CDP facilitator's /supported endpoint
// to discover advertised scheme/network pairs. Requires CDP_API_KEY_ID and
// CDP_API_KEY_SECRET to be set — without them the first request returns 500
// with "Failed to initialize: no supported payment kinds loaded".
app.use(paymentMiddleware(routeConfig, resourceServer));

// Loose Solana base58 sanity check. Real validation happens in solanaPubkey()
// inside fetchTokenMeta — this just rejects obvious garbage early so we don't
// pay for an RPC round trip on it.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

app.get(ROUTE, async (req, res) => {
	const mint = String(req.query?.mint || '').trim();
	if (!mint) {
		return res.status(400).json({ error: 'missing_mint', message: 'query param "mint" is required' });
	}
	if (!BASE58_RE.test(mint)) {
		return res
			.status(400)
			.json({ error: 'invalid_mint', message: 'mint must be a base58 SPL address (32–44 chars)' });
	}

	let meta;
	try {
		meta = await fetchTokenMeta(mint);
	} catch (err) {
		const status = err.status || 502;
		return res.status(status).json({
			error: err.code || 'meta_fetch_failed',
			message: err.message || 'failed to read on-chain metadata',
		});
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

	res.setHeader('cache-control', 'no-store');
	res.json({
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
	});
});

app.use((err, req, res, _next) => {
	console.error('[x402/mint-to-mesh] unhandled', err);
	res.status(500).json({ error: 'internal_error', message: err?.message || 'unknown error' });
});

export default app;
