// GET /api/x402/solana-agent-passport?asset=<base58>&network=mainnet|devnet
//
// Paid endpoint (CDP Bazaar, x402 v2). For $0.001 USDC on Base or Arbitrum
// mainnet the server returns a full discovery card for a Solana-registered
// three.ws agent: identity (Metaplex Core asset), owner wallet, reputation
// summary (feedback counts, score averages, dispute rate), latest validation
// result, and recent attestations. Equivalent to calling solana_agent_reputation
// + solana_agent_attestations + identity lookup in a single paid call.
//
// Wire stack: @x402/express + @x402/evm + @coinbase/x402 (same as model-check).

import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { facilitator as cdpFacilitator } from '@coinbase/x402';

import { env } from '../_lib/env.js';
import { TOOLS } from '../_mcp/catalog.js';

const NETWORK_BASE = 'eip155:8453';
const NETWORK_ARBITRUM = 'eip155:42161';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ASSET_FOR_NETWORK = {
	[NETWORK_BASE]: USDC_BASE,
	[NETWORK_ARBITRUM]: env.X402_ASSET_ADDRESS_ARBITRUM,
};

const PAY_TO = env.X402_PAY_TO_BASE;
const PRICE = '$0.001';
const ROUTE = '/api/x402/solana-agent-passport';

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
	'three.ws Solana Agent Passport — full discovery card for a Solana-registered ' +
	'agent: Metaplex Core identity, owner wallet, reputation summary (feedback counts, ' +
	'score averages, verified vs disputed, validation pass/fail), and the 10 most recent ' +
	'on-chain attestations. Equivalent to solana_agent_reputation + ' +
	'solana_agent_attestations + identity in one call. Pass ?asset=<base58> and ' +
	'optionally ?network=mainnet|devnet (default devnet). $0.001 USDC on Base or Arbitrum.';

const routeConfig = {
	[`GET ${ROUTE}`]: {
		accepts: buildAccepts(),
		description: ROUTE_DESCRIPTION,
		mimeType: 'application/json',
		extensions: {
			...declareDiscoveryExtension({
				input: { asset: 'AgNTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', network: 'mainnet' },
				inputSchema: {
					type: 'object',
					required: ['asset'],
					properties: {
						asset: { type: 'string', description: 'Metaplex Core asset pubkey (base58) — the agent ID on Solana.' },
						network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'devnet' },
					},
					additionalProperties: false,
				},
				output: {
					example: {
						agent: 'AgNTxxxxxx',
						identity: { id: 'uuid', name: 'MyAgent', owner: 'wallet...', asset_pubkey: 'AgNTxx', network: 'mainnet' },
						reputation: { total: 12, verified: 9, disputed: 1, score_avg: 4.3, score_avg_verified: 4.6 },
						validation: { passed: 3, failed: 0 },
						recent_attestations: [],
						schemas_url: 'https://three.ws/.well-known/agent-attestation-schemas',
					},
					schema: {
						type: 'object',
						required: ['agent', 'identity', 'reputation', 'validation', 'recent_attestations'],
						properties: {
							agent: { type: 'string' },
							identity: { type: 'object' },
							reputation: { type: 'object' },
							validation: { type: 'object' },
							recent_attestations: { type: 'array' },
							schemas_url: { type: 'string' },
						},
					},
				},
			}),
		},
	},
};

const app = express();
app.use(paymentMiddleware(routeConfig, resourceServer));

app.get(ROUTE, async (req, res) => {
	const asset = String(req.query?.asset || '').trim();
	const network = req.query?.network === 'mainnet' ? 'mainnet' : 'devnet';

	if (!asset) {
		return res.status(400).json({ error: 'missing_asset', message: 'query param "asset" is required' });
	}

	const tool = TOOLS['solana_agent_passport'];
	if (!tool) {
		return res.status(500).json({ error: 'internal_error', message: 'passport tool not available' });
	}

	let result;
	try {
		result = await tool.handler({ asset, network });
	} catch (err) {
		const status = err.status || 500;
		return res.status(status).json({ error: err.code || 'handler_error', message: err.message });
	}

	if (result?.isError) {
		return res.status(502).json({ error: 'upstream_error', message: result.content?.[0]?.text || 'upstream failed' });
	}

	res.setHeader('cache-control', 'no-store');
	return res.json(result.structuredContent ?? JSON.parse(result.content[0].text));
});

app.use((err, req, res, _next) => {
	console.error('[x402/solana-agent-passport] unhandled', err);
	res.status(500).json({ error: 'internal_error', message: err?.message || 'unknown error' });
});

export default app;
