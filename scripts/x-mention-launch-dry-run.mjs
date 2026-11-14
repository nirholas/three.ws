#!/usr/bin/env node
// Real dry-run decisions for the X mention bot's `launch` intent (order 925).
//
// Runs realistic "@trythreews launch <NAME> $<TICKER>" posts through the exact
// function the /api/cron/x-mentions tick calls for every new mention
// (handleMention in api/_lib/x-mention-poll.js): the real parser, the real
// guard, the real per-author limits, the real budget gate, the real author
// lookup against social_connections, and the real reply composer. Each post is
// recorded on x_mention_events as a dry run, then read back so the evidence is
// what the ledger (and /x/ops) actually holds, not what the script believes.
//
// Nothing is posted to X and nothing is launched: the company account is always
// dry run inside handleMention, and a launch mention only ever produces a reply
// carrying a /launch link the author signs on three.ws themselves.
//
// Rows land under account_ref `trythreews-evidence`, so they never appear in the
// real account's review console or per-author limits. The shared post budget is
// read (the gate runs) but not charged, so evidence never crowds out a real
// mention's dry-run decision for the day.
//
// The linked-author case uses a platform admin's own connected X account whose
// user has an agent with a 3D body, so the evidence never carries a stranger's
// identity. Pass --linked-x-id to choose a specific connected X user id.
//
// USAGE
//   node scripts/x-mention-launch-dry-run.mjs
//   node scripts/x-mention-launch-dry-run.mjs --base https://three.ws --linked-x-id 123456
//
// DATABASE_URL comes from this process's env or is read off the three-ws-api
// Cloud Run service. Evidence is written to
// prompts/x-grok/_generated/launch-dry-run.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceEnvValue } from './lib/service-env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prompts', 'x-grok', '_generated', 'launch-dry-run.json');
const ACCOUNT = { kind: 'company', ref: 'trythreews-evidence', userId: '1700000000000000001', handle: 'trythreews' };

function arg(name, def) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
}

const base = arg('base', 'https://three.ws').replace(/\/$/, '');
process.env.APP_ORIGIN = base;
process.env.DATABASE_URL ||= serviceEnvValue('DATABASE_URL');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set and could not be read from the three-ws-api service');

// Imported after the env is settled: db.js and self-origin.js read it on load.
const { sql } = await import('../api/_lib/db.js');
const { handleMention, replyLimits } = await import('../api/_lib/x-mention-poll.js');
const { getMentionEvent } = await import('../api/_lib/x-mention-store.js');
const { listAdminUserIds } = await import('../api/_lib/admin.js');
const xBudget = await import('../api/_lib/x-budget.js');

/** A connected X user id for a platform admin whose user has an agent with a body. */
async function linkedAdminXId() {
	const explicit = arg('linked-x-id', null);
	if (explicit) return explicit;
	const admins = await listAdminUserIds();
	if (!admins.length) return null;
	// Both tables findUserByXId resolves an author through.
	const [row] = await sql`
		select provider_uid, user_id from (
			select provider_uid, user_id from social_connections
			where provider = 'x' and disconnected_at is null
			union all
			select provider_uid, user_id from agent_x_connections
			where disconnected_at is null
		) c
		where c.user_id = any(${admins})
		  and exists (
			select 1 from agent_identities a
			where a.user_id = c.user_id and a.deleted_at is null and a.avatar_id is not null
		  )
		limit 1
	`;
	return row?.provider_uid || null;
}

const linkedId = await linkedAdminXId();

// How many connected X authors could get the launch_link reply today: linked
// through either table and owning a live agent with a body. A count only, so
// the evidence carries no one's identity.
const [{ n: reachableAuthors }] = await sql`
	select count(distinct c.provider_uid)::int as n from (
		select provider_uid, user_id from social_connections where provider = 'x' and disconnected_at is null
		union all
		select provider_uid, user_id from agent_x_connections where disconnected_at is null
	) c
	where exists (
		select 1 from agent_identities a
		where a.user_id = c.user_id and a.deleted_at is null and a.avatar_id is not null
	)
`;
console.log(JSON.stringify({ reachableAuthors }));
const salt = BigInt(Date.now()) << 22n;

// Each case names the author it needs and the outcome the ledger should show.
const CASES = [
	{ label: 'linked author, agent with a body', author: linkedId, text: '@trythreews launch Fixture Moon $FXMOON the cat that lives on the moon', expect: 'launch_link' },
	{ label: 'author not linked to three.ws', author: String(1800000000000000000n + 925n), text: '@trythreews launch Fixture Frog $FXFROG', expect: 'launch_unlinked' },
	{ label: 'missing ticker', author: String(1800000000000000000n + 926n), text: '@trythreews launch Fixture Cat', expect: 'launch_malformed' },
	{ label: 'reserved ticker', author: String(1800000000000000000n + 927n), text: '@trythreews launch Copycat $THREE', expect: 'launch_reserved_ticker' },
];

// The real gate decides; only the counter bump is withheld (see header).
const budget = { ...xBudget, recordPosts: async () => {} };
const limits = replyLimits(process.env);

const rows = [];
for (const [i, c] of CASES.entries()) {
	if (!c.author) {
		rows.push({ case: c.label, post: c.text, skipped: 'no connected X account found for a platform admin with an agent that has a 3D body' });
		console.log(JSON.stringify(rows.at(-1)));
		continue;
	}
	const tweetId = String(salt + BigInt(i));
	const mention = {
		platform: 'x', id: tweetId, text: c.text, createdAt: new Date().toISOString(), conversationId: tweetId,
		userId: c.author, username: `evidence_author_${i + 1}`, author: { id: c.author, username: `evidence_author_${i + 1}` },
		mentions: [{ username: 'trythreews', id: ACCOUNT.userId }], urls: [], media: [], isRetweet: false, fromSelf: false,
		inReplyToUserId: null, repliedTo: null, quoted: null, account: ACCOUNT,
	};
	const result = await handleMention({ mention, account: ACCOUNT, limits, env: process.env, budget });
	const event = await getMentionEvent(tweetId);
	let linkStatus = null;
	if (event?.reply_text) {
		const link = (event.reply_text.match(/https?:\/\/\S+/) || [])[0] || null;
		if (link) {
			const r = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(60_000) }).catch((err) => ({ status: 0, error: err.message }));
			linkStatus = { link, status: r.status, ...(r.error ? { error: r.error } : {}) };
		}
	}
	rows.push({
		case: c.label, post: c.text, tweetId, expectedReason: c.expect,
		handler: { intent: result.intent, decision: result.decision, reason: result.reason, dry_run: result.dry_run },
		ledger: event && {
			intent: event.intent, decision: event.decision, reason: event.reason, dry_run: event.dry_run,
			reply_tweet_id: event.reply_tweet_id, reply_text: event.reply_text,
		},
		linkCheck: linkStatus,
		pass: Boolean(event && event.reason === c.expect && event.dry_run === true && !event.reply_tweet_id),
	});
	console.log(JSON.stringify(rows.at(-1), null, 2));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), base, dryRun: true, reachableAuthors, rows }, null, 2)}\n`);
console.log(`wrote ${OUT}`);
process.exit(rows.every((r) => r.pass || r.skipped) ? 0 : 1);
