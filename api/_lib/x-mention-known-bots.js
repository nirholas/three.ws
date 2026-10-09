// The known-bot list: other automated accounts the mention bot must never
// answer on its own. The usernames below are the source of truth; ids are
// resolved from them through X (GET /2/users/by) and cached in app_settings
// (x_mention_known_bots), refreshed once a day. A username that cannot be
// resolved (tier, rate window, auth) is recorded as unresolved and still
// matched by username, so the list works before any lookup succeeds.
//
// Add accounts without a deploy: env X_MENTION_KNOWN_BOTS (comma separated
// usernames), or add them to the constant below.

import { sql } from './db.js';
import { lookupUsersByUsername } from './x-mentions.js';

export const KNOWN_BOTS_KEY = 'x_mention_known_bots';
export const REFRESH_SECONDS = 24 * 3600;
/** @grok is xAI's assistant; @bot is Grok Bot. Order 056 handles both specially. */
export const KNOWN_BOT_USERNAMES = Object.freeze(['grok', 'bot']);

async function readSetting(key) {
	const [row] = await sql`select value from app_settings where key = ${key}`;
	return row?.value ?? null;
}

/** The username list: the constant plus env additions, lower-cased and unique. */
export function knownBotUsernames(env = process.env) {
	const extra = String(env.X_MENTION_KNOWN_BOTS || '').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
	return [...new Set([...KNOWN_BOT_USERNAMES, ...extra].map((n) => n.toLowerCase()))];
}

/** A matcher over the cached ids and the username list. */
export function buildMatcher({ usernames, ids = {} }) {
	const names = new Set(usernames.map((n) => n.toLowerCase()));
	const idSet = new Set(Object.keys(ids));
	return {
		isKnownBot: (author) => (author?.id && idSet.has(String(author.id))) || (!!author?.username && names.has(String(author.username).toLowerCase())),
		ids: idSet,
		usernames: names,
	};
}

/** Read the cached list (no network). */
export async function loadKnownBots({ env = process.env, read = readSetting } = {}) {
	let cached = null;
	try {
		cached = await read(KNOWN_BOTS_KEY);
	} catch {
		cached = null;
	}
	return buildMatcher({ usernames: knownBotUsernames(env), ids: cached?.ids || {} });
}

/**
 * Refresh the cache when it is older than a day or the username list changed.
 * Never throws: a failed lookup keeps the stale ids and is recorded.
 *
 * @param {{ env?: object, request: Function, now?: number, read?: Function, write?: Function }} o
 * @returns {Promise<{ refreshed: boolean, resolved: number, unresolved: string[], error?: string }>}
 */
export async function ensureKnownBots({ env = process.env, request, now = Date.now(), read = readSetting, write = null }) {
	const usernames = knownBotUsernames(env);
	let cached = null;
	try {
		cached = await read(KNOWN_BOTS_KEY);
	} catch {
		cached = null;
	}
	const age = cached?.refreshed_at ? (now - Date.parse(cached.refreshed_at)) / 1000 : Infinity;
	const sameList = JSON.stringify(cached?.usernames || []) === JSON.stringify(usernames);
	if (cached && sameList && age < REFRESH_SECONDS) {
		return { refreshed: false, resolved: Object.keys(cached.ids || {}).length, unresolved: cached.unresolved || [] };
	}
	const save = write || (async (value) => {
		await sql`
			insert into app_settings (key, value) values (${KNOWN_BOTS_KEY}, ${JSON.stringify(value)}::jsonb)
			on conflict (key) do update set value = excluded.value, updated_at = now()
		`;
	});
	try {
		const users = await lookupUsersByUsername({ usernames, request });
		const ids = {};
		for (const u of users) ids[u.id] = u.username;
		const found = new Set(users.map((u) => u.username.toLowerCase()));
		const unresolved = usernames.filter((n) => !found.has(n));
		await save({ usernames, ids, unresolved, refreshed_at: new Date(now).toISOString() });
		return { refreshed: true, resolved: users.length, unresolved };
	} catch (err) {
		const error = String(err?.code || err?.message || err).slice(0, 120);
		// Keep whatever ids we had; stamp the attempt so a refused lookup is retried
		// tomorrow rather than on every two-minute tick.
		try {
			await save({ usernames, ids: cached?.ids || {}, unresolved: usernames.filter((n) => !Object.values(cached?.ids || {}).map((v) => String(v).toLowerCase()).includes(n)), refreshed_at: new Date(now).toISOString(), last_error: error });
		} catch {
			return { refreshed: false, resolved: Object.keys(cached?.ids || {}).length, unresolved: usernames, error };
		}
		return { refreshed: false, resolved: Object.keys(cached?.ids || {}).length, unresolved: usernames, error };
	}
}
