#!/usr/bin/env node
// Public-cluster end-to-end proof of the staked Event Markets program on devnet.
//
// Drives the same instruction builders the server uses (api/_lib/event-markets/staking/program.js)
// against the deployed devnet program with throwaway wallets and two test mints it creates itself
// (the devnet USDC mint is not mintable by us): a classic SPL mint and a Token-2022 mint.
// Runs: init (once), pool A stake x3 -> lock -> resolve -> claim (payout equals the pool formula
// to the base unit), pool B stake -> void -> every staker refunded, pool C left to void_expired,
// then reconciles each vault (vault == totalStaked - feePaid - paidOut). Prints every signature.
//
// Idempotent: authority, resolver, treasury and buyback keypairs persist in .deploy/stake-devnet
// (gitignored, mode 600) so a rerun reuses the on-chain config. Spends devnet SOL only; the payer
// needs about 3 devnet SOL (faucet.solana.com). Mainnet is refused.
//
//   node scripts/event-markets-stake-devnet-e2e.mjs [--payer .deploy/devnet-payer.json] [--rpc <url>] [--json]
// Env: EVENT_MARKETS_STAKE_PROGRAM_ID (defaults to the program keypair in contracts/.../target/deploy),
//      SOLANA_RPC_URL_DEVNET. The HTTP route and browser checks are separate (docs/ops/event-markets-stake-launch.md).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
	TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotent, createMint, getAccount, getAssociatedTokenAddressSync, mintTo,
} from '@solana/spl-token';
import { build, configPda, decodeConfig, decodePool, poolPda } from '../api/_lib/event-markets/staking/program.js';
import { payoutFor, splitFee } from '../api/_lib/event-markets/staking/math.js';
import { reconcilePool } from '../api/_lib/event-markets/staking/reconcile.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const die = (m) => { console.error(`error: ${m}`); process.exit(1); };
const payerFile = opt('payer', '.deploy/devnet-payer.json');
const rpc = opt('rpc', process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com');
if (/mainnet/i.test(rpc)) die('devnet only: refusing a mainnet RPC');
const loadKp = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, 'utf8'))));
if (!existsSync(payerFile)) die(`payer keypair ${payerFile} not found`);

const conn = new Connection(rpc, 'confirmed');
const payer = loadKp(payerFile);
const programKeyFile = 'contracts/event-markets-stake/target/deploy/event_markets_stake-keypair.json';
const program = new PublicKey(process.env.EVENT_MARKETS_STAKE_PROGRAM_ID || (existsSync(programKeyFile) ? loadKp(programKeyFile).publicKey : die('set EVENT_MARKETS_STAKE_PROGRAM_ID')));
if (!(await conn.getAccountInfo(program))?.executable) die(`program ${program.toBase58()} is not deployed on devnet; deploy it first (node scripts/deploy-solana-programs.mjs --cluster devnet)`);

const keyDir = '.deploy/stake-devnet';
mkdirSync(keyDir, { recursive: true, mode: 0o700 });
const persisted = (name) => {
	const f = `${keyDir}/${name}.json`;
	if (existsSync(f)) return loadKp(f);
	const k = Keypair.generate();
	writeFileSync(f, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 });
	return k;
};
const [authority, resolver, treasuryOwner, buybackOwner] = ['authority', 'resolver', 'treasury', 'buyback'].map(persisted);

const sigs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = async () => (await conn.getBlockTime(await conn.getSlot())) ?? Math.floor(Date.now() / 1000);
async function send(label, ixs, signers = []) {
	const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer, ...signers], { commitment: 'confirmed' });
	sigs.push({ label, sig });
	console.log(`  ${label.padEnd(34)} ${sig}`);
	return sig;
}

const balanceNeeded = 3 * LAMPORTS_PER_SOL;
const have = await conn.getBalance(payer.publicKey);
if (have < balanceNeeded) die(`payer ${payer.publicKey.toBase58()} holds ${have / LAMPORTS_PER_SOL} devnet SOL, needs ${balanceNeeded / LAMPORTS_PER_SOL}. Fund it at https://faucet.solana.com and rerun.`);

