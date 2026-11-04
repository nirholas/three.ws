#!/usr/bin/env node
// Node operator payout run for the open inference network.
//
// DRY RUN by default: aggregates accrued rows in inference_node_earnings per
// node and prints the exact transfers a payout would make (recipient, amount,
// asset, job count). Sending USDC is an irreversible on-chain action, so this
// script refuses to send unless BOTH --execute and a configured signer are
// present, and even then it stops at the confirmation table: --execute alone
// prints the table and exits non-zero asking for --confirm-total=<atomics>
// matching the printed total. No transfer code path exists in this file yet; the
// signer hook is intentionally the single place a reviewed sender plugs in.
//
// Usage:
//   node --env-file=.env scripts/inference-node-payouts.mjs --dry-run
//   node --env-file=.env scripts/inference-node-payouts.mjs --min-atomics=100000
//
// Payout address: nodes do not yet register a payout address (spec: "the payout
// address settlement will credit"); until they do, the node public key itself
// (a Solana ed25519 key) is the recipient, which an operator controls by holding
// the node's secret key.

import { sql } from '../api/_lib/db.js';

const args = new Map(
	process.argv.slice(2).map((a) => {
		const [k, ...v] = a.replace(/^--/, '').split('=');
		return [k, v.join('=') || true];
	}),
);
const execute = args.has('execute');
const minAtomics = BigInt(args.get('min-atomics') || 0);
const signerConfigured = Boolean(process.env.NODE_PAYOUT_SIGNER_SECRET);

if (execute && !signerConfigured) {
	console.error('refusing to execute: NODE_PAYOUT_SIGNER_SECRET is not configured');
	process.exit(2);
}

const rows = await sql`
	select node_public_key, count(*)::int as jobs, sum(amount_atomics)::text as atomics
	from inference_node_earnings
	where payout_status = 'accrued'
	group by node_public_key
	order by sum(amount_atomics) desc`;

const transfers = rows.filter((r) => BigInt(r.atomics) >= minAtomics);
const total = transfers.reduce((a, r) => a + BigInt(r.atomics), 0n);

console.log(`mode: ${execute ? 'EXECUTE (confirmation required)' : 'DRY RUN'}`);
console.log('recipient (node key)                           jobs   amount (USDC)');
for (const t of transfers) {
	console.log(`${t.node_public_key.padEnd(46)} ${String(t.jobs).padStart(4)}   ${(Number(t.atomics) / 1e6).toFixed(6)}`);
}
console.log(`transfers: ${transfers.length}   total: ${(Number(total) / 1e6).toFixed(6)} USDC (${total} atomics)   skipped below minimum: ${rows.length - transfers.length}`);

if (execute) {
	if (args.get('confirm-total') !== total.toString()) {
		console.error(`not sending: re-run with --confirm-total=${total} after the owner approves this table`);
		process.exit(3);
	}
	console.error('not sending: no reviewed sender is wired into this script; it only prepares the approved table');
	process.exit(4);
}
process.exit(0);
