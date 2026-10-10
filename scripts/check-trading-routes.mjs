#!/usr/bin/env node
// Live, read-only check of every swap aggregator behind swap_quote and
// swap_execute (api/_lib/trading-tools/swap-routes.js).
//
// For each aggregator it runs the same path a real swap takes up to the
// signature, and stops there:
//   1. quote the pair for the given wallet
//   2. build the router's unsigned transaction for that wallet
//   3. decompile it through the same guard the executor uses (single signer,
//      wallet pays, nothing leaves the wallet beyond the disclosed fees)
//   4. simulate the router transaction on mainnet with signature checks off
//
// Nothing is signed and no key is loaded: the wallet is a public key only.
// Simulation needs the wallet to hold the input amount plus fees, so point it
// at a funded wallet (an agent wallet's public address works).
//
// Usage:
//   node --env-file=.env.local scripts/check-trading-routes.mjs --wallet <pubkey>
//   node --env-file=.env.local scripts/check-trading-routes.mjs --wallet <pubkey> --in SOL --out USDC --amount 0.01
//   ... --json                  machine-readable report
//
// LIFI_API_KEY raises the LI.FI rate limit and is read from the environment
// when present (scripts/read-service-env.mjs '^LIFI_API_KEY$' --raw).
//
// Exit code: 0 when every aggregator that has a route for the pair quoted,
// built, passed the guard and simulated cleanly; 1 otherwise; 2 on bad usage.

import { PublicKey, VersionedTransaction } from '@solana/web3.js';

import { SWAP_AGGREGATORS, quoteRoute, buildRoute, decompileRouteTx } from '../api/_lib/trading-tools/swap-routes.js';
import { resolveMint, tokenDecimals } from '../api/_lib/trading-tools/market.js';
import { toAtomic } from '../api/_lib/trading-tools/arbitrage.js';
import { solanaConnection } from '../api/_lib/agent-pumpfun.js';

function arg(name, fallback = null) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const wallet = arg('wallet');
const asJson = process.argv.includes('--json');
const slippageBps = Number(arg('slippage-bps', '100'));
if (!wallet) {
	console.error('usage: check-trading-routes.mjs --wallet <pubkey> [--in SOL] [--out USDC] [--amount 0.01] [--slippage-bps 100] [--json]');
	process.exit(2);
}
let ownerPk;
try {
	ownerPk = new PublicKey(wallet);
} catch {
	console.error(`not a Solana public key: ${wallet}`);
	process.exit(2);
}

const inputMint = await resolveMint(arg('in', 'SOL'));
const outputMint = await resolveMint(arg('out', 'USDC'));
const amountRaw = toAtomic(arg('amount', '0.01'), await tokenDecimals(inputMint));
const conn = solanaConnection('mainnet');

async function checkOne(aggregator) {
	const row = { aggregator, quote: null, build: null, guard: null, simulation: null, ok: false };
	const route = await quoteRoute(aggregator, { inputMint, outputMint, amountRaw, slippageBps, userAddress: wallet, fresh: true });
	if (route.status !== 'ok') {
		row.quote = { status: route.status, reason: route.reason };
		// A pair one router does not list is a market fact, not a broken route.
		row.ok = route.status === 'no_route';
		row.skipped = row.ok;
		return row;
	}
	row.quote = { status: 'ok', out_amount_raw: route.out_amount_raw, min_out_raw: route.min_out_raw, price_impact_pct: route.price_impact_pct, route: route.route, latency_ms: route.latency_ms };

	let txs;
	try {
		txs = await buildRoute(aggregator, { raw: route.raw, userAddress: wallet, conn });
		row.build = { status: 'ok', transactions: txs.length };
	} catch (err) {
		row.build = { status: 'failed', reason: err.message };
		return row;
	}

	try {
		const { instructions, addressLookupTables } = await decompileRouteTx(txs, { conn, ownerPk, inputMint, providerFees: route.provider_fees, inAmountRaw: route.in_amount_raw });
		row.guard = { status: 'ok', instructions: instructions.length, lookup_tables: addressLookupTables.length };
	} catch (err) {
		row.guard = { status: 'refused', code: err.code || null, reason: err.message };
		return row;
	}

	try {
		const tx = VersionedTransaction.deserialize(Buffer.from(txs[0], 'base64'));
		const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
		const err = sim.value.err;
		row.simulation = { status: err ? 'failed' : 'ok', err: err || null, units_consumed: sim.value.unitsConsumed ?? null };
		if (err) row.simulation.logs = (sim.value.logs || []).slice(-6);
		row.ok = !err;
	} catch (err) {
		row.simulation = { status: 'failed', reason: err.message };
	}
	return row;
}

const results = [];
for (const aggregator of SWAP_AGGREGATORS) results.push(await checkOne(aggregator));
const passed = results.every((r) => r.ok) && results.some((r) => r.ok && !r.skipped);

if (asJson) {
	console.log(JSON.stringify({ checked_at: new Date().toISOString(), wallet, input_mint: inputMint, output_mint: outputMint, amount_raw: amountRaw, slippage_bps: slippageBps, passed, results }, null, 2));
} else {
	console.log(`swap routes for ${wallet}: ${amountRaw} of ${inputMint} -> ${outputMint} (read-only, nothing signed)`);
	for (const r of results) {
		const steps = [
			`quote ${r.quote.status}${r.quote.status === 'ok' ? ` (${r.quote.out_amount_raw} out, ${r.quote.latency_ms}ms)` : `: ${r.quote.reason}`}`,
			r.build && `build ${r.build.status}${r.build.reason ? `: ${r.build.reason}` : ''}`,
			r.guard && `guard ${r.guard.status}${r.guard.reason ? `: ${r.guard.reason}` : ` (${r.guard.instructions} ix)`}`,
			r.simulation && `simulate ${r.simulation.status}${r.simulation.units_consumed != null ? ` (${r.simulation.units_consumed} CU)` : ''}${r.simulation.err ? ` ${JSON.stringify(r.simulation.err)}` : ''}${r.simulation.reason ? `: ${r.simulation.reason}` : ''}`,
		].filter(Boolean);
		console.log(`  ${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'} ${r.aggregator.padEnd(8)} ${steps.join(' | ')}`);
		for (const line of r.simulation?.logs || []) console.log(`         ${line}`);
	}
	console.log(passed ? 'all routes pass' : 'one or more routes failed');
}
process.exit(passed ? 0 : 1);
