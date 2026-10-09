// The `make` intent of the X mention bot: "@trythreews make a 3D dragon".
//
// A parsed `make` mention (x-mention-intents.js) arrives here with a prompt
// that is already stripped of links and handles. This module runs it through
// the free studio's own safety module and text-to-3D lane, waits a bounded
// time, and ends in exactly one of four recorded states on the mention's
// x_mention_events row:
//
//   reply    done in time (or finished later by finishPendingMakes): the reply
//            is the rendered PNG as media plus the creation viewer link
//   pending  not done inside X_MAKE_BUDGET_MS: the job id is kept on the row
//            and finishPendingMakes replies once when it completes
//   reply    failed: a reply carrying a prefilled /forge?prompt= link so the
//            person can try on the site
//   unsafe   refused by the studio moderation: a fixed refusal, no echo
//
// The reply copy names the prompt back, shortened, and nothing else from the
// post. The tweet text is untrusted data throughout: it only ever becomes a
// quoted, length-capped prompt, never an instruction, and the only thing this
// module can cause is one reply to the same author.
//
// Creations are attributed to the system bot account (a users row with
// service_account = true) and carry x_author_id, so a later claim step can
// hand them to the X author once they link their profile. They are
// 'unlisted': reachable by the link in the reply, absent from public feeds.
//
// Nothing here posts. `dryRun` rows record the reply that would be sent;
// a live row hands the reply to `deliver` (the X adapter), and without one
// the row is held as `paused` rather than guessed at.

import { sql } from './db.js';
import { selfOrigin } from './self-origin.js';
import { weightedLength, X_POST_MAX_WEIGHT } from './x-text-weight.js';
import { updateDecision } from './x-mention-store.js';
import { checkPromptSafety } from '../_mcp-studio/safety.js';
import { startForge, pollJob, pollOnce, directPrompt } from '../_mcp-studio/gpt-forge-client.js';
import { posterPngUrl } from '../_mcp-studio/asset-links.js';
import { meshDirectorFor, meshSubjectClass } from './forge-director-prompts.js';

export const BOT_EMAIL = 'x-mentions@forge.three.ws';
export const BOT_USERNAME = 'x_mention_bot';
export const BOT_DISPLAY_NAME = 'three.ws on X';

const DEFAULT_BUDGET_MS = 150_000;
const DEFAULT_GIVE_UP_MS = 30 * 60_000;
const ECHO_MAX = 40;
const UNSAFE_REPLY = 'I cannot make that one. Try a creature, prop or scene, like "a low poly fox".';

function envMs(key, def) {
	const v = Number(process.env[key]);
	return Number.isFinite(v) && v > 0 ? v : def;
}

/** How long the make handler waits for a generation before recording `pending`. */
export const makeBudgetMs = () => envMs('X_MAKE_BUDGET_MS', DEFAULT_BUDGET_MS);
/** How long a pending job may stay unfinished before the designed failure reply. */
export const makeGiveUpMs = () => envMs('X_MAKE_GIVE_UP_MS', DEFAULT_GIVE_UP_MS);

/**
 * The prompt as shown back: no cashtags or hashtags (a reply never names a
 * coin on someone else's say-so), no quotes, one line, cut on a word edge.
 * PURE.
 */
