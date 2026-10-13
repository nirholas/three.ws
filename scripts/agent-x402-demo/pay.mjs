// Agent x402 payment demo — record this terminal session.
//
// An AI agent calls a REAL, live three.ws paid service, hits HTTP 402, and pays
// for it ITSELF in USDC on Solana — no card, no human — settled on-chain by the
// Coinbase/PayAI x402 facilitator. Then it shows the paid result + the
// settlement transaction on Solscan. Every byte hits production (https://three.ws);
// nothing is mocked.
//
//   node scripts/agent-x402-demo/pay.mjs                 # default service
//   node scripts/agent-x402-demo/pay.mjs agent-reputation
//   node scripts/agent-x402-demo/pay.mjs pump-agent-audit
//
// One-time: fund the printed wallet address with a few dollars of USDC on
// Solana mainnet (the agent pays per call; PayAI covers the network fee, so the
// wallet needs USDC only — no SOL required).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	createTransferCheckedInstruction,
	getMint,
	getAccount,
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const HERE = dirname(fileURLToPath(import.meta.url));
const WALLET_FILE = resolve(HERE, 'wallet.local.json');
const BASE_URL = process.env.X402_BASE_URL || 'https://three.ws';
const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const X402_VERSION = 2;
const SOLANA_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const bs58decode = bs58.default ? bs58.default.decode : bs58.decode;
const bs58encode = bs58.default ? bs58.default.encode : bs58.encode;

// A curated menu of live, GET-able paid services with a tangible result.
const SERVICES = {
	'agent-reputation': { url: '/api/x402/agent-reputation?agent_id=76bca598-103f-4e3a-8c95-b0d64993258a', blurb: 'an on-chain reputation score for another agent' },
	'pump-agent-audit': { url: '/api/x402/pump-agent-audit?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump', blurb: "an audit of a live pump.fun agent's token" },
	'symbol-availability': { url: '/api/x402/symbol-availability?ticker=WWWTEST', blurb: 'whether a token ticker is still available' },
};

// ── terminal UI ───────────────────────────────────────────────────────────────
const C = { r: '\x1b[0m', dim: '\x1b[2m', b: '\x1b[1m', p: '\x1b[38;5;141m', g: '\x1b[38;5;120m', c: '\x1b[38;5;87m', y: '\x1b[38;5;221m', gray: '\x1b[38;5;245m', red: '\x1b[38;5;203m' };
const PACE = Number(process.env.PACE ?? 700);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function say(line, color = '\x1b[97m') { process.stdout.write(`${color}${line}${C.r}\n`); if (PACE) await sleep(PACE); }
async function think(line) { process.stdout.write(`${C.gray}${C.dim}  🧠 ${line}${C.r}\n`); if (PACE) await sleep(PACE); }
const rule = () => console.log(C.dim + '─'.repeat(70) + C.r);

// ── wallet ──────────────────────────────────────────────────────────────────
function loadOrCreateWallet() {
	if (existsSync(WALLET_FILE)) {
		const raw = JSON.parse(readFileSync(WALLET_FILE, 'utf8'));
		return Keypair.fromSecretKey(bs58decode(raw.secret));
	}
	const kp = Keypair.generate();
	writeFileSync(WALLET_FILE, JSON.stringify({ pubkey: kp.publicKey.toBase58(), secret: bs58encode(kp.secretKey) }, null, 2) + '\n', { mode: 0o600 });
	return kp;
}

async function usdcBalance(conn, owner) {
	try {
		const ata = getAssociatedTokenAddressSync(USDC_MINT, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
		const acct = await getAccount(conn, ata, 'confirmed', TOKEN_PROGRAM_ID);
		return Number(acct.amount) / 1e6;
	} catch {
		return 0;
	}
}

// ── the proven x402 SVM "exact" payment construction ──────────────────────────
async function buildAndSignPayment({ kp, conn, requirement }) {
	const mint = new PublicKey(requirement.asset);
	const payTo = new PublicKey(requirement.payTo);
	const feePayer = new PublicKey(requirement.extra.feePayer);
	const amount = BigInt(requirement.amount);
	const mintInfo = await getMint(conn, mint);
	const senderAta = getAssociatedTokenAddressSync(mint, kp.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
	const receiverAta = getAssociatedTokenAddressSync(mint, payTo, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

	const tx = new Transaction();
	const { blockhash } = await conn.getLatestBlockhash('confirmed');
	tx.recentBlockhash = blockhash;
	tx.feePayer = feePayer;
	tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }));
	tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }));
	tx.add(createTransferCheckedInstruction(senderAta, mint, receiverAta, kp.publicKey, amount, mintInfo.decimals, [], TOKEN_PROGRAM_ID));
	tx.partialSign(kp);
	return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
}

