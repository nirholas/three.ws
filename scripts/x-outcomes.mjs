#!/usr/bin/env node
// What the @trythreews posts actually did, and what the content queue has
// learned from it. The same engine runs inside every publishing tick of
// /api/cron/x-content (api/_lib/x-content/outcomes.js); this is the operator's
// view of it.
//
//   node scripts/x-outcomes.mjs             the learned table, then the best and worst posts
//   node scripts/x-outcomes.mjs --refresh   read the timeline from X first, and save it
//   node scripts/x-outcomes.mjs --json      the learned object as JSON
//   node scripts/x-outcomes.mjs --compare   pipeline posts against hand-sent ones, last 30 days
//
// Read only: it never posts. Env: reads .env.local then .env. DATABASE_URL gives
// it the stored outcomes and the publish ledger; X_API_KEY, X_API_SECRET,
// X_ACCESS_TOKEN, X_ACCESS_SECRET are needed only for --refresh, and are taken
// from the Cloud Run service when they are not in the local env files.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { OUTCOMES_WINDOW_DAYS, MIN_AGE_HOURS, attributeKeys, collectOutcomes, isMature, learnLifts, memoryOutcomesStore, outcomeOf, outcomesStore } from '../api/_lib/x-content/outcomes.js';
import { loadSeriesOrNull } from '../api/_lib/x-content/price-impact.js';
import { xClientFromEnv } from '../api/_lib/x-content/publisher.js';
import { dbStore, memoryStore } from '../api/_lib/x-content/state.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DAY = 24 * 60 * 60_000;
const COMPARE_DAYS = 30;
const BEST = 10;
const WORST = 5;

function loadEnvFile(path) {
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
		if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
	}
}
loadEnvFile(resolve(root, '.env.local'));
loadEnvFile(resolve(root, '.env'));

const args = process.argv.slice(2);
const has = (flag) => args.includes(`--${flag}`);

function fail(message) {
	console.error(message);
	process.exit(1);
}

// The four credentials of the @trythreews user context, taken from the Cloud
// Run service when they are not in the local env files.
const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];

function hydrateXEnv() {
	if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'aerial-vehicle-466722-p5';
	for (const name of X_ENV.filter((key) => !process.env[key])) {
		const read = spawnSync(process.execPath, [resolve(root, 'scripts/read-service-env.mjs'), `^${name}$`, '--raw'], { cwd: root, encoding: 'utf8' });
		const value = read.status === 0 ? read.stdout.trim() : '';
		if (value) process.env[name] = value;
	}
}

const store = () => (process.env.DATABASE_URL ? outcomesStore() : memoryOutcomesStore());
const ledgerStore = () => (process.env.DATABASE_URL ? dbStore() : memoryStore());

async function refresh(outcomes) {
	hydrateXEnv();
	const client = await xClientFromEnv(process.env);
	if (!client) fail(`Reading the timeline needs ${X_ENV.join(', ')}.`);
	const ledger = await ledgerStore().load();
	let fresh;
	try {
		fresh = await collectOutcomes({ client, ledger, priceSeries: await loadSeriesOrNull({ days: OUTCOMES_WINDOW_DAYS }) });
	} catch (err) {
		// Nothing is saved from a read that stopped half way, so the stored record
		// is still the last complete one.
		fail(`X did not answer the timeline read (${err?.data?.title || err?.message || err}). The stored outcomes are unchanged; run it again in a minute.`);
	}
	await outcomes.save(fresh);
	return fresh;
}

// Rounded before the sign is chosen, so a lift of -0.004 prints as 0.00.
function signed(value, places = 2) {
	const rounded = Math.round(value * 10 ** places) / 10 ** places + 0;
	return `${rounded > 0 ? '+' : ''}${rounded.toFixed(places)}`;
}

const postUrl = (row) => `https://x.com/i/status/${row.id}`;

function describeRow(row) {
	const metrics = `${String(row.likes).padStart(5)} likes ${String(row.bookmarks).padStart(4)} saved ${String(row.reposts).padStart(4)} reposts ${String(row.impressions).padStart(7)} views`;
	return `  ${outcomeOf(row).toFixed(2).padStart(5)}  ${row.at.slice(0, 10)}  ${metrics}  ${postUrl(row)}\n         ${row.source}  ${attributeKeys(row).join('  ')}`;
}

function printLearned(outcomes, learned, now) {
	console.log(`outcomes: ${outcomes.posts.length} head post(s), read ${outcomes.fetchedAt || 'never'}`);
	console.log(`sample:   ${learned.sample} post(s) at least ${MIN_AGE_HOURS} hours old`);
	console.log(`baseline: ${learned.baseline.toFixed(2)}   (log1p(likes) + 0.5 log1p(bookmarks) + 0.25 log1p(reposts), recency weighted)`);
	if (!learned.sample) {
		console.log('\nNothing has been measured yet. Run with --refresh to read the timeline from X.');
		return;
	}

	console.log('\nLift of each attribute value, against the posts without it:');
	console.log(`  ${'value'.padEnd(26)} ${'shrunk'.padStart(7)} ${'raw'.padStart(7)} ${'n'.padStart(5)}`);
	const table = Object.entries(learned.lifts).sort(([a, left], [b, right]) => right.shrunk - left.shrunk || right.delta - left.delta || a.localeCompare(b));
	for (const [key, row] of table) {
		console.log(`  ${key.padEnd(26)} ${signed(row.shrunk).padStart(7)} ${signed(row.delta).padStart(7)} ${String(row.n).padStart(5)}`);
	}

	const ranked = outcomes.posts.filter((row) => isMature(row, now)).sort((a, b) => outcomeOf(b) - outcomeOf(a));
	console.log(`\nBest ${Math.min(BEST, ranked.length)} of the window:`);
	for (const row of ranked.slice(0, BEST)) console.log(describeRow(row));
	const worst = ranked.slice(BEST).slice(-WORST);
	if (worst.length) {
		console.log(`\nWorst ${worst.length} of the window:`);
		for (const row of worst.reverse()) console.log(describeRow(row));
	}
}

function median(values) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function printCompare(outcomes, now) {
	const recent = outcomes.posts.filter((row) => now - Date.parse(row.at) <= COMPARE_DAYS * DAY);
	console.log(`Head posts of the last ${COMPARE_DAYS} days, read ${outcomes.fetchedAt || 'never'}. Medians:\n`);
	console.log(`  ${'source'.padEnd(10)} ${'posts'.padStart(6)} ${'likes'.padStart(8)} ${'impressions'.padStart(12)} ${'bookmarks'.padStart(10)}`);
	for (const source of ['pipeline', 'hand']) {
		const rows = recent.filter((row) => row.source === source);
		const cell = (field) => (rows.length ? String(median(rows.map((row) => row[field]))) : 'none');
		console.log(`  ${source.padEnd(10)} ${String(rows.length).padStart(6)} ${cell('likes').padStart(8)} ${cell('impressions').padStart(12)} ${cell('bookmarks').padStart(10)}`);
	}
	const young = recent.filter((row) => !isMature(row, now)).length;
	if (young) console.log(`\n${young} of these are under ${MIN_AGE_HOURS} hours old, so their counts are still rising.`);
	if (!recent.length) console.log('\nNothing has been measured yet. Run with --refresh to read the timeline from X.');
}

const outcomes = store();
const now = Date.now();
const record = has('refresh') ? await refresh(outcomes) : await outcomes.load();
const learned = learnLifts(record.posts, { now });

if (has('json')) console.log(JSON.stringify(learned, null, '\t'));
else if (has('compare')) printCompare(record, now);
else printLearned(record, learned, now);
