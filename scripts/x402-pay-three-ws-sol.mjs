import { readFileSync } from 'node:fs';
import {
  Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getMint,
} from '@solana/spl-token';

const secretArr = JSON.parse(readFileSync('/home/codespace/.config/x402-test-wallets/solana.json', 'utf8'));
const buyer = Keypair.fromSecretKey(Uint8Array.from(secretArr));
const RPC = 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');
console.log('[x402] buyer:', buyer.publicKey.toBase58());

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
const accept = initBody.accepts.find(a => a.network.startsWith('solana:'));
console.log('  accept:', accept.network, accept.amount, 'to', accept.payTo);
console.log('  feePayer:', accept.extra.feePayer);

const mint = new PublicKey(accept.asset);
const payTo = new PublicKey(accept.payTo);
const feePayer = new PublicKey(accept.extra.feePayer);
const amount = BigInt(accept.amount);

const senderAta = getAssociatedTokenAddressSync(mint, buyer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const receiverAta = getAssociatedTokenAddressSync(mint, payTo, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
console.log('  senderATA:', senderAta.toBase58());
console.log('  receiverATA:', receiverAta.toBase58());

const mintInfo = await getMint(conn, mint);

const ixs = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
];
const receiverInfo = await conn.getAccountInfo(receiverAta);
if (!receiverInfo) {
  console.log('  receiver ATA missing — including idempotent create (payer = feePayer)');
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(
    feePayer, receiverAta, payTo, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  ));
}
ixs.push(createTransferCheckedInstruction(
  senderAta, mint, receiverAta, buyer.publicKey,
  amount, mintInfo.decimals, [], TOKEN_PROGRAM_ID,
));

const { blockhash } = await conn.getLatestBlockhash('confirmed');
const message = new TransactionMessage({
  payerKey: feePayer,
  recentBlockhash: blockhash,
  instructions: ixs,
}).compileToV0Message();
const vtx = new VersionedTransaction(message);
vtx.sign([buyer]);

const txBase64 = Buffer.from(vtx.serialize()).toString('base64');
console.log('[x402] partially-signed tx size:', txBase64.length, 'b64 chars');

const paymentPayload = {
  x402Version: 2,
  scheme: 'exact',
  network: accept.network,
  resource: { url, mimeType: 'application/json' },
  accepted: accept,
  payload: { transaction: txBase64 },
};
const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

console.log('[x402] POST 2 (X-PAYMENT, Solana exact)');
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
const summary = typeof parsed === 'object' && parsed !== null
  ? { status: paidRes.status, error: parsed.error, has_result: !!parsed.result }
  : (typeof parsed === 'string' ? parsed.slice(0, 500) : parsed);
console.log('[x402] summary:', summary);

if (paidRes.ok && parsed?.result) {
  console.log('[x402] result preview:', JSON.stringify(parsed.result, null, 2).slice(0, 700));
  console.log('\nDone — Bazaar should index in a few minutes.');
} else {
  process.exit(1);
}