const pickSolana = (env) => (env.accepts || []).find((a) => a.scheme === 'exact' && String(a.network).startsWith('solana')) || null;
const encodeHeader = (p) => Buffer.from(JSON.stringify(p), 'utf8').toString('base64');

// ── run ───────────────────────────────────────────────────────────────────────
const which = process.argv[2] || 'agent-reputation';
const service = SERVICES[which];
if (!service) { console.error(`Unknown service "${which}". Options: ${Object.keys(SERVICES).join(', ')}`); process.exit(1); }

const conn = new Connection(RPC, 'confirmed');
const kp = loadOrCreateWallet();

console.clear();
console.log(`${C.p}${C.b}
  ╔══════════════════════════════════════════════════════════════════════╗
  ║   three.ws · the agent economy, live                                   ║
  ║   an AI agent pays for a real service in USDC — no card, no human       ║
  ║   x402 over HTTP · settled on Solana by the Coinbase / PayAI facilitator ║
  ╚══════════════════════════════════════════════════════════════════════╝${C.r}`);
await sleep(PACE);

await say(`\n  Agent wallet: ${C.b}${kp.publicKey.toBase58()}${C.r}`, C.c);
const bal = await usdcBalance(conn, kp.publicKey);
await say(`  USDC balance: ${C.b}$${bal.toFixed(2)}${C.r}`, C.gray);

if (bal <= 0) {
	rule();
	await say(`\n  ${C.y}Fund this wallet with a few dollars of USDC on Solana mainnet, then re-run:${C.r}`);
	await say(`    ${C.b}${kp.publicKey.toBase58()}${C.r}`, C.c);
	await say(`  ${C.gray}(PayAI covers the network fee — the agent needs USDC only, no SOL.)${C.r}`);
	await say(`    node scripts/agent-x402-demo/pay.mjs ${which}`, C.gray);
	process.exit(0);
}

rule();
await say(`\n  ${C.b}GOAL:${C.r} the agent wants ${service.blurb}.`, C.y);
await think(`Calling the service at ${service.url} …`);

// 1. Hit the endpoint → expect 402.
const url = `${BASE_URL}${service.url}`;
const probe = await fetch(url);
if (probe.status !== 402) { await say(`  Unexpected ${probe.status} (endpoint not gated?).`, C.red); process.exit(1); }
const envelope = await probe.json();
const requirement = pickSolana(envelope);
if (!requirement) { await say('  No Solana payment option offered.', C.red); process.exit(1); }
const price = (Number(requirement.amount) / 1e6).toFixed(4);
console.log(`\n${C.p}  ← HTTP 402 Payment Required${C.r}`);
await say(`    price: ${C.b}$${price} USDC${C.r}   facilitator fee-payer: ${requirement.extra.feePayer.slice(0, 8)}…`, C.gray);

// 2. Build + sign the USDC payment itself.
await think('I will pay for it myself — building and signing a USDC transfer.');
const txB64 = await buildAndSignPayment({ kp, conn, requirement });
const payload = {
	x402Version: X402_VERSION,
	scheme: 'exact',
	network: requirement.network,
	resource: { url: envelope.resource?.url || url, mimeType: envelope.resource?.mimeType || 'application/json' },
	accepted: requirement,
	payload: { transaction: txB64 },
};

// 3. Retry with X-PAYMENT — server verifies + settles on-chain via PayAI.
await say(`\n  ${C.b}→ retrying with X-PAYMENT …${C.r}  ${C.gray}(server verifies, PayAI co-signs + broadcasts)${C.r}`, C.c);
const t0 = Date.now();
const res = await fetch(url, { headers: { 'X-PAYMENT': encodeHeader(payload) } });
const ms = Date.now() - t0;
const body = await res.text();

if (res.status !== 200) { await say(`\n  ✗ ${res.status}: ${body.slice(0, 200)}`, C.red); process.exit(1); }

const payTx = res.headers.get('x-payment-tx');
const payNet = res.headers.get('x-payment-network') || 'solana';
console.log(`\n${C.g}${C.b}  ✓ Paid and served in ${ms}ms.${C.r}`);
if (payTx) {
	await say(`    settled on ${payNet}: ${payTx}`, C.gray);
	await say(`    ${C.c}${C.b}https://solscan.io/tx/${payTx}${C.r}`);
}
rule();
await say(`\n  ${C.b}The paid result:${C.r}`, C.y);
let pretty = body;
try { pretty = JSON.stringify(JSON.parse(body), null, 2); } catch { /* keep raw */ }
console.log(pretty.length > 900 ? pretty.slice(0, 900) + '…' : pretty);
const after = await usdcBalance(conn, kp.publicKey);
await say(`\n  ${C.gray}Agent USDC: $${bal.toFixed(2)} → $${after.toFixed(2)}.  It just bought a service, by itself, on-chain.${C.r}`);
await say(`\n  ${C.c}The agent economy, in the open. · three.ws${C.r}\n`);
process.exit(0);