export function shortenPrompt(prompt, max = ECHO_MAX) {
	let text = String(prompt ?? '')
		.replace(/[$#]\S+/g, ' ')
		.replace(/["“”]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const chars = [...text];
	if (chars.length <= max) return text;
	text = chars.slice(0, max).join('');
	const lastSpace = text.lastIndexOf(' ');
	if (lastSpace > max * 0.5) text = text.slice(0, lastSpace);
	return `${text.replace(/[\s,;:.-]+$/, '')}...`;
}

/** The /forge page prefilled with the person's prompt. PURE. */
export function forgeLink(base, prompt) {
	return `${base}/forge?prompt=${encodeURIComponent(String(prompt ?? '').trim())}`;
}

/** The public viewer page for a creation. PURE. */
export function creationLink(base, creationId) {
	return `${base}/m/${creationId}`;
}

/**
 * The reply text for each end state. Always within one post's weighted
 * length: if the echo would push it over, the echo shrinks. PURE.
 *
 * @param {'success'|'failure'|'unsafe'} kind
 * @param {{ prompt?: string, link?: string }} fields
 */
export function composeMakeReply(kind, { prompt = '', link = '' } = {}) {
	if (kind === 'unsafe') return UNSAFE_REPLY;
	const build = (echo) => {
		const named = echo ? ` "${echo}"` : '';
		if (kind === 'success') return `Here is your 3D model${named}. Spin it around: ${link}`;
		return `I could not finish your 3D model${named} this time. Try it on three.ws: ${link}`;
	};
	let max = ECHO_MAX;
	let text = build(shortenPrompt(prompt, max));
	while (weightedLength(text) > X_POST_MAX_WEIGHT && max > 8) {
		max -= 8;
		text = build(shortenPrompt(prompt, max));
	}
	return text;
}

/** Find or create the system bot account that owns bot-made creations. */
export async function ensureBotUser() {
	await sql`
		insert into users (email, display_name, username, plan, email_verified, service_account, created_at, updated_at)
		values (${BOT_EMAIL}, ${BOT_DISPLAY_NAME}, ${BOT_USERNAME}, 'free', false, true, now(), now())
		on conflict do nothing
	`;
	const [row] = await sql`select id from users where email = ${BOT_EMAIL}`;
	return row?.id ?? null;
}

/**
 * Attribute a creation to the system bot and to the X author who asked.
 * Set once: a creation already carrying an author is left alone.
 */
export async function attributeCreation({ creationId, authorId }) {
	if (!creationId || !authorId) return false;
	const botId = await ensureBotUser();
	const rows = await sql`
		update forge_creations set
			x_author_id = ${String(authorId)},
			user_id     = coalesce(user_id, ${botId}),
			visibility  = coalesce(visibility, 'unlisted'),
			updated_at  = now()
		where id = ${creationId} and x_author_id is null
		returning id
	`;
	return rows.length > 0;
}

async function markPending(tweetId, { jobId, creationId, prompt, startedAt }) {
	const make = { job_id: jobId, prompt, started_at: startedAt };
	const rows = await sql`
		update x_mention_events set
			decision    = 'pending',
			reason      = 'make_pending',
			args        = args || ${JSON.stringify({ make })}::jsonb,
			creation_id = coalesce(${creationId ?? null}, creation_id),
			decided_at  = now(),
			updated_at  = now()
		where tweet_id = ${String(tweetId)}
		returning tweet_id
	`;
	return rows.length > 0;
}

function successReply({ base, prompt, glbUrl, creationId }) {
	const link = creationId ? creationLink(base, creationId) : `${base}/viewer?src=${encodeURIComponent(glbUrl)}`;
	return {
		kind: 'success',
		text: composeMakeReply('success', { prompt, link }),
		mediaUrl: posterPngUrl(base, glbUrl),
		link,
	};
}

function failureReply({ base, prompt }) {
	const link = forgeLink(base, prompt);
	return { kind: 'failure', text: composeMakeReply('failure', { prompt, link }), mediaUrl: null, link };
}

async function directedPrompt(prompt, deps) {
	const director = deps.directPrompt || directPrompt;
	const directed = await director(meshDirectorFor(meshSubjectClass(prompt)), prompt);
	return directed || prompt;
}

/**
 * Record the reply, then hand it to the X adapter when the row is live.
 * `deliver({ text, mediaUrl, inReplyToTweetId })` resolves to the new post id.
 */
async function finalize({ tweetId, reply, dryRun, deliver, reason, creationId, error }) {
	const base = {
		decision: 'reply',
		reason,
		replyText: reply.text,
		replyMediaUrl: reply.mediaUrl || undefined,
		replyLink: reply.link || undefined,
		creationId: creationId || undefined,
		error: error || undefined,
		dryRun,
	};
	if (dryRun) {
		await updateDecision(tweetId, base);
		return { decision: 'reply', sent: false, replyTweetId: null };
	}
	if (typeof deliver !== 'function') {
		await updateDecision(tweetId, { ...base, decision: 'paused', reason: 'no_delivery_adapter' });
		return { decision: 'paused', sent: false, replyTweetId: null };
	}
	await updateDecision(tweetId, base);
	const replyTweetId = await deliver({ text: reply.text, mediaUrl: reply.mediaUrl, inReplyToTweetId: tweetId });
	if (replyTweetId) await updateDecision(tweetId, { replyTweetId });
	return { decision: 'reply', sent: Boolean(replyTweetId), replyTweetId: replyTweetId || null };
}

/**
 * Handle one recorded `make` mention end to end.
 *
 * @param {{ tweetId: string, authorId: string, prompt: string, dryRun?: boolean }} event
 * @param {{ base?: string, budgetMs?: number, deliver?: Function, startForge?: Function, pollJob?: Function, directPrompt?: Function, now?: () => number }} [deps]
 * @returns {Promise<{ outcome: 'reply'|'pending'|'unsafe', decision: string, text: string|null, mediaUrl: string|null, link: string|null, creationId: string|null, reason: string }>}
 */
export async function handleMake(event, deps = {}) {
	const { tweetId, authorId } = event;
	const dryRun = event.dryRun !== false;
	const prompt = String(event.prompt ?? '').trim();
	const base = deps.base || selfOrigin();
	const done = (outcome, fields) => ({ outcome, mediaUrl: null, link: null, creationId: null, text: null, ...fields });

	const safety = checkPromptSafety(prompt);
	if (!safety.allowed) {
		const text = composeMakeReply('unsafe');
		await updateDecision(tweetId, { decision: 'unsafe', reason: `safety_${safety.category}`, replyText: text, dryRun });
		return done('unsafe', { decision: 'unsafe', text, reason: `safety_${safety.category}` });
	}

	const submit = deps.startForge || startForge;
	const poll = deps.pollJob || pollJob;
	let job;
	try {
		const effective = await directedPrompt(prompt, deps);
		job = await submit(base, { prompt: effective, path: 'image', tier: 'standard', internal: true, director: false });
	} catch (err) {
		return settleFailure({ event, base, prompt, dryRun, deps, reason: `make_failed:${err?.code || 'submit'}`, error: err?.message });
	}

	const creationId = job.creation_id || null;
	if (creationId) await attributeCreation({ creationId, authorId }).catch((err) => console.warn('[x-mention-make] attribution failed:', err?.message));

	let result = job;
	if (!(job.status === 'done' && job.glb_url)) {
		const startedAt = new Date((deps.now || Date.now)()).toISOString();
		try {
			result = await poll(base, job.job_id, { timeoutMs: deps.budgetMs ?? makeBudgetMs(), intervalMs: Number(process.env.STUDIO_POLL_MS) || 3000 });
		} catch (err) {
			return settleFailure({ event, base, prompt, dryRun, deps, creationId, reason: `make_failed:${err?.code || 'poll'}`, error: err?.message });
		}
		if (result._timedOut || !result.glb_url) {
			await markPending(tweetId, { jobId: job.job_id, creationId, prompt, startedAt });
			return done('pending', { decision: 'pending', creationId, reason: 'make_pending' });
		}
	}

	const reply = successReply({ base, prompt, glbUrl: result.glb_url, creationId: result.creation_id || creationId });
	const sent = await finalize({ tweetId, reply, dryRun, deliver: deps.deliver, reason: 'make_done', creationId: result.creation_id || creationId });
	return done('reply', { decision: sent.decision, text: reply.text, mediaUrl: reply.mediaUrl, link: reply.link, creationId: result.creation_id || creationId, reason: 'make_done' });
}

async function settleFailure({ event, base, prompt, dryRun, deps, creationId = null, reason, error }) {
	const reply = failureReply({ base, prompt });
	const sent = await finalize({ tweetId: event.tweetId, reply, dryRun, deliver: deps.deliver, reason, creationId, error });
	return { outcome: 'reply', decision: sent.decision, text: reply.text, mediaUrl: null, link: reply.link, creationId, reason };
}

/**
 * The follow-up tick: every `make` mention left `pending` is probed once.
 * Done jobs get their one reply, failed or long-overdue jobs get the failure
 * reply, running jobs are left for the next tick. A row settles at most once:
 * the decision flips from `pending` in a single conditional UPDATE, so two
 * overlapping ticks cannot both reply.
 *
 * @param {{ limit?: number }} [opts]
 * @param {{ base?: string, deliver?: Function, pollOnce?: Function, now?: () => number }} [deps]
 */
export async function finishPendingMakes({ limit = 10 } = {}, deps = {}) {
	const base = deps.base || selfOrigin();
	const probe = deps.pollOnce || pollOnce;
	const now = deps.now || Date.now;
	const rows = await sql`
		select tweet_id, author_id, dry_run, creation_id, args
		from x_mention_events
		where intent = 'make' and decision = 'pending' and args->'make'->>'job_id' is not null
		order by created_at asc
		limit ${Math.max(1, Math.min(50, Math.round(Number(limit) || 10)))}
	`;
	const summary = { checked: rows.length, replied: 0, failed: 0, waiting: 0 };
	for (const row of rows) {
		const make = row.args?.make || {};
		const prompt = String(make.prompt || row.args?.prompt || '');
		let status = null;
		let probeError = null;
		try {
			status = await probe(base, make.job_id);
		} catch (err) {
			probeError = err;
		}
		const overdue = now() - Date.parse(make.started_at || 0) > makeGiveUpMs();
		let reply;
		let reason;
		if (status?.status === 'done' && status.glb_url) {
			reply = successReply({ base, prompt, glbUrl: status.glb_url, creationId: status.creation_id || row.creation_id });
			reason = 'make_done_late';
		} else if (status?.status === 'failed' || probeError?.code === 'unknown_job' || overdue) {
			reply = failureReply({ base, prompt });
			reason = `make_failed:${status?.status === 'failed' ? 'generation_failed' : probeError?.code || 'overdue'}`;
		} else {
			summary.waiting += 1;
			continue;
		}
		const claimed = await sql`
			update x_mention_events set decision = 'reply', reason = ${reason}, updated_at = now()
			where tweet_id = ${row.tweet_id} and decision = 'pending'
			returning tweet_id
		`;
		if (!claimed.length) continue;
		await finalize({
			tweetId: row.tweet_id,
			reply,
			dryRun: row.dry_run !== false,
			deliver: deps.deliver,
			reason,
			creationId: status?.creation_id || row.creation_id,
		});
		if (reply.kind === 'success') summary.replied += 1;
		else summary.failed += 1;
	}
	return summary;
}
