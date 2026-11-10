// Devnet proof for the human-task escrow legs: fund, release (payout + fee) and
// refund, signed by the real escrow code against the real devnet chain.
//
//   node scripts/qa-human-task-devnet.mjs [--keypair .deploy/devnet-payer.json]
//
// The funding wallet must hold devnet SOL (fees and rent) and at least 2.1 devnet
// USDC (Circle faucet, https://faucet.circle.com). It also acts as the marketplace
// fee payer. The escrow secret, the worker and the fee wallet are throwaway keys
// generated per run, so the production escrow secret is never loaded. The
// network is hard-coded to devnet; nothing here can touch mainnet.
//
// While the devnet faucets are out of reach, the same code can be proven on a
// local solana-test-validator seeded with the devnet USDC mint account (mint
// authority swapped to a throwaway key so test USDC can be minted): point
// SOLANA_RPC_URL_DEVNET at it. The closing line names which chain was used.
//
// Exit codes: 0 proven, 2 funding wallet short of devnet SOL or USDC (the single
// owner step is printed), 1 any failure.

import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';

const argv = process.argv.slice(2);
const keyPath = argv.includes('--keypair') ? argv[argv.indexOf('--keypair') + 1] : '.deploy/devnet-payer.json';
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8'))));

process.env.HUMAN_TASKS_NETWORK = 'devnet';
process.env.HUMAN_TASK_ESCROW_SECRET = randomBytes(32).toString('hex');
process.env.MARKETPLACE_PAYER_KEYPAIR = JSON.stringify([...funder.secretKey]);
const RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
process.env.SOLANA_RPC_URL_DEVNET = RPC;

const chain = await import('../api/_lib/human-tasks/chain.js');
const { tokenProgramFor, tokenBalance } = await import('../api/_lib/agent-market/chain.js');
const { computeEscrow, usdc } = await import('../api/_lib/human-tasks/money.js');

const conn = new Connection(RPC, 'confirmed');
const mint = chain.usdcMint('devnet');
const programId = await tokenProgramFor(conn, mint);
const BOUNTY = 1_000_000n;
const e = computeEscrow(BOUNTY, 100);

const sol = await conn.getBalance(funder.publicKey);
const have = await tokenBalance(conn, funder.publicKey.toBase58(), mint, programId);
console.log(`funder ${funder.publicKey.toBase58()}  ${(sol / 1e9).toFixed(4)} SOL  ${usdc(have)} USDC (devnet mint ${mint})`);
if (sol < 20_000_000 || have < e.escrow * 2n) {
	console.log(`\nShort of devnet funds. Send at least 0.02 SOL and ${usdc(e.escrow * 2n)} devnet USDC to ${funder.publicKey.toBase58()} (faucet.circle.com for USDC), then rerun this script.`);
	process.exit(2);
}

const worker = Keypair.generate().publicKey.toBase58();
const feeWallet = Keypair.generate().publicKey.toBase58();

async function fundEscrow(escrowAddress, atomics) {
	const mintPk = new (await import('@solana/web3.js')).PublicKey(mint);
	const escrowPk = new (await import('@solana/web3.js')).PublicKey(escrowAddress);
	const from = getAssociatedTokenAddressSync(mintPk, funder.publicKey, true, programId);
	const to = getAssociatedTokenAddressSync(mintPk, escrowPk, true, programId);
	const tx = new Transaction().add(
		createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, to, escrowPk, mintPk, programId),
		createTransferCheckedInstruction(from, mintPk, to, funder.publicKey, atomics, chain.USDC_DECIMALS, [], programId),
	);
	return sendAndConfirmTransaction(conn, tx, [funder], { commitment: 'confirmed' });
}

const bal = (addr) => tokenBalance(conn, addr, mint, programId);
const must = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok   ${msg}`); };

// Release path: fund, pay the worker, pay the fee, escrow ends empty.
const a = { id: randomUUID(), network: 'devnet' };
a.escrow_address = chain.escrowAddressFor(a.id);
console.log(`\nrelease task ${a.id} escrow ${a.escrow_address}`);
console.log(`fund   ${await fundEscrow(a.escrow_address, e.escrow)}`);
must((await chain.escrowBalance(a)) === e.escrow, `escrow holds ${usdc(e.escrow)} USDC`);
const pay = await chain.sendFromEscrow({ task: a, legId: `payout:${a.id}`, recipient: worker, atomics: e.bounty, prior: null, onPrepared: async () => {} });
console.log(`payout ${pay.signature}`);
const fee = await chain.sendFromEscrow({ task: a, legId: `fee:${a.id}`, recipient: feeWallet, atomics: e.fee, prior: null, onPrepared: async () => {} });
console.log(`fee    ${fee.signature}`);
must((await bal(worker)) === e.bounty, `worker received ${usdc(e.bounty)} USDC`);
must((await bal(feeWallet)) === e.fee, `fee wallet received ${usdc(e.fee)} USDC`);
must((await chain.escrowBalance(a)) === 0n, 'release escrow is empty');
const replay = await chain.sendFromEscrow({ task: a, legId: `payout:${a.id}`, recipient: worker, atomics: e.bounty, prior: { signature: pay.signature }, onPrepared: async () => {} });
must(replay.replayed === true && (await bal(worker)) === e.bounty, 'resending the payout leg is a no-op (exactly once)');

// Refund path: fund, send everything back to the funder.
const b = { id: randomUUID(), network: 'devnet' };
b.escrow_address = chain.escrowAddressFor(b.id);
console.log(`\nrefund task ${b.id} escrow ${b.escrow_address}`);
const before = await bal(funder.publicKey.toBase58());
console.log(`fund   ${await fundEscrow(b.escrow_address, e.escrow)}`);
const refund = await chain.sendFromEscrow({ task: b, legId: `refund:${b.id}`, recipient: funder.publicKey.toBase58(), atomics: e.escrow, prior: null, onPrepared: async () => {} });
console.log(`refund ${refund.signature}`);
must((await bal(funder.publicKey.toBase58())) === before, 'funder got the full bounty plus fee back');
must((await chain.escrowBalance(b)) === 0n, 'refund escrow is empty');

const where = new URL(RPC).hostname;
const local = where === '127.0.0.1' || where === 'localhost';
console.log(`\nHuman-task escrow release and refund proven ${local ? `on a local validator (${RPC}), not on devnet` : `on devnet (${where})`}.`);
