// @ts-check
// Health of the X mention bot (x-grok 42): "is it polling, how far behind,
// and how much runway is left". api/healthz.js's own docblock names exactly
// this failure mode: a bot that answers nothing looks dead to a user and
// broken to the owner unless some subsystem says so out loud.
//
// Every signal here is a read of x_mention_events, the one ledger both
// ingestion paths (the Account Activity webhook today, a future poll cron)
// write through on the tweet id primary key, plus the operator pause switch
// (x-mention-admin.js: app_settings x_mention_bot_paused) and the live-send
// flag (X_MENTION_BOT_LIVE, api/_lib/gateway/adapters/x.js). No X call, no
// secret read: this is a DB-only sensor, cheap enough for a per-request path.
//
// readMentionBotSignals() does the IO; mentionBotVerdict() is pure given its
// output, so the status vocabulary (ok/degraded/paused/unknown) is testable
// without a live database, the same split as api/_lib/ops/index-lag.js.

import { sql } from './db.js';
import { isPaused } from './x-mention-admin.js';
import { isXMentionBotLive } from './gateway/adapters/x.js';

const QUERY_TIMEOUT_MS = 4_000;

// How far behind "decide what we already read" may fall before it is a fault,
// and how error-heavy the last hour of decisions may run. Chosen by the work
// order (x-grok 42): generous enough that one slow tick never flaps, tight
// enough that a wedged decision path is visible within the hour it broke in.
export const LAG_DEGRADED_MS = 10 * 60 * 1000;
export const ERROR_RATE_DEGRADED = 0.2;
// Below this many decisions in the last hour, an error rate is noise, not a
// signal: one error out of two decided is "100%" and tells nobody anything.
const ERROR_RATE_MIN_SAMPLE = 5;

// Conservative placeholders until the real X tier is on this deployment (see
// x-grok 926); raised with env, no deploy of code needed. Same env names the
// budget design (docs/x-mention-bot.md on the branch that has it) already
// uses, so a future port of that module needs no data migration here.
const DAILY_POST_CAP = Number(process.env.X_MENTION_DAILY_POST_CAP) > 0 ? Number(process.env.X_MENTION_DAILY_POST_CAP) : 80;
const MONTHLY_POST_CAP = Number(process.env.X_MENTION_MONTHLY_POST_CAP) > 0 ? Number(process.env.X_MENTION_MONTHLY_POST_CAP) : 1500;

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error('mention bot health query timed out')), ms)),
	]);
}

/**
 * One round trip over the whole ledger. Pure counts and timestamps; no
 * per-row data leaves this function (callers decide what is safe to publish).
 *
 * @returns {Promise<{
 *   live: boolean, paused: boolean,
 *   lastEventAt: string|null, lastEventAgeMs: number|null,
 *   unprocessed: number, oldestUnprocessedAt: string|null, unprocessedLagMs: number|null,
 *   decidedLastHour: number, errorsLastHour: number, errorRate: number|null,
 *   handlesServed: number, replies24h: number, medianReplySeconds: number|null,
 *   budget: { dailyCap: number, dailyUsed: number, dailyRemaining: number,
 *             monthlyCap: number, monthlyUsed: number, monthlyRemaining: number },
 * }>}
 */
export async function readMentionBotSignals({ env = process.env } = {}) {
	const [paused, rows] = await Promise.all([
		isPaused(),
		withTimeout(
			sql`
				select
					max(created_at) as last_event_at,
					count(*) filter (where decision is null)::int as unprocessed,
					min(created_at) filter (where decision is null) as oldest_unprocessed_at,
					count(*) filter (where decided_at > now() - interval '1 hour')::int as decided_last_hour,
					count(*) filter (where decision = 'error' and decided_at > now() - interval '1 hour')::int as errors_last_hour,
					count(*) filter (where decision = 'reply' and created_at > now() - interval '1 day')::int as replies_24h,
					count(*) filter (where decision = 'reply' and created_at >= date_trunc('day', now()))::int as replies_today,
					count(*) filter (where decision = 'reply' and created_at >= date_trunc('month', now()))::int as replies_month,
					count(distinct (account_kind || ':' || account_ref))::int as handles_served,
					percentile_disc(0.5) within group (order by extract(epoch from (decided_at - created_at)))
						filter (where decision = 'reply' and decided_at is not null and created_at > now() - interval '1 day') as median_reply_seconds
				from x_mention_events
			`,
			QUERY_TIMEOUT_MS,
		),
	]);

	const r = rows[0] || {};
	const now = Date.now();
	const lastEventAt = r.last_event_at ? new Date(r.last_event_at).toISOString() : null;
	const oldestUnprocessedAt = r.oldest_unprocessed_at ? new Date(r.oldest_unprocessed_at).toISOString() : null;
	const decidedLastHour = Number(r.decided_last_hour || 0);
	const errorsLastHour = Number(r.errors_last_hour || 0);
	const dailyUsed = Number(r.replies_today || 0);
	const monthlyUsed = Number(r.replies_month || 0);

	return {
		live: isXMentionBotLive(env),
		paused,
		lastEventAt,
		lastEventAgeMs: lastEventAt ? now - new Date(lastEventAt).getTime() : null,
		unprocessed: Number(r.unprocessed || 0),
		oldestUnprocessedAt,
		unprocessedLagMs: oldestUnprocessedAt ? now - new Date(oldestUnprocessedAt).getTime() : null,
		decidedLastHour,
		errorsLastHour,
		errorRate: decidedLastHour > 0 ? errorsLastHour / decidedLastHour : null,
		handlesServed: Number(r.handles_served || 0),
		replies24h: Number(r.replies_24h || 0),
		medianReplySeconds: r.median_reply_seconds != null ? Math.round(Number(r.median_reply_seconds)) : null,
		budget: {
			dailyCap: DAILY_POST_CAP,
			dailyUsed,
			dailyRemaining: Math.max(0, DAILY_POST_CAP - dailyUsed),
			monthlyCap: MONTHLY_POST_CAP,
			monthlyUsed,
			monthlyRemaining: Math.max(0, MONTHLY_POST_CAP - monthlyUsed),
		},
	};
}

