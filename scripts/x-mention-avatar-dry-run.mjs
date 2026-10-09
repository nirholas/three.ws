#!/usr/bin/env node
// Real dry-run avatar generations for the X mention bot's `avatar` intent.
//
// Reads the real recent mentions of @trythreews (one read-only GET
// /2/users/:id/mentions) and takes each distinct author's real public profile
// picture from the user expansion, exactly as the poller does. Each author is
// turned into a mention "@trythreews make me an avatar", recorded as a dry run,
// and run through the real handler (x-mention-avatar.js): CDN fetch, vision
// review, image storage, the rigged-avatar lane on --base, the bounded wait,
// and the reply it WOULD post. One extra run names another account in the text
// and must still use the author's picture; one extra run uses a default
// profile picture. Nothing is posted to X. Evidence, with the HTTP status of
// every media URL, goes to prompts/x-grok/_generated/avatar-dry-run.json.
//
// Rows land under account_ref `trythreews-evidence`, never the real account's.
//
// USAGE (needs DATABASE_URL, e.g. from .env.local; X and provider credentials
// come from process.env or the three-ws-api Cloud Run service)
//   node --env-file=.env.local scripts/x-mention-avatar-dry-run.mjs
//   node --env-file=.env.local scripts/x-mention-avatar-dry-run.mjs --base https://three.ws --budget-ms 420000 --count 2

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceEnvEntries, serviceEnvValue } from './lib/service-env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prompts', 'x-grok', '_generated', 'avatar-dry-run.json');
const X_KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const PROVIDER_KEYS = ['NVIDIA_API_KEY', 'NVIDIA_FALLBACK_KEYS', 'OPENROUTER_API_KEY', 'OPENROUTER_FALLBACK_KEYS', 'OPENAI_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_API_TOKEN', 'GOOGLE_CLOUD_PROJECT', 'CRON_SECRET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN', 'S3_REGION'];
const DEFAULT_PFP = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';

function arg(name, def) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
}

const names = serviceEnvEntries().map((e) => e.name);
for (const k of [...X_KEYS, ...PROVIDER_KEYS]) {
	if (!process.env[k] && names.includes(k)) {
		const v = serviceEnvValue(k);
		if (v) process.env[k] = v;
	}
}

const { companyUserId, normalizeMentions, COMPANY_HANDLE_DEFAULT, plainHeaders, TWEET_FIELDS, EXPANSIONS, USER_FIELDS, MEDIA_FIELDS } = await import('../api/_lib/x-mentions.js');
const { parseMentionIntent } = await import('../api/_lib/x-mention-intents.js');
const { recordMention } = await import('../api/_lib/x-mention-store.js');
const { handleAvatar, isDefaultProfileImage } = await import('../api/_lib/x-mention-avatar.js');
const { xProfileImageUrl } = await import('../api/_lib/x-media-image.js');

async function status(url) {
	try {
		const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(180_000) });
		await r.arrayBuffer();
		return { status: r.status, contentType: r.headers.get('content-type') };
	} catch (err) {
		return { status: 0, error: err.message };
	}
}

async function realAuthors(max) {
	const userId = companyUserId(process.env);
	if (!userId || X_KEYS.some((k) => !process.env[k])) throw new Error('X credentials are not available');
	const { TwitterApi } = await import('twitter-api-v2');
	const env = process.env;
	const client = new TwitterApi({ appKey: env.X_API_KEY, appSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET }).readOnly;
	const res = await client.v2.get(`users/${userId}/mentions`, {
		max_results: '100',
		'tweet.fields': TWEET_FIELDS.join(','), expansions: EXPANSIONS.join(','), 'user.fields': USER_FIELDS.join(','), 'media.fields': MEDIA_FIELDS.join(','),
	}, { fullResponse: true });
	const account = { kind: 'company', ref: 'trythreews-evidence', userId, handle: COMPANY_HANDLE_DEFAULT };
	const seen = new Set();
	const authors = [];
	for (const m of normalizeMentions(res.data, account)) {
		const a = m.author;
		if (m.fromSelf || !a?.id || seen.has(a.id) || !a.profileImageUrl || isDefaultProfileImage(a.profileImageUrl) || !xProfileImageUrl(a.profileImageUrl)) continue;
		seen.add(a.id);
		authors.push(a);
		if (authors.length >= max) break;
	}
	return { userId, account, authors, rate: plainHeaders(res.headers)['x-rate-limit-remaining'] };
}

const base = arg('base', 'https://three.ws').replace(/\/$/, '');
const budgetMs = Number(arg('budget-ms', 420_000));
const count = Number(arg('count', 2));
const { userId, account, authors, rate } = await realAuthors(Number(arg('candidates', 8)));
console.log(`read ${authors.length} distinct authors with a custom profile picture (timeline reads left: ${rate})`);

const salt = BigInt(Date.now()) << 22n;
let n = 0;
const rows = [];

async function run(label, { author, text = '@trythreews make me an avatar', named = [] }) {
	n += 1;
	const tweetId = String(salt + BigInt(n));
	const mention = {
		platform: 'x', id: tweetId, text, createdAt: new Date().toISOString(), conversationId: tweetId,
		userId: author.id, username: author.username, author,
		mentions: [{ username: 'trythreews', id: userId }, ...named], urls: [],
		media: [], isRetweet: false, fromSelf: false, inReplyToUserId: null, repliedTo: null, quoted: null, account,
	};
	const parsed = parseMentionIntent(mention, account);
	await recordMention({ mention, parsed, dryRun: true });
	const started = Date.now();
	if (parsed.intent !== 'avatar') {
		rows.push({ label, intent: parsed.intent, reason: parsed.reason, note: 'not an avatar intent' });
		return null;
	}
	const res = await handleAvatar({ tweetId, authorId: author.id, author, dryRun: true }, { base, budgetMs });
	const row = {
		label, text, author: `@${author.username}`, profileImage: author.profileImageUrl,
		fetchedAs: xProfileImageUrl(author.profileImageUrl), profileCheck: await status(xProfileImageUrl(author.profileImageUrl) || author.profileImageUrl),
		outcome: res.outcome, decision: res.decision, reason: res.reason, wouldReply: res.text,
		mediaUrl: res.mediaUrl, mediaCheck: res.mediaUrl ? await status(res.mediaUrl) : null,
		link: res.link, linkCheck: res.link ? await status(res.link) : null, creationId: res.creationId,
		seconds: Math.round((Date.now() - started) / 1000),
	};
	rows.push(row);
	console.log(JSON.stringify(row, null, 2));
	return row;
}

let produced = 0;
for (const [i, author] of authors.entries()) {
	if (produced >= count) break;
	const row = await run(`own profile image ${produced + 1} (candidate ${i + 1})`, { author });
	if (row?.reason?.startsWith('avatar_done')) produced += 1;
}
if (authors.length) {
	await run('text names another account', { author: authors[0], text: '@trythreews make me an avatar using @jack profile picture', named: [{ username: 'jack', id: '12' }] });
}
await run('default profile image', { author: { id: '1800000000000000555', username: 'evidence_default_user', profileImageUrl: DEFAULT_PFP } });

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), base, dryRun: true, rows }, null, 2)}\n`);
console.log(`wrote ${OUT}`);
process.exit(0);
