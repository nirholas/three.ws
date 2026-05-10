import { randomBytes } from 'node:crypto';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import {
  Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';

const CHAIN = (process.env.CHAIN || 'base').toLowerCase();
const URL = 'https://three.ws/api/mcp';

const TOOL_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'validate_model',
    arguments: { url: 'https://threejs.org/examples/models/gltf/Duck/glTF/Duck.gltf' },
  },
});

console.log('fetching 402 spec from three.ws/api/mcp…');
const initRes = await fetch(URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: TOOL_BODY,
});

if (initRes.status !== 402) {
  const text = await initRes.text();
  console.error(`unexpected status ${initRes.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}

const spec = await initRes.json();

if (CHAIN === 'base') {
  const PK = process.env.PK;
  if (!PK) { console.error('PK env var required for CHAIN=base'); process.exit(1); }

  const accept = spec.accepts.find(a => a.network === 'eip155:8453');
  if (!accept) { console.error('no eip155:8453 accept found in 402 spec'); process.exit(1); }

  console.log(`payTo (base): ${accept.payTo}`);

  const account = privateKeyToAccount(PK.startsWith('0x') ? PK : `0x${PK}`);

  const now = Math.floor(Date.now() / 1000);
  const validAfter = '0';
  const validBefore = (now + accept.maxTimeoutSeconds).toString();
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
    name: accept.extra?.name ?? 'USD Coin',
    version: accept.extra?.version ?? '2',
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

  console.log('signing EIP-3009 transferWithAuthorization…');
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
  const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  console.log('posting with X-PAYMENT header…');
  const paidRes = await fetch(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'X-PAYMENT': xPayment,
    },
    body: TOOL_BODY,
  });

  const settle = paidRes.headers.get('x-payment-response') || paidRes.headers.get('payment-response');
  if (settle) {
    try {
      const decoded = JSON.parse(Buffer.from(settle, 'base64').toString('utf8'));
      console.log('settlement:', JSON.stringify(decoded));
    } catch { /* raw header not JSON */ }
  }

  const text = await paidRes.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }

  if (!paidRes.ok) {
    console.error(`HTTP ${paidRes.status}:`, typeof parsed === 'object' ? JSON.stringify(parsed) : parsed);
    process.exit(1);
  }

  const result = parsed?.result;
  console.log(`✅ tool result: ${JSON.stringify(result)}`);
  console.log('check https://agentic.market to confirm indexing');

} else if (CHAIN === 'solana') {
  const SOLANA_KEY_BASE58 = process.env.SOLANA_KEY_BASE58;
  if (!SOLANA_KEY_BASE58) { console.error('SOLANA_KEY_BASE58 env var required for CHAIN=solana'); process.exit(1); }

  const accept = spec.accepts.find(a => a.network?.startsWith('solana:'));
  if (!accept) { console.error('no solana accept found in 402 spec'); process.exit(1); }

  console.log(`payTo (solana): ${accept.payTo}`);

  const secretBytes = bs58.decode(SOLANA_KEY_BASE58);
  const buyer = Keypair.fromSecretKey(secretBytes);
  const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(RPC, 'confirmed');

  const mint = new PublicKey(accept.asset);
  const payTo = new PublicKey(accept.payTo);
  const feePayer = new PublicKey(accept.extra.feePayer);
  const amount = BigInt(accept.amount);

  const senderAta = getAssociatedTokenAddressSync(mint, buyer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const receiverAta = getAssociatedTokenAddressSync(mint, payTo, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const mintInfo = await getMint(conn, mint);

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  const receiverInfo = await conn.getAccountInfo(receiverAta);
  if (!receiverInfo) {
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

  console.log('signing Solana SPL transferChecked…');
  vtx.sign([buyer]);

  const txBase64 = Buffer.from(vtx.serialize()).toString('base64');

  const paymentPayload = {
    x402Version: 2,
    scheme: 'exact',
    network: accept.network,
    resource: { url: URL, mimeType: 'application/json' },
    accepted: accept,
    payload: { transaction: txBase64 },
  };
  const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  console.log('posting with X-PAYMENT header…');
  const paidRes = await fetch(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'X-PAYMENT': xPayment,
    },
    body: TOOL_BODY,
  });

  const settle = paidRes.headers.get('x-payment-response') || paidRes.headers.get('payment-response');
  if (settle) {
    try {
      const decoded = JSON.parse(Buffer.from(settle, 'base64').toString('utf8'));
      console.log('settlement:', JSON.stringify(decoded));
    } catch { /* raw header not JSON */ }
  }

  const text = await paidRes.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }

  if (!paidRes.ok) {
    console.error(`HTTP ${paidRes.status}:`, typeof parsed === 'object' ? JSON.stringify(parsed) : parsed);
    process.exit(1);
  }

  const result = parsed?.result;
  console.log(`✅ tool result: ${JSON.stringify(result)}`);
  console.log('check https://agentic.market to confirm indexing');

} else {
  console.error(`unknown CHAIN="${CHAIN}" — use base or solana`);
  process.exit(1);
}
