#!/usr/bin/env node
/**
 * Print the accounting ledger (withdrawals, platform fee events, bounty
 * escrow/payout/refund) for an inclusive UTC date range to stdout.
 *
 *   node scripts/export-accounting.mjs --from 2026-10-01 --to 2026-10-31 --format csv
 *   node scripts/export-accounting.mjs --from 2026-10-01 --to 2026-10-31 --format json
 *
 * Reads the database named by DATABASE_URL (.env.local / .env are loaded when
 * the variable is not already set). Read-only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const envFile of ['.env.local', '.env']) {
	try {
		for (const line of fs.readFileSync(path.resolve(ROOT, envFile), 'utf8').split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
			if (!m || process.env[m[1]]) continue;
			process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
		}
		break;
	} catch {
		/* file not present */
	}
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const format = flag('format', 'csv');

if (!process.env.DATABASE_URL) {
	console.error('ERROR: DATABASE_URL is required. Set it in .env.local or the environment.');
	process.exit(1);
}
if (format !== 'csv' && format !== 'json') {
	console.error('ERROR: --format must be csv or json');
	process.exit(2);
}

const { COLUMNS, collectAccountingRows, parseRange, toCsv } = await import('../api/_lib/accounting-export.js');
let range;
try {
	range = parseRange(flag('from'), flag('to'));
} catch (err) {
	console.error(`ERROR: ${err.message}`);
	process.exit(2);
}
const rows = await collectAccountingRows(range);
process.stdout.write(
	format === 'json'
		? JSON.stringify({ from: range.from, to: range.to, count: rows.length, columns: COLUMNS, rows }, null, 2) + '\n'
		: toCsv(rows),
);
