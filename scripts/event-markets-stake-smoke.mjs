#!/usr/bin/env node
/**
 * Devnet smoke test for the deployed `event_markets_stake` program.
 *
 * Runs one real cycle against the LIVE deployment with synthetic actors and a
 * synthetic mint (never a real third-party wallet or token):
 *   1. confirms the program is executable on the cluster,
 *   2. initializes the config if this is the first run,
 *   3. creates a pool, stakes on two outcomes, locks it, resolves it,
 *   4. claims as the winner and asserts the payout against the program math.
 * Exits non-zero on any failure.
 *
 * Env: SOLANA_RPC_URL_DEVNET (default public devnet), EVENT_MARKETS_STAKE_PROGRAM_ID
 * (default: declare_id! in contracts/event-markets-stake/src/lib.rs),
 * SMOKE_FUNDER_KEYPAIR (optional funded keypair file; otherwise the faucet).
 * If the config already exists with a different resolver, the run uses that
 * resolver only when EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR is set.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotent, createMint, getAccount, getAssociatedTokenAddressSync, mintTo } from '@solana/spl-token';
import { build, configPda, decodeConfig, decodePool, poolPda } from '../api/_lib/event-markets/staking/program.js';
import { payoutFor, splitFee } from '../api/_lib/event-markets/staking/math.js';
import { ensureSol, loadKeypair } from './lib/devnet-funding.mjs';

const RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
const declared = /declare_id!\("([^"]+)"\)/.exec(readFileSync(new URL('../contracts/event-markets-stake/src/lib.rs', import.meta.url), 'utf8'))?.[1];
const program = new PublicKey(process.env.EVENT_MARKETS_STAKE_PROGRAM_ID || declared);
const conn = new Connection(RPC, 'confirmed');
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const ok = (m) => console.log(`ok   ${m}`);

const info = await conn.getAccountInfo(program, 'confirmed');
if (!info?.executable) fail(`${program.toBase58()} is not an executable program on ${RPC}`);
ok(`program ${program.toBase58()} is deployed`);

const payer = Keypair.generate();
await ensureSol(conn, payer, 1.5);
const send = (ixs, signers = []) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer, ...signers], { commitment: 'confirmed' });

const existing = await conn.getAccountInfo(configPda(program), 'confirmed');
let resolver;
let treasuryOwner;
let buybackOwner;
if (existing) {
	const cfg = decodeConfig(existing.data);
	if (!process.env.EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR) fail(`config already initialized with resolver ${cfg.resolver.toBase58()}; set EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR to that keypair file`);
	resolver = loadKeypair(process.env.EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR);
	if (!resolver.publicKey.equals(cfg.resolver)) fail('EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR does not match the on-chain resolver');
	treasuryOwner = cfg.treasury;
	buybackOwner = cfg.buyback;
	ok('config exists, using its resolver');
} else {
	resolver = Keypair.generate();
	treasuryOwner = Keypair.generate().publicKey;
	buybackOwner = Keypair.generate().publicKey;
	await send([build.initialize(program, { authority: payer.publicKey, resolver: resolver.publicKey, treasury: treasuryOwner, buyback: buybackOwner, feeBps: 250, buybackShareBps: 4000 })]);
	ok('initialized config');
}
await ensureSol(conn, resolver, 0.05);

const mint = await createMint(conn, payer, payer.publicKey, null, 6);
for (const owner of [treasuryOwner, buybackOwner]) await createAssociatedTokenAccountIdempotent(conn, payer, mint, owner);
const winner = Keypair.generate();
const loser = Keypair.generate();
for (const k of [winner, loser]) {
	await ensureSol(conn, k, 0.05);
	await createAssociatedTokenAccountIdempotent(conn, payer, mint, k.publicKey);
	await mintTo(conn, payer, mint, getAssociatedTokenAddressSync(mint, k.publicKey), payer, 2_000_000n);
}
ok('synthetic mint and actors funded');

const poolId = randomBytes(32);
const now = (await conn.getBlockTime(await conn.getSlot())) ?? Math.floor(Date.now() / 1000);
await send([build.createPool(program, { resolver: resolver.publicKey, poolId, mint, outcomeCount: 2, minStake: 1_000n, maxStake: 5_000_000n, maxPool: 20_000_000n, lockTs: now + 600, voidAfterTs: now + 1200, tokenProgram: TOKEN_PROGRAM_ID })], [resolver]);
await send([build.stake(program, { staker: winner.publicKey, poolId, mint, outcome: 0, amount: 1_000_000n, tokenProgram: TOKEN_PROGRAM_ID })], [winner]);
await send([build.stake(program, { staker: loser.publicKey, poolId, mint, outcome: 1, amount: 500_000n, tokenProgram: TOKEN_PROGRAM_ID })], [loser]);
const staked = decodePool((await conn.getAccountInfo(poolPda(program, poolId), 'confirmed')).data);
if (staked.totalStaked !== 1_500_000n) fail(`totalStaked ${staked.totalStaked}`);
ok('pool created and both sides staked');

await send([build.lock(program, { resolver: resolver.publicKey, poolId })], [resolver]);
await send([build.resolve(program, { resolver: resolver.publicKey, poolId, mint, winningOutcome: 0, treasuryOwner, buybackOwner })], [resolver]);
const pool = decodePool((await conn.getAccountInfo(poolPda(program, poolId), 'confirmed')).data);
if (pool.statusName !== 'resolved' || pool.winningOutcome !== 0) fail(`pool state ${pool.statusName}/${pool.winningOutcome}`);
const fee = splitFee(1_500_000n, 250, 4000);
ok(`resolved, fee ${fee.fee}`);

const ata = getAssociatedTokenAddressSync(mint, winner.publicKey);
const before = (await getAccount(conn, ata, 'confirmed')).amount;
await send([build.claim(program, { owner: winner.publicKey, poolId, mint })], [winner]);
const got = (await getAccount(conn, ata, 'confirmed')).amount - before;
const expected = payoutFor(1_000_000n, 1_500_000n, fee.fee, 1_000_000n);
if (got !== expected) fail(`payout ${got} != expected ${expected}`);
ok(`winner claimed ${got} (matches program math)`);
console.log('PASS event_markets_stake devnet smoke');
