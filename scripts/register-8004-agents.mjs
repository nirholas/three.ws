#!/usr/bin/env node
/**
 * Back-fill: enrol already-minted three.ws agents in the open Solana agent
 * registry (8004) and refresh the cached trust tier of registered ones.
 * ---------------------------------------------------------------------------
 * The platform authority key signs and pays, so agent owners never sign. The run
 * is rate limited (one registration at a time with a pause) and idempotent:
 * agents that already hold a registry asset are skipped.
 *
 * Usage (env comes from .env via Node's --env-file):
 *   # preview, no SOL and no writes:
 *   node --env-file=.env scripts/register-8004-agents.mjs --network devnet --limit 5 --dry-run
 *
 *   # real devnet run:
 *   node --env-file=.env scripts/register-8004-agents.mjs --network devnet --limit 5 --confirm
 *
 *   # real mainnet run (spends authority SOL; also needs SOLANA_8004_REGISTER_MAINNET=1):
 *   SOLANA_8004_REGISTER_MAINNET=1 node --env-file=.env scripts/register-8004-agents.mjs --network mainnet --limit 5 --confirm
 *
 * Flags: --network devnet|mainnet, --limit N, --pause-ms N, --refresh-only, --dry-run, --confirm.
 */

import {
	EST_REGISTER_8004_LAMPORTS,
	fetchStale8004,
	fetchUnregistered8004,
	registrationEnabled,
	runBackfill8004,
} from '../api/_lib/solana-8004.js';

function arg(name, fallback) {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(name);

async function main() {
	const network = arg('--network', 'mainnet') === 'devnet' ? 'devnet' : 'mainnet';
	const limit = Math.min(500, Math.max(1, Number(arg('--limit', '5')) || 5));
	const pauseMs = Math.max(0, Number(arg('--pause-ms', '750')) || 0);
	const refreshOnly = flag('--refresh-only');
	const dryRun = flag('--dry-run');

	console.log('\nthree.ws open Solana agent registry (8004) back-fill');
	console.log(`  network: ${network}   limit: ${limit}   ${dryRun ? 'DRY RUN' : 'LIVE'}`);

	if (!refreshOnly && !registrationEnabled(network)) {
		console.error('\nMainnet registration is off. Set SOLANA_8004_REGISTER_MAINNET=1 to enable it.');
		process.exit(1);
	}

	if (dryRun) {
		const todo = refreshOnly ? [] : await fetchUnregistered8004(network, limit);
		const stale = await fetchStale8004(network, limit * 4);
		const sol = ((todo.length * EST_REGISTER_8004_LAMPORTS) / 1e9).toFixed(4);
		console.log(`\n  would register: ${todo.length} agents (about ${sol} SOL)`);
		for (const a of todo) console.log(`    ${a.id}  ${a.name}`);
		console.log(`  would refresh standing: ${stale.length} agents`);
		return;
	}

	if (!flag('--confirm')) {
		console.error('\nRefusing to sign without --confirm (use --dry-run to preview).');
		process.exit(1);
	}

	const out = await runBackfill8004({
		network,
		limit,
		pauseMs,
		register: !refreshOnly,
		refresh: true,
		onEvent: (kind, d) => console.log(`  ${kind}: ${d.agent_id} ${d.signature || d.error || ''}`),
	});
	console.log(
		`\n  registered ${out.registered.length}, already ${out.already.length}, refreshed ${out.refreshed.length}, errors ${out.errors.length}`,
	);
	if (out.errors.length) process.exitCode = 1;
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => setTimeout(() => process.exit(), 50));
