#!/usr/bin/env node
// Real dry-run generations for the X mention bot's `image3d` intent.
//
// Looks up real public posts that carry a product photo (one read-only
// GET /2/tweets?ids=, ids from --posts or the defaults below), so every
// picture is a real pbs.twimg.com photo from a real post and its poster is the
// mention author: the "own image" rule holds honestly. The mention text is
// replaced by "3D this" so the evidence exercises this intent whatever the
// person originally wrote. Each run builds a mention in one of the
// shapes the parser accepts (photo attached to the mention; reply to the post
// that holds the photo), records it as a dry run, then runs the real handler
// (x-mention-image3d.js): CDN fetch, vision review, image storage, the
// image-to-3D lane on --base, the bounded wait, and the reply it WOULD post.
// One extra run replays the same photo as another person's (skip evidence).
// Nothing is posted to X. Evidence, with the HTTP status of every media URL,
// goes to prompts/x-grok/_generated/image3d-dry-run.json.
//
// Rows land under account_ref `trythreews-evidence`, never the real account's.
//
// USAGE (needs DATABASE_URL, e.g. from .env.local; X credentials come from
// process.env or the three-ws-api Cloud Run service)
//   node --env-file=.env.local scripts/x-mention-image3d-dry-run.mjs
//   node --env-file=.env.local scripts/x-mention-image3d-dry-run.mjs --finish   # settle rows a run left pending
//   node --env-file=.env.local scripts/x-mention-image3d-dry-run.mjs --base https://three.ws --budget-ms 240000 --posts <id>,<id>,<id>

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceEnvValue } from './lib/service-env.mjs';
import { companyUserId, normalizeMentions, COMPANY_HANDLE_DEFAULT, plainHeaders, TWEET_FIELDS, EXPANSIONS, USER_FIELDS, MEDIA_FIELDS } from '../api/_lib/x-mentions.js';
import { parseMentionIntent } from '../api/_lib/x-mention-intents.js';
import { recordMention } from '../api/_lib/x-mention-store.js';
import { sql } from '../api/_lib/db.js';
import { handleImage3d, finishPendingImage3d } from '../api/_lib/x-mention-image3d.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prompts', 'x-grok', '_generated', 'image3d-dry-run.json');
const KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];

function arg(name, def) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
}

async function status(url) {
	try {
		const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(120_000) });
		await r.arrayBuffer();
		return { status: r.status, contentType: r.headers.get('content-type') };
	} catch (err) {
		return { status: 0, error: err.message };
	}
}

const DEFAULT_POSTS = ['2108593510001889542', '2108592640891474301', '2108589747316969518'];

async function photoPosts(ids) {
	const env = {};
	for (const k of KEYS) env[k] = process.env[k] || serviceEnvValue(k);
	const userId = companyUserId(env);
	if (!userId || KEYS.some((k) => !env[k])) throw new Error('X credentials are not available');
	const { TwitterApi } = await import('twitter-api-v2');
	const client = new TwitterApi({ appKey: env.X_API_KEY, appSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET }).readOnly;
	const res = await client.v2.get('tweets', {
		ids: ids.join(','),
		'tweet.fields': TWEET_FIELDS.join(','), expansions: EXPANSIONS.join(','), 'user.fields': USER_FIELDS.join(','), 'media.fields': MEDIA_FIELDS.join(','),
	}, { fullResponse: true });
	const account = { kind: 'company', ref: 'trythreews-evidence', userId, handle: COMPANY_HANDLE_DEFAULT };
	const posts = normalizeMentions(res.data, account).filter((p) => p.media.some((m) => m.type === 'photo' && m.url));
	return { userId, account, posts, rate: plainHeaders(res.headers)['x-rate-limit-remaining'] };
}

