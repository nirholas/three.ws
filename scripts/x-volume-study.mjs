#!/usr/bin/env node
/**
 * What each X post did to $THREE volume: 1 minute, 5 minutes, 1 hour, 24 hours
 * and 7 days after it went out, against the same stretch of tape before it, and
 * against a placebo of random moments so a lift is read against what the chart
 * does on its own.
 *
 * Usage:
 *   node scripts/x-volume-study.mjs                 # refresh the candle cache, measure, write the report
 *   node scripts/x-volume-study.mjs --no-fetch      # measure from the cache only
 *   node scripts/x-volume-study.mjs --handle trythreews
 *   node scripts/x-volume-study.mjs --stdout        # print the report instead of writing files
 *
 * Posts come from every snapshot in data/x-archive/ (own posts only), plus the
 * content pipeline's publish ledger when DATABASE_URL is set, which covers the
 * days after the newest snapshot with exact publish times.
 *
 * Candles are GeckoTerminal 1-minute OHLCV for the $THREE pool, cached in
 * data/x-archive/cache/ (gitignored, regenerable). The endpoint only returns
 * minutes that traded, so a missing minute is a real zero, not a gap.
 *
 * Writes docs/x-archive/<handle>-volume.md and
 * data/x-archive/analysis/<handle>-volume.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ARCHIVE_DIR, listArchiveFiles, median, mergeScrapes, percentile, readScrapeFile, topicsOf, lengthBucketOf } from './x-archive-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const POOL = '5ByL7MZoLABYnwMPZKPKjf4MGkZ7FeBzrAnos19Pre2z';
const GT = 'https://api.geckoterminal.com/api/v2';
const CACHE_FILE = path.resolve(ROOT, ARCHIVE_DIR, 'cache', 'three-minute-volume.json');
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
// GeckoTerminal's keyless tier allows about 30 requests a minute.
const REQUEST_GAP_MS = 2400;
const PLACEBO_SAMPLES = 4000;

for (const envFile of ['.env.local', '.env']) {
	const file = path.resolve(ROOT, envFile);
	if (!existsSync(file)) continue;
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
	}
}

const args = process.argv.slice(2);
const has = (flag) => args.includes(`--${flag}`);
const option = (name, fallback = null) => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const HANDLE = option('handle', 'trythreews');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Candles ─────────────────────────────────────────────────────────────────

function loadCache() {
	if (!existsSync(CACHE_FILE)) return { pool: POOL, rows: [] };
	const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
	return cache.pool === POOL ? cache : { pool: POOL, rows: [] };
}

async function fetchPage(beforeTs) {
	const url = `${GT}/networks/solana/pools/${POOL}/ohlcv/minute?aggregate=1&before_timestamp=${beforeTs}&limit=1000&currency=usd`;
	for (let attempt = 0; attempt < 8; attempt++) {
		const response = await fetch(url, { headers: { accept: 'application/json' } });
		if (response.status === 429 || response.status >= 500) {
			await sleep(Math.min(60_000, 5000 * 2 ** attempt));
			continue;
		}
		if (!response.ok) throw new Error(`GeckoTerminal answered ${response.status} for before_timestamp=${beforeTs}`);
		const body = await response.json();
		return (body.data?.attributes?.ohlcv_list || []).map((row) => [row[0], row[5]]);
	}
	throw new Error('GeckoTerminal kept rate-limiting; rerun and the cache resumes where it stopped');
}

// Walks backward from now until it reaches what the cache already holds (or the
// start of the range), so a rerun costs a handful of calls, not the whole tape.
async function refreshCandles(sinceTs) {
	const cache = loadCache();
	const known = new Map(cache.rows);
	const newestKnown = cache.rows.length ? cache.rows[cache.rows.length - 1][0] : 0;
	const oldestKnown = cache.rows.length ? cache.rows[0][0] : Infinity;
	let before = Math.floor(Date.now() / 1000);
	let calls = 0;
	const save = () => {
		mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
		const rows = [...known.entries()].sort((a, b) => a[0] - b[0]);
		writeFileSync(CACHE_FILE, JSON.stringify({ pool: POOL, fetchedAt: new Date().toISOString(), rows }));
		return rows;
	};
	while (before > sinceTs) {
		// Inside the span the cache already covers: jump to its far edge.
		if (before <= newestKnown && before > oldestKnown) {
			before = oldestKnown;
			continue;
		}
		const page = await fetchPage(before);
		calls++;
		if (!page.length) break;
		for (const [ts, volume] of page) known.set(ts, volume);
		const oldest = page[page.length - 1][0];
		if (oldest >= before) break;
		before = oldest;
		if (calls % 10 === 0) {
			save();
			process.stderr.write(`  candles back to ${new Date(before * 1000).toISOString().slice(0, 16)} (${known.size} minutes, ${calls} calls)\n`);
		}
		await sleep(REQUEST_GAP_MS);
	}
	return save();
}

// Volume over [from, to) in unix seconds, from a sorted [ts, volume] tape.
function makeTape(rows) {
	const ts = rows.map((row) => row[0]);
	const cumulative = new Float64Array(rows.length + 1);
	rows.forEach((row, i) => (cumulative[i + 1] = cumulative[i] + row[1]));
	const lowerBound = (value) => {
		let lo = 0;
		let hi = ts.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (ts[mid] < value) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	};
	return {
		start: ts[0],
		end: ts[ts.length - 1],
		volume: (from, to) => cumulative[lowerBound(to)] - cumulative[lowerBound(from)],
	};
}

// ── Measurement ─────────────────────────────────────────────────────────────
// Windows start at the first full minute after the post, so a trade that landed
// seconds before it is never credited to it. Each is compared with the same
// length of tape immediately before the post's minute; the 1 and 5 minute
// windows use the prior hour's per-minute rate, because one prior minute on a
// thin pool is mostly noise.
const WINDOWS = [
	{ key: 'm1', label: '1 min', seconds: MINUTE, baselineSeconds: HOUR },
	{ key: 'm5', label: '5 min', seconds: 5 * MINUTE, baselineSeconds: HOUR },
	{ key: 'h1', label: '1 hour', seconds: HOUR, baselineSeconds: HOUR },
	{ key: 'd1', label: '24 hours', seconds: DAY, baselineSeconds: DAY },
	{ key: 'd7', label: '7 days', seconds: 7 * DAY, baselineSeconds: 7 * DAY },
];

function measure(tape, tsSeconds) {
	const minuteStart = Math.floor(tsSeconds / MINUTE) * MINUTE;
	const after = minuteStart + MINUTE;
	const out = {};
	for (const w of WINDOWS) {
		if (after + w.seconds > tape.end + MINUTE || minuteStart - w.baselineSeconds < tape.start) {
			out[w.key] = null;
			continue;
		}
		const volume = tape.volume(after, after + w.seconds);
		const expected = (tape.volume(minuteStart - w.baselineSeconds, minuteStart) * w.seconds) / w.baselineSeconds;
		out[w.key] = {
			volume: Math.round(volume * 100) / 100,
			expected: Math.round(expected * 100) / 100,
			excess: Math.round((volume - expected) * 100) / 100,
			lift: expected > 0 ? Math.round((volume / expected) * 100) / 100 : null,
		};
	}
	return out;
}

// A response: the window at least doubled its baseline AND moved real dollars.
// The dollar floor keeps "$0.40 became $1.10" from counting as a 2.7x win.
const RESPONSE_FLOOR_USD = { m1: 25, m5: 75, h1: 250, d1: 2500, d7: 10000 };
const responded = (m, key) => Boolean(m?.[key] && m[key].lift !== null && m[key].lift >= 2 && m[key].volume >= RESPONSE_FLOOR_USD[key]);

// ── Posts ───────────────────────────────────────────────────────────────────

async function archivePosts() {
	const files = await listArchiveFiles(path.resolve(ROOT, ARCHIVE_DIR));
	const scrapes = [];
	for (const file of files) scrapes.push(await readScrapeFile(file));
	return mergeScrapes(scrapes).posts
		.filter((post) => post.isOwn && !post.isRetweet && post.handle === HANDLE && post.postedAt)
		.map((post) => ({ ...post, source: 'archive' }));
}

async function ledgerPosts(knownIds) {
	if (!process.env.DATABASE_URL) return [];
	const { sql } = await import('../api/_lib/db.js');
	const [row] = await sql`SELECT value FROM app_settings WHERE key = 'x_content'`;
	return (row?.value?.published || [])
		.filter((entry) => entry.postIds?.[0] && !knownIds.has(entry.postIds[0]))
		.map((entry) => ({
			tweetId: entry.postIds[0],
			handle: HANDLE,
			url: entry.url,
			text: entry.text || '',
			postedAt: entry.publishedAt,
			isReply: false,
			hasImage: entry.kind !== 'article',
			hasVideo: false,
			mentions: (entry.text || '').match(/@\w{1,15}/g) || [],
			likes: null,
			retweets: null,
			replies: null,
			views: null,
			source: 'ledger',
			queueId: entry.id,
		}));
}

const TIER1 = /@(ibm|openai|awscloud|aws_partners|nvidia|nvidiaai|googlecloud|anthropicai|claude|chatgpt|microsoft|github|solana|coinbase|okx|phantom|jupiterexchange|pumpdotfun)\b/i;

function featuresOf(post) {
	const text = post.text || '';
	const hourUtc = new Date(post.postedAt).getUTCHours();
	const day = new Date(post.postedAt).getUTCDay();
	return {
		reply: Boolean(post.isReply),
		image: Boolean(post.hasImage),
		video: Boolean(post.hasVideo),
		namesThree: /\$three\b/i.test(text),
		contractAddress: /FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump/i.test(text),
		tier1Mention: TIER1.test(text),
		anyMention: (post.mentions || []).length > 0,
		link: /https?:\/\/|\b[a-z0-9-]+\.(?:ws|com|io|ai|so|fun|xyz)\b/i.test(text),
		usHours: hourUtc >= 12 && hourUtc < 20,
		weekend: day === 0 || day === 6,
		length: lengthBucketOf(post),
		topics: topicsOf(post),
	};
}

// ── Aggregates ──────────────────────────────────────────────────────────────

function summarize(rows, key) {
	const measured = rows.filter((row) => row.windows[key]);
	const lifts = measured.map((row) => row.windows[key].lift).filter((v) => v !== null);
	const excess = measured.map((row) => row.windows[key].excess);
	return {
		n: measured.length,
		responseRate: measured.length ? measured.filter((row) => responded(row.windows, key)).length / measured.length : null,
		medianLift: lifts.length ? median(lifts) : null,
		medianExcess: excess.length ? median(excess) : null,
		p90Excess: excess.length ? percentile(excess, 90) : null,
		totalExcess: excess.reduce((sum, v) => sum + v, 0),
	};
}

function placebo(tape, from, to) {
	// Deterministic so the report does not change between runs on the same tape.
	let seed = 0x9e3779b9;
	const random = () => {
		seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
		return seed / 0x100000000;
	};
	const rows = [];
	for (let i = 0; i < PLACEBO_SAMPLES; i++) rows.push({ windows: measure(tape, from + random() * (to - from)) });
	return rows;
}

function featureTable(rows, base) {
	const flags = ['reply', 'image', 'video', 'namesThree', 'contractAddress', 'tier1Mention', 'anyMention', 'link', 'usHours', 'weekend'];
	const table = [];
	for (const flag of flags) {
		for (const value of [true, false]) {
			const subset = rows.filter((row) => row.features[flag] === value);
			if (subset.length < 8) continue;
			const s = summarize(subset, 'h1');
			table.push({ feature: `${flag}=${value}`, n: s.n, responseRate: s.responseRate, vsBase: base ? s.responseRate / base : null, medianExcess: s.medianExcess, totalExcess: s.totalExcess });
		}
	}
	for (const bucket of new Set(rows.map((row) => row.features.length))) {
		const subset = rows.filter((row) => row.features.length === bucket);
		if (subset.length < 8) continue;
		const s = summarize(subset, 'h1');
		table.push({ feature: `length=${bucket}`, n: s.n, responseRate: s.responseRate, vsBase: base ? s.responseRate / base : null, medianExcess: s.medianExcess, totalExcess: s.totalExcess });
	}
	for (const topic of new Set(rows.flatMap((row) => row.features.topics))) {
		const subset = rows.filter((row) => row.features.topics.includes(topic));
		if (subset.length < 8) continue;
		const s = summarize(subset, 'h1');
		table.push({ feature: `topic=${topic}`, n: s.n, responseRate: s.responseRate, vsBase: base ? s.responseRate / base : null, medianExcess: s.medianExcess, totalExcess: s.totalExcess });
	}
	return table.sort((a, b) => (b.responseRate ?? 0) - (a.responseRate ?? 0));
}

// ── Report ──────────────────────────────────────────────────────────────────

const usd = (v) => (v === null || v === undefined ? 'n/a' : `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`);
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const times = (v) => (v === null || v === undefined ? 'n/a' : `${v.toFixed(2)}x`);
const oneLine = (text, n = 90) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, n);

function report({ rows, originals, placeboRows, tape, features, generatedAt }) {
	const lines = [];
	lines.push(`# @${HANDLE}: what each post did to $THREE volume`, '');
	lines.push(`Generated ${generatedAt}. ${rows.length} own posts measured (${originals.length} originals, ${rows.length - originals.length} replies) against 1-minute candles of the $THREE pool from ${new Date(tape.start * 1000).toISOString().slice(0, 10)} to ${new Date(tape.end * 1000).toISOString().slice(0, 10)}. Regenerate with \`npm run x:volume\`.`, '');
	lines.push('## How to read this', '');
	lines.push('Each window starts at the first full minute after the post and is compared with the tape just before it. **Excess** is dollars traded above what that baseline predicted; **lift** is the ratio. A **response** means the window at least doubled its baseline and cleared a dollar floor, so a quiet pool twitching does not count. The **placebo** row is the same measurement at 4,000 random moments: it is what the chart does with no post at all, and a post number only means something against it.', '');
	lines.push('The 24 hour and 7 day windows almost always contain other posts and market moves. Treat them as context, not attribution. The 1 minute to 1 hour windows are where a single post can be read.', '');

	lines.push('## Posts against the placebo', '');
	lines.push('| Window | Posts: response rate | Placebo: response rate | Posts vs placebo | Posts: median excess | Placebo: median excess |', '|---|---|---|---|---|---|');
	for (const w of WINDOWS) {
		const p = summarize(originals, w.key);
		const c = summarize(placeboRows, w.key);
		lines.push(`| ${w.label} | ${pct(p.responseRate)} (n=${p.n}) | ${pct(c.responseRate)} | ${c.responseRate ? times(p.responseRate / c.responseRate) : 'n/a'} | ${usd(p.medianExcess)} | ${usd(c.medianExcess)} |`);
	}
	lines.push('');

	const ranked = (key) => originals.filter((row) => row.windows[key]).sort((a, b) => b.windows[key].excess - a.windows[key].excess);
	for (const [key, title] of [['h1', 'Top 20 posts by excess volume in the first hour'], ['m5', 'Top 10 posts by excess volume in the first 5 minutes']]) {
		lines.push(`## ${title}`, '');
		lines.push('| Posted (UTC) | 1 min | 5 min | 1 hour | 1h lift | 24 hours | Post |', '|---|---|---|---|---|---|---|');
		for (const row of ranked(key).slice(0, key === 'h1' ? 20 : 10)) {
			const w = row.windows;
			lines.push(`| ${row.postedAt.slice(0, 16).replace('T', ' ')} | ${usd(w.m1?.excess)} | ${usd(w.m5?.excess)} | ${usd(w.h1?.excess)} | ${times(w.h1?.lift)} | ${usd(w.d1?.excess)} | [${oneLine(row.text, 80).replace(/\|/g, '/')}](${row.url}) |`);
		}
		lines.push('');
	}

	lines.push('## Bottom 10 by first-hour excess', '', 'Posts that went out into a falling tape. Usually the market, not the post, but a pattern here is worth knowing.', '');
	lines.push('| Posted (UTC) | 1 hour | 1h lift | Post |', '|---|---|---|---|');
	for (const row of ranked('h1').slice(-10).reverse()) lines.push(`| ${row.postedAt.slice(0, 16).replace('T', ' ')} | ${usd(row.windows.h1.excess)} | ${times(row.windows.h1.lift)} | [${oneLine(row.text, 80).replace(/\|/g, '/')}](${row.url}) |`);
	lines.push('');

	lines.push('## What the responders have in common', '', 'First-hour response rate by post feature, originals only, features with at least 8 posts. "vs all" compares with every original post.', '');
	lines.push('| Feature | Posts | Response rate | vs all | Median 1h excess | Total 1h excess |', '|---|---|---|---|---|---|');
	for (const f of features) lines.push(`| ${f.feature} | ${f.n} | ${pct(f.responseRate)} | ${times(f.vsBase)} | ${usd(f.medianExcess)} | ${usd(f.totalExcess)} |`);
	lines.push('');

	const pipeline = rows.filter((row) => row.source === 'ledger');
	if (pipeline.length) {
		lines.push('## The content pipeline\'s posts', '', 'Everything the queue has published, newest last. Windows that have not closed yet read n/a.', '');
		lines.push('| Posted (UTC) | Queue id | 1 min | 5 min | 1 hour | 1h lift | 24 hours |', '|---|---|---|---|---|---|---|');
		for (const row of pipeline) {
			const w = row.windows;
			lines.push(`| ${row.postedAt.slice(0, 16).replace('T', ' ')} | [${row.queueId}](${row.url}) | ${usd(w.m1?.excess)} | ${usd(w.m5?.excess)} | ${usd(w.h1?.excess)} | ${times(w.h1?.lift)} | ${usd(w.d1?.excess)} |`);
		}
		lines.push('');
	}
	return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

const archive = await archivePosts();
const ledger = await ledgerPosts(new Set(archive.map((post) => post.tweetId)));
const posts = [...archive, ...ledger].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
if (!posts.length) throw new Error(`no own posts found for @${HANDLE} in ${ARCHIVE_DIR}`);

const firstPost = Math.floor(Date.parse(posts[0].postedAt) / 1000);
process.stderr.write(`${posts.length} posts (${archive.length} archive, ${ledger.length} ledger), ${posts[0].postedAt.slice(0, 10)} to ${posts[posts.length - 1].postedAt.slice(0, 10)}\n`);

const candleRows = has('no-fetch') ? loadCache().rows : await refreshCandles(firstPost - 8 * DAY);
if (!candleRows.length) throw new Error('no candles cached; run without --no-fetch');
const tape = makeTape(candleRows);

const rows = posts.map((post) => ({
	tweetId: post.tweetId,
	url: post.url,
	text: post.text,
	postedAt: new Date(post.postedAt).toISOString(),
	source: post.source,
	queueId: post.queueId || null,
	engagement: { likes: post.likes, retweets: post.retweets, replies: post.replies, views: post.views },
	features: featuresOf(post),
	windows: measure(tape, Date.parse(post.postedAt) / 1000),
}));
const originals = rows.filter((row) => !row.features.reply);
const placeboRows = placebo(tape, firstPost, tape.end - HOUR);
const base = summarize(originals, 'h1').responseRate;
const features = featureTable(originals, base);
const generatedAt = new Date().toISOString();
const markdown = report({ rows, originals, placeboRows, tape, features, generatedAt });

if (has('stdout')) {
	process.stdout.write(`${markdown}\n`);
} else {
	const docFile = path.resolve(ROOT, 'docs', 'x-archive', `${HANDLE}-volume.md`);
	const dataFile = path.resolve(ROOT, ARCHIVE_DIR, 'analysis', `${HANDLE}-volume.json`);
	mkdirSync(path.dirname(docFile), { recursive: true });
	mkdirSync(path.dirname(dataFile), { recursive: true });
	writeFileSync(docFile, `${markdown}\n`);
	writeFileSync(dataFile, `${JSON.stringify({ generatedAt, handle: HANDLE, pool: POOL, tape: { start: tape.start, end: tape.end, minutes: candleRows.length }, windows: WINDOWS.map(({ key, label, seconds }) => ({ key, label, seconds })), responseFloorUsd: RESPONSE_FLOOR_USD, placebo: Object.fromEntries(WINDOWS.map((w) => [w.key, summarize(placeboRows, w.key)])), posts: Object.fromEntries(WINDOWS.map((w) => [w.key, summarize(originals, w.key)])), features, rows }, null, '\t')}\n`);
	process.stderr.write(`wrote ${path.relative(ROOT, docFile)} and ${path.relative(ROOT, dataFile)}\n`);
}
process.exit(0);
