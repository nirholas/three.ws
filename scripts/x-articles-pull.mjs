#!/usr/bin/env node
/**
 * Pull every X Article an account has published, with what readers said back.
 *
 * A timeline scrape sees an Article as a title card. The X API v2 returns the
 * whole thing when a post is read with the `article` tweet field: title,
 * preview, cover, and the full plain text with its code blocks and links. This
 * script walks the account's timeline (the API returns the last 3,200 posts),
 * keeps the posts that carry an Article, and for each one collects the replies
 * in its conversation (full-archive search) and the posts that quote it. Those
 * two lists are the closest thing the account has to a reader survey: what
 * people asked, what they pushed back on, what they wanted next.
 *
 * Usage:
 *   npm run x:articles:pull                      # every Article on @trythreews
 *   npm run x:articles:pull -- --no-replies      # Articles and metrics only
 *   npm run x:articles:pull -- --since 2026-08-01
 *
 * Output: data/x-archive/<handle>-articles-<YYYY-MM-DD>.json. Snapshots are
 * additive, like the rest of the archive (see data/x-archive/README.md).
 *
 * Credentials: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET, the
 * posting account's OAuth 1.0a user context. Read from the environment, then
 * .env.local and .env, then the Cloud Run service through
 * scripts/read-service-env.mjs. Read-only: nothing is posted.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { xClientFromEnv } from '../api/_lib/x-content/publisher.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO_ROOT, 'data', 'x-archive');
const CREDENTIALS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const TIMELINE_CAP = 3200;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : null;
};
const SINCE = value('since');
const WITH_REPLIES = !flag('no-replies');

function loadEnvFiles() {
	for (const file of ['.env.local', '.env']) {
		let raw;
		try {
			raw = readFileSync(path.join(REPO_ROOT, file), 'utf8');
		} catch {
			continue;
		}
		for (const line of raw.split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (!m || process.env[m[1]]) continue;
			process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
		}
	}
}

function loadServiceCredentials() {
	for (const name of CREDENTIALS) {
		if (process.env[name]) continue;
		const out = execFileSync('node', ['scripts/read-service-env.mjs', `^${name}$`, '--raw'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
		if (out) process.env[name] = out;
	}
}

const TWEET_FIELDS = ['public_metrics', 'created_at', 'article', 'note_tweet', 'entities', 'referenced_tweets', 'conversation_id', 'author_id', 'in_reply_to_user_id'];
const READER_QUERY = {
	'tweet.fields': ['public_metrics', 'created_at', 'note_tweet', 'referenced_tweets', 'author_id', 'in_reply_to_user_id'],
	expansions: ['author_id'],
	'user.fields': ['username', 'name', 'public_metrics', 'verified'],
	max_results: 100,
};

async function collect(paginator) {
	const posts = [];
	for await (const post of paginator) posts.push(post);
	const users = new Map((paginator.includes?.users || []).map((u) => [u.id, u]));
	return posts.map((post) => {
		const author = users.get(post.author_id);
		return {
			id: post.id,
			url: author ? `https://x.com/${author.username}/status/${post.id}` : `https://x.com/i/status/${post.id}`,
			created_at: post.created_at,
			author: { id: post.author_id, username: author?.username ?? null, name: author?.name ?? null, followers: author?.public_metrics?.followers_count ?? null },
			text: post.note_tweet?.text || post.text,
			metrics: post.public_metrics,
		};
	});
}

// Full-archive search allows one request a second and a small budget per 15
// minutes. On a 429 wait until the reset X reports, then run the step again.
async function withRateLimit(label, step) {
	for (;;) {
		try {
			return await step();
		} catch (err) {
			if (err?.code !== 429) throw err;
			const reset = Number(err.rateLimit?.reset || 0) * 1000;
			const waitMs = Math.max(15_000, reset - Date.now() + 2_000);
			console.warn(`  rate limited on ${label}; waiting ${Math.round(waitMs / 1000)}s`);
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
	}
}

async function readerResponse(client, article, selfId) {
	const replies = await withRateLimit('replies', async () => collect(await client.searchAll(`conversation_id:${article.id} -from:${selfId}`, { ...READER_QUERY, start_time: article.created_at })));
	const quotes = await withRateLimit('quotes', async () => collect(await client.quotes(article.id, READER_QUERY)));
	return { replies, quotes: quotes.filter((q) => q.author.id !== selfId) };
}

function describe(post, handle) {
	const a = post.article;
	return {
		id: post.id,
		url: `https://x.com/${handle}/status/${post.id}`,
		created_at: post.created_at,
		title: a.title?.trim() || null,
		preview: a.preview_text || null,
		cover_media: a.cover_media || null,
		characters: (a.plain_text || '').length,
		metrics: post.public_metrics,
		body: a.plain_text || null,
		entities: a.entities || null,
	};
}

async function main() {
	loadEnvFiles();
	loadServiceCredentials();
	const client = await xClientFromEnv();
	if (!client) throw new Error(`missing X credentials: set ${CREDENTIALS.join(', ')} or authenticate gcloud so the Cloud Run copies can be read`);

	const { data: me } = await client.me();
	const timeline = await client.userTimeline(me.id, { 'tweet.fields': TWEET_FIELDS, max_results: 100, exclude: ['retweets'], ...(SINCE ? { start_time: new Date(SINCE).toISOString() } : {}) });
	const posts = [];
	for await (const post of timeline) {
		posts.push(post);
		if (posts.length >= TIMELINE_CAP) break;
	}
	const articles = posts.filter((p) => p.article).map((p) => describe(p, me.username));
	console.log(`@${me.username}: ${posts.length} posts read (oldest ${posts.at(-1)?.created_at ?? 'none'}), ${articles.length} Articles`);

	// The snapshot is rewritten after every Article, so a run cut short by a
	// long rate-limit wait still leaves everything it already collected.
	await mkdir(OUT_DIR, { recursive: true });
	const file = path.join(OUT_DIR, `${me.username}-articles-${new Date().toISOString().slice(0, 10)}.json`);
	const save = (complete) =>
		writeFile(file, `${JSON.stringify({ source: 'x-api-v2', handle: me.username, fetchedAt: new Date().toISOString(), complete, timelinePostsRead: posts.length, articles }, null, '\t')}\n`);
	await save(!WITH_REPLIES);

	if (WITH_REPLIES) {
		for (const article of articles) {
			Object.assign(article, await readerResponse(client, article, me.id));
			await save(false);
			console.log(`  ${article.created_at.slice(0, 10)}  ${String(article.replies.length).padStart(3)} replies  ${String(article.quotes.length).padStart(3)} quotes  ${article.title}`);
		}
		await save(true);
	}
	console.log(`wrote ${path.relative(REPO_ROOT, file)}`);
}

main().catch((err) => {
	console.error(`x:articles:pull: ${err?.data?.title || err?.message || err}`);
	process.exit(1);
});
