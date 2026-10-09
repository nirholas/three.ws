// The X API budget the mention bot cannot exceed.
//
// X reads and posts are metered. A viral thread can send thousands of
// mentions in an hour, so every read and every reply is counted here, against
// caps the owner can tune, and the bot degrades in a fixed order instead of
// burning the month in a day or going dark mid-conversation.
//
// State lives in app_settings (no migration):
//   x_budget_month_YYYY-MM   { reads, posts }   UTC calendar month
//   x_budget_day_YYYY-MM-DD  { reads, posts }   UTC day
//   x_budget_backoff         { until, reason }  set from X's own rate-limit headers
//
// Replies count the moment they are decided, dry run included, so a dry run
// spends the same budget live will and the numbers are honest before going live.
//
// Degrade ladder. `level` is the largest used fraction of any cap (daily posts,
// monthly posts, monthly reads). As it climbs, intents are dropped in this
// order, cheapest value first, and each drop is recorded as a `budget`
// decision on the mention:
//
//   level >= 0.70  chat      (open-ended conversation)
//   level >= 0.80  avatar
//   level >= 0.90  image3d
//   level >= 1.00  make, launch, help (everything: a cap is a hard stop)
//
// Defaults are deliberately conservative and env-tunable; the real allowances
// of the X tier are recorded by order 926. Rationale: docs/x-mention-bot.md.

import { sql } from './db.js';
import { plainHeaders, readRateLimit } from './x-mentions.js';

export const BACKOFF_KEY = 'x_budget_backoff';
export const DEFAULT_CAPS = Object.freeze({ monthlyPosts: 1500, dailyPosts: 80, monthlyReads: 15000 });

/** Degrade ladder, first to drop first. `at` is the used fraction that drops it. */
export const LADDER = Object.freeze([
	Object.freeze({ at: 0.7, intents: Object.freeze(['chat']) }),
	Object.freeze({ at: 0.8, intents: Object.freeze(['avatar']) }),
	Object.freeze({ at: 0.9, intents: Object.freeze(['image3d']) }),
	Object.freeze({ at: 1.0, intents: Object.freeze(['make', 'launch', 'help']) }),
]);

