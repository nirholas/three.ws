#!/usr/bin/env node
/**
 * Pull any public X account's posts into a committed store, paying only for what we do not have yet.
 *
 * The keyless syndication endpoint (api/_lib/x-syndication.js) returns an account's most
 * popular posts, not its latest. The X API returns the timeline newest first, with video
 * variants and X Article bodies, but every post read is billed. So every read lands in
 * data/x-research/<handle>.json, and every later run starts from that file: a timeline
 * pull asks only for posts newer than the newest one stored, an id fetch skips ids already
 * stored, and ranking reads the file with no network at all.
 *
 * Usage:
 *   node scripts/x-user-timeline.mjs poteto                     # new posts since the last pull (first run: up to --max)
 *   node scripts/x-user-timeline.mjs poteto --max 3200          # cap on paid post reads for this run (default 100)
 *   node scripts/x-user-timeline.mjs poteto --backfill          # older posts than the oldest stored, as far as the API allows
 *   node scripts/x-user-timeline.mjs poteto --ids 1,2,3         # specific posts, skipping ids already stored
 *   node scripts/x-user-timeline.mjs poteto --articles          # full X Article text for stored posts that link one
 *   node scripts/x-user-timeline.mjs poteto --refresh-metrics   # re-measure every stored post (paid, appends to metricsHistory)
 *   node scripts/x-user-timeline.mjs poteto --import file.json  # merge an earlier pull ({posts: [...]}) for free
 *   node scripts/x-user-timeline.mjs poteto --top 25            # rank stored posts by engagement, free and offline
 *   add --replies to include the account's replies in timeline pulls
 *
 * Prices (docs.x.com pricing, 2026-11-26): $0.005 per post read, $0.010 per user lookup.
 * The user id is stored after the first lookup, so later runs skip that charge. Every
 * paid run is appended to the store's `pulls` ledger with its read count.
 *
 * Credential: X_API_BEARER, or else an app-only bearer minted from X_API_KEY plus
 * X_API_SECRET. Each is looked up in the environment, then .env.local / .env, then the
 * production Cloud Run service via scripts/read-service-env.mjs (needs a live gcloud
 * login; set GCP_PROJECT and CLOUDSDK_CORE_ACCOUNT to pick the project and account),
 * e.g. GCP_PROJECT=three-ws node scripts/x-user-timeline.mjs poteto
 */

import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const STORE_DIR = path.join(REPO_ROOT, 'data', 'x-research');
const API = 'https://api.x.com/2';
const PRICE_POST = 0.005;
const PRICE_USER = 0.01;

const TWEET_FIELDS = 'created_at,public_metrics,attachments,entities,referenced_tweets,note_tweet';
const MEDIA_FIELDS = 'type,url,preview_image_url,variants,duration_ms,public_metrics';

function parseArgs(argv) {
	const opts = { handle: null, max: 100, replies: false, since: null, mode: 'timeline', ids: [], importFile: null, top: 25 };
	const setMode = (m) => {
		if (opts.mode !== 'timeline') throw new Error(`Pick one of --backfill, --ids, --articles, --refresh-metrics, --import, --top (got ${opts.mode} and ${m}).`);
		opts.mode = m;
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--max') opts.max = Number(argv[++i]);
		else if (a === '--replies') opts.replies = true;
		else if (a === '--since') opts.since = argv[++i];
		else if (a === '--backfill') setMode('backfill');
		else if (a === '--articles') setMode('articles');
		else if (a === '--refresh-metrics') setMode('refresh');
		else if (a === '--ids') {
			setMode('ids');
			opts.ids = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
		} else if (a === '--import') {
			setMode('import');
			opts.importFile = argv[++i];
		} else if (a === '--top') {
			setMode('top');
			if (argv[i + 1] && /^\d+$/.test(argv[i + 1])) opts.top = Number(argv[++i]);
		} else if (!a.startsWith('--')) opts.handle = a.replace(/^@/, '').toLowerCase();
		else throw new Error(`Unknown flag ${a}.`);
	}
	if (!opts.handle || !/^[a-z0-9_]{1,15}$/.test(opts.handle)) {
		throw new Error('Usage: node scripts/x-user-timeline.mjs <handle> [--max N] [--backfill | --ids a,b | --articles | --refresh-metrics | --import file | --top N]');
	}
	if (!Number.isInteger(opts.max) || opts.max < 5 || opts.max > 3200) {
		throw new Error('--max must be an integer from 5 to 3200 (the X API floor and the timeline ceiling).');
	}
	if (opts.since && Number.isNaN(Date.parse(opts.since))) throw new Error(`--since "${opts.since}" is not a date.`);
	if (opts.mode === 'ids' && (!opts.ids.length || opts.ids.some((id) => !/^\d+$/.test(id)))) throw new Error('--ids takes a comma-separated list of numeric post ids.');
	if (opts.mode === 'import' && !opts.importFile) throw new Error('--import takes a path to an earlier pull.');
	return opts;
}

