#!/usr/bin/env node
// Print where the Solana RPC quota goes: the top (caller, method) pairs by real
// provider calls over a window, plus per-lane totals, the reads the cache and
// coalescing saved, and any lane budget in force.
//
// Reads GET /api/ops/rpc-spend from a running server, because the counts live
// in the shared cache of the process that made the calls (a local dev server
// keeps them in memory; production keeps them in Redis).
//
//   node scripts/rpc-spend-report.mjs                       # http://localhost:3000, 24h
//   node scripts/rpc-spend-report.mjs --base https://three.ws --hours 6 --top 30
//   node scripts/rpc-spend-report.mjs --json                # raw board
//
// Auth: OPS_SECRET from the environment (or .env / .env.local), sent as
// x-ops-secret. The secret is never printed.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
	const out = { base: process.env.RPC_SPEND_BASE || 'http://localhost:3000', hours: 24, top: 20, json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		if (a === '--base') out.base = next();
		else if (a === '--hours') out.hours = Number(next());
		else if (a === '--top') out.top = Number(next());
		else if (a === '--json') out.json = true;
		else if (a === '--help' || a === '-h') out.help = true;
		else throw new Error(`unknown argument: ${a}`);
	}
	return out;
}

function opsSecret() {
	if (process.env.OPS_SECRET) return process.env.OPS_SECRET;
	for (const name of ['.env.local', '.env']) {
		const p = resolve(ROOT, name);
		if (!existsSync(p)) continue;
		const m = readFileSync(p, 'utf8').match(/^\s*OPS_SECRET\s*=\s*"?([^"\n]*)"?\s*$/m);
		if (m && m[1]) return m[1].trim();
	}
	return '';
}

const pad = (v, n, right = false) => {
	const s = String(v);
	if (s.length >= n) return s.slice(0, n);
	return right ? s.padStart(n) : s.padEnd(n);
};

function table(headers, rows, widths, rightCols = new Set()) {
	const line = (cells) => cells.map((c, i) => pad(c, widths[i], rightCols.has(i))).join('  ');
	console.log(line(headers));
	console.log(widths.map((w) => '-'.repeat(w)).join('  '));
	for (const r of rows) console.log(line(r));
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log('usage: node scripts/rpc-spend-report.mjs [--base URL] [--hours 1..48] [--top N] [--json]');
		return;
	}
	const secret = opsSecret();
	if (!secret) {
		console.error('OPS_SECRET is not set (env, .env.local or .env); /api/ops/rpc-spend requires it.');
		process.exitCode = 2;
		return;
	}
	const url = new URL('/api/ops/rpc-spend', args.base);
	url.searchParams.set('hours', String(args.hours));
	url.searchParams.set('top', String(args.top));

	let res;
	try {
		res = await fetch(url, { headers: { 'x-ops-secret': secret, accept: 'application/json' } });
	} catch (err) {
		console.error(`could not reach ${url.origin}: ${err?.cause?.code || err?.message}. Is the server running?`);
		process.exitCode = 1;
		return;
	}
	const text = await res.text();
	let board;
	try {
		board = JSON.parse(text);
	} catch {
		console.error(`${res.status} from ${url.origin}, not JSON: ${text.slice(0, 200)}`);
		process.exitCode = 1;
		return;
	}
	if (!res.ok) {
		console.error(`${res.status} ${board?.error || ''} ${board?.error_description || board?.message || ''}`.trim());
		process.exitCode = 1;
		return;
	}
	if (args.json) {
		console.log(JSON.stringify(board, null, 2));
		return;
	}

	const total = board.calls + board.saved;
	console.log(`Solana RPC spend, ${board.window.from} to ${board.window.to} (${board.window.hours}h, ${board.instances} instance(s)) at ${url.origin}`);
	console.log(`provider calls: ${board.calls}   saved by cache/coalescing: ${board.saved}   saved share: ${(board.saved_ratio * 100).toFixed(1)}% of ${total} reads`);
	console.log('');
	if (!board.top.length) {
		console.log('No RPC calls recorded in this window. Exercise a route that reads Solana, then rerun.');
		return;
	}
	table(
		['#', 'caller', 'method', 'calls', 'saved', 'share'],
		board.top.map((r, i) => [
			i + 1,
			r.caller,
			r.method,
			r.calls,
			r.saved,
			board.calls ? `${((r.calls / board.calls) * 100).toFixed(1)}%` : '0.0%',
		]),
		[3, 52, 34, 9, 9, 6],
		new Set([0, 3, 4, 5]),
	);
	console.log('');
	table(['lane', 'calls'], board.by_lane.map((l) => [l.lane, l.calls]), [44, 9], new Set([1]));
	if (board.budgets?.length) {
		console.log('');
		table(
			['budgeted lane', 'today', 'daily', 'cutoff', 'state'],
			board.budgets.map((b) => [b.lane, b.calls_today, b.daily, `${Math.round(b.fraction * 100)}%`, b.over_budget ? 'DEMOTED' : 'ok']),
			[44, 9, 9, 6, 8],
			new Set([1, 2, 3]),
		);
	}
}

main().catch((err) => {
	console.error(err?.stack || String(err));
	process.exitCode = 1;
});
