#!/usr/bin/env node
// Promote proof-of-custody epochs that are stored as anchor_failed but whose
// SPL-Memo did land on Solana (the confirm wait gave up first). Every row is
// checked against the chain by reconcileLandedAnchors (api/_lib/custody-proof.js):
// finalized, no error, signed by the attester, memo kind/epoch/root equal to the
// stored epoch. anchored_at becomes the block time. Nothing is broadcast.
//
// The custody-attest cron runs the same reconcile over the last 14 days on every
// epoch; this script is for an operator who needs a wider window or a dry run.
//
//   node scripts/custody-reconcile-anchors.mjs                      # dry run, last 14 days
//   node scripts/custody-reconcile-anchors.mjs --since-days 90 --apply
//   node scripts/custody-reconcile-anchors.mjs --attester <base58>  # no ATTEST_AGENT_SECRET_KEY locally
//
// Reads DATABASE_URL (and CUSTODY_ANCHOR_NETWORK, default mainnet) from the
// environment, .env.local or .env.

import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : undefined;
}

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is not set (environment, .env.local or .env).');
	process.exit(2);
}

const apply = process.argv.includes('--apply');
const sinceDays = Number(arg('since-days') || 14);
const attester = arg('attester');

const { reconcileLandedAnchors, ANCHOR_NETWORK } = await import('../api/_lib/custody-proof.js');

const out = await reconcileLandedAnchors({ limit: 500, sinceDays, dryRun: !apply, attester });
console.log(`anchor network: ${ANCHOR_NETWORK}, window: ${sinceDays} days, mode: ${apply ? 'APPLY' : 'dry run'}`);
console.log(`checked ${out.checked} gave-up epoch(s)`);
for (const p of out.promoted) {
	console.log(`  ${apply ? 'promoted' : 'would promote'} epoch ${p.epoch}: ${p.signature} (on-chain ${p.anchored_at})`);
}
for (const e of out.errors) console.log(`  epoch ${e.epoch}: lookup failed, left as is: ${e.error}`);
if (!out.promoted.length) console.log('  nothing to promote');
if (!apply && out.promoted.length) console.log('\nRe-run with --apply to write.');
