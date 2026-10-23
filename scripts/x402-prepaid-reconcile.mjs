#!/usr/bin/env node
// scripts/x402-prepaid-reconcile.mjs
//
// Reconciles the x402 prepaid ledger: deposits - debits - settled = held, and
// each payer balance equals deposits - debits. Prints a zero delta when the
// books are clean; exits 1 on any problem, 2 on an unusable setup.
//
//   node scripts/x402-prepaid-reconcile.mjs            # reads DATABASE_URL (read-only)
//   node scripts/x402-prepaid-reconcile.mjs --chain    # also compare the deposit wallet's USDC
//   node scripts/x402-prepaid-reconcile.mjs --dev      # in-process Postgres (PGlite): applies the
//                                                      # migration, runs real deposits, debits, a
//                                                      # refund and a batch settlement, then reconciles
//   --json                                             # machine-readable output
//
// DATABASE_URL mode never writes. --dev never touches any remote database.

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const dev = args.has('--dev');
const checkChain = args.has('--chain');

const root = new URL('../', import.meta.url);
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

async function useDevDatabase() {
	const { PGlite } = await import('@electric-sql/pglite');
	const pg = new PGlite();
	await pg.exec(readFileSync(new URL('api/_lib/migrations/20261023160000_x402_prepaid_ledger.sql', root), 'utf8'));
	globalThis.__prepaidDevPg = pg;
	const shim = `
		export const sql = async (strings, ...values) => {
			const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? '$' + (i + 1) : ''), '');
			return (await globalThis.__prepaidDevPg.query(text, values)).rows;
		};
		export const isDbUnavailableError = () => false;
		export const isDbCapacityError = () => false;
	`;
	const shimUrl = 'data:text/javascript,' + encodeURIComponent(shim);
	const hooks = `
		export async function resolve(specifier, context, next) {
			if (specifier.endsWith('/_lib/db.js') || specifier === '../db.js') return { url: ${JSON.stringify(shimUrl)}, shortCircuit: true };
			return next(specifier, context);
		}
	`;
	register('data:text/javascript,' + encodeURIComponent(hooks), pathToFileURL('./'));
}

async function seedDevLedger() {
	const ledger = await import('../api/_lib/x402/prepaid-ledger.js');
	const settle = await import('../api/_lib/x402/prepaid-settle.js');
	const { PREPAID_NETWORK, PREPAID_ASSET } = await import('../api/_lib/x402/prepaid-constants.js');
	const key = (payer) => ({ payer, network: PREPAID_NETWORK, asset: PREPAID_ASSET });
	const payers = ['THREEsyntheticPayer1111111111111111111111', 'THREEsyntheticPayer2222222222222222222222'];
	const payees = [THREE_MINT, 'THREEsyntheticPayee1111111111111111111111'];

	for (const [i, payer] of payers.entries()) {
		await ledger.creditDeposit({ ...key(payer), amountAtomics: 5_000_000n, ref: `dev-deposit-${i}` });
	}
	const reserved = await Promise.all(
		Array.from({ length: 40 }, (_, i) =>
			ledger.reserveDebit({ ...key(payers[i % 2]), amountAtomics: 150_000n, ref: `dev-debit-${i}`, payee: payees[i % 2], route: '/dev' }),
		),
	);
	let n = 0;
	for (const r of reserved) {
		if (!r?.entryId) continue;
		if (n++ % 5 === 4) await ledger.refundDebit(r.entryId, 'upstream_5xx');
		else await ledger.commitDebit(r.entryId);
	}
	const sent = [];
	await settle.runSettlementWindow({
		minSettleAtomics: 1_000_000n,
		send: async (batches) => {
			sent.push(batches.length);
			return `dev-signature-${sent.length}`;
		},
	});
	return { payers: payers.length, debitsAttempted: reserved.length, transactions: sent.length };
}

async function main() {
	let seeded = null;
	if (dev) {
		await useDevDatabase();
	} else if (!process.env.DATABASE_URL) {
		console.error('DATABASE_URL is not set. Use --dev for the in-process ledger, or load .env.local.');
		process.exit(2);
	}
	if (dev) seeded = await seedDevLedger();

	const { reconcileReport } = await import('../api/_lib/x402/prepaid-reconcile.js');
	let report;
	try {
		report = await reconcileReport({ checkChain });
	} catch (err) {
		if (/x402_prepaid_/.test(String(err?.message)) && /does not exist/.test(String(err?.message))) {
			console.error('The x402_prepaid_* tables do not exist yet. Run `npm run db:status`, then `npm run db:migrate` at deploy.');
			process.exit(2);
		}
		throw err;
	}

	if (asJson) {
		console.log(JSON.stringify({ ok: report.ok, problems: report.problems, summary: report.summary, seeded }, null, 2));
	} else {
		if (seeded) console.log(`dev ledger: ${seeded.payers} payers, ${seeded.debitsAttempted} debits, ${seeded.transactions} settlement tx\n`);
		console.log(report.lines.join('\n'));
	}
	process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
	console.error(err?.stack || err);
	process.exit(2);
});
