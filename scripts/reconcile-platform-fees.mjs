#!/usr/bin/env node
// Reconcile platform_fee_events against the chain and the purchase tables.
//
// The fee ledger (api/_lib/platform-fee-events.js) is only worth trusting if
// what it says matches what the fee wallets actually received. For a window of
// UTC days this checks, read-only:
//
//   1. Backed: every onchain Solana event's transaction confirmed and paid its
//      beneficiary at least the recorded amount (summed per tx, beneficiary
//      and asset, since one tx can carry more than one fee leg).
//   2. Complete: every confirmed skill purchase, bundle purchase and
//      subscription checkout in the window whose transaction paid the platform
//      fee wallet has its event. A buyer who used the no-fee fallback paid the
//      wallet nothing and correctly has none.
//   3. Totals: the ledger's per-source, per-asset totals for the window,
//      including the ledger-settled x402 skill splits.
//
// Exit 0: consistent. Exit 1: an unbacked or missing fee. Exit 2: cannot run
// (no DATABASE_URL, or the platform_fee_events migration is not applied).
//
//   npm run audit:platform-fees                       yesterday (UTC)
//   npm run audit:platform-fees -- --date 2026-11-03
//   npm run audit:platform-fees -- --days 7 --json
//   npm run audit:platform-fees -- --no-chain         ledger totals only
//
// Env: DATABASE_URL, plus the Solana RPC env rpcFallbackFromEnv reads.
// Reads .env.local then .env. Writes nothing.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const file of ['.env.local', '.env']) {
	try {
		for (const line of readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (!m || process.env[m[1]]) continue;
			let value = m[2].trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			process.env[m[1]] = value;
		}
	} catch { /* not present */ }
}

function arg(name, fallback = null) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const json = process.argv.includes('--json');
const checkChain = !process.argv.includes('--no-chain');
const days = Math.max(1, Math.min(31, parseInt(arg('days', '1'), 10) || 1));
const maxTx = Math.max(1, parseInt(arg('max-tx', '500'), 10) || 500);

function fail(code, message) {
	if (json) console.log(JSON.stringify({ ok: false, error: message }));
	else console.error(message);
	process.exit(code);
}

const dateArg = arg('date');
let end;
if (dateArg) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) fail(2, `--date must be YYYY-MM-DD, got ${dateArg}`);
	end = new Date(`${dateArg}T00:00:00Z`);
	end.setUTCDate(end.getUTCDate() + 1);
} else {
	end = new Date();
	end.setUTCHours(0, 0, 0, 0);
}
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - days);

if (!process.env.DATABASE_URL) fail(2, 'DATABASE_URL is not set. Add it to .env.local or export it.');

const { sql } = await import('../api/_lib/db.js');
const { feeReceivedInTx } = await import('../api/_lib/platform-fee-events.js');

const [{ present }] = await sql`select to_regclass('public.platform_fee_events') is not null as present`;
if (!present) {
	fail(2, 'platform_fee_events does not exist: apply api/_lib/migrations/20261104150000_platform_fee_events.sql (npm run db:status, then npm run db:migrate).');
}

const totals = await sql`
	select source, settlement, chain, asset, asset_mint, decimals,
	       count(*)::int as events, sum(amount_atomics)::text as amount_atomics
	from platform_fee_events
	where occurred_at >= ${start.toISOString()} and occurred_at < ${end.toISOString()}
	group by 1, 2, 3, 4, 5, 6
	order by 1, 4`;

const report = {
	ok: true,
	window: { start: start.toISOString(), end: end.toISOString(), days },
	totals,
	checked: { onchain_txs: 0, purchases: 0 },
	unbacked: [],
	missing: [],
	unverifiable: [],
	skipped_chain: !checkChain,
};

