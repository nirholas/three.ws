#!/usr/bin/env node
// Real dry-run generations for the X mention bot's `make` intent.
//
// Takes realistic "@trythreews make ..." posts, runs each through the real
// parser (x-mention-intents.js), records it on x_mention_events as a dry run,
// then runs the real handler (x-mention-make.js): studio moderation, the free
// text-to-3D lane on --base, the bounded wait, and the reply it WOULD post.
// Nothing is posted to X. The evidence (reply text, media URL, viewer link,
// and the HTTP status of each) is written to
// prompts/x-grok/_generated/make-dry-run.json.
//
// Rows land under account_ref `trythreews-evidence`, so they never appear in
// the real account's review console or rate limits.
//
// Usage (needs DATABASE_URL, e.g. from .env.local):
//   node --env-file=.env.local scripts/x-mention-make-dry-run.mjs
//   node --env-file=.env.local scripts/x-mention-make-dry-run.mjs --base https://three.ws --budget-ms 150000
//   node --env-file=.env.local scripts/x-mention-make-dry-run.mjs --follow-up-ms 900000   # how long to keep running the follow-up tick on pending rows
//   node --env-file=.env.local scripts/x-mention-make-dry-run.mjs --prompts "make a 3D owl" "3d a teapot"

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMentionIntent } from '../api/_lib/x-mention-intents.js';
import { recordMention } from '../api/_lib/x-mention-store.js';
import { handleMake, finishPendingMakes } from '../api/_lib/x-mention-make.js';
import { getMentionEvent } from '../api/_lib/x-mention-store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prompts', 'x-grok', '_generated', 'make-dry-run.json');
const ACCOUNT = { kind: 'company', ref: 'trythreews-evidence', userId: '1700000000000000001', handle: 'trythreews' };

const DEFAULT_POSTS = [
	'@trythreews make a 3D dragon',
	'@trythreews can you make me a low poly fox sitting on a mossy rock',
	'@trythreews 3d a vintage brass telescope on a tripod',
	'@trythreews generate a cozy wooden cabin with a snowy roof',
	'@trythreews forge a cute robot barista holding a coffee cup',
];

function arg(name, def) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
}

function flagList(name) {
	const i = process.argv.indexOf(`--${name}`);
	if (i < 0) return null;
	const out = [];
	for (const a of process.argv.slice(i + 1)) {
		if (a.startsWith('--')) break;
		out.push(a);
	}
	return out;
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

const base = arg('base', 'https://three.ws').replace(/\/$/, '');
const budgetMs = Number(arg('budget-ms', 150_000));
const posts = flagList('prompts') || DEFAULT_POSTS.map((p) => p);
const salt = BigInt(Date.now()) << 22n;

const rows = [];
for (const [i, text] of posts.entries()) {
	const withHandle = text.startsWith('@') ? text : `@trythreews ${text}`;
	const tweetId = String(salt + BigInt(i));
	const authorId = String(1800000000000000000n + BigInt(i));
	const mention = {
		platform: 'x', id: tweetId, text: withHandle, createdAt: new Date().toISOString(), conversationId: tweetId,
		userId: authorId, username: `evidence_user_${i + 1}`, author: { id: authorId, username: `evidence_user_${i + 1}` },
		mentions: [{ username: 'trythreews', id: ACCOUNT.userId }], urls: [], media: [], isRetweet: false, fromSelf: false,
		inReplyToUserId: null, repliedTo: null, quoted: null, account: ACCOUNT,
	};
	const parsed = parseMentionIntent(mention);
	await recordMention({ mention, parsed, dryRun: true });
	const started = Date.now();
	if (parsed.intent !== 'make') {
		rows.push({ post: withHandle, intent: parsed.intent, reason: parsed.reason, note: 'not a make intent' });
		continue;
	}
	const res = await handleMake({ tweetId, authorId, prompt: parsed.args.prompt, dryRun: true }, { base, budgetMs });
	const media = res.mediaUrl ? await status(res.mediaUrl) : null;
	const link = res.link ? await status(res.link) : null;
	rows.push({
		post: withHandle, intent: parsed.intent, prompt: parsed.args.prompt, tweetId, outcome: res.outcome, decision: res.decision,
		reason: res.reason, wouldReply: res.text, mediaUrl: res.mediaUrl, mediaCheck: media, link: res.link, linkCheck: link,
		creationId: res.creationId, seconds: Math.round((Date.now() - started) / 1000),
	});
	console.log(JSON.stringify(rows.at(-1), null, 2));
}

// Pending rows are collected by the follow-up tick, exactly as production would.
const followUpMs = Number(arg('follow-up-ms', 600_000));
const deadline = Date.now() + followUpMs;
while (rows.some((r) => r.outcome === 'pending') && Date.now() < deadline) {
	await finishPendingMakes({ limit: 50 }, { base });
	for (const r of rows.filter((x) => x.outcome === 'pending')) {
		const event = await getMentionEvent(r.tweetId);
		if (event.decision !== 'reply') continue;
		const media = event.reply_media_url ? await status(event.reply_media_url) : null;
		const link = event.reply_link ? await status(event.reply_link) : null;
		Object.assign(r, {
			outcome: 'reply', decision: 'reply', reason: event.reason, wouldReply: event.reply_text, mediaUrl: event.reply_media_url,
			mediaCheck: media, link: event.reply_link, linkCheck: link, creationId: event.creation_id, followUp: true,
		});
		console.log(JSON.stringify(r, null, 2));
	}
	if (rows.some((x) => x.outcome === 'pending')) await new Promise((res) => setTimeout(res, 20_000));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), base, dryRun: true, rows }, null, 2)}\n`);
console.log(`wrote ${OUT}`);
process.exit(0);
