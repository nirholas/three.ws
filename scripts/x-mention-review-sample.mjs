#!/usr/bin/env node
// Read-only review sample of the X mention bot's dry-run decisions.
//
// Order 928 asks the owner to decide on real evidence before the bot goes live.
// This pulls a stratified sample from x_mention_events (the ledger /x/ops reads):
// up to --per-intent rows for every intent, newest first, so the sample covers
// make / image3d / avatar / help / chat / launch / ignore rather than whatever
// was most recent. It prints the mention, the decision and reason, and the reply
// the bot would have sent, and finishes with the live-readiness checks the
// runbook (docs/ops/x-mention-go-live.md) lists.
//
// It never writes to the database and never contacts X. The database URL comes
// from this process's env or is resolved off the three-ws-api Cloud Run service.
// Mention text is other people's public posts: the output is for the owner's
// eyes and is not meant to be committed (use --out outside the repo).
//
// USAGE
//   node scripts/x-mention-review-sample.mjs                 # 30-row sample to stdout
//   node scripts/x-mention-review-sample.mjs --limit 30 --out /tmp/sample.md
//   node scripts/x-mention-review-sample.mjs --json          # machine-readable

import { writeFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { serviceEnvValue } from './lib/service-env.mjs';

const INTENTS = ['make', 'image3d', 'avatar', 'help', 'launch', 'chat', 'ignore'];

export function parseArgs(argv) {
	const out = { limit: 30, json: false, out: null };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--limit') out.limit = Math.max(1, Number(argv[++i]) || 30);
		else if (argv[i] === '--out') out.out = argv[++i] || null;
		else if (argv[i] === '--json') out.json = true;
	}
	return out;
}

// Spread `limit` rows over the intents that actually have rows: round-robin
// from each intent's newest row, so a chatty intent cannot crowd the others out.
export function stratify(rowsByIntent, limit) {
	const queues = INTENTS.map((i) => [...(rowsByIntent[i] || [])]).filter((q) => q.length);
	const picked = [];
	while (picked.length < limit && queues.some((q) => q.length)) {
		for (const q of queues) {
			if (picked.length >= limit) break;
			if (q.length) picked.push(q.shift());
		}
	}
	return picked;
}

// Rules a live reply must not break. Each returns a problem string or null.
export function guardProblems(row) {
	const problems = [];
	const text = row.reply_text || '';
	if (text.length > 280) problems.push(`reply is ${text.length} chars (limit 280)`);
	if (/[\u2013\u2014]/.test(text)) problems.push('reply contains a dash glyph');
	if (row.decision === 'reply' && !text) problems.push('decision is reply but there is no reply text');
	if (row.decision === 'reply' && row.dry_run === false && !row.reply_tweet_id)
		problems.push('live row without a reply tweet id');
	if (row.decision === 'unsafe' && text) problems.push('unsafe decision carries reply text');
	return problems;
}

function render(rows, summary) {
	const lines = ['# X mention bot dry-run review sample', ''];
	lines.push(`Ledger totals (all time): ${summary.map((s) => `${s.intent}/${s.decision}=${s.n}`).join(', ') || 'no rows'}`, '');
	rows.forEach((r, i) => {
		lines.push(`## ${i + 1}. ${r.intent} -> ${r.decision || 'undecided'} (${r.reason || 'no reason'})`);
		lines.push(`account: ${r.account_kind}/${r.account_ref}, dry_run: ${r.dry_run}, at ${new Date(r.created_at).toISOString()}`);
		lines.push(`mention: ${(r.mention_text || '').replace(/\s+/g, ' ').trim()}`);
		if (r.reply_text) lines.push(`would reply: ${r.reply_text.replace(/\n/g, ' / ')}`);
		if (r.reply_link) lines.push(`link: ${r.reply_link}`);
		if (r.reply_media_url) lines.push(`media: ${r.reply_media_url}`);
		const problems = guardProblems(r);
		lines.push(problems.length ? `GUARD PROBLEMS: ${problems.join('; ')}` : 'guard check: ok');
		lines.push('');
	});
	return lines.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const url = process.env.DATABASE_URL || serviceEnvValue('DATABASE_URL');
	if (!url) throw new Error('DATABASE_URL is not set and could not be read from the three-ws-api service');
	const sql = neon(url);
	const byIntent = {};
	for (const intent of INTENTS) {
		byIntent[intent] = await sql`
			select tweet_id, account_kind, account_ref, intent, decision, reason, mention_text,
			       reply_text, reply_link, reply_media_url, reply_tweet_id, dry_run, created_at
			from x_mention_events
			where intent = ${intent}
			order by created_at desc
			limit ${args.limit}`;
	}
	const summary = await sql`
		select intent, coalesce(decision, 'undecided') as decision, count(*)::int as n
		from x_mention_events group by 1, 2 order by 1, 2`;
	const rows = stratify(byIntent, args.limit);
	const report = args.json ? JSON.stringify({ summary, rows }, null, 2) : render(rows, summary);
	if (args.out) writeFileSync(args.out, report);
	else console.log(report);
	if (rows.some((r) => guardProblems(r).length)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(`[x-mention-review-sample] ${err.message}`);
		process.exit(2);
	});
}
