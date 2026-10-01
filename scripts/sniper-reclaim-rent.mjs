#!/usr/bin/env node
// Reclaim the rent stranded in sniper wallets' empty token accounts.
//
// Every sniper buy opened a token account and, until the worker learned to close
// it on exit (workers/agent-sniper/rent-reclaim.js), no sell ever closed it. This
// sweeps the backlog: for every wallet that has a sniper strategy, it lists the
// token accounts, keeps only the ones whose raw balance is exactly zero, and
// closes them with the rent returned to that same wallet. Nothing is sent to any
// other address, and an account holding even one base unit is never touched.
//
// DRY RUN BY DEFAULT: without --apply it only reads and prints what it would
// reclaim. --apply signs close transactions from each agent wallet, which is an
// owner-approved action (CLAUDE.md gate 1).
//
// Usage:
//   npm run sniper:reclaim-rent                                                # plan, all sniper wallets
//   node --env-file=.env.local scripts/sniper-reclaim-rent.mjs --agent <id>    # plan, one agent
//   node --env-file=.env.local scripts/sniper-reclaim-rent.mjs --apply         # sign and close
//
// Reads need an RPC that serves getTokenAccountsByOwner with a programId filter
// (public mainnet-beta and several free lanes reject it). Resolution order:
// --rpc <url>, SOLANA_RPC_URL, then Helius via HELIUS_API_KEY. --apply also needs
// WALLET_ENCRYPTION_KEY to recover the agent keys; both live on the agent-sniper
// Cloud Run service (node scripts/read-service-env.mjs '^NAME$' --raw).

import { Connection, PublicKey } from '@solana/web3.js';
import { sql } from '../api/_lib/db.js';
import { planCloses, buildCloseInstructions } from '../workers/agent-sniper/rent-reclaim.js';
import { TOKEN_PROGRAMS } from '../workers/agent-sniper/reconcile.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const APPLY = flag('--apply');
const ONLY_AGENT = opt('--agent');
const RPC = opt('--rpc')
	|| process.env.SOLANA_RPC_URL
	|| (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : null);

if (!RPC) {
	console.error('No RPC: pass --rpc <url> or set SOLANA_RPC_URL / HELIUS_API_KEY.');
	process.exit(2);
}
const connection = new Connection(RPC, 'confirmed');

// Owner-wide token scans are the heaviest read a free or shared Helius plan
// serves; spacing wallets out and retrying once keeps a 429 burst from reading as
// a wallet that could not be scanned.
const WALLET_PACING_MS = 1_500;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listTokenAccountsWithRetry(owner) {
	try {
		return await listTokenAccounts(owner);
	} catch {
		await pause(WALLET_PACING_MS * 4);
		return listTokenAccounts(owner);
	}
}

async function listTokenAccounts(owner) {
	const out = [];
	for (const programId of TOKEN_PROGRAMS) {
		const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { programId: new PublicKey(programId) });
		for (const { pubkey, account } of res.value) {
			out.push({
				pubkey: pubkey.toBase58(),
				programId,
				amount: account.data?.parsed?.info?.tokenAmount?.amount ?? null,
				lamports: account.lamports,
			});
		}
	}
	return out;
}

const agents = await sql`
	SELECT DISTINCT ON (s.agent_id) s.agent_id, s.user_id, a.name, a.meta->>'solana_address' AS address
	FROM agent_sniper_strategies s
	JOIN agent_identities a ON a.id = s.agent_id AND a.deleted_at IS NULL
	WHERE s.network = 'mainnet'
	  AND a.meta->>'solana_address' IS NOT NULL
	  AND (${ONLY_AGENT}::uuid IS NULL OR s.agent_id = ${ONLY_AGENT}::uuid)
	ORDER BY s.agent_id
`;

let ctx = null;
let signAndSend = null;
let loadAgentKeypair = null;
if (APPLY) {
	const tradeClient = await import('../workers/agent-sniper/trade-client.js');
	ctx = await tradeClient.getTradeCtx('mainnet');
	signAndSend = tradeClient.signAndSend;
	({ loadAgentKeypair } = await import('../workers/agent-sniper/keys.js'));
}

let totalAccounts = 0;
let totalRent = 0;
let totalReclaimed = 0;
let readErrors = 0;

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${agents.length} sniper wallet(s)\n`);
for (const a of agents) {
	let accounts;
	await pause(WALLET_PACING_MS);
	try {
		accounts = await listTokenAccountsWithRetry(a.address);
	} catch (err) {
		readErrors += 1;
		console.log(`  ${a.name.padEnd(28)} ${a.address}  read failed: ${err.message}`);
		continue;
	}
	const plan = planCloses(accounts);
	totalAccounts += plan.closable;
	totalRent += plan.rentLamports;
	console.log(`  ${a.name.padEnd(28)} ${a.address}  ${String(accounts.length).padStart(4)} accounts, ${String(plan.closable).padStart(4)} empty, ${(plan.rentLamports / 1e9).toFixed(4)} SOL reclaimable`);
	if (!APPLY || plan.closable === 0) continue;

	const loaded = await loadAgentKeypair(a.agent_id, a.user_id, 'sniper_rent_reclaim');
	if (!loaded || loaded.address !== a.address) {
		console.log(`    skipped: signing key does not resolve to ${a.address}`);
		continue;
	}
	for (const batch of plan.batches) {
		try {
			const sig = await signAndSend(ctx, loaded.keypair, buildCloseInstructions(ctx, loaded.keypair.publicKey, batch), 60_000);
			const rent = batch.reduce((s, x) => s + x.lamports, 0);
			totalReclaimed += rent;
			console.log(`    closed ${batch.length}, +${(rent / 1e9).toFixed(4)} SOL  ${sig}`);
		} catch (err) {
			console.log(`    batch of ${batch.length} failed (left for the next run): ${err.message}`);
		}
	}
}

console.log(`\n${totalAccounts} empty account(s), ${(totalRent / 1e9).toFixed(4)} SOL reclaimable${APPLY ? `, ${(totalReclaimed / 1e9).toFixed(4)} SOL reclaimed` : ''}`);
if (readErrors) console.log(`${readErrors} wallet(s) could not be read; rerun with an RPC that serves getTokenAccountsByOwner by programId.`);
process.exit(readErrors ? 2 : 0);
