// The mention polling loop: read new mentions of our X accounts, record each
// once, decide, deliver one reply through the X adapter, record the outcome.
//
// Safe to run every two minutes forever:
//   - a run lock (app_settings row with an expiry) stops overlapping ticks;
//   - x_mention_events.tweet_id is the primary key, so a mention read twice is
//     handled once;
//   - the cursor only moves past mentions that are fully recorded, so a crash
//     mid-batch re-reads the unrecorded tail and nothing else;
//   - X being unavailable (tier, credits, rate window, bad credentials) is a
//     quiet, recorded outcome, never a thrown error;
//   - the first poll of an account only anchors the cursor at "now": the bot
//     never answers an account's history.
//
// Dry run is the default. The adapter posts only when X_MENTION_BOT_LIVE is
// "1" AND a poster token resolver is supplied; this loop supplies none for the
// company account, so going live is the separate owner step (order 928).
//
// Mention text is untrusted data: it is parsed by the pure parser and quoted
// to the reply brain as data. The only action it can ever cause is one reply
// to the same author.

import { randomUUID } from 'node:crypto';
import { sql } from './db.js';
import * as mentionStore from './x-mention-store.js';
import { fetchMentions, resolveAccount, companyMentionsConfigured, XMentionsError, XTierUnavailable, XRateLimited, XAuthFailed } from './x-mentions.js';
import { parseMentionIntent } from './x-mention-intents.js';
import { composePublicReply, FIXED_HELP_REPLY } from './x-mention-reply.js';
import { createXAdapter } from './gateway/adapters/x.js';
import { guardMention, isPaused } from './x-mention-guard.js';
import { ensureKnownBots, loadKnownBots } from './x-mention-known-bots.js';
import { answerOnBehalf } from './x-mention-on-behalf.js';
import * as xBudget from './x-budget.js';
import { handleAvatar, finishPendingAvatars } from './x-mention-avatar.js';

export const LOCK_KEY = 'x_mentions_lock';
const DEFAULT_LOCK_SECONDS = 110;
const DEFAULT_MAX_PER_ACCOUNT = 25;
const HOUR = 3600;
const DAY = 86400;

const REFUSED_REPLY = 'I cannot move funds or handle keys, and no one can ask me to. I make 3D models: try "make a red vintage scooter". https://three.ws/grok';

/** Intents whose dedicated handler is a later order; they answer with help until it lands. */
const UNBUILT_HANDLERS = Object.freeze(new Set(['make', 'image3d', 'launch']));