/**
 * Roll the bot's signals into one verdict. Pure: takes the shape
 * readMentionBotSignals() returns (or any subset of it) and does no IO.
 *
 * Paused is a chosen state, never a fault, so it reports `paused` regardless
 * of lag or errors underneath it (mentions are still recorded while paused;
 * nothing is decided or sent, so both would otherwise always read "stuck").
 * No event ever recorded is `unknown` (warming up), not a fault either.
 *
 * @param {{ paused: boolean, live: boolean, lastEventAgeMs: number|null,
 *   unprocessedLagMs: number|null, errorRate: number|null, decidedLastHour?: number }} signals
 * @returns {{ status: 'ok'|'degraded'|'paused'|'unknown', mode: 'live'|'dry_run'|'paused', detail: string }}
 */
export function mentionBotVerdict({ paused, live, lastEventAgeMs, unprocessedLagMs, errorRate, decidedLastHour = 0 }) {
	if (paused) {
		return { status: 'paused', mode: 'paused', detail: 'paused by operator: mentions are still recorded, nothing is decided or sent' };
	}
	const mode = live ? 'live' : 'dry_run';
	if (lastEventAgeMs == null) {
		return { status: 'unknown', mode, detail: 'no mentions recorded yet' };
	}

	const lagDegraded = unprocessedLagMs != null && unprocessedLagMs > LAG_DEGRADED_MS;
	const errorDegraded = decidedLastHour >= ERROR_RATE_MIN_SAMPLE && errorRate != null && errorRate > ERROR_RATE_DEGRADED;

	if (!lagDegraded && !errorDegraded) {
		return { status: 'ok', mode, detail: `${mode === 'live' ? 'live' : 'dry run'}, last mention ${Math.round(lastEventAgeMs / 1000)}s ago` };
	}

	const reasons = [];
	if (lagDegraded) reasons.push(`oldest undecided mention is ${Math.round(unprocessedLagMs / 60_000)}m old (limit ${Math.round(LAG_DEGRADED_MS / 60_000)}m)`);
	if (errorDegraded) reasons.push(`${Math.round(errorRate * 100)}% of the last hour's ${decidedLastHour} decisions errored`);
	return { status: 'degraded', mode, detail: reasons.join('; ') };
}

/**
 * Subsystem-health record for api/healthz.js's `subsystems` block. Never
 * throws: an unreadable ledger reports `unknown`, like every other sensor.
 * @returns {Promise<{ name: string, label: string, status: string, detail: string, metrics?: object }>}
 */
export async function gatherMentionBotHealth() {
	const base = { name: 'x_mention_bot', label: 'X mention bot' };
	let signals;
	try {
		signals = await readMentionBotSignals();
	} catch (err) {
		return { ...base, status: 'unknown', detail: err?.message || 'mention bot signals unreadable' };
	}
	const verdict = mentionBotVerdict(signals);
	return { ...base, status: verdict.status, detail: verdict.detail, metrics: signals };
}

/**
 * The public shape for GET /api/x/mention-bot/status: mode, aggregate
 * activity, no row-level or budget data (no mention text, no author ids, no
 * X tier caps). Never throws: a read failure reports `unknown` with zeroed
 * activity rather than a 500, so the status surface itself never looks down
 * because of its own probe.
 * @returns {Promise<{ status: string, mode: string, handlesServed: number,
 *   repliesLast24h: number, medianReplySeconds: number|null, checkedAt: string }>}
 */
export async function publicMentionBotStatus() {
	let signals;
	try {
		signals = await readMentionBotSignals();
	} catch {
		return { status: 'unknown', mode: 'unknown', handlesServed: 0, repliesLast24h: 0, medianReplySeconds: null, checkedAt: new Date().toISOString() };
	}
	const verdict = mentionBotVerdict(signals);
	return {
		status: verdict.status,
		mode: verdict.mode,
		handlesServed: signals.handlesServed,
		repliesLast24h: signals.replies24h,
		medianReplySeconds: signals.medianReplySeconds,
		checkedAt: new Date().toISOString(),
	};
}
