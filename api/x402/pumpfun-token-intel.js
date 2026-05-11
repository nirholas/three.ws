// GET /api/x402/pumpfun-token-intel?mint=<base58>
//
// Paid endpoint (CDP Bazaar, x402 v2). For $0.005 USDC on Base or Arbitrum
// mainnet the server returns full pump.fun intel on a token: graduation status,
// bonding-curve progress, creator profile, top holders, volume, bundle
// detection, and trust signals.
//
// Wire stack: @x402/express + @x402/evm + @coinbase/x402.

import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { facilitator as cdpFacilitator } from '@coinbase/x402';

import { env } from '../_lib/env.js';
import { pumpfunMcp, pumpfunBotEnabled } from '../_lib/pumpfun-mcp.js';

const NETWORK_BASE = 'eip155:8453';
const NETWORK_ARBITRUM = 'eip155:42161';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ASSET_FOR_NETWORK = {
	[NETWORK_BASE]: USDC_BASE,
	[NETWORK_ARBITRUM]: env.X402_ASSET_ADDRESS_ARBITRUM,
};

const PAY_TO = env.X402_PAY_TO_BASE;
const PRICE = '$0.005';
const ROUTE = '/api/x402/pumpfun-token-intel';

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
	'three.ws Pump.fun Token Intel — full intelligence report on a pump.fun token: ' +
	'graduation status, bonding-curve progress, creator profile, top holders, volume, ' +
	'bundle detection, and behavioural trust signals. Pass ?mint=<base58>. ' +
	'$0.005 USDC on Base or Arbitrum mainnet.';

const routeConfig = {
	[`GET ${ROUTE}`]: {
		accepts: buildAccepts(),
		description: ROUTE_DESCRIPTION,
		mimeType: 'application/json',
		extensions: {
			...declareDiscoveryExtension({
				input: { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
				inputSchema: {
					type: 'object',
					required: ['mint'],
					properties: {
						mint: { type: 'string', description: 'Pump.fun SPL mint pubkey (base58).' },
					},
					additionalProperties: false,
				},
				output: {
					example: {
						mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
						graduated: false,
						bonding_curve_pct: 42.7,
						creator: { wallet: 'wallet...', graduation_rate: 0.12 },
						top_holders: [],
						trust_signals: { bundled: false, score: 0.8 },
					},
					schema: { type: 'object' },
				},
			}),
		},
	},
};

const app = express();
app.use(paymentMiddleware(routeConfig, resourceServer));

app.get(ROUTE, async (req, res) => {
	const mint = String(req.query?.mint || '').trim();

	if (!mint) {
		return res.status(400).json({ error: 'missing_mint', message: 'query param "mint" is required' });
	}
	if (!pumpfunBotEnabled()) {
		return res.status(503).json({ error: 'service_unavailable', message: 'pump.fun feed not configured on this server' });
	}

	let result;
	try {
		result = await pumpfunMcp.tokenIntel({ mint });
	} catch (err) {
		return res.status(err.status || 502).json({ error: 'upstream_error', message: err.message });
	}

	if (!result.ok) {
		return res.status(502).json({ error: 'upstream_error', message: result.error || 'pump.fun upstream error' });
	}

	res.setHeader('cache-control', 'no-store');
	return res.json(result.data);
});

app.use((err, req, res, _next) => {
	console.error('[x402/pumpfun-token-intel] unhandled', err);
	res.status(500).json({ error: 'internal_error', message: err?.message || 'unknown error' });
});

export default app;