// --finish: the follow-up tick for the evidence rows a run left `pending`.
// Probes them every 15 s with the real finishPendingImage3d until none is
// pending (or --wait-ms passes), then folds the final replies, with the HTTP
// status of each media URL and link, into the evidence file.
async function finishPending() {
	const { readFileSync } = await import('node:fs');
	const base = arg('base', 'https://three.ws').replace(/\/$/, '');
	const deadline = Date.now() + Number(arg('wait-ms', 900_000));
	let summary;
	do {
		summary = await finishPendingImage3d({ limit: 50 }, { base });
		console.log(JSON.stringify(summary));
		if (!summary.waiting) break;
		await new Promise((r) => setTimeout(r, 15_000));
	} while (Date.now() < deadline);
	const evidence = JSON.parse(readFileSync(OUT, 'utf8'));
	const ids = evidence.rows.filter((r) => r.tweetId).map((r) => r.tweetId);
	const settled = await sql`select tweet_id, decision, reason, reply_text, reply_media_url, reply_link, creation_id, dry_run, reply_tweet_id from x_mention_events where tweet_id = any(${ids}::text[]) order by tweet_id`;
	for (const row of settled) {
		const target = evidence.rows.find((r) => r.tweetId === row.tweet_id);
		if (!target || row.decision === 'pending') continue;
		Object.assign(target, {
			outcome: 'reply', decision: row.decision, reason: row.reason, wouldReply: row.reply_text, mediaUrl: row.reply_media_url,
			mediaCheck: row.reply_media_url ? await status(row.reply_media_url) : null, link: row.reply_link,
			linkCheck: row.reply_link ? await status(row.reply_link) : null, creationId: row.creation_id, dryRun: row.dry_run, posted: Boolean(row.reply_tweet_id),
		});
	}
	evidence.finishedAt = new Date().toISOString();
	writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
	console.log(JSON.stringify(evidence.rows.map((r) => ({ label: r.label, decision: r.decision, reason: r.reason, media: r.mediaCheck?.status, link: r.linkCheck?.status })), null, 1));
	process.exit(0);
}
if (process.argv.includes('--finish')) await finishPending();

const base = arg('base', 'https://three.ws').replace(/\/$/, '');
const budgetMs = Number(arg('budget-ms', 240_000));
const count = Number(arg('count', 3));
const ids = (arg('posts', '') ? arg('posts', '').split(',') : DEFAULT_POSTS).slice(0, count);
const { userId, account, posts, rate } = await photoPosts(ids);
if (posts.length < ids.length) throw new Error(`only ${posts.length} of ${ids.length} posts carry a photo`);
console.log(`read ${posts.length} photo posts (lookup reads left: ${rate})`);

const salt = BigInt(Date.now()) << 22n;
let n = 0;
const rows = [];

async function run(label, { post, shape, authorId }) {
	n += 1;
	const tweetId = String(salt + BigInt(n));
	const username = authorId === post.author?.id ? post.author.username : 'evidence_other_user';
	const mention = {
		platform: 'x', id: tweetId, text: '@trythreews 3D this', createdAt: new Date().toISOString(), conversationId: tweetId,
		userId: authorId, username, author: { id: authorId, username }, mentions: [{ username: 'trythreews', id: userId }], urls: [],
		media: shape === 'attached' ? post.media : [], isRetweet: false, fromSelf: false,
		inReplyToUserId: shape === 'reply' ? post.author?.id ?? null : null,
		repliedTo: shape === 'reply' ? { id: post.id, available: true, text: post.text, author: post.author, media: post.media, url: post.url, conversationId: post.conversationId } : null,
		quoted: null, account,
	};
	const parsed = parseMentionIntent(mention, account);
	await recordMention({ mention, parsed, dryRun: true });
	const started = Date.now();
	if (parsed.intent !== 'image3d') {
		rows.push({ label, shape, intent: parsed.intent, reason: parsed.reason, note: 'not an image3d intent' });
		return;
	}
	const res = await handleImage3d({ tweetId, authorId, args: parsed.args, dryRun: true }, { base, budgetMs });
	rows.push({
		tweetId, label, shape, sourcePost: post.url, photo: parsed.args.mediaUrl, photoCheck: await status(parsed.args.mediaUrl),
		outcome: res.outcome, decision: res.decision, reason: res.reason, wouldReply: res.text,
		mediaUrl: res.mediaUrl, mediaCheck: res.mediaUrl ? await status(res.mediaUrl) : null,
		link: res.link, linkCheck: res.link ? await status(res.link) : null, creationId: res.creationId,
		seconds: Math.round((Date.now() - started) / 1000),
	});
	console.log(JSON.stringify(rows.at(-1), null, 2));
}

for (const [i, post] of posts.entries()) await run(`own image ${i + 1}`, { post, shape: i === 1 ? 'reply' : 'attached', authorId: post.author.id });
await run('someone else\'s image', { post: posts[0], shape: 'reply', authorId: '1800000000000000777' });

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), base, dryRun: true, rows }, null, 2)}\n`);
console.log(`wrote ${OUT}`);
process.exit(0);