function intEnv(env, name, fallback) {
	const n = Number.parseInt(env[name] ?? '', 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Reply limits per author per account, configurable by env. */
export function replyLimits(env = process.env) {
	return {
		perHour: intEnv(env, 'X_MENTION_REPLIES_PER_AUTHOR_HOUR', 3),
		perDay: intEnv(env, 'X_MENTION_REPLIES_PER_AUTHOR_DAY', 10),
	};
}

/**
 * Take the run lock. Succeeds when no lock row exists or the held one has
 * expired. @returns {Promise<string|null>} the holder token, or null when held.
 */
export async function acquireLock(seconds = DEFAULT_LOCK_SECONDS) {
	const holder = randomUUID();
	const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
	const value = JSON.stringify({ holder, expires_at: expiresAt });
	const rows = await sql`
		insert into app_settings (key, value) values (${LOCK_KEY}, ${value}::jsonb)
		on conflict (key) do update
			set value = excluded.value, updated_at = now()
			where (app_settings.value->>'expires_at')::timestamptz < now()
		returning key
	`;
	return rows.length ? holder : null;
}

export async function releaseLock(holder) {
	await sql`delete from app_settings where key = ${LOCK_KEY} and value->>'holder' = ${holder}`;
}

/** Whether the author already used their reply allowance with this account. */
export async function overReplyLimit(authorId, account, limits, store = mentionStore) {
	const hour = await store.countByAuthor(authorId, { windowSeconds: HOUR, decisions: ['reply'], account });
	if (hour >= limits.perHour) return 'author_hourly_limit';
	const day = await store.countByAuthor(authorId, { windowSeconds: DAY, decisions: ['reply'], account });
	if (day >= limits.perDay) return 'author_daily_limit';
	return null;
}

/** The text a parsed mention is answered with, or why it is not answered. */
async function composeAnswer({ mention, parsed, account, compose }) {
	if (parsed.intent === 'help') {
		return { text: parsed.args?.topic === 'refused' ? REFUSED_REPLY : FIXED_HELP_REPLY, reason: parsed.reason };
	}
	if (UNBUILT_HANDLERS.has(parsed.intent)) {
		return { text: FIXED_HELP_REPLY, reason: 'handler_not_built' };
	}
	const reply = await compose({ company: { handle: account.handle }, mention });
	return { text: reply.text, reason: reply.source === 'model' ? parsed.reason : `fallback:${reply.reason}`, provider: reply.provider, model: reply.model };
}

/**
 * Handle one new mention end to end. Returns the decision recorded.
 * Only ever throws for a store failure on the mention row itself, which the
 * caller treats as "not fully recorded" and stops the batch there.
 */
export async function handleMention({ mention, account, limits, env, store = mentionStore, compose = composePublicReply, adapterFactory = createXAdapter, guard = guardMention, paused = isPaused, budget = xBudget, request = null, onBehalf = answerOnBehalf, knownBots = null, avatar = handleAvatar }) {
	const parsed = parseMentionIntent(mention, account);
	const dryRun = true;
	const { inserted } = await store.recordMention({ mention, parsed, dryRun });
	if (!inserted) return { tweetId: mention.id, decision: 'duplicate', reason: null };

	if (await paused(env)) {
		await store.updateDecision(mention.id, { decision: 'paused', reason: 'kill_switch' });
		return { tweetId: mention.id, intent: parsed.intent, decision: 'paused', reason: 'kill_switch' };
	}

	if (parsed.intent === 'ignore') {
		await store.updateDecision(mention.id, { decision: 'skip', reason: parsed.reason });
		return { tweetId: mention.id, intent: 'ignore', decision: 'skip', reason: parsed.reason };
	}

	try {
		const verdict = await guard({ mention, account: mention.account, env, store });
		if (!verdict.allow && verdict.reason === 'known_bot') {
			// A known xAI account tagged us: answer on behalf of the human at the
			// root of the conversation, or skip with the reason (x-mention-on-behalf.js).
			const allowedBot = await budget.budgetGate({ intent: parsed.intent, env });
			if (!allowedBot.allow) {
				await store.updateDecision(mention.id, { decision: 'budget', reason: allowedBot.reason });
				return { tweetId: mention.id, intent: parsed.intent, decision: 'budget', reason: allowedBot.reason };
			}
			const answered = await onBehalf({
				mention, parsed, account: mention.account, limits, env, store, adapterFactory,
				bots: knownBots || (await loadKnownBots({ env })),
				request: typeof request === 'function' ? await request() : request,
			});
			if (answered.decision === 'reply') await budget.recordPosts(1);
			return answered;
		}
		if (!verdict.allow) {
			await store.updateDecision(mention.id, { decision: verdict.decision, reason: verdict.reason });
			return { tweetId: mention.id, intent: parsed.intent, decision: verdict.decision, reason: verdict.reason };
		}
		const limited = await overReplyLimit(mention.userId || mention.author?.id, mention.account, limits, store);
		if (limited) {
			await store.updateDecision(mention.id, { decision: 'rate_limited', reason: limited });
			return { tweetId: mention.id, intent: parsed.intent, decision: 'rate_limited', reason: limited };
		}
		const allowed = await budget.budgetGate({ intent: parsed.intent, env });
		if (!allowed.allow) {
			await store.updateDecision(mention.id, { decision: 'budget', reason: allowed.reason });
			return { tweetId: mention.id, intent: parsed.intent, decision: 'budget', reason: allowed.reason };
		}
		if (parsed.intent === 'avatar') {
			const result = await avatar({ tweetId: mention.id, authorId: mention.userId || mention.author?.id, author: mention.author, dryRun });
			if (result.decision === 'reply') await budget.recordPosts(1);
			return { tweetId: mention.id, intent: 'avatar', decision: result.decision, reason: result.reason, text: result.text, dry_run: dryRun };
		}
		const answer = await composeAnswer({ mention, parsed, account, compose });
		const adapter = adapterFactory({ mention, parsed, env, policyDryRun: true });
		await adapter.sendText(mention.id, answer.text);
		await budget.recordPosts(1);
		await store.updateDecision(mention.id, { reason: answer.reason });
		return { tweetId: mention.id, intent: parsed.intent, decision: 'reply', reason: answer.reason, text: answer.text, dry_run: !adapter.live };
	} catch (err) {
		const message = String(err?.message || err).slice(0, 300);
		await store.updateDecision(mention.id, { decision: 'error', reason: err?.code || 'handler_error', error: message });
		return { tweetId: mention.id, intent: parsed.intent, decision: 'error', reason: err?.code || 'handler_error', error: message };
	}
}

/**
 * Poll one account and handle what is new.
 * @returns {Promise<{ account: string, status: string, ... }>}
 */
export async function pollAccount({ descriptor, env = process.env, maxMentions = DEFAULT_MAX_PER_ACCOUNT, deps = {} }) {
	const store = deps.store || mentionStore;
	const fetcher = deps.fetchMentions || fetchMentions;
	const limits = replyLimits(env);
	const label = `${descriptor.kind}:${descriptor.ref}`;

	let sinceId;
	try {
		sinceId = await store.getCursor({ kind: descriptor.kind, ref: descriptor.ref });
	} catch (err) {
		return { account: label, status: 'error', error: String(err?.message || err).slice(0, 200) };
	}

	const budget = deps.budget || xBudget;
	const gate = await budget.readGate({ env });
	if (!gate.allow) return { account: label, status: 'budget', reason: gate.reason, until: gate.until || null };

	let page;
	try {
		page = await fetcher({ account: descriptor.fetch, sinceId, env, request: deps.request || null, resolvedAccount: deps.resolvedAccount || null });
	} catch (err) {
		if (err instanceof XTierUnavailable) return { account: label, status: 'unavailable', reason: err.reason || 'tier_unavailable' };
		if (err instanceof XRateLimited) {
			const backoff = budget.backoffFromHeaders({ headers: err.headers, status: 429 });
			await budget.setBackoff(backoff || { until: err.resetAt, reason: 'http_429' }).catch(() => {});
			return { account: label, status: 'rate_limited', reset_at: err.resetAt };
		}
		if (err instanceof XAuthFailed) return { account: label, status: 'auth_failed' };
		if (err instanceof XMentionsError) return { account: label, status: 'unavailable', reason: err.code };
		throw err;
	}

	await budget.recordReads(page.mentions.length).catch(() => {});
	await budget.noteResponse({ headers: page.headers }).catch(() => {});

	if (!sinceId) {
		if (page.newestId) await store.advanceCursor({ kind: descriptor.kind, ref: descriptor.ref }, page.newestId);
		return { account: label, status: 'anchored', cursor: page.newestId };
	}

	const batch = page.mentions.slice(0, maxMentions);
	const resolve = () => (deps.request ? Promise.resolve(deps.request) : resolveAccount(descriptor.fetch, env).then((r) => r.request));
	if (batch.length) {
		await (deps.ensureKnownBots || ensureKnownBots)({ env, request: async (...a) => (await resolve())(...a) }).catch(() => {});
	}
	const decisions = [];
	let lastRecorded = null;
	let stoppedAt = null;
	for (const mention of batch) {
		try {
			decisions.push(await handleMention({ mention, account: page.account, limits, env, store, compose: deps.compose, adapterFactory: deps.adapterFactory, guard: deps.guard, paused: deps.paused, budget: deps.budget, request: resolve, onBehalf: deps.onBehalf, knownBots: deps.knownBots, avatar: deps.avatar }));
			lastRecorded = mention.id;
		} catch (err) {
			stoppedAt = mention.id;
			console.error('[x-mentions] stopped before an unrecorded mention', mention.id, err?.message || err);
			break;
		}
	}
	if (lastRecorded) await store.advanceCursor({ kind: descriptor.kind, ref: descriptor.ref }, lastRecorded);
	return {
		account: label,
		status: stoppedAt ? 'partial' : 'ok',
		read: page.mentions.length,
		handled: decisions.filter((d) => d.decision !== 'duplicate').length,
		deferred: page.mentions.length - batch.length,
		cursor: lastRecorded || sinceId,
		decisions,
	};
}

/**
 * Accounts to poll: the company account when its credentials are present,
 * then each agent account with mention replies enabled (supplied by
 * `agentAccounts`, which order 060 provides from the agent policy).
 */
export async function listAccounts({ env = process.env, agentAccounts = async () => [] } = {}) {
	const accounts = [];
	if (companyMentionsConfigured(env)) {
		accounts.push({ kind: 'company', ref: env.X_COMPANY_HANDLE || 'trythreews', fetch: { kind: 'company' } });
	}
	for (const a of await agentAccounts()) {
		accounts.push({ kind: 'agent', ref: String(a.agentId), fetch: { kind: 'agent', agentId: a.agentId, userId: a.userId } });
	}
	return accounts;
}

/** One cron tick: lock, poll every account, release. Never throws for X outages. */
export async function runMentionTick({ env = process.env, deps = {} } = {}) {
	const holder = await (deps.acquireLock || acquireLock)(intEnv(env, 'X_MENTION_LOCK_SECONDS', DEFAULT_LOCK_SECONDS));
	if (!holder) return { ok: true, skipped: 'locked' };
	const report = { ok: true, accounts: [] };
	try {
		const accounts = await (deps.listAccounts || listAccounts)({ env, agentAccounts: deps.agentAccounts });
		if (!accounts.length) return { ok: true, skipped: 'no_accounts_configured' };
		for (const descriptor of accounts) {
			try {
				report.accounts.push(await pollAccount({ descriptor, env, deps }));
			} catch (err) {
				report.accounts.push({ account: `${descriptor.kind}:${descriptor.ref}`, status: 'error', error: String(err?.message || err).slice(0, 200) });
			}
		}
		report.avatarFollowUp = await (deps.finishPendingAvatars || finishPendingAvatars)().catch((err) => ({ error: String(err?.message || err).slice(0, 200) }));
		return report;
	} finally {
		await (deps.releaseLock || releaseLock)(holder).catch(() => {});
	}
}
