#!/usr/bin/env node
/**
 * $THREE price impact of every archived @trythreews post.
 *
 * Usage:
 *   node scripts/x-archive-price-impact.mjs              # write public/data/trythreews-post-impact.json
 *   node scripts/x-archive-price-impact.mjs --stdout     # print the summary, write nothing
 *   node scripts/x-archive-price-impact.mjs --handle trythreews
 *
 * For each own post in data/x-archive: the $THREE/SOL price when it went out and
 * the return after +1h, +4h and +24h, against the same returns at arbitrary
 * moments (the baseline). A return with no price behind it (the post predates the
 * pool, or nothing traded around that time) is null, never interpolated.
 *
 * The output file is what the Posts view on /oracle-coin reads.
 *
 * GeckoTerminal's keyless tier only serves the last 180 days of candles, so every
 * 15m bar read is also kept in data/x-archive/analysis/<handle>-three-candles.json
 * and merged with each new read: the series only grows. Posts older than even
 * that archive keep the returns the previous output measured for them (counted in
 * the document's `carried` field).
 */

import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ARCHIVE_DIR, listArchiveFiles, mergeScrapes, readScrapeFile } from './x-archive-lib.mjs';
import { BAR_SECONDS, THREE_MINT, buildImpactDocument, loadSeries, mergeCandles } from '../api/_lib/x-content/price-impact.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
export const OUT_FILE = path.resolve(REPO_ROOT, 'public', 'data', 'trythreews-post-impact.json');

for (const envFile of ['.env.local', '.env']) {
	try {
		for (const line of readFileSync(path.resolve(REPO_ROOT, envFile), 'utf8').split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (!m || process.env[m[1]]) continue;
			process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
		}
	} catch {
		// Absent env files are normal outside a configured checkout.
	}
}

const args = process.argv.slice(2);
const handleIdx = args.indexOf('--handle');
const HANDLE = handleIdx >= 0 ? args[handleIdx + 1] : 'trythreews';
const TO_STDOUT = args.includes('--stdout');
const CANDLE_FILE = path.resolve(REPO_ROOT, ARCHIVE_DIR, 'analysis', `${HANDLE}-three-candles.json`);

async function readJson(file) {
	try {
		return JSON.parse(await readFile(file, 'utf8'));
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		throw new Error(`${path.relative(REPO_ROOT, file)} is unreadable: ${err.message}`);
	}
}

// Bars are stored as [t, o, h, l, c, v] rows with prices at 8 significant
// digits and volume to the cent: about half the size of raw floats, and far
// finer than the two-decimal percentage returns read from them.
const sig = (n) => (Number.isFinite(n) ? Number(n.toPrecision(8)) : n);
const cents = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
const packBars = (candles) => candles.map((b) => [b.t, sig(b.o), sig(b.h), sig(b.l), sig(b.c), cents(b.v)]);
const unpackBars = (rows) => (rows || []).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

async function loadPosts() {
	const files = await listArchiveFiles(path.resolve(REPO_ROOT, ARCHIVE_DIR));
	const scrapes = [];
	for (const file of files) {
		// Article snapshots are a different shape and carry no timeline.
		if (/-articles-/.test(file)) continue;
		const scrape = await readScrapeFile(file);
		if (scrape.handle.toLowerCase() === HANDLE.toLowerCase()) scrapes.push(scrape);
	}
	if (!scrapes.length) throw new Error(`no scrape files for @${HANDLE} in ${ARCHIVE_DIR}`);
	return mergeScrapes(scrapes).posts;
}

const posts = await loadPosts();
const earliest = Math.floor(Math.min(...posts.map((p) => Date.parse(p.postedAt))) / 1000);
const archived = await readJson(CANDLE_FILE);
const archivedBars = archived?.mint === THREE_MINT ? unpackBars(archived.candles) : [];
// With an archive, only the bars since its last one (plus a day of overlap, so a
// bar that was still forming is replaced) need reading.
const fromSec = archivedBars.length ? Math.max(earliest, archivedBars[archivedBars.length - 1].t - 86_400) : earliest;
// Up to five waits (15s doubling to 240s) per throttled page: the keyless tier
// throttles a full-history page burst, and a wait costs less than a lost run.
const fresh = await loadSeries({ mint: THREE_MINT, fromSec, rateLimitRetries: 5 });
const { pool } = fresh;
// A pool change is a different price series; the archive restarts from it.
const samePool = archived?.pool === pool;
const candles = mergeCandles(samePool ? archivedBars : [], fresh.candles);
if (candles.length < 2) throw new Error('GeckoTerminal returned no $THREE candles');
console.log(
	`read ${fresh.candles.length} bars from GeckoTerminal${fresh.historyLimited ? ' (stopped at its history window)' : ''}, ` +
		`${samePool ? archivedBars.length : 0} from the archive${archived && !samePool ? ` (pool changed from ${archived.pool}, archive restarted)` : ''}`,
);

const previous = await readJson(OUT_FILE);
const doc = buildImpactDocument({ handle: HANDLE, posts, pool, candles, previous });
const { summary } = doc;

const line = (key, label) => {
	const h = summary.horizons[key];
	return `${label}: ${h.measured} measured, ${h.unavailable} unavailable, median ${h.median}% (baseline ${h.baselineMedian}%), ${Math.round((h.positiveShare ?? 0) * 100)}% up`;
};
console.log(`@${HANDLE}: ${summary.posts} own posts, ${doc.posts.length} with a $THREE price at post time`);
console.log(`series ${doc.series.from} to ${doc.series.to} (${doc.series.bars} bars of 15m)`);
console.log(line('r1h', '+1h '));
console.log(line('r4h', '+4h '));
console.log(line('r24h', '+24h'));
if (doc.carried) console.log(`${doc.carried} posts predate every bar still available and keep the returns the previous run measured`);

if (!TO_STDOUT) {
	await mkdir(path.dirname(CANDLE_FILE), { recursive: true });
	await writeFile(
		CANDLE_FILE,
		`${JSON.stringify({ mint: THREE_MINT, pool, barSeconds: BAR_SECONDS, updatedAt: doc.generatedAt, fields: ['t', 'o', 'h', 'l', 'c', 'v'], candles: packBars(candles) })}\n`,
	);
	console.log(`wrote ${path.relative(REPO_ROOT, CANDLE_FILE)} (${candles.length} bars)`);
	await mkdir(path.dirname(OUT_FILE), { recursive: true });
	await writeFile(OUT_FILE, `${JSON.stringify(doc)}\n`);
	console.log(`wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
}
