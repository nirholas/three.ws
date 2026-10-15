// Local spending ledger for the x402 buyer MCP. Every settled payment (from
// pay_and_call or a named tool in named-services.js) appends one JSON line
// here; spending_report reads it back and totals by merchant and day. This is
// the only state this stdio server keeps: everything else is stateless,
// per-call. File-based so the ledger survives across separate server runs
// (each `npx @three-ws/x402-mcp` invocation is a fresh process).

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { env } from '../config.js';

export const LEDGER_PATH = env('X402_MCP_LEDGER_PATH', path.join(homedir(), '.three-ws', 'x402-mcp-ledger.jsonl'));

/**
 * Append one settled-payment record. Never throws: a ledger write failure
 * (e.g. a read-only filesystem) must not fail the payment that already
 * happened.
 * @param {{tool?: string, url: string, amountUsd: number|null, token: string, network?: string|null, settlement?: unknown}} entry
 */
export async function recordSpend(entry) {
	const line = JSON.stringify({
		at: new Date().toISOString(),
		tool: entry.tool ?? null,
		url: entry.url,
		merchant: safeHostname(entry.url),
		amountUsd: typeof entry.amountUsd === 'number' && Number.isFinite(entry.amountUsd) ? entry.amountUsd : null,
		token: entry.token ?? 'usdc',
		network: entry.network ?? null,
		settlement: entry.settlement ?? null,
	});
	try {
		await mkdir(path.dirname(LEDGER_PATH), { recursive: true });
		await appendFile(LEDGER_PATH, line + '\n', 'utf8');
	} catch {
		// Ledger is best-effort bookkeeping, not the source of truth for the
		// payment itself (the chain is), so swallow write failures.
	}
}

function safeHostname(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return 'unknown';
	}
}

/** Read every ledger entry, oldest first. Missing file reads as empty. */
export async function readEntries() {
	let text;
	try {
		text = await readFile(LEDGER_PATH, 'utf8');
	} catch (err) {
		if (err?.code === 'ENOENT') return [];
		throw err;
	}
	const entries = [];
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line));
		} catch {
			// Skip a corrupted line rather than failing the whole report.
		}
	}
	return entries;
}

/**
 * Total ledger entries by merchant (hostname) and by day (UTC date), with an
 * optional `since` (ISO timestamp, inclusive) and `merchant` filter.
 * @param {{since?: string, merchant?: string}} [opts]
 */
export async function summarize(opts = {}) {
	let entries = await readEntries();
	if (opts.since) {
		const sinceMs = Date.parse(opts.since);
		if (Number.isFinite(sinceMs)) entries = entries.filter((e) => Date.parse(e.at) >= sinceMs);
	}
	if (opts.merchant) {
		const want = String(opts.merchant).toLowerCase();
		entries = entries.filter((e) => String(e.merchant).toLowerCase() === want);
	}

	const byMerchant = new Map();
	const byDay = new Map();
	let totalUsd = 0;
	let unpricedCalls = 0;

	for (const e of entries) {
		const day = String(e.at).slice(0, 10);
		const usd = typeof e.amountUsd === 'number' ? e.amountUsd : 0;
		if (e.amountUsd == null) unpricedCalls += 1;
		totalUsd += usd;

		const m = byMerchant.get(e.merchant) || { merchant: e.merchant, totalUsd: 0, calls: 0 };
		m.totalUsd += usd;
		m.calls += 1;
		byMerchant.set(e.merchant, m);

		const d = byDay.get(day) || { date: day, totalUsd: 0, calls: 0 };
		d.totalUsd += usd;
		d.calls += 1;
		byDay.set(day, d);
	}

	const round = (n) => Math.round(n * 1e6) / 1e6;
	return {
		totalUsd: round(totalUsd),
		totalCalls: entries.length,
		unpricedCalls,
		byMerchant: [...byMerchant.values()].map((m) => ({ ...m, totalUsd: round(m.totalUsd) })).sort((a, b) => b.totalUsd - a.totalUsd),
		byDay: [...byDay.values()].map((d) => ({ ...d, totalUsd: round(d.totalUsd) })).sort((a, b) => (a.date < b.date ? 1 : -1)),
	};
}