if (checkChain) {
	const { rpcFallbackFromEnv } = await import('../api/_lib/solana/rpc-fallback.js');
	const rpcs = new Map();
	const txCache = new Map();
	let rpcCalls = 0;
	async function parsedTx(network, signature) {
		const key = `${network}:${signature}`;
		if (txCache.has(key)) return txCache.get(key);
		if (rpcCalls >= maxTx) return undefined;
		rpcCalls += 1;
		if (!rpcs.has(network)) rpcs.set(network, rpcFallbackFromEnv({ network, commitment: 'confirmed' }));
		const tx = await rpcs.get(network).withFallback((c) =>
			c.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }),
		);
		txCache.set(key, tx ?? null);
		return tx ?? null;
	}
	const assetKind = (asset) => (asset === 'SOL' ? 'SOL' : 'SPL');

	// 1. Backed: group the window's onchain Solana events per tx leg.
	const legs = await sql`
		select network, tx_signature, beneficiary, asset, asset_mint,
		       sum(amount_atomics)::text as amount_atomics,
		       array_agg(source || ':' || source_ref) as refs
		from platform_fee_events
		where settlement = 'onchain' and chain = 'solana'
		  and occurred_at >= ${start.toISOString()} and occurred_at < ${end.toISOString()}
		group by 1, 2, 3, 4, 5`;
	for (const leg of legs) {
		const network = leg.network === 'devnet' ? 'devnet' : 'mainnet';
		let tx;
		try {
			tx = await parsedTx(network, leg.tx_signature);
		} catch (e) {
			report.unverifiable.push({ tx_signature: leg.tx_signature, refs: leg.refs, reason: e.message });
			continue;
		}
		if (tx === undefined) {
			report.unverifiable.push({ tx_signature: leg.tx_signature, refs: leg.refs, reason: `--max-tx ${maxTx} reached` });
			continue;
		}
		report.checked.onchain_txs += 1;
		const received = tx
			? feeReceivedInTx(tx, { recipient: leg.beneficiary, asset: assetKind(leg.asset), mint: leg.asset_mint })
			: 0n;
		const recorded = BigInt(leg.amount_atomics);
		if (received < recorded) {
			report.unbacked.push({
				tx_signature: leg.tx_signature,
				beneficiary: leg.beneficiary,
				asset: leg.asset,
				recorded: recorded.toString(),
				received: received.toString(),
				refs: leg.refs,
				reason: tx ? 'fee wallet received less than recorded' : 'transaction not found or not confirmed',
			});
		}
	}

	// 2. Complete: confirmed purchases whose tx paid the fee wallet need an event.
	const purchases = [
		...(await sql`
			select 'skill_purchase' as source, id::text as ref, tx_signature, platform_fee_wallet, currency_mint
			from skill_purchases
			where status = 'confirmed' and chain = 'solana' and tx_signature is not null
			  and platform_fee_wallet is not null and coalesce(platform_fee_amount, 0) > 0
			  and confirmed_at >= ${start.toISOString()} and confirmed_at < ${end.toISOString()}`),
		...(await sql`
			select 'skill_bundle' as source, id::text as ref, tx_signature, platform_fee_wallet, currency_mint
			from bundle_purchases
			where status = 'confirmed' and chain = 'solana' and tx_signature is not null
			  and platform_fee_wallet is not null and coalesce(platform_fee_amount, 0) > 0
			  and confirmed_at >= ${start.toISOString()} and confirmed_at < ${end.toISOString()}`),
		...(await sql`
			select 'subscription' as source, id::text as ref, tx_signature, platform_fee_wallet, currency_mint
			from subscription_checkouts
			where status = 'confirmed' and tx_signature is not null
			  and platform_fee_wallet is not null and coalesce(platform_fee_amount, 0) > 0
			  and confirmed_at >= ${start.toISOString()} and confirmed_at < ${end.toISOString()}`),
	];
	const recordedRefs = new Set(
		(await sql`
			select source || ':' || source_ref as k from platform_fee_events
			where source in ('skill_purchase', 'skill_bundle', 'subscription')
			  and occurred_at >= ${new Date(start.getTime() - 86_400_000).toISOString()}`).map((r) => r.k),
	);
	for (const p of purchases) {
		if (recordedRefs.has(`${p.source}:${p.ref}`)) {
			report.checked.purchases += 1;
			continue;
		}
		let tx;
		try {
			tx = await parsedTx('mainnet', p.tx_signature);
		} catch (e) {
			report.unverifiable.push({ tx_signature: p.tx_signature, refs: [`${p.source}:${p.ref}`], reason: e.message });
			continue;
		}
		if (tx === undefined) {
			report.unverifiable.push({ tx_signature: p.tx_signature, refs: [`${p.source}:${p.ref}`], reason: `--max-tx ${maxTx} reached` });
			continue;
		}
		report.checked.purchases += 1;
		const paid = tx ? feeReceivedInTx(tx, { recipient: p.platform_fee_wallet, asset: 'SPL', mint: p.currency_mint }) : 0n;
		if (paid > 0n) {
			report.missing.push({
				source: p.source,
				source_ref: p.ref,
				tx_signature: p.tx_signature,
				fee_wallet: p.platform_fee_wallet,
				received: paid.toString(),
			});
		}
	}
}

report.ok = report.unbacked.length === 0 && report.missing.length === 0;

if (json) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(`platform fees ${report.window.start.slice(0, 10)} .. ${end.toISOString().slice(0, 10)} (exclusive), ${days} day(s)`);
	if (!totals.length) console.log('  no fee events in the window');
	for (const t of totals) {
		console.log(`  ${t.source.padEnd(17)} ${t.settlement.padEnd(8)} ${String(t.chain).padEnd(7)} ${t.asset.padEnd(5)} ${String(t.events).padStart(5)} events  ${t.amount_atomics} atomics (10^-${t.decimals})`);
	}
	if (checkChain) {
		console.log(`  chain-checked: ${report.checked.onchain_txs} fee tx leg(s), ${report.checked.purchases} confirmed purchase(s)`);
	} else {
		console.log('  chain checks skipped (--no-chain)');
	}
	for (const u of report.unbacked) {
		console.log(`  UNBACKED ${u.tx_signature}: recorded ${u.recorded}, received ${u.received} (${u.reason}) [${u.refs.join(', ')}]`);
	}
	for (const m of report.missing) {
		console.log(`  MISSING  ${m.source}:${m.source_ref} tx ${m.tx_signature} paid ${m.received} to ${m.fee_wallet} with no fee event`);
	}
	for (const u of report.unverifiable) {
		console.log(`  unverified ${u.tx_signature}: ${u.reason}`);
	}
	console.log(report.ok ? 'consistent' : 'INCONSISTENT');
}
process.exit(report.ok ? 0 : 1);