// ---------- store ----------

function storePath(handle) {
	return path.join(STORE_DIR, `${handle}.json`);
}

async function loadStore(handle) {
	try {
		return JSON.parse(await readFile(storePath(handle), 'utf8'));
	} catch (err) {
		if (err.code !== 'ENOENT') throw err;
		return { handle, user: null, userFetchedAt: null, updatedAt: null, pulls: [], posts: [] };
	}
}

async function saveStore(store) {
	store.posts.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
	store.updatedAt = new Date().toISOString();
	await mkdir(STORE_DIR, { recursive: true });
	await writeFile(storePath(store.handle), JSON.stringify(store, null, '\t') + '\n');
}

function metricsSnapshot(metrics, at) {
	return { at, ...metrics };
}

// Merge one shaped post into the store. Text, media and links take the newest non-empty
// value; metrics keep a history so engagement stays a time series.
function mergePost(store, incoming, source) {
	const at = incoming.metricsAt || new Date().toISOString();
	const existing = store.posts.find((p) => p.id === incoming.id);
	if (!existing) {
		store.posts.push({
			...incoming,
			metricsAt: incoming.metrics ? at : null,
			metricsHistory: incoming.metrics ? [metricsSnapshot(incoming.metrics, at)] : [],
			sources: [source],
		});
		return 'added';
	}
	for (const key of ['url', 'createdAt', 'text', 'kind', 'articleTitle']) if (incoming[key]) existing[key] = incoming[key];
	if (incoming.media?.length) existing.media = incoming.media;
	if (incoming.links?.length) existing.links = incoming.links;
	if (incoming.article?.text) existing.article = incoming.article;
	if (incoming.metrics) {
		const last = existing.metricsHistory?.at(-1);
		const changed = !last || Object.keys(incoming.metrics).some((k) => last[k] !== incoming.metrics[k]);
		existing.metricsHistory = existing.metricsHistory || [];
		if (changed) existing.metricsHistory.push(metricsSnapshot(incoming.metrics, at));
		if (!existing.metricsAt || at >= existing.metricsAt) {
			existing.metrics = incoming.metrics;
			existing.metricsAt = at;
		}
	}
	if (!existing.sources.includes(source)) existing.sources.push(source);
	return 'updated';
}

function engagement(p) {
	const m = p.metrics || {};
	return (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0) + (m.bookmark_count || 0);
}

// ---------- credentials ----------

function loadDotEnv() {
	for (const file of ['.env.local', '.env']) {
		let raw;
		try {
			raw = readFileSync(path.resolve(REPO_ROOT, file), 'utf8');
		} catch {
			continue;
		}
		for (const line of raw.split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
		}
	}
}

