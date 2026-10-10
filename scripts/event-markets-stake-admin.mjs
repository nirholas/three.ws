#!/usr/bin/env node
// Owner-gated admin for staked Event Markets. Every command that sends a
// transaction prints a confirmation table (cluster, program, signer, recipient,
// amount, token) and DOES NOTHING until re-run with --yes. On mainnet it also
// needs --confirm-mainnet. Keys are read from keypair files named in the env and
// are never printed. Run with the production env loaded, e.g.
//   node --env-file=.env scripts/event-markets-stake-admin.mjs <command> [flags]
//
//   init          --treasury <owner> --buyback <owner> [--fee-bps 300 --buyback-share-bps 5000]
//   create-pool   --market <slug|id> --token usdc|three [--lock-grace-seconds 0]
//   resolve       --market <slug|id>        (winner comes from the resolved market row)
//   void          --market <slug|id>        (resolver void: everyone refunded)
//   pause | resume                         (on-chain config pause: blocks new pools and stakes)
//   status        read-only: the config and every pool
//
// Env: EVENT_MARKETS_STAKE_PROGRAM_ID, EVENT_MARKETS_STAKE_CLUSTER,
//      EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR, EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR (file paths).
// Guide: docs/event-markets-staking.md.

import { readFileSync } from 'node:fs';
import { Keypair, Transaction, sendAndConfirmTransaction, PublicKey } from '@solana/web3.js';
import { build, poolIdFor, poolPda, programId } from '../api/_lib/event-markets/staking/program.js';
import { FEE, TOKENS, VOID_AFTER_LOCK_SECONDS, mintFor, stakingConfig } from '../api/_lib/event-markets/staking/config.js';
import { connection, readConfig, readPool, tokenProgramFor } from '../api/_lib/event-markets/staking/chain.js';
import { getPoolByMarket, insertPool, listPools, markPoolStatus } from '../api/_lib/event-markets/staking/store.js';
import { formatAmount } from '../api/_lib/event-markets/staking/limits.js';
import { getMarket } from '../api/_lib/event-markets/index.js';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt = null) => {
	const i = rest.indexOf(`--${name}`);
	return i !== -1 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : dflt;
};
const has = (name) => rest.includes(`--${name}`);
const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

function key(envName) {
	const f = process.env[envName];
	if (!f) die(`${envName} must point at a keypair file`);
	return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, 'utf8'))));
}

/** Prints the table and returns true only when the owner passed --yes (and --confirm-mainnet on mainnet). */
function gate(title, rows) {
	const cfg = stakingConfig();
	console.log(`\n${title}`);
	console.table([{ field: 'chain', value: `solana (${cfg.cluster})` }, { field: 'program', value: programId().toBase58() }, ...rows.map(([field, value]) => ({ field, value: String(value) }))]);
	if (!has('yes')) { console.log('Dry run. Re-run with --yes to sign and send.'); return false; }
	if (cfg.cluster === 'mainnet' && !has('confirm-mainnet')) { console.log('Mainnet needs --confirm-mainnet as well. Nothing sent.'); return false; }
	return true;
}

async function send(ixs, signer) {
	const sig = await sendAndConfirmTransaction(connection(), new Transaction().add(...ixs), [signer], { commitment: 'confirmed' });
	console.log(`sent ${sig}`);
	return sig;
}

async function marketOrDie() {
	const ref = flag('market');
	if (!ref) die('--market <slug|id> is required');
	return getMarket(ref, { includeDraft: true }).catch(() => die(`no market ${ref}`));
}

