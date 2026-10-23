#!/usr/bin/env node
// Devnet proof for the transaction landing race. Sends real self-transfers through
// submitProtected with two devnet providers (the primary RPC plus an additional
// public devnet RPC), then prints the per-provider stats table.
//
//   node scripts/landing-race-devnet.mjs [--runs 4] [--extra <rpc url>] [--db <postgres url>]
//
// Devnet only: the payer is an ephemeral keypair funded by a devnet airdrop. With
// --db the counters persist to landing_provider_stats in that database (apply
// api/_lib/migrations/20261023190000_landing_provider_stats.sql first); without
// it an in-process Postgres holds them for the run.

import { readFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { submitProtected } from '../api/_lib/execution-engine.js';
import { createSqlStatsStore, getLandingStats } from '../api/_lib/landing-race.js';

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const runs = Number(flag('--runs', 4));
const primaryUrl = flag('--primary', 'https://api.devnet.solana.com');
const extraUrl = flag('--extra', 'https://solana-devnet.api.onfinality.io/public');
const dbUrl = flag('--db', null);

process.env.LANDING_EXTRA_RPC_URL = extraUrl;

const migration = readFileSync(new URL('../api/_lib/migrations/20261023190000_landing_provider_stats.sql', import.meta.url), 'utf8');
let run;
let closeDb = async () => {};
if (dbUrl) {
	const { neon } = await import('@neondatabase/serverless');
	const client = neon(dbUrl);
	run = (t, p) => client.query(t, p);
} else {
	const { PGlite } = await import('@electric-sql/pglite');
	const db = new PGlite();
	await db.exec(migration);
	run = async (t, p) => (await db.query(t, p)).rows;
	closeDb = () => db.close();
}
const store = createSqlStatsStore(run);
const stats = getLandingStats('devnet', store);

const connection = new Connection(primaryUrl, 'confirmed');
const payer = Keypair.generate();
const airdropSig = await connection.requestAirdrop(payer.publicKey, 0.05 * LAMPORTS_PER_SOL);
const bh = await connection.getLatestBlockhash();
await connection.confirmTransaction({ signature: airdropSig, ...bh }, 'confirmed');
console.log(`funded ${payer.publicKey.toBase58()} on devnet`);

for (let i = 0; i < runs; i++) {
	const ix = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000 + i });
	const r = await submitProtected({ network: 'devnet', connection, payer, instructions: [ix], opts: { confirmTimeoutMs: 40_000 } });
	console.log(`run ${i + 1}: ${r.signature.slice(0, 16)}... landedBy=${r.landedBy} slot=${r.slot} ${r.landedMs}ms lanes=${r.lanes.map((l) => `${l.name}:${l.outcome}@${l.ms}ms`).join(' ')}`);
}

await stats.flush();
const rows = await run(
	'select provider, network, landed, lost, outpaced, streak, latency_ms, last_error from landing_provider_stats order by provider',
	[],
);
console.log('\nlanding_provider_stats');
console.table(rows);
await closeDb();
process.exit(0);
