#!/usr/bin/env node
// Drive the CDP-Bazaar listing by paying for /api/x402/model-check exactly once.
//
// The CDP Bazaar catalog only indexes endpoints whose first verify+settle has
// been processed by the CDP facilitator. Until this script runs successfully
// against a deployed instance, the endpoint won't appear on agentic.market.
//
// Usage:
//   X402_BUYER_PRIVATE_KEY=0x...        # funded wallet, USDC + gas on the chosen network
//   X402_TARGET=https://three.ws/api/x402/model-check
//   X402_NETWORK=base                   # "base" or "arbitrum"
//   node scripts/x402-first-paid-request.mjs
//
// Pre-flight: needs ≥0.001 USDC of the target network's native USDC and a
// few cents of native gas (ETH). Use https://faucet.circle.com or fund from
// Coinbase. Same private key works on both Base and Arbitrum.

import { wrapFetchWithPayment } from '@x402/fetch';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, arbitrum } from 'viem/chains';

const PRIVATE_KEY = process.env.X402_BUYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
	console.error('Missing X402_BUYER_PRIVATE_KEY (0x-prefixed funded EVM private key).');
	process.exit(2);
}

const TARGET =
	process.env.X402_TARGET ||
	'https://three.ws/api/x402/model-check?url=' +
		encodeURIComponent('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF-Binary/DamagedHelmet.glb');

const NETWORK = (process.env.X402_NETWORK || 'base').toLowerCase();
const CHAIN = NETWORK === 'arbitrum' ? arbitrum : base;
if (NETWORK !== 'base' && NETWORK !== 'arbitrum') {
	console.error(`X402_NETWORK must be "base" or "arbitrum"; got "${NETWORK}"`);
	process.exit(2);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({
	account,
	chain: CHAIN,
	transport: http(process.env.X402_RPC_URL || undefined),
});

console.log(`[x402] buyer ${account.address} on ${CHAIN.name}`);
console.log(`[x402] GET ${TARGET}`);

const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient);

const t0 = Date.now();
const res = await fetchWithPayment(TARGET, { method: 'GET' });
const elapsed = Date.now() - t0;

const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = text; }

const settle = res.headers.get('payment-response') || res.headers.get('x-payment-response');
console.log(`[x402] HTTP ${res.status} in ${elapsed}ms`);
if (settle) {
	try {
		const decoded = JSON.parse(Buffer.from(settle, 'base64').toString('utf8'));
		console.log('[x402] settlement:', decoded);
	} catch {
		console.log('[x402] payment-response (raw):', settle);
	}
}
console.log('[x402] body:', body);

if (!res.ok) process.exit(1);
console.log('\nDone. Re-validate at https://agentic.market/validate to confirm the endpoint is now Bazaar-indexed.');