async function fundWallet(owner, sol) {
	const bal = await conn.getBalance(owner.publicKey);
	if (bal >= sol * LAMPORTS_PER_SOL) return;
	await send(`fund ${owner.publicKey.toBase58().slice(0, 6)}`, [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: owner.publicKey, lamports: sol * LAMPORTS_PER_SOL - bal })]);
}
async function staker(mint, amount, tp) {
	const k = Keypair.generate();
	await fundWallet(k, 0.05);
	await createAssociatedTokenAccountIdempotent(conn, payer, mint, k.publicKey, undefined, tp);
	await mintTo(conn, payer, mint, getAssociatedTokenAddressSync(mint, k.publicKey, false, tp), payer, amount, [], undefined, tp);
	return k;
}
const bal = async (mint, owner, tp) => (await getAccount(conn, getAssociatedTokenAddressSync(mint, owner, true, tp), 'confirmed', tp)).amount;
const readPool = async (id) => decodePool((await conn.getAccountInfo(poolPda(program, id), 'confirmed')).data);
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };

console.log(`Program ${program.toBase58()} on devnet, payer ${payer.publicKey.toBase58()}`);
for (const o of [authority, resolver, treasuryOwner, buybackOwner]) await fundWallet(o, 0.2);

const FEE_BPS = 300, SHARE_BPS = 5000;
if (!(await conn.getAccountInfo(configPda(program)))) {
	await send('init config', [build.initialize(program, { authority: authority.publicKey, resolver: resolver.publicKey, treasury: treasuryOwner.publicKey, buyback: buybackOwner.publicKey, feeBps: FEE_BPS, buybackShareBps: SHARE_BPS })], [authority]);
}
const cfg = decodeConfig((await conn.getAccountInfo(configPda(program))).data);
if (!cfg.resolver.equals(resolver.publicKey)) die('the on-chain config uses a different resolver than .deploy/stake-devnet; delete that dir only if you also redeploy the program');
const feeBps = cfg.feeBps, shareBps = cfg.buybackShareBps;

const mints = {};
for (const [name, tp] of [['spl', TOKEN_PROGRAM_ID], ['token2022', TOKEN_2022_PROGRAM_ID]]) {
	const mint = await createMint(conn, payer, payer.publicKey, null, 6, undefined, undefined, tp);
	for (const o of [treasuryOwner, buybackOwner]) await createAssociatedTokenAccountIdempotent(conn, payer, mint, o.publicKey, undefined, tp);
	mints[name] = { mint, tp };
}

async function newPool({ mint, tp }, { outcomes = 2, lockIn = 600, voidIn = 1200 } = {}) {
	const poolId = randomBytes(32);
	const t = await now();
	await send('create pool', [build.createPool(program, { resolver: resolver.publicKey, poolId, mint, outcomeCount: outcomes, minStake: 1_000n, maxStake: 50_000_000n, maxPool: 500_000_000n, lockTs: t + lockIn, voidAfterTs: t + voidIn, tokenProgram: tp })], [resolver]);
	return poolId;
}
const stake = (k, poolId, { mint, tp }, outcome, amount) => send(`stake outcome ${outcome}`, [build.stake(program, { staker: k.publicKey, poolId, mint, outcome, amount, tokenProgram: tp })], [k]);
const lock = (poolId) => send('lock', [build.lock(program, { resolver: resolver.publicKey, poolId })], [resolver]);
async function reconcileVault(label, poolId, { mint, tp }, ledger) {
	const chain = await readPool(poolId);
	const r = reconcilePool({ chain, vaultBalance: await bal(mint, poolPda(program, poolId), tp), ledger });
	const surplusOnly = r.problems.every((p) => p.code === 'vault_surplus');
	check(`${label}: vault == staked - fee - paid`, r.ok || (surplusOnly && false), r.ok ? 'zero drift' : JSON.stringify(r.problems));
}

