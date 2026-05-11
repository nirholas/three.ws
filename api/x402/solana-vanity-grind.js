// POST /api/x402/solana-vanity-grind
//
// Paid endpoint cataloged by the CDP x402 Bazaar (agentic.market). For $0.05
// USDC on Base or Arbitrum mainnet the server runs Keypair.generate() in a
// tight loop until a Solana address matching the requested prefix and/or suffix
// is found, then returns the full keypair (publicKey + secretKey in Base58).
//
// Pattern limits: prefix + suffix ≤ 4 Base58 chars total. Longer patterns
// exceed Vercel's 60-second function budget at ~50k keys/s. The grind aborts
// after 45 s (3 M attempts) and returns 408 so the client can retry with a
// shorter or case-insensitive pattern.
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
import bs58 from 'bs58';

import { env } from '../_lib/env.js';
import { generateVanityKey } from '../../src/pump/vanity-keygen.js';
import { validatePattern } from '../../src/solana/vanity/validation.js';

const NETWORK_BASE = 'eip155:8453';
const NETWORK_ARBITRUM = 'eip155:42161';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ASSET_FOR_NETWORK = {
	[NETWORK_BASE]: USDC_BASE,
	[NETWORK_ARBITRUM]: env.X402_ASSET_ADDRESS_ARBITRUM,
};

const PAY_TO = env.X402_PAY_TO_BASE;
const PRICE = '$0.05';
const ROUTE = '/api/x402/solana-vanity-grind';
const MAX_TOTAL_CHARS = 4;
const GRIND_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3_000_000;

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
	'three.ws Solana Vanity Grind — server-side Keypair.generate() loop that finds ' +
	'a Solana address matching your prefix and/or suffix. Returns the full keypair ' +
	'(publicKey + secretKey in Base58). Pattern must be valid Base58 chars; total ' +
	'length (prefix + suffix combined) ≤ 4 chars. Case-insensitive mode halves ' +
	'expected attempts. Useful for agents that need a branded wallet address ' +
	'(e.g. starts with "AGNT" or ends with "pump"). $0.05 USDC per grind on Base ' +
	'or Arbitrum mainnet.';

const routeConfig = {
	[`POST ${ROUTE}`]: {
		accepts: buildAccepts(),
		description: ROUTE_DESCRIPTION,
		mimeType: 'application/json',
		extensions: {
			...declareDiscoveryExtension({
				input: { prefix: 'AGNT', caseSensitive: false },
				inputSchema: {
					type: 'object',
					properties: {
						prefix: {
							type: 'string',
							minLength: 1,
							maxLength: 4,
							description: 'Base58 chars the address must start with.',
						},
						suffix: {
							type: 'string',
							minLength: 1,
							maxLength: 4,
							description: 'Base58 chars the address must end with.',
						},
						caseSensitive: {
							type: 'boolean',
							default: false,
							description: 'When false (default), matching ignores case — roughly halves expected attempts.',
						},
					},
					additionalProperties: false,
				},
				output: {
					example: {
						publicKey: 'AGNTvzDpqJa3fGsR7wHXbMkQ2nL6eTcxAoZiByNuPW8',
						secretKey: '3CGhVykNGJoXLTG7XMimwVpWbNBnrxMcZSF6Lz9UZix...',
						attempts: 42789,
						ms: 1432,
						pattern: { prefix: 'AGNT', suffix: '', caseSensitive: false },
					},
					schema: {
						type: 'object',
						required: ['publicKey', 'secretKey', 'attempts', 'ms', 'pattern'],
						properties: {
							publicKey: { type: 'string', description: 'Base58 Solana address.' },
							secretKey: {
								type: 'string',
								description: 'Base58-encoded 64-byte Ed25519 secret key. Store securely — never share.',
							},
							attempts: { type: 'integer', description: 'Total keypairs generated.' },
							ms: { type: 'integer', description: 'Wall-clock time in milliseconds.' },
							pattern: {
								type: 'object',
								properties: {
									prefix: { type: 'string' },
									suffix: { type: 'string' },
									caseSensitive: { type: 'boolean' },
								},
							},
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
	const prefix = String(req.body?.prefix ?? '').trim();
	const suffix = String(req.body?.suffix ?? '').trim();
	const caseSensitive = !!req.body?.caseSensitive;

	if (!prefix && !suffix) {
		return res.status(400).json({
			error: 'validation_error',
			message: 'at least one of prefix or suffix is required',
		});
	}

	const totalLen = prefix.length + suffix.length;
	if (totalLen > MAX_TOTAL_CHARS) {
		return res.status(400).json({
			error: 'pattern_too_long',
			message: `prefix + suffix must be ≤ ${MAX_TOTAL_CHARS} chars total (got ${totalLen})`,
		});
	}

	if (prefix) {
		const v = validatePattern(prefix);
		if (!v.valid) {
			return res.status(400).json({ error: 'invalid_prefix', message: v.errors.join('; ') });
		}
	}
	if (suffix) {
		const v = validatePattern(suffix);
		if (!v.valid) {
			return res.status(400).json({ error: 'invalid_suffix', message: v.errors.join('; ') });
		}
	}

	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), GRIND_TIMEOUT_MS);

	let result;
	try {
		result = await generateVanityKey({
			prefix,
			suffix,
			caseSensitive,
			maxAttempts: MAX_ATTEMPTS,
			signal: ac.signal,
		});
	} catch (err) {
		clearTimeout(timer);
		return res.status(500).json({ error: 'grind_error', message: err.message });
	}
	clearTimeout(timer);

	if (!result) {
		return res.status(408).json({
			error: 'not_found',
			message: `no match in ${MAX_ATTEMPTS.toLocaleString()} attempts; try fewer chars or caseSensitive: false`,
			attempts: MAX_ATTEMPTS,
		});
	}

	const encode = typeof bs58.encode === 'function' ? bs58.encode : bs58.default.encode;

	res.setHeader('cache-control', 'no-store');
	return res.json({
		publicKey: result.publicKey,
		secretKey: encode(result.secretKey),
		attempts: result.attempts,
		ms: result.ms,
		pattern: { prefix, suffix, caseSensitive },
	});
});

app.use((err, req, res, _next) => {
	console.error('[x402/solana-vanity-grind] unhandled', err);
	res.status(500).json({ error: 'internal_error', message: err?.message || 'unknown error' });
});

export default app;
