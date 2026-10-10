#!/usr/bin/env node
// Submit pages from data/pages.json to IndexNow (Bing, Yandex, Seznam, Naver)
// so a freshly deployed page is indexed in minutes instead of at the next crawl.
// Run it after a deploy has landed: IndexNow fetches the URLs it is given, so a
// page that is not live yet wastes the submission.
//
//   node scripts/indexnow-submit.mjs                 pages added in the last 7 days
//   node scripts/indexnow-submit.mjs --days 30       a wider window
//   node scripts/indexnow-submit.mjs --since 2026-10-01
//   node scripts/indexnow-submit.mjs --all           every page in the manifest
//   node scripts/indexnow-submit.mjs --dry-run       print the list, send nothing
//
// The key file lives at public/<key>.txt and the client at api/_lib/indexnow.js.

import { readFileSync } from 'node:fs';
import { pingIndexNow } from '../api/_lib/indexnow.js';

const ORIGIN = 'https://three.ws';
// IndexNow accepts up to 10,000 URLs per request.
const BATCH = 10_000;

function parseArgs(argv) {
	const opts = { days: 7, since: null, all: false, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--all') opts.all = true;
		else if (a === '--dry-run') opts.dryRun = true;
		else if (a === '--days') opts.days = Number(argv[++i]);
		else if (a === '--since') opts.since = argv[++i];
		else throw new Error(`unknown argument: ${a}`);
	}
	if (!Number.isFinite(opts.days) || opts.days <= 0) throw new Error('--days needs a positive number');
	if (opts.since && Number.isNaN(Date.parse(opts.since))) throw new Error('--since needs a date like 2026-10-01');
	return opts;
}

function selectPages(manifest, opts) {
	const cutoff = opts.since
		? new Date(opts.since).toISOString().slice(0, 10)
		: new Date(Date.now() - opts.days * 86_400_000).toISOString().slice(0, 10);
	const urls = new Set();
	for (const section of manifest.sections) {
		for (const page of section.pages) {
			if (!page.path || page.path.includes(':')) continue;
			if (!opts.all && !(page.added && page.added >= cutoff)) continue;
			urls.add(ORIGIN + page.path);
		}
	}
	return { urls: [...urls], cutoff };
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const manifest = JSON.parse(readFileSync(new URL('../data/pages.json', import.meta.url), 'utf8'));
	const { urls, cutoff } = selectPages(manifest, opts);
	const scope = opts.all ? 'every page' : `pages added since ${cutoff}`;
	if (urls.length === 0) {
		console.log(`[indexnow] no ${scope}; nothing to submit`);
		return;
	}
	console.log(`[indexnow] ${urls.length} URL(s), ${scope}`);
	if (opts.dryRun) {
		for (const u of urls) console.log(`  ${u}`);
		return;
	}
	let failed = 0;
	for (let i = 0; i < urls.length; i += BATCH) {
		const chunk = urls.slice(i, i + BATCH);
		const res = await pingIndexNow(chunk);
		const detail = res.status ? `HTTP ${res.status}` : res.error;
		console.log(`[indexnow] batch ${i / BATCH + 1}: ${chunk.length} URL(s) ${res.ok ? 'accepted' : 'rejected'} (${detail})`);
		if (!res.ok) failed++;
	}
	if (failed) process.exitCode = 1;
}

main().catch((err) => {
	console.error(`[indexnow] ${err.message}`);
	process.exitCode = 1;
});
