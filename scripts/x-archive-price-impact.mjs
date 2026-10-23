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
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ARCHIVE_DIR, listArchiveFiles, mergeScrapes, readScrapeFile } from './x-archive-lib.mjs';
import { THREE_MINT, buildImpactDocument, loadSeries } from '../api/_lib/x-content/price-impact.js';

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
const { pool, candles } = await loadSeries({ mint: THREE_MINT, fromSec: earliest });
if (candles.length < 2) throw new Error('GeckoTerminal returned no $THREE candles');

const doc = buildImpactDocument({ handle: HANDLE, posts, pool, candles });
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

if (!TO_STDOUT) {
	await mkdir(path.dirname(OUT_FILE), { recursive: true });
	await writeFile(OUT_FILE, `${JSON.stringify(doc, null, 1)}\n`);
	console.log(`wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
}
