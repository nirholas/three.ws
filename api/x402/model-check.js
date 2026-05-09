// GET /api/x402/model-check?url=<glb-or-gltf>
//
// Paid endpoint cataloged by the CDP x402 Bazaar (agentic.market). For $0.001
// USDC on Base or Arbitrum mainnet the server fetches the model bytes, runs
// the glTF-Transform inspector, and returns structural stats + optimization
// hints. Buyers pay programmatically with @x402/fetch — no API keys.
//
// Wire stack (all official, all v2):
//   • @x402/express     paymentMiddleware → Express adapter
//   • @x402/core        x402ResourceServer + HTTPFacilitatorClient
//   • @x402/evm         ExactEvmScheme (eip155:* networks)
//   • @x402/extensions  declareDiscoveryExtension → bazaar discovery shape
//   • @coinbase/x402    facilitator config with ES256 JWT auth (CDP)
//
// Bazaar listing requires settlement through the CDP facilitator — that's the
// only one whose verify+settle log feeds the catalog. CDP_API_KEY_ID and
// CDP_API_KEY_SECRET must be set in Vercel; @coinbase/x402's `facilitator`
// reads them itself via createAuthHeaders.

import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { facilitator as cdpFacilitator } from '@coinbase/x402';

import { env } from '../_lib/env.js';
import { inspectModel, suggestOptimizations } from '../_lib/model-inspect.js';

const NETWORK_BASE = 'eip155:8453';
const NETWORK_ARBITRUM = 'eip155:42161';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ASSET_FOR_NETWORK = {
	[NETWORK_BASE]: USDC_BASE,
	[NETWORK_ARBITRUM]: env.X402_ASSET_ADDRESS_ARBITRUM,
};

const PAY_TO = env.X402_PAY_TO_BASE;
const PRICE = '$0.001';
const ROUTE = '/api/x402/model-check';
const MAX_FETCH_BYTES = 16 * 1024 * 1024;

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
	'three.ws Model Check — fetch a glTF/GLB model from a URL, run the canonical ' +
	'glTF-Transform inspector, and return structural stats (vertices, triangles, ' +
	'materials, textures, animations, extensions) plus a prioritized list of ' +
	'optimization recommendations. Useful for any agent vetting a 3D asset before ' +
	'minting, embedding, or paying for it. Pay-per-call in USDC on Base or Arbitrum mainnet.';

const DISCOVERY_INPUT_EXAMPLE = {
	url: 'https://three.ws/avatar/character-studio/sample.glb',
};

const DISCOVERY_INPUT_SCHEMA = {
	type: 'object',
	required: ['url'],
	properties: {
		url: {
			type: 'string',
			format: 'uri',
			description: 'Public HTTPS URL of a glTF (.gltf) or binary glTF (.glb) model. Max 16 MiB.',
		},
	},
};

const DISCOVERY_OUTPUT_EXAMPLE = {
	url: 'https://three.ws/avatar/character-studio/sample.glb',
	fetchedBytes: 1572864,
	model: {
		container: 'glb',
		generator: 'three.ws CharacterStudio v1.5',
		version: '2.0',
		extensionsUsed: ['KHR_materials_unlit'],
		extensionsRequired: [],
		counts: {
			scenes: 1,
			nodes: 18,
			meshes: 6,
			materials: 4,
			textures: 3,
			animations: 1,
			skins: 1,
			totalVertices: 12480,
			totalTriangles: 24812,
			indexedPrimitives: 6,
			nonIndexedPrimitives: 0,
		},
	},
	suggestions: [
		{
			id: 'texture_size',
			severity: 'info',
			message: 'All textures are within 1024x1024 — good for mobile.',
		},
	],
};

const DISCOVERY_OUTPUT_SCHEMA = {
	type: 'object',
	required: ['url', 'fetchedBytes', 'model', 'suggestions'],
	properties: {
		url: { type: 'string', format: 'uri' },
		fetchedBytes: { type: 'integer' },
		model: {
			type: 'object',
			required: ['container', 'counts'],
			properties: {
				container: { type: 'string', enum: ['glb', 'gltf'] },
				generator: { type: ['string', 'null'] },
				version: { type: ['string', 'null'] },
				extensionsUsed: { type: 'array', items: { type: 'string' } },
				extensionsRequired: { type: 'array', items: { type: 'string' } },
				counts: {
					type: 'object',
					properties: {
						scenes: { type: 'integer' },
						nodes: { type: 'integer' },
						meshes: { type: 'integer' },
						materials: { type: 'integer' },
						textures: { type: 'integer' },
						animations: { type: 'integer' },
						skins: { type: 'integer' },
						totalVertices: { type: 'integer' },
						totalTriangles: { type: 'integer' },
						indexedPrimitives: { type: 'integer' },
						nonIndexedPrimitives: { type: 'integer' },
					},
				},
			},
		},
		suggestions: {
			type: 'array',
			items: {
				type: 'object',
				required: ['id', 'severity', 'message'],
				properties: {
					id: { type: 'string' },
					severity: { type: 'string', enum: ['info', 'warn', 'critical'] },
					message: { type: 'string' },
					estimate: { type: 'string' },
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

app.get(ROUTE, async (req, res) => {
	const target = String(req.query?.url || '').trim();
	if (!target) {
		return res.status(400).json({ error: 'missing_url', message: 'query param "url" is required' });
	}
	let parsed;
	try {
		parsed = new URL(target);
	} catch {
		return res.status(400).json({ error: 'invalid_url', message: 'url is not a valid URL' });
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return res.status(400).json({
			error: 'invalid_url',
			message: 'url must be http(s)',
		});
	}

	let upstream;
	try {
		upstream = await fetch(parsed.toString(), {
			redirect: 'follow',
			headers: { accept: 'model/gltf-binary,model/gltf+json,application/octet-stream' },
			signal: AbortSignal.timeout(20_000),
		});
	} catch (err) {
		return res.status(502).json({
			error: 'fetch_failed',
			message: `could not fetch model: ${err.message}`,
		});
	}
	if (!upstream.ok) {
		return res.status(502).json({
			error: 'fetch_failed',
			message: `upstream returned ${upstream.status} ${upstream.statusText}`,
		});
	}

	const contentLength = Number(upstream.headers.get('content-length') || 0);
	if (contentLength && contentLength > MAX_FETCH_BYTES) {
		return res.status(413).json({
			error: 'too_large',
			message: `model is ${contentLength} bytes; max is ${MAX_FETCH_BYTES}`,
		});
	}

	const buf = new Uint8Array(await upstream.arrayBuffer());
	if (buf.byteLength > MAX_FETCH_BYTES) {
		return res.status(413).json({
			error: 'too_large',
			message: `model is ${buf.byteLength} bytes; max is ${MAX_FETCH_BYTES}`,
		});
	}

	let info;
	try {
		info = await inspectModel(buf, { fileSize: buf.byteLength });
	} catch (err) {
		return res.status(422).json({
			error: 'invalid_model',
			message: err.message || 'failed to parse model',
		});
	}
	const suggestions = suggestOptimizations(info);

	res.setHeader('cache-control', 'no-store');
	res.json({
		url: parsed.toString(),
		fetchedBytes: buf.byteLength,
		model: info,
		suggestions,
	});
});

app.use((err, req, res, _next) => {
	console.error('[x402/model-check] unhandled', err);
	res.status(500).json({ error: 'internal_error', message: err?.message || 'unknown error' });
});

export default app;