const commands = {
	async init() {
		const authority = key('EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR');
		const resolver = key('EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR');
		const treasury = flag('treasury') || die('--treasury <owner pubkey> is required');
		const buyback = flag('buyback') || die('--buyback <owner pubkey> is required');
		const feeBps = Number(flag('fee-bps', FEE.feeBps));
		const share = Number(flag('buyback-share-bps', FEE.buybackShareBps));
		if (!gate('Initialize the staking program config', [
			['signer (authority)', authority.publicKey.toBase58()], ['resolver', resolver.publicKey.toBase58()],
			['treasury recipient', treasury], ['buyback recipient', buyback], ['fee', `${feeBps / 100}% of each pool`], ['buyback share of fee', `${share / 100}%`],
		])) return;
		await send([build.initialize(programId(), { authority: authority.publicKey, resolver: resolver.publicKey, treasury, buyback, feeBps, buybackShareBps: share })], authority);
	},

	async 'create-pool'() {
		const resolver = key('EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR');
		const market = await marketOrDie();
		const tokenKey = flag('token') || die('--token usdc|three is required');
		const token = TOKENS[tokenKey] || die(`unknown token ${tokenKey}`);
		if (await getPoolByMarket(market.id)) die('this market already has a pool');
		const cfg = stakingConfig();
		const mint = mintFor(tokenKey, cfg.cluster);
		const lockTs = Math.floor(new Date(market.locks_at).getTime() / 1000);
		const voidAfterTs = lockTs + VOID_AFTER_LOCK_SECONDS;
		if (lockTs * 1000 <= Date.now()) die('the market has already locked');
		const poolId = poolIdFor(market.id);
		const outcomeIds = market.outcomes.map((o) => o.outcome_id ?? o.id);
		const config = await readConfig() || die('program config not initialized; run init first');
		if (!gate(`Create a staked pool for "${market.title}"`, [
			['signer (resolver)', resolver.publicKey.toBase58()], ['token', `${token.symbol} (${mint})`], ['outcomes', outcomeIds.length],
			['min / max stake', `${formatAmount(token.min, token.decimals)} / ${formatAmount(token.maxStake, token.decimals)} ${token.symbol}`],
			['pool cap', `${formatAmount(token.maxPool, token.decimals)} ${token.symbol}`], ['locks', new Date(lockTs * 1000).toISOString()],
			['auto-void after', new Date(voidAfterTs * 1000).toISOString()], ['fee', `${config.feeBps / 100}% (buyback share ${config.buybackShareBps / 100}%)`],
			['fee recipients', `treasury ${config.treasury.toBase58()}, buyback ${config.buyback.toBase58()}`], ['funds moved', 'none (rent for the pool and vault accounts only)'],
		])) return;
		const tokenProgram = await tokenProgramFor(mint);
		const sig = await send([build.createPool(programId(), {
			resolver: resolver.publicKey, poolId, mint, outcomeCount: outcomeIds.length, minStake: token.min, maxStake: token.maxStake,
			maxPool: token.maxPool, lockTs, voidAfterTs, tokenProgram,
		})], resolver);
		await insertPool({
			marketId: market.id, cluster: cfg.cluster, programId: programId().toBase58(), poolIdHex: poolId.toString('hex'),
			poolAddress: poolPda(programId(), poolId).toBase58(), mint, tokenKey, decimals: token.decimals, outcomeIds,
			minStake: token.min, maxStake: token.maxStake, maxPool: token.maxPool, feeBps: config.feeBps, buybackShareBps: config.buybackShareBps,
			lockAt: new Date(lockTs * 1000), voidAfter: new Date(voidAfterTs * 1000), createSignature: sig,
		});
		console.log('pool recorded');
	},

	async resolve() {
		const resolver = key('EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR');
		const market = await marketOrDie();
		if (market.status !== 'resolved' || !market.winner) die(`market is ${market.status}; resolve it in the platform first, the on-chain winner is read from it`);
		const pool = await getPoolByMarket(market.id) || die('this market has no staked pool');
		const winning = pool.outcomeIds.indexOf(market.winner.outcome_id);
		if (winning < 0) die('market winner is not in the pool outcome list');
		const chain = await readPool(pool.poolIdHex) || die('pool not found on chain');
		if (chain.statusName !== 'open') die(`pool is already ${chain.statusName}`);
		const config = await readConfig();
		const token = TOKENS[pool.tokenKey];
		const fee = (chain.totalStaked * BigInt(chain.feeBps)) / 10_000n;
		const buyback = (fee * BigInt(chain.buybackShareBps)) / 10_000n;
		const winningTotal = chain.totals[winning];
		const nobody = winningTotal === 0n;
		if (!gate(`Resolve the pool for "${market.title}"`, [
			['signer (resolver)', resolver.publicKey.toBase58()], ['winner', `${market.winner.label} (outcome ${winning})`], ['token', `${token.symbol} (${pool.mint})`],
			['pool total', `${formatAmount(chain.totalStaked, pool.decimals)} ${token.symbol}`], ['fee moves out', `${formatAmount(fee, pool.decimals)} ${token.symbol}`],
			['to treasury', `${formatAmount(fee - buyback, pool.decimals)} -> ${config.treasury.toBase58()}`], ['to buyback', `${formatAmount(buyback, pool.decimals)} -> ${config.buyback.toBase58()}`],
			['result', nobody ? 'NOBODY PICKED THE WINNER: use the void command instead, everyone is refunded' : 'winners claim their own payouts'],
		])) return;
		if (nobody) die('nobody staked on the winner; run void so every staker is refunded');
		const sig = await send([build.resolve(programId(), {
			resolver: resolver.publicKey, poolId: Buffer.from(pool.poolIdHex, 'hex'), mint: pool.mint, winningOutcome: winning,
			treasuryOwner: config.treasury, buybackOwner: config.buyback, tokenProgram: await tokenProgramFor(pool.mint),
		})], resolver);
		await markPoolStatus(market.id, 'resolved', sig);
	},

	async void() {
		const resolver = key('EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR');
		const market = await marketOrDie();
		const pool = await getPoolByMarket(market.id) || die('this market has no staked pool');
		const chain = await readPool(pool.poolIdHex) || die('pool not found on chain');
		if (chain.statusName !== 'open') die(`pool is already ${chain.statusName}`);
		if (!gate(`Void the pool for "${market.title}"`, [
			['signer (resolver)', resolver.publicKey.toBase58()], ['token', `${TOKENS[pool.tokenKey].symbol} (${pool.mint})`],
			['pool total', `${formatAmount(chain.totalStaked, pool.decimals)} ${TOKENS[pool.tokenKey].symbol}`], ['result', 'every staker may refund their full stake; no fee is taken'],
		])) return;
		const sig = await send([build.voidPool(programId(), { resolver: resolver.publicKey, poolId: Buffer.from(pool.poolIdHex, 'hex') })], resolver);
		await markPoolStatus(market.id, 'void', sig);
	},

	async pause() { await setPaused(true); },
	async resume() { await setPaused(false); },

	async status() {
		const config = await readConfig();
		console.log(config ? { authority: config.authority.toBase58(), resolver: config.resolver.toBase58(), treasury: config.treasury.toBase58(), buyback: config.buyback.toBase58(), feeBps: config.feeBps, buybackShareBps: config.buybackShareBps, paused: config.paused } : 'config not initialized');
		for (const p of await listPools()) {
			const c = await readPool(p.poolIdHex);
			console.log(p.marketId, p.tokenKey, c ? `${c.statusName} staked=${c.totalStaked}` : 'missing on chain');
		}
	},
};

async function setPaused(paused) {
	const authority = key('EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR');
	if (!gate(`${paused ? 'Pause' : 'Resume'} the program (new pools and stakes)`, [
		['signer (authority)', authority.publicKey.toBase58()], ['effect', paused ? 'create_pool and stake fail on chain; claims and refunds keep working' : 'new pools and stakes allowed again'],
	])) return;
	await send([build.setConfig(programId(), { authority: authority.publicKey, paused })], authority);
}

if (!commands[cmd]) die(`usage: ${Object.keys(commands).join(' | ')} [flags]; see the header of this file`);
await commands[cmd]();
process.exit(0);
