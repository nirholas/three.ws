import { readFileSync } from 'node:fs';
import { createPublicClient, http, hexToBigInt, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { randomBytes } from 'node:crypto';

const PK = readFileSync('/home/codespace/.config/x402-test-wallets/base.privkey.txt', 'utf8').trim();
const account = privateKeyToAccount(PK);
const RPC = 'https://mainnet.base.org';
const publicClient = createPublicClient({ chain: base, transport: http(RPC) });

console.log('[x402] buyer:', account.address);

const url = 'https://three.ws/api/mcp';
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

console.log('[x402] POST 1 (no payment)');
const initRes = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body,
});
console.log('  ->', initRes.status);
const initBody = await initRes.json();
const accept = initBody.accepts.find(a => a.network === 'eip155:8453');
console.log('  accept:', accept.network, accept.amount, 'to', accept.payTo);

const now = Math.floor(Date.now() / 1000);
const validAfter = (now - 60).toString();
const validBefore = (now + accept.maxTimeoutSeconds + 60).toString();
const nonce = '0x' + randomBytes(32).toString('hex');

const authorization = {
  from: account.address,
  to: accept.payTo,
  value: accept.amount,
  validAfter,
  validBefore,
  nonce,
};

const domain = {
  name: 'USD Coin',
  version: accept.extra.version,
  chainId: 8453,
  verifyingContract: accept.asset,
};
const types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

console.log('[x402] signing EIP-3009 transferWithAuthorization (v2 payload)...');
const signature = await account.signTypedData({
  domain,
  types,
  primaryType: 'TransferWithAuthorization',
  message: {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  },
});

const paymentPayload = {
  x402Version: 2,
  scheme: 'exact',
  network: 'eip155:8453',
  payload: { signature, authorization },
};
console.log('  payload keys:', Object.keys(paymentPayload), ' size:', Buffer.byteLength(JSON.stringify(paymentPayload)), 'bytes');

const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

console.log('[x402] POST 2 (X-PAYMENT, v2 payload)');
const t0 = Date.now();
const paidRes = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'accept': 'application/json',
    'X-PAYMENT': xPayment,
  },
  body,
});
const ms = Date.now() - t0;
console.log(`  -> HTTP ${paidRes.status} in ${ms}ms`);

const settle = paidRes.headers.get('x-payment-response') || paidRes.headers.get('payment-response');
if (settle) {
  try {
    const decoded = JSON.parse(Buffer.from(settle, 'base64').toString('utf8'));
    console.log('[x402] settlement:', JSON.stringify(decoded, null, 2));
  } catch { console.log('[x402] settle (raw):', settle.slice(0, 300)); }
}
const text = await paidRes.text();
let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
const summary = typeof parsed === 'object'
  ? { status: paidRes.status, error: parsed.error, has_result: !!parsed.result }
  : parsed.slice(0, 500);
console.log('[x402] response summary:', summary);

if (paidRes.ok && parsed?.result) {
  const tools = parsed.result?.tools || parsed.result?.content;
  console.log('[x402] tools/result preview:', JSON.stringify(tools, null, 2).slice(0, 600));
  console.log('\nDone — verify+settle landed. Bazaar should index in a few minutes.');
} else {
  process.exit(1);
}
