// POST /api/x402/solana-tx-explain
//
// Paid endpoint (CDP Bazaar, x402 v2). For $0.002 USDC on Base or Arbitrum
// mainnet the server fetches a Solana transaction via Helius, extracts token
// transfers, native SOL transfers, type, fee payer, and description, then
// optionally appends a plain-English AI summary via OpenRouter.
//
// Wire stack: @x402/express + @x402/evm + @coinbase/x402.

import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { facilitator as cdpFacilitator } from '@coinbase/x402';

import { env } from '../_lib/env.js';

const NETWORK_BASE = 'eip155:8453';
const NETWORK_ARBITRUM = 'eip155:42161';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ASSET_FOR_NETWORK = {
	[NETWORK_BASE]: USDC_BASE,
	[NETWORK_ARBITRUM]: env.X402_ASSET_ADDRESS_ARBITRUM,
};

const PAY_TO = env.X402_PAY_TO_BASE;
const PRICE = '$0.002';
const ROUTE = '/api/x402/solana-tx-explain';

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
	'three.ws Solana TX Explain — decode a Solana transaction signature via Helius ' +
	'and return structured token transfers, native SOL transfers, transaction type, ' +
	'fee payer, description, and an optional plain-English AI summary. Useful for ' +
	'agents that need to audit or narrate on-chain activity without holding an API key. ' +
	'$0.002 USDC on Base or Arbitrum mainnet.';

const routeConfig = {
	[`POST ${ROUTE}`]: {
		accepts: buildAccepts(),
		description: ROUTE_DESCRIPTION,
		mimeType: 'application/json',
		extensions: {
			...declareDiscoveryExtension({
				input: { signature: '5KtPn3...' },
				inputSchema: {
					type: 'object',
					required: ['signature'],
					properties: {
						signature: {
							type: 'string',
							description: 'Base58 Solana transaction signature.',
						},
					},
					additionalProperties: false,
				},
				output: {
					example: {
						signature: '5KtPn3...',
						type: 'TRANSFER',
						description: 'Wallet A transferred 10 USDC to Wallet B.',
						feePayer: 'wallet...',
						tokenTransfers: [{ mint: 'EPjFW...', fromUserAccount: '...', toUserAccount: '...', tokenAmount: 10 }],
						nativeTransfers: [],
						summary: 'This transaction transferred 10 USDC from Wallet A to Wallet B with a fee of 0.000005 SOL.',
					},
					schema: {
						type: 'object',
						required: ['signature', 'type', 'feePayer', 'tokenTransfers', 'nativeTransfers'],
						properties: {
							signature: { type: 'string' },
							type: { type: 'string' },
							description: { type: 'string' },
							feePayer: { type: 'string' },
							tokenTransfers: { type: 'array' },
							nativeTransfers: { type: 'array' },
							summary: { type: 'string', description: 'AI-generated plain-English summary (present when OpenRouter is configured).' },
						},
					},
				},
			}),
		},
	},
};

const app = express();
app.use(express.json());
app.use(paymentMiddleware(routeConfig, resourceServer));

app.post(ROUTE, async (req, res) => {
	const signature = String(req.body?.signature || '').trim();

	if (!signature) {
		return res.status(400).json({ error: 'missing_signature', message: 'body field "signature" is required' });
	}
	if (!env.HELIUS_API_KEY) {
		return res.status(503).json({ error: 'service_unavailable', message: 'Helius API not configured on this server' });
	}

	let heliusResp;
	try {
		heliusResp = await fetch(
			`https://api.helius.xyz/v0/transactions/?api-key=${env.HELIUS_API_KEY}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ transactions: [signature] }),
				signal: AbortSignal.timeout(15_000),
			},
		);
	} catch (err) {
		return res.status(502).json({ error: 'upstream_timeout', message: 'Helius request timed out' });
	}

	if (!heliusResp.ok) {
		const txt = await heliusResp.text().catch(() => '');
		return res.status(502).json({ error: 'upstream_error', message: `Helius ${heliusResp.status}: ${txt}` });
	}

	const data = await heliusResp.json();
	if (!Array.isArray(data) || data.length === 0) {
		return res.status(404).json({ error: 'not_found', message: 'transaction not found' });
	}

	const tx = data[0];
	const payload = {
		signature,
		type: tx.type || '',
		description: tx.description || '',
		feePayer: tx.feePayer || '',
		tokenTransfers: tx.tokenTransfers || [],
		nativeTransfers: tx.nativeTransfers || [],
	};

	if (env.OPENROUTER_API_KEY) {
		try {
			const summaryResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://three.ws',
					'X-Title': 'three.ws tx explainer',
				},
				body: JSON.stringify({
					model: 'meta-llama/llama-3.1-8b-instruct:free',
					max_tokens: 200,
					messages: [{
						role: 'user',
						content: `Summarize this Solana transaction in one plain-English paragraph. Be concise. Data: ${JSON.stringify(payload)}`,
					}],
				}),
				signal: AbortSignal.timeout(10_000),
			});
			if (summaryResp.ok) {
				const summaryJson = await summaryResp.json();
				const text = summaryJson.choices?.[0]?.message?.content;
				if (text) payload.summary = text.trim();
			}
		} catch {
			// summary is optional
		}
	}

	res.setHeader('cache-control', 'no-store');
	return res.json(payload);
});

app.use((err, req, res, _next) => {
	console.error('[x402/solana-tx-explain] unhandled', err);
	res.status(500).json({ error: 'internal_error', message: err?.message || 'unknown error' });
});

export default app;