function capEnv(env, name, fallback) {
	const n = Number.parseInt(env[name] ?? '', 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The configured caps. */
export function budgetCaps(env = process.env) {
	return {
		monthlyPosts: capEnv(env, 'X_MENTION_MONTHLY_POST_CAP', DEFAULT_CAPS.monthlyPosts),
		dailyPosts: capEnv(env, 'X_MENTION_DAILY_POST_CAP', DEFAULT_CAPS.dailyPosts),
		monthlyReads: capEnv(env, 'X_MENTION_MONTHLY_READ_CAP', DEFAULT_CAPS.monthlyReads),
	};
}

export const monthKey = (now = Date.now()) => `x_budget_month_${new Date(now).toISOString().slice(0, 7)}`;
export const dayKey = (now = Date.now()) => `x_budget_day_${new Date(now).toISOString().slice(0, 10)}`;

async function readSetting(key) {
	const [row] = await sql`select value from app_settings where key = ${key}`;
	return row?.value ?? null;
}

async function bump(key, field, n) {
	await sql`
		insert into app_settings (key, value) values (${key}, jsonb_build_object(${field}::text, ${n}::int))
		on conflict (key) do update
			set value = jsonb_set(
					coalesce(app_settings.value, '{}'::jsonb),
					array[${field}::text],
					to_jsonb(coalesce((app_settings.value->>${field}::text)::int, 0) + ${n}::int)
				),
				updated_at = now()
	`;
}

/** Count `n` replies against today and this month. */
export async function recordPosts(n = 1, now = Date.now()) {
	if (!(n > 0)) return;
	await bump(dayKey(now), 'posts', n);
	await bump(monthKey(now), 'posts', n);
}

/** Count `n` posts read from X against today and this month. */
export async function recordReads(n, now = Date.now()) {
	if (!(n > 0)) return;
	await bump(dayKey(now), 'reads', n);
	await bump(monthKey(now), 'reads', n);
}

/** The lowest ladder rung whose threshold `level` has reached, as the set of dropped intents. PURE. */
export function droppedIntents(level) {
	const out = [];
	for (const rung of LADDER) if (level >= rung.at) out.push(...rung.intents);
	return out;
}

/** The largest used fraction of any cap. PURE. */
export function usageLevel({ day, month }, caps) {
	return Math.max(
		(day.posts || 0) / caps.dailyPosts,
		(month.posts || 0) / caps.monthlyPosts,
		(month.reads || 0) / caps.monthlyReads,
	);
}

/**
 * Current usage, caps, level, what is dropped and any active backoff.
 * This is the object the mention-bot status endpoint (order 064) exposes.
 */
export async function getBudgetUsage({ env = process.env, now = Date.now(), read = readSetting } = {}) {
	const caps = budgetCaps(env);
	const [dayRow, monthRow, backoffRow] = await Promise.all([read(dayKey(now)), read(monthKey(now)), read(BACKOFF_KEY)]);
	const day = { posts: Number(dayRow?.posts) || 0, reads: Number(dayRow?.reads) || 0 };
	const month = { posts: Number(monthRow?.posts) || 0, reads: Number(monthRow?.reads) || 0 };
	const level = usageLevel({ day, month }, caps);
	const until = backoffRow?.until && Date.parse(backoffRow.until) > now ? backoffRow.until : null;
	return {
		caps,
		day,
		month,
		remaining: {
			dailyPosts: Math.max(0, caps.dailyPosts - day.posts),
			monthlyPosts: Math.max(0, caps.monthlyPosts - month.posts),
			monthlyReads: Math.max(0, caps.monthlyReads - month.reads),
		},
		level: Math.round(level * 1000) / 1000,
		dropped: droppedIntents(level),
		backoff: until ? { until, reason: backoffRow.reason || 'rate_limit' } : null,
	};
}

/**
 * May this intent be answered right now? Fails closed: a budget that cannot be
 * read is a budget that cannot be proven, so nothing is spent.
 * @returns {Promise<{ allow: true } | { allow: false, reason: string }>}
 */
export async function budgetGate({ intent, env = process.env, now = Date.now(), read = readSetting } = {}) {
	let usage;
	try {
		usage = await getBudgetUsage({ env, now, read });
	} catch {
		return { allow: false, reason: 'budget_unreadable' };
	}
	if (usage.backoff) return { allow: false, reason: 'rate_limit_backoff' };
	if (usage.day.posts >= usage.caps.dailyPosts) return { allow: false, reason: 'daily_post_cap' };
	if (usage.month.posts >= usage.caps.monthlyPosts) return { allow: false, reason: 'monthly_post_cap' };
	if (usage.dropped.includes(intent)) return { allow: false, reason: `degraded:${intent}` };
	return { allow: true };
}

/**
 * May the poller read from X right now? A read-cap or backoff stop leaves the
 * cursor where it is, so the mentions are read later, not lost.
 */
export async function readGate({ env = process.env, now = Date.now(), read = readSetting } = {}) {
	let usage;
	try {
		usage = await getBudgetUsage({ env, now, read });
	} catch {
		return { allow: false, reason: 'budget_unreadable' };
	}
	if (usage.backoff) return { allow: false, reason: 'rate_limit_backoff', until: usage.backoff.until };
	if (usage.month.reads >= usage.caps.monthlyReads) return { allow: false, reason: 'monthly_read_cap' };
	return { allow: true };
}

/**
 * When X's own headers say to stop. PURE.
 * Honors the endpoint window (x-rate-limit-remaining = 0 until x-rate-limit-reset)
 * and the app's 24 hour window (x-app-limit-24hour-remaining = 0 until
 * x-app-limit-24hour-reset). A 429 with no usable reset backs off `fallbackSeconds`.
 * @returns {{ until: string, reason: string } | null}
 */
export function backoffFromHeaders({ headers, status = 200, now = Date.now(), fallbackSeconds = 900 } = {}) {
	const h = plainHeaders(headers);
	const num = (k) => {
		const n = Number(h[k]);
		return h[k] != null && h[k] !== '' && Number.isFinite(n) ? n : null;
	};
	const candidates = [];
	const rl = readRateLimit(h);
	if (rl.remaining === 0 && rl.resetAt && Date.parse(rl.resetAt) > now) candidates.push({ until: Date.parse(rl.resetAt), reason: 'endpoint_window' });
	const appRemaining = num('x-app-limit-24hour-remaining');
	const appReset = num('x-app-limit-24hour-reset');
	if (appRemaining === 0 && appReset != null && appReset * 1000 > now) candidates.push({ until: appReset * 1000, reason: 'app_24h_window' });
	if (status === 429 && !candidates.length) candidates.push({ until: now + fallbackSeconds * 1000, reason: 'http_429' });
	if (!candidates.length) return null;
	const latest = candidates.reduce((a, b) => (b.until > a.until ? b : a));
	return { until: new Date(latest.until).toISOString(), reason: latest.reason };
}

/** Persist a backoff, only ever extending an existing one. */
export async function setBackoff({ until, reason }, { now = Date.now() } = {}) {
	const value = JSON.stringify({ until, reason });
	await sql`
		insert into app_settings (key, value) values (${BACKOFF_KEY}, ${value}::jsonb)
		on conflict (key) do update
			set value = excluded.value, updated_at = now()
			where coalesce((app_settings.value->>'until')::timestamptz, to_timestamp(0)) < ${new Date(now).toISOString()}::timestamptz
			   or (app_settings.value->>'until')::timestamptz < (excluded.value->>'until')::timestamptz
	`;
}

/** Read X's response headers and back off when they say the window is spent. Returns the backoff set, or null. */
export async function noteResponse({ headers, status = 200, now = Date.now() } = {}) {
	const backoff = backoffFromHeaders({ headers, status, now });
	if (backoff) await setBackoff(backoff, { now });
	return backoff;
}
