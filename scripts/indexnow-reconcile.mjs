#!/usr/bin/env node
// Run the IndexNow reconcile by hand: the same code the ten-minute cron runs
// (api/cron/indexnow-reconcile.js), against the database in DATABASE_URL.
// Use it right after a deploy, to backfill a window, or to see what the next
// run would send.
//
//   npm run indexnow:reconcile                         changes since each type's cursor, then submit
//   npm run indexnow:reconcile -- --since 2026-11-01   rescan from a date (cursors still advance)
//   npm run indexnow:reconcile -- --types agent,page   only some types
//   npm run indexnow:reconcile -- --dry-run            print what would be enqueued, write nothing, send nothing
//   npm run indexnow:reconcile -- --drain              submit what is already queued, scan nothing
//   npm run indexnow:reconcile -- --status             outbox depth and the last five requests
//
// IndexNow fetches what it is given, so only run it against URLs that are
// already live: deploy first. Database rows are live the moment they are
// written, but this checkout's data/pages.json can list pages production does
// not serve yet, so each catalog page is fetched from production first and a
// page that does not answer 200 is held back (and the page cursor with it)
// until a later run. Runbook: docs/ops/bing-and-indexnow.md.

import { config } from 'dotenv';

config({ path: '.env.local' });
config();

function parseArgs(argv) {
	const opts = { since: null, types: null, dryRun: false, status: false, drainOnly: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dry-run') opts.dryRun = true;
		else if (a === '--status') opts.status = true;
		else if (a === '--drain') opts.drainOnly = true;
		else if (a === '--since') opts.since = argv[++i];
		else if (a === '--types') opts.types = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
		else throw new Error(`unknown argument: ${a}`);
	}
	if (opts.since) {
		const d = new Date(opts.since);
		if (Number.isNaN(d.getTime())) throw new Error('--since needs a date like 2026-11-01');
		opts.since = d;
	}
	return opts;
}

/** True when production answers 200 for the URL itself (no redirect, no 404). */
async function servedByProduction(url) {
	try {
		const res = await fetch(url, {
			method: 'GET',
			redirect: 'manual',
			headers: { 'user-agent': 'three.ws-indexnow-reconcile' },
			signal: AbortSignal.timeout(15_000),
		});
		await res.body?.cancel();
		return res.status === 200;
	} catch {
		return false;
	}
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (looked in .env.local and .env)');
	const { reconcileIndexNow, drainIndexNow, indexNowStatus, RECONCILE_TYPES } = await import('../api/_lib/indexnow-queue.js');

	if (opts.status) {
		const s = await indexNowStatus();
		console.log(`[indexnow] pending ${s.pending}`);
		for (const r of s.recent) {
			console.log(`  ${new Date(r.submitted_at).toISOString()} ${r.source.padEnd(10)} ${String(r.url_count).padStart(5)} url(s)  HTTP ${r.status ?? '-'}  ${r.ok ? 'ok' : r.error}`);
		}
		return;
	}

	const result = opts.drainOnly
		? { types: [], drain: await drainIndexNow({ source: 'manual' }) }
		: await reconcileIndexNow({
				since: opts.since,
				types: opts.types || RECONCILE_TYPES,
				dryRun: opts.dryRun,
				source: 'manual',
				isLive: servedByProduction,
			});
	let failed = false;
	for (const t of result.types) {
		if (t.error) {
			failed = true;
			console.log(`[indexnow] ${t.type}: error ${t.error}`);
			continue;
		}
		console.log(
			`[indexnow] ${t.type}: scanned ${t.scanned}, public ${t.live}, deleted ${t.gone}, hidden ${t.hidden}` +
				(opts.dryRun ? '' : `, enqueued ${t.enqueued}`) +
				` (from ${t.from})`,
		);
		if (opts.dryRun) for (const u of t.urls || []) console.log(`    ${u}`);
		if (t.skipped?.length) {
			console.log(`[indexnow] ${t.type}: held back ${t.skipped.length} page(s) production does not serve yet (deploy, then rerun):`);
			for (const u of t.skipped) console.log(`    ${u}`);
		}
	}
	if (result.drain) {
		const d = result.drain;
		if (d.skipped) console.log(`[indexnow] drain skipped: ${d.skipped} until ${d.until}`);
		for (const [i, b] of d.batches.entries()) {
			console.log(`[indexnow] batch ${i + 1}: ${b.urls} url(s) HTTP ${b.status ?? '-'} ${b.ok ? 'accepted' : b.error}`);
			if (!b.ok) failed = true;
		}
		console.log(`[indexnow] submitted ${d.submitted}`);
	}
	if (failed) process.exitCode = 1;
}

main().catch((err) => {
	console.error(`[indexnow] ${err.message}`);
	process.exitCode = 1;
});