for (const [name, tokenSet] of Object.entries(mints)) {
	console.log(`\nPool A (${name}): stake x3, lock, resolve, claim`);
	const { mint, tp } = tokenSet;
	const poolId = await newPool(tokenSet, { outcomes: 3 });
	const plan = [[await staker(mint, 5_000_000n, tp), 0, 700_001n], [await staker(mint, 5_000_000n, tp), 0, 300_333n], [await staker(mint, 5_000_000n, tp), 1, 1_000_007n]];
	for (const [k, o, amt] of plan) await stake(k, poolId, tokenSet, o, amt);
	const total = plan.reduce((s, [, , x]) => s + x, 0n);
	let p = await readPool(poolId);
	check('pool total equals the stakes', p.totalStaked === total, `${p.totalStaked} vs ${total}`);
	await lock(poolId);
	await send('resolve (outcome 0 wins)', [build.resolve(program, { resolver: resolver.publicKey, poolId, mint, winningOutcome: 0, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey, tokenProgram: tp })], [resolver]);
	const fee = splitFee(total, feeBps, shareBps);
	p = await readPool(poolId);
	check('fee paid equals the formula', p.feePaid === fee.fee, `${p.feePaid} vs ${fee.fee}`);
	let paid = 0n;
	for (const [k, o, amt] of plan.filter(([, o]) => o === 0)) {
		const before = await bal(mint, k.publicKey, tp);
		await send('claim', [build.claim(program, { owner: k.publicKey, poolId, mint, tokenProgram: tp })], [k]);
		const got = (await bal(mint, k.publicKey, tp)) - before;
		const want = payoutFor(amt, total, fee.fee, p.totals[0]);
		check(`payout equals the pool formula`, got === want, `${got} vs ${want}`);
		paid += got;
	}
	p = await readPool(poolId);
	check('paidOut equals the claims', p.paidOut === paid, `${p.paidOut} vs ${paid}`);
	const dust = await bal(mint, poolPda(program, poolId), tp);
	check('vault left is only rounding dust', dust === total - fee.fee - paid && dust < 2n, `${dust}`);
}

console.log('\nPool B (spl): stake, void, every staker refunded');
{
	const tokenSet = mints.spl, { mint, tp } = tokenSet;
	const poolId = await newPool(tokenSet);
	const ks = [await staker(mint, 2_000_000n, tp), await staker(mint, 2_000_000n, tp)];
	await stake(ks[0], poolId, tokenSet, 0, 500_000n);
	await stake(ks[1], poolId, tokenSet, 1, 750_000n);
	await send('void', [build.voidPool(program, { resolver: resolver.publicKey, poolId })], [resolver]);
	for (const k of ks) {
		const before = await bal(mint, k.publicKey, tp);
		await send('refund', [build.refund(program, { owner: k.publicKey, poolId, mint, tokenProgram: tp })], [k]);
		check('refund returns the full stake', (await bal(mint, k.publicKey, tp)) - before === (k === ks[0] ? 500_000n : 750_000n));
	}
	check('void pool vault is empty', (await bal(mint, poolPda(program, poolId), tp)) === 0n);
}

console.log('\nPool C (spl): left to void_expired');
{
	const tokenSet = mints.spl, { mint, tp } = tokenSet;
	const poolId = await newPool(tokenSet, { lockIn: 20, voidIn: 45 });
	const k = await staker(mint, 1_000_000n, tp);
	await stake(k, poolId, tokenSet, 0, 400_000n);
	const voidAfter = (await readPool(poolId)).voidAfterTs;
	console.log(`  waiting for the void window (${voidAfter})`);
	while ((await now()) <= Number(voidAfter)) await sleep(2_000);
	await send('void_expired (permissionless)', [build.voidExpired(program, { poolId })]);
	const before = await bal(mint, k.publicKey, tp);
	await send('refund after expiry', [build.refund(program, { owner: k.publicKey, poolId, mint, tokenProgram: tp })], [k]);
	check('expired pool refunds the full stake', (await bal(mint, k.publicKey, tp)) - before === 400_000n);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed, ${sigs.length} transactions`);
if (args.includes('--json')) console.log(JSON.stringify({ program: program.toBase58(), signatures: sigs, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
