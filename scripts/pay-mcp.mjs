/**
 * Pay https://three.ws/api/mcp via x402 exact scheme (Base mainnet).
 * Triggers CDP facilitator verify+settle → catalogs the endpoint in Coinbase Bazaar.
 *
 * Usage:
 *   node scripts/pay-mcp.mjs <private-key-hex>
 *
 * The wallet must have USDC on Base mainnet. Amount: 0.001 USDC (1000 atomic units).
 * Use a throwaway wallet — never pass a key from a wallet you use elsewhere.
 */

import { createWalletClient, createPublicClient, http, privateKeyToAccount } from 'viem';
import { base } from 'viem/chains';
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm';
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';

const key = process.argv[2];
if (!key) {
	console.error('Usage: node scripts/pay-mcp.mjs <private-key-hex>');
	process.exit(1);
}

const privateKey = key.startsWith('0x') ? key : `0x${key}`;
const account = privateKeyToAccount(privateKey);
console.log('Payer:', account.address);

const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

const signer = toClientEvmSigner(walletClient, publicClient);
const scheme = new ExactEvmScheme(signer);
const client = new x402Client().register('eip155:8453', scheme);
const fetchWithPay = wrapFetchWithPayment(fetch, client);

const url = 'https://three.ws/api/mcp';
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

console.log('Hitting', url, '...');
const res = await fetchWithPay(url, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body,
});

console.log('Status:', res.status);
const paymentResponse = res.headers.get('x-payment-response');
if (paymentResponse) {
	try {
		const settled = JSON.parse(Buffer.from(paymentResponse, 'base64').toString());
		console.log('Settlement:', JSON.stringify(settled, null, 2));
	} catch {
		console.log('X-Payment-Response (raw):', paymentResponse);
	}
}

if (res.status === 200) {
	const data = await res.json();
	console.log('Response:', JSON.stringify(data, null, 2).slice(0, 500));
} else {
	const text = await res.text();
	console.error('Error body:', text.slice(0, 500));
}