function readServiceVar(name) {
	try {
		return execFileSync('node', [path.join(HERE, 'read-service-env.mjs'), `^${name}$`, '--raw'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	} catch (err) {
		return { error: (err.stderr || err.message || '').trim().split('\n').filter(Boolean).pop() };
	}
}

function envOrService(name) {
	if (process.env[name]) return process.env[name];
	const v = readServiceVar(name);
	return typeof v === 'string' && v ? v : null;
}

// App-only bearer from the consumer key and secret (POST /oauth2/token, client_credentials).
async function mintAppBearer(key, secret) {
	const res = await fetch('https://api.x.com/oauth2/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${encodeURIComponent(key)}:${encodeURIComponent(secret)}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
		},
		body: 'grant_type=client_credentials',
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.token_type !== 'bearer') throw new Error(`X oauth2/token ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
	return body.access_token;
}

async function resolveBearer() {
	loadDotEnv();
	const bearer = envOrService('X_API_BEARER');
	if (bearer) return bearer;
	const key = envOrService('X_API_KEY');
	const secret = key && envOrService('X_API_SECRET');
	if (key && secret) return mintAppBearer(key, secret);
	const probe = readServiceVar('X_API_KEY');
	throw new Error(
		'No X credential found: X_API_BEARER, or X_API_KEY plus X_API_SECRET, in the environment, .env, or the Cloud Run service.' +
			(probe?.error ? `\n  Cloud Run read: ${probe.error}\n  Set GCP_PROJECT and CLOUDSDK_CORE_ACCOUNT to the project and account that own three-ws-api.` : ''),
	);
}

// ---------- X API ----------

async function xGet(pathname, params, bearer) {
	const url = new URL(API + pathname);
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
	const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
	const body = await res.text();
	if (!res.ok) {
		const reset = res.headers.get('x-rate-limit-reset');
		const hint = res.status === 429 && reset ? ` (rate limited until ${new Date(Number(reset) * 1000).toISOString()})` : '';
		throw new Error(`X API ${res.status} on ${pathname}${hint}: ${body.slice(0, 400)}`);
	}
	return JSON.parse(body);
}

function bestVideoUrl(media) {
	const mp4 = (media.variants || []).filter((v) => v.content_type === 'video/mp4');
	mp4.sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
	return mp4[0]?.url || null;
}

function shapePost(post, mediaByKey, handle, at) {
	const media = (post.attachments?.media_keys || [])
		.map((key) => mediaByKey.get(key))
		.filter(Boolean)
		.map((m) => ({
			type: m.type,
			url: m.type === 'photo' ? m.url : bestVideoUrl(m),
			preview: m.preview_image_url || null,
			durationSec: m.duration_ms ? Math.round(m.duration_ms / 100) / 10 : null,
			views: m.public_metrics?.view_count ?? null,
		}));
	const links = (post.entities?.urls || [])
		.map((u) => u.unwound_url || u.expanded_url)
		.filter((u) => u && !/^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+\/(photo|video)\//.test(u));
	const shaped = {
		id: post.id,
		url: `https://x.com/${handle}/status/${post.id}`,
		createdAt: post.created_at,
		text: post.note_tweet?.text || post.text,
		kind: (post.referenced_tweets || []).map((r) => r.type).join(',') || 'original',
		metrics: post.public_metrics,
		metricsAt: at,
		media,
		links,
	};
	if (post.article?.title) {
		shaped.articleTitle = post.article.title;
		if (post.article.plain_text) shaped.article = { title: post.article.title, text: post.article.plain_text, fetchedAt: at };
	}
	return shaped;
}

async function ensureUser(store, bearer, ledger) {
	if (store.user?.id) return store.user.id;
	const user = await xGet(`/users/by/username/${store.handle}`, { 'user.fields': 'description,public_metrics,created_at' }, bearer);
	if (!user.data) throw new Error(`@${store.handle} not found: ${JSON.stringify(user.errors || user).slice(0, 300)}`);
	ledger.userReads += 1;
	store.user = user.data;
	store.userFetchedAt = new Date().toISOString();
	return user.data.id;
}

async function pullTimeline(store, opts, bearer, ledger, { backfill }) {
	const userId = await ensureUser(store, bearer, ledger);
	const ids = store.posts.map((p) => BigInt(p.id));
	const newest = ids.length ? ids.reduce((a, b) => (b > a ? b : a)).toString() : null;
	const oldest = ids.length ? ids.reduce((a, b) => (b < a ? b : a)).toString() : null;
	const at = new Date().toISOString();
	const mediaByKey = new Map();
	const raw = [];
	let token;
	do {
		const page = await xGet(
			`/users/${userId}/tweets`,
			{
				max_results: Math.max(5, Math.min(100, opts.max - raw.length)),
				pagination_token: token,
				exclude: opts.replies ? 'retweets' : 'retweets,replies',
				since_id: backfill ? undefined : newest || undefined,
				until_id: backfill ? oldest || undefined : undefined,
				start_time: opts.since ? new Date(opts.since).toISOString() : undefined,
				'tweet.fields': TWEET_FIELDS,
				expansions: 'attachments.media_keys',
				'media.fields': MEDIA_FIELDS,
			},
			bearer,
		);
		for (const m of page.includes?.media || []) mediaByKey.set(m.media_key, m);
		raw.push(...(page.data || []));
		token = page.meta?.next_token;
	} while (token && raw.length < opts.max);
	ledger.postReads += raw.length;
	const source = backfill ? 'x-api:timeline-backfill' : 'x-api:timeline';
	return raw.map((p) => mergePost(store, shapePost(p, mediaByKey, store.handle, at), source));
}

async function fetchByIds(store, ids, bearer, ledger, { withArticle, source }) {
	const at = new Date().toISOString();
	const results = [];
	for (let i = 0; i < ids.length; i += 100) {
		const batch = ids.slice(i, i + 100);
		const res = await xGet(
			'/tweets',
			{
				ids: batch.join(','),
				'tweet.fields': withArticle ? `${TWEET_FIELDS},article` : TWEET_FIELDS,
				expansions: 'attachments.media_keys',
				'media.fields': MEDIA_FIELDS,
			},
			bearer,
		);
		const mediaByKey = new Map((res.includes?.media || []).map((m) => [m.media_key, m]));
		ledger.postReads += (res.data || []).length;
		for (const p of res.data || []) results.push(mergePost(store, shapePost(p, mediaByKey, store.handle, at), source));
		for (const e of res.errors || []) console.error(`  ${e.resource_id || e.value}: ${e.title || e.detail}`);
	}
	return results;
}

// ---------- modes ----------

function printTop(store, n) {
	const ranked = [...store.posts].sort((a, b) => engagement(b) - engagement(a)).slice(0, n);
	console.log(`@${store.handle}: top ${ranked.length} of ${store.posts.length} stored posts by engagement (likes + reposts + replies + quotes + bookmarks).`);
	for (const p of ranked) {
		const m = p.metrics || {};
		const media = (p.media || []).map((x) => (x.type === 'video' ? `video ${x.durationSec}s` : x.type)).join(', ');
		const label = (p.articleTitle ? `[Article: ${p.articleTitle}] ` : '') + p.text.replace(/\s+/g, ' ').slice(0, 110);
		console.log(`${String(engagement(p)).padStart(7)}  ${String(m.impression_count ?? '').padStart(9)} imp  ${p.createdAt?.slice(0, 10)}  ${media ? `(${media}) ` : ''}${label}`);
		console.log(`         ${p.url}`);
	}
}

async function importFile(store, file) {
	const doc = JSON.parse(await readFile(path.resolve(file), 'utf8'));
	const posts = Array.isArray(doc) ? doc : doc.posts;
	if (!Array.isArray(posts)) throw new Error(`${file} has no posts array.`);
	const at = doc.builtAt || doc.fetchedAt || new Date().toISOString();
	if (!store.user && doc.user?.id) {
		store.user = doc.user;
		store.userFetchedAt = doc.fetchedAt || at;
	}
	let added = 0;
	for (const p of posts) {
		if (!p.id || !p.text) continue;
		const { engagement: _drop, ...clean } = p;
		if (mergePost(store, { ...clean, metricsAt: p.metricsAt || at }, `import:${path.basename(file)}`) === 'added') added++;
	}
	return { added, total: posts.length };
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const store = await loadStore(opts.handle);

	if (opts.mode === 'top') {
		if (!store.posts.length) throw new Error(`Nothing stored for @${opts.handle} yet. Run a pull first.`);
		printTop(store, opts.top);
		return;
	}
	if (opts.mode === 'import') {
		const { added, total } = await importFile(store, opts.importFile);
		await saveStore(store);
		console.log(`Imported ${total} posts from ${opts.importFile} (${added} new). Store now holds ${store.posts.length}. No paid reads.`);
		return;
	}

	const ledger = { postReads: 0, userReads: 0 };
	const bearer = await resolveBearer();
	let outcomes = [];
	let note = '';

	if (opts.mode === 'timeline' || opts.mode === 'backfill') {
		outcomes = await pullTimeline(store, opts, bearer, ledger, { backfill: opts.mode === 'backfill' });
		note = opts.mode === 'backfill' ? 'older than the oldest stored post' : 'newer than the newest stored post';
	} else if (opts.mode === 'ids') {
		const have = new Set(store.posts.map((p) => p.id));
		const wanted = [...new Set(opts.ids)].filter((id) => !have.has(id));
		console.log(`${opts.ids.length - wanted.length} of ${opts.ids.length} ids already stored, fetching ${wanted.length}.`);
		outcomes = await fetchByIds(store, wanted, bearer, ledger, { withArticle: true, source: 'x-api:ids' });
		note = 'by id';
	} else if (opts.mode === 'articles') {
		// A post that only links someone's Article (a quote or a share) carries no body of its
		// own; once read, articleCheckedAt keeps later runs from paying to read it again.
		const wanted = store.posts
			.filter((p) => !p.article?.text && !p.articleCheckedAt && (p.articleTitle || (p.links || []).some((l) => /x\.com\/(i\/)?(\w+\/)?article\//.test(l))))
			.map((p) => p.id);
		console.log(`${wanted.length} stored posts link an X Article with no body stored or checked.`);
		outcomes = await fetchByIds(store, wanted, bearer, ledger, { withArticle: true, source: 'x-api:article' });
		const checkedAt = new Date().toISOString();
		for (const p of store.posts) if (wanted.includes(p.id) && !p.article?.text) p.articleCheckedAt = checkedAt;
		note = 'article bodies';
	} else if (opts.mode === 'refresh') {
		outcomes = await fetchByIds(store, store.posts.map((p) => p.id), bearer, ledger, { withArticle: false, source: 'x-api:refresh' });
		note = 'metrics refresh';
	}

	const cost = ledger.postReads * PRICE_POST + ledger.userReads * PRICE_USER;
	store.pulls.push({ at: new Date().toISOString(), mode: opts.mode, note, postReads: ledger.postReads, userReads: ledger.userReads, estUsd: Number(cost.toFixed(3)) });
	await saveStore(store);

	const added = outcomes.filter((o) => o === 'added').length;
	console.log(`@${opts.handle} ${opts.mode}: ${outcomes.length} posts read (${added} new, ${outcomes.length - added} updated). Store holds ${store.posts.length}.`);
	console.log(`Paid reads: ${ledger.postReads} posts + ${ledger.userReads} user lookup(s), about $${cost.toFixed(3)}.`);
	console.log(`Wrote ${path.relative(REPO_ROOT, storePath(opts.handle))}`);
}

main().catch((err) => {
	console.error(`\n  ${err.message}\n`);
	process.exit(1);
});
