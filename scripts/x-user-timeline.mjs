#!/usr/bin/env node
/**
 * Pull any public account's most recent original posts, with their media, from the X API v2.
 *
 * The keyless syndication endpoint (api/_lib/x-syndication.js) returns an account's most
 * popular posts, not its latest, so it cannot answer "what has this person shipped this
 * month". GET /2/users/:id/tweets returns the timeline newest first, with video variants,
 * which is what we need to study how other builders present demos.
 *
 * Usage:
 *   node scripts/x-user-timeline.mjs poteto                 # latest 100 original posts
 *   node scripts/x-user-timeline.mjs poteto --max 50        # cap the paid reads
 *   node scripts/x-user-timeline.mjs poteto --replies       # include replies
 *   node scripts/x-user-timeline.mjs poteto --since 2026-10-01
 *
 * Every post returned is a paid read on our X API account, so --max is a hard cap
 * (default 100). Output: data/x-research/<handle>-<YYYY-MM-DD>.json, newest first, with
 * a media list per post (video URLs at the highest bitrate) and public metrics.
 *
 * Credential: X_API_BEARER, or else an app-only bearer minted from X_API_KEY plus
 * X_API_SECRET. Each is looked up in the environment, then .env.local / .env, then the
 * production Cloud Run service via scripts/read-service-env.mjs (needs a live gcloud
 * login; set GCP_PROJECT and CLOUDSDK_CORE_ACCOUNT to pick the project and account),
 * e.g. GCP_PROJECT=three-ws node scripts/x-user-timeline.mjs poteto
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const API = 'https://api.x.com/2';

function parseArgs(argv) {
	const opts = { handle: null, max: 100, replies: false, since: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--max') opts.max = Number(argv[++i]);
		else if (a === '--replies') opts.replies = true;
		else if (a === '--since') opts.since = argv[++i];
		else if (!a.startsWith('--')) opts.handle = a.replace(/^@/, '');
	}
	if (!opts.handle || !/^[A-Za-z0-9_]{1,15}$/.test(opts.handle)) {
		throw new Error('Usage: node scripts/x-user-timeline.mjs <handle> [--max N] [--replies] [--since YYYY-MM-DD]');
	}
	if (!Number.isInteger(opts.max) || opts.max < 5 || opts.max > 3200) {
		throw new Error('--max must be an integer from 5 to 3200 (the X API floor and the timeline ceiling).');
	}
	if (opts.since && Number.isNaN(Date.parse(opts.since))) throw new Error(`--since "${opts.since}" is not a date.`);
	return opts;
}

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

function shapePost(post, mediaByKey, handle) {
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
	return {
		id: post.id,
		url: `https://x.com/${handle}/status/${post.id}`,
		createdAt: post.created_at,
		text: post.note_tweet?.text || post.text,
		kind: (post.referenced_tweets || []).map((r) => r.type).join(',') || 'original',
		metrics: post.public_metrics,
		media,
		links,
	};
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const bearer = await resolveBearer();

	const user = await xGet(`/users/by/username/${opts.handle}`, { 'user.fields': 'description,public_metrics,created_at' }, bearer);
	if (!user.data) throw new Error(`@${opts.handle} not found: ${JSON.stringify(user.errors || user).slice(0, 300)}`);
	const { id: userId } = user.data;

	const posts = [];
	const mediaByKey = new Map();
	let token;
	do {
		const page = await xGet(
			`/users/${userId}/tweets`,
			{
				max_results: Math.max(5, Math.min(100, opts.max - posts.length)),
				pagination_token: token,
				exclude: opts.replies ? 'retweets' : 'retweets,replies',
				start_time: opts.since ? new Date(opts.since).toISOString() : undefined,
				'tweet.fields': 'created_at,public_metrics,attachments,entities,referenced_tweets,note_tweet',
				expansions: 'attachments.media_keys',
				'media.fields': 'type,url,preview_image_url,variants,duration_ms,public_metrics',
			},
			bearer,
		);
		for (const m of page.includes?.media || []) mediaByKey.set(m.media_key, m);
		posts.push(...(page.data || []));
		token = page.meta?.next_token;
	} while (token && posts.length < opts.max);

	const shaped = posts.slice(0, opts.max).map((p) => shapePost(p, mediaByKey, opts.handle));
	const day = new Date().toISOString().slice(0, 10);
	const outDir = path.join(REPO_ROOT, 'data', 'x-research');
	const outFile = path.join(outDir, `${opts.handle}-${day}.json`);
	await mkdir(outDir, { recursive: true });
	await writeFile(
		outFile,
		JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'GET /2/users/:id/tweets', user: user.data, posts: shaped }, null, '\t') + '\n',
	);

	const withVideo = shaped.filter((p) => p.media.some((m) => m.type === 'video' || m.type === 'animated_gif'));
	console.log(`@${opts.handle}: ${shaped.length} posts (${shaped.at(-1)?.createdAt?.slice(0, 10)} to ${shaped[0]?.createdAt?.slice(0, 10)}), ${withVideo.length} with video.`);
	console.log(`Paid reads this run: ${shaped.length} posts + 1 user lookup.`);
	console.log(`Wrote ${path.relative(REPO_ROOT, outFile)}`);
}

main().catch((err) => {
	console.error(`\n  ${err.message}\n`);
	process.exit(1);
});
