// Daily free-tier allowance for the free open models.
//
// A model the roster marks `free` (api/_lib/model-roster.js) costs the caller
// nothing per message, but every message on it draws one unit from a daily
// allowance. The allowance lives in app_settings['free_tier'] so it can be
// changed without a deploy:
//
//   { "daily_messages": 100, "anon_daily_messages": 20 }
//
// A signed-in account is metered by user id, an anonymous caller by a hash of
// its IP. Every day resets at 00:00 UTC. When the allowance is spent, consume
// throws FreeTierExhaustedError carrying the reset time; every surface turns
// that into the same 429 `free_tier_exhausted` body (freeTierErrorBody) so a
// client parses one shape wherever it sends a message.
//
// Paid models never touch this module: they are gated to signed-in callers and
// metered in llm-pricing.js.

import { createHash } from 'node:crypto';
import { sql } from './db.js';
import { isFreeTierModel } from './chat-models.js';

export const FREE_TIER_SETTINGS_KEY = 'free_tier';

// Used only when the settings row is missing (a database the migration has
// not reached). The migration seeds the same numbers.
export const DEFAULT_FREE_TIER = Object.freeze({ daily_messages: 100, anon_daily_messages: 20 });

const SETTINGS_TTL_MS = 60_000;
const RETENTION_DAYS = 90;
let settingsCache = { value: null, at: 0 };
let lastPruneDay = null;

/** A free-tier allowance that is spent for today. */
export class FreeTierExhaustedError extends Error {
	/** @param {{ limit: number, used: number, resetAt: string, model: string|null }} info */
	constructor(info) {
		super(
			`You have used all ${info.limit} free messages for today. The allowance resets at ${info.resetAt}. ` +
				'Sign in for a larger allowance, or pick a paid model to keep going.',
		);
		this.name = 'FreeTierExhaustedError';
		this.status = 429;
		this.code = 'free_tier_exhausted';
		this.limit = info.limit;
		this.used = info.used;
		this.resetAt = info.resetAt;
		this.model = info.model;
	}
}

function cleanCount(v, fallback) {
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Normalize a stored settings value into { daily_messages, anon_daily_messages }. */
export function normalizeFreeTierSettings(value) {
	const v = value && typeof value === 'object' ? value : {};
	return {
		daily_messages: cleanCount(v.daily_messages, DEFAULT_FREE_TIER.daily_messages),
		anon_daily_messages: cleanCount(v.anon_daily_messages, DEFAULT_FREE_TIER.anon_daily_messages),
	};
}

/** The live allowance, read from app_settings and cached for a minute. */
export async function getFreeTierSettings() {
	if (settingsCache.value && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
	const [row] = await sql`SELECT value FROM app_settings WHERE key = ${FREE_TIER_SETTINGS_KEY}`;
	const value = normalizeFreeTierSettings(row?.value);
	settingsCache = { value, at: Date.now() };
	return value;
}

/** Test seam: forget the cached settings. */
export function resetFreeTierSettingsCache() {
	settingsCache = { value: null, at: 0 };
}

/** The UTC calendar day `now` falls in, as YYYY-MM-DD. */
export function utcDay(now = new Date()) {
	return now.toISOString().slice(0, 10);
}

/** The instant the current UTC day ends, as an ISO string. */
export function nextResetAt(now = new Date()) {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
	return d.toISOString();
}

/**
 * The metering subject for a caller: the account when signed in, otherwise a
 * truncated SHA-256 of the IP (the raw address is never stored).
 * @param {{ userId?: string|null, ip?: string|null }} who
 */
export function freeTierSubject({ userId = null, ip = null } = {}) {
	if (userId) return { subject: `user:${userId}`, anonymous: false };
	const hash = createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 32);
	return { subject: `ip:${hash}`, anonymous: true };
}

function limitFor(settings, anonymous) {
	return anonymous ? settings.anon_daily_messages : settings.daily_messages;
}

/**
 * Today's allowance for a caller without consuming anything.
 * @param {{ userId?: string|null, ip?: string|null }} who
 */
export async function getFreeTierStatus(who) {
	const settings = await getFreeTierSettings();
	const { subject, anonymous } = freeTierSubject(who);
	const day = utcDay();
	const [row] = await sql`SELECT used FROM free_tier_usage WHERE subject = ${subject} AND day = ${day}`;
	const limit = limitFor(settings, anonymous);
	const used = Math.min(Number(row?.used || 0), limit);
	return {
		limit,
		used,
		remaining: Math.max(0, limit - used),
		resetAt: nextResetAt(),
		anonymous,
		signedInLimit: settings.daily_messages,
	};
}

/**
 * Draw one message from the caller's allowance. Atomic: the increment only
 * lands while `used` is under the limit, so concurrent requests can never
 * overshoot it. Throws FreeTierExhaustedError when nothing is left.
 * @param {{ userId?: string|null, ip?: string|null, model?: string|null }} who
 * @returns {Promise<{ limit: number, used: number, remaining: number, resetAt: string }>}
 */
export async function consumeFreeMessage({ userId = null, ip = null, model = null } = {}) {
	const settings = await getFreeTierSettings();
	const { subject, anonymous } = freeTierSubject({ userId, ip });
	const limit = limitFor(settings, anonymous);
	const day = utcDay();
	const resetAt = nextResetAt();
	if (limit <= 0) throw new FreeTierExhaustedError({ limit, used: 0, resetAt, model });

	const rows = await sql`
		INSERT INTO free_tier_usage (subject, day, used)
		VALUES (${subject}, ${day}, 1)
		ON CONFLICT (subject, day) DO UPDATE
		   SET used = free_tier_usage.used + 1, updated_at = now()
		 WHERE free_tier_usage.used < ${limit}
		RETURNING used
	`;
	if (!rows.length) throw new FreeTierExhaustedError({ limit, used: limit, resetAt, model });
	pruneOldUsage(day);
	const used = Number(rows[0].used);
	return { limit, used, remaining: Math.max(0, limit - used), resetAt };
}

// Retention runs at most once per instance per day and never blocks the
// request that triggered it.
function pruneOldUsage(day) {
	if (lastPruneDay === day) return;
	lastPruneDay = day;
	sql`DELETE FROM free_tier_usage WHERE day < (now() AT TIME ZONE 'utc')::date - ${RETENTION_DAYS}::int`.catch((err) =>
		console.warn(`[free-tier] prune failed: ${err?.message || err}`),
	);
}

/**
 * Consume an allowance unit only when the model is a free-tier model. Paid and
 * unknown models pass through untouched (null).
 * @param {string|null|undefined} model
 * @param {{ userId?: string|null, ip?: string|null }} who
 */
export async function meterFreeModel(model, who) {
	if (!model || !isFreeTierModel(model)) return null;
	return consumeFreeMessage({ ...who, model });
}

/** The one JSON body every surface answers an exhausted allowance with. */
export function freeTierErrorBody(err) {
	return {
		error: 'free_tier_exhausted',
		error_description: err.message,
		message: err.message,
		limit: err.limit,
		used: err.used,
		reset_at: err.resetAt,
		model: err.model || null,
	};
}

/** Seconds until the allowance resets, for a Retry-After header. */
export function retryAfterSeconds(resetAt) {
	return Math.max(1, Math.ceil((Date.parse(resetAt) - Date.now()) / 1000));
}
