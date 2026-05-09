// x402 buyer client — fires a real paid request against an x402 endpoint and
// prints the response + settlement details.
//
// USAGE
//   BUYER_PRIVATE_KEY=0x... node scripts/x402-pay.mjs <url> [field=value ...]
//
// EXAMPLES
//   # Smoke-test our own revenue-vision endpoint after deploy:
//   BUYER_PRIVATE_KEY=0xabc... node scripts/x402-pay.mjs \
//     https://three.ws/api/insights/revenue-vision \
//     agent_codename=ledger-bot \
//     power_request=revenue-vision \
//     mission_brief="Find the highest-converting buyer segment this week."
//
//   # Hit the model-check endpoint:
//   BUYER_PRIVATE_KEY=0xabc... node scripts/x402-pay.mjs \
//     https://three.ws/api/x402/model-check \
//     url=https://three.ws/avatar/character-studio/sample.glb
//
// REQUIREMENTS
//   * BUYER_PRIVATE_KEY — hex EVM private key (0x...). Wallet must hold USDC on
//     Base mainnet (or Arbitrum One — script auto-selects whichever the endpoint
//     accepts that's listed first). $0.001 USDC + a tiny amount of ETH for gas.
//   * Node 20+ (uses native fetch).
//
// BAZAAR INDEXING
//   The first successful settle through the CDP facilitator is what triggers
//   agentic.market to index your endpoint. Run this script once with a real
//   buyer wallet and you're listed.

import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;
if (!BUYER_PRIVATE_KEY) {
	console.error('error: BUYER_PRIVATE_KEY env var is required (0x-prefixed hex)');
	process.exit(2);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(BUYER_PRIVATE_KEY)) {
	console.error(
		'error: BUYER_PRIVATE_KEY must be 0x + 64 hex chars (32-byte ECDSA secp256k1 key)',
	);
	process.exit(2);
}

const args = process.argv.slice(2);
if (!args.length) {
	console.error(
		'usage: BUYER_PRIVATE_KEY=0x... node scripts/x402-pay.mjs <url> [field=value ...]',
	);
	process.exit(2);
}

const targetUrl = args[0];
const params = new URLSearchParams();
for (const pair of args.slice(1)) {
	const eq = pair.indexOf('=');
	if (eq === -1) {
		console.error(`error: argument "${pair}" must be in field=value form`);
		process.exit(2);
	}
	params.set(pair.slice(0, eq), pair.slice(eq + 1));
}

const url = new URL(targetUrl);
for (const [k, v] of params) url.searchParams.set(k, v);

const account = privateKeyToAccount(BUYER_PRIVATE_KEY);
console.log(`buyer wallet: ${account.address}`);
console.log(`target:       ${url.toString()}`);
console.log();

// `eip155:*` registers the same scheme for any EVM chain — the facilitator's
// first-listed accepts entry decides which one we actually pay on.
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
	schemes: [{ network: 'eip155:*', client: new ExactEvmScheme(account) }],
});

const t0 = Date.now();
let res;
try {
	res = await fetchWithPayment(url.toString(), { method: 'GET' });
} catch (err) {
	console.error('request failed:', err?.message || err);
	if (err?.cause) console.error('cause:', err.cause);
	process.exit(1);
}
const elapsed = Date.now() - t0;

console.log(`HTTP ${res.status}  (${elapsed}ms)`);

const paymentResponseHeader =
	res.headers.get('payment-response') || res.headers.get('PAYMENT-RESPONSE');
if (paymentResponseHeader) {
	try {
		const decoded = decodePaymentResponseHeader(paymentResponseHeader);
		console.log('settlement:');
		console.log(`  network:     ${decoded.network}`);
		console.log(`  payer:       ${decoded.payer}`);
		console.log(`  transaction: ${decoded.transaction}`);
	} catch (err) {
		console.warn('could not decode payment-response header:', err?.message);
	}
}

const text = await res.text();
console.log('body:');
try {
	console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
	console.log(text);
}

if (!res.ok) process.exit(1);
