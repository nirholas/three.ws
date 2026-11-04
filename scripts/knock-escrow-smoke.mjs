#!/usr/bin/env node
/**
 * Devnet smoke test for the deployed `knock_escrow` program.
 *
 * Runs the real instruction builders the product ships (src/knock/escrow-program.js)
 * against the LIVE program with synthetic actors and a synthetic mint:
 *   1. confirms the program is executable on the cluster,
 *   2. initializes the config on the first run,
 *   3. opens a door, knocks (escrow), answers (owner paid minus fee, treasury paid),
 *   4. knocks again and refuses (full refund, no fee),
 *   5. decodes every account back and asserts amounts and states.
 * Exits non-zero on any failure.
 *
 * Env: SOLANA_RPC_URL_DEVNET (default public devnet), SMOKE_FUNDER_KEYPAIR
 * (optional funded keypair file; otherwise the faucet). If the config already
 * exists the run uses its treasury and does not re-initialize.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotent, createMint, getAccount, mintTo } from '@solana/spl-token';
import * as k from '../src/knock/escrow-program.js';
import { ensureSol } from './lib/devnet-funding.mjs';

const RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const program = new PublicKey(k.KNOCK_ESCROW_PROGRAM_ID);
const FEE_BPS = 500;
const PRICE = 1_000_000n;
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const ok = (m) => console.log(`ok   ${m}`);

const info = await conn.getAccountInfo(program, 'confirmed');
if (!info?.executable) fail(`${program.toBase58()} is not an executable program on ${RPC}`);
ok(`program ${program.toBase58()} is deployed`);

const payer = Keypair.generate();
await ensureSol(conn, payer, 1.5);
const send = (ixs, signers = []) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer, ...signers], { commitment: 'confirmed' });

let treasury;
const cfgInfo = await conn.getAccountInfo(k.configPda(), 'confirmed');
if (cfgInfo) {
	const cfg = k.decodeConfig(cfgInfo.data);
	treasury = new PublicKey(cfg.treasury);
	ok(`config exists (fee ${cfg.feeBps} bps)`);
} else {
	treasury = Keypair.generate().publicKey;
	const data = Buffer.concat([k.discriminator('initialize'), treasury.toBuffer(), Buffer.from(Uint16Array.of(FEE_BPS).buffer)]);
	await send([new TransactionInstruction({
		programId: program,
		keys: [
			{ pubkey: payer.publicKey, isSigner: true, isWritable: true },
			{ pubkey: k.configPda(), isSigner: false, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data,
	})]);
	ok('initialized config');
}
const feeBps = k.decodeConfig((await conn.getAccountInfo(k.configPda(), 'confirmed')).data).feeBps;

const mint = await createMint(conn, payer, payer.publicKey, null, 6);
const owner = Keypair.generate();
const sender = Keypair.generate();
for (const a of [owner, sender]) await ensureSol(conn, a, 0.1);
const tokenAta = (who) => k.ataFor(mint, who);
await createAssociatedTokenAccountIdempotent(conn, payer, mint, treasury);
await createAssociatedTokenAccountIdempotent(conn, payer, mint, owner.publicKey);
await createAssociatedTokenAccountIdempotent(conn, payer, mint, sender.publicKey);
await mintTo(conn, payer, mint, tokenAta(sender.publicKey), payer, 5_000_000n);
const bal = async (who) => (await getAccount(conn, tokenAta(who), 'confirmed')).amount;

const handle = `smoke-${randomBytes(4).toString('hex')}`;
const door = k.doorPda(owner.publicKey, k.doorId(handle));
await send([k.openDoorIx({ owner: owner.publicKey, mint, priceAtomics: PRICE, replyWindowSeconds: 3600, handle })], [owner]);
const d = k.decodeDoor((await conn.getAccountInfo(door, 'confirmed')).data);
if (!d.open || d.price !== PRICE) fail('door did not read back as open at the set price');
ok(`door ${handle} opened`);

const msgHash = (s) => createHash('sha256').update(s).digest();
async function knock(nonce, text) {
	await send([k.knockIx({ sender: sender.publicKey, door, mint, senderTokens: tokenAta(sender.publicKey), nonce, messageHash: msgHash(text) })], [sender]);
	return k.knockPda(door, sender.publicKey, nonce);
}

// Answer path.
const senderBefore = await bal(sender.publicKey);
const ownerBefore = await bal(owner.publicKey);
const treasuryBefore = await bal(treasury);
const knockA = await knock(1n, 'hello');
let rec = k.decodeKnock((await conn.getAccountInfo(knockA, 'confirmed')).data);
if (rec.stateName !== 'pending' || rec.amount !== PRICE) fail(`knock A state ${rec.stateName} amount ${rec.amount}`);
await send([k.answerIx({ owner: owner.publicKey, door, knock: knockA, mint, sender: sender.publicKey, ownerTokens: tokenAta(owner.publicKey), treasuryTokens: tokenAta(treasury), replyHash: msgHash('hi back') })], [owner]);
rec = k.decodeKnock((await conn.getAccountInfo(knockA, 'confirmed')).data);
const fee = (PRICE * BigInt(feeBps)) / 10_000n;
if (rec.stateName !== 'answered') fail(`knock A ended ${rec.stateName}`);
if ((await bal(owner.publicKey)) - ownerBefore !== PRICE - fee) fail('owner payout is not price minus fee');
if ((await bal(treasury)) - treasuryBefore !== fee) fail('treasury did not receive the fee');
if (senderBefore - (await bal(sender.publicKey)) !== PRICE) fail('sender was not debited the price');
ok(`answered: owner +${PRICE - fee}, treasury +${fee}`);

// Refuse path.
const senderMid = await bal(sender.publicKey);
const knockB = await knock(2n, 'second');
await send([k.refuseIx({ owner: owner.publicKey, door, knock: knockB, mint, sender: sender.publicKey, senderTokens: tokenAta(sender.publicKey) })], [owner]);
rec = k.decodeKnock((await conn.getAccountInfo(knockB, 'confirmed')).data);
if (rec.stateName !== 'refused') fail(`knock B ended ${rec.stateName}`);
if ((await bal(sender.publicKey)) !== senderMid) fail('refused knock was not refunded in full');
ok('refused: sender refunded in full, no fee');

const final = k.decodeDoor((await conn.getAccountInfo(door, 'confirmed')).data);
if (final.knocks !== 2n || final.answered !== 1n) fail(`door counters knocks=${final.knocks} answered=${final.answered}`);
console.log('PASS knock_escrow devnet smoke');
