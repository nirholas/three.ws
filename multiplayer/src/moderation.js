// Moderation store for the /play worlds: mutes and bans keyed by stable identity.
//
// A player has up to three identities, and a record matches on ANY of them so a
// moderator cannot be dodged by reconnecting with a different one:
//   acct:<wallet>      the wallet verified in onAuth / a signed play pass
//   uid:<account uid>  the three.ws account from a signed presence ticket
//   pk:<playerKey>     the economy persistence key (wallet, or the id sealed in
//                      an HMAC guest token for an anonymous guest)
//
// Mutes live in memory with an expiry (they are minutes long and a restart
// clearing them is acceptable). Bans are written through to Upstash Redis when
// UPSTASH_REDIS_REST_URL/_TOKEN are set (the same store block-store.js uses) so
// they survive a restart and a redeploy; without it they are memory-only and the
// startup log says so.

export const KICK_CLOSE_CODE = 4403;
export const AUTO_MUTE_REPORTERS = 3;
export const AUTO_MUTE_MINUTES = 10;
export const REPORT_WINDOW_MS = 5 * 60_000;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const BAN_KEY = 'playmod:bans';
const MAX_RECORDS = 5000;

/** Stable identity keys for a joined client's userData (or a join-time lookup). */
export function identityKeys({ account, accountUid, playerKey } = {}) {
	const keys = [];
	if (account) keys.push(`acct:${account}`);
	if (accountUid) keys.push(`uid:${accountUid}`);
	if (playerKey) keys.push(`pk:${playerKey}`);
	return keys;
}

export class ModerationStore {
	/**
	 * @param {{ now?: () => number, persist?: { save: (bans: object[]) => Promise<void> } | null }} [opts]
	 */
	constructor({ now = Date.now, persist = null } = {}) {
		this._now = now;
		this._persist = persist;
		this._records = [];
	}

	_add(kind, keys, { minutes, reason, by }) {
		const clean = [...new Set((keys || []).filter(Boolean))];
		if (clean.length === 0) return null;
		this.remove(kind, clean);
		const at = this._now();
		const record = {
			kind,
			keys: clean,
			at,
			until: Number(minutes) > 0 ? at + Number(minutes) * 60_000 : null,
			reason: String(reason || '').slice(0, 200),
			by: String(by || 'operator').slice(0, 60),
		};
		if (this._records.length >= MAX_RECORDS) this._records.shift();
		this._records.push(record);
		if (kind === 'ban') this._save();
		return record;
	}

	mute(keys, opts = {}) {
		// A mute always ends: an unbounded one would be a ban by another name.
		return this._add('mute', keys, { ...opts, minutes: Number(opts.minutes) > 0 ? opts.minutes : 15 });
	}

	/** `minutes` omitted means permanent. */
	ban(keys, opts = {}) {
		return this._add('ban', keys, opts);
	}

	remove(kind, keys) {
		const wanted = new Set(keys || []);
		const before = this._records.length;
		this._records = this._records.filter((r) => r.kind !== kind || !r.keys.some((k) => wanted.has(k)));
		const changed = this._records.length !== before;
		if (changed && kind === 'ban') this._save();
		return changed;
	}

	unmute(keys) { return this.remove('mute', keys); }
	unban(keys) { return this.remove('ban', keys); }

	/** The live record of `kind` matching any of `keys`, or null. */
	active(keys, kind) {
		this.sweep();
		const wanted = new Set(keys || []);
		if (wanted.size === 0) return null;
		return this._records.find((r) => r.kind === kind && r.keys.some((k) => wanted.has(k))) || null;
	}

	sweep() {
		const t = this._now();
		const expired = this._records.filter((r) => r.until !== null && r.until <= t);
		if (expired.length === 0) return;
		this._records = this._records.filter((r) => r.until === null || r.until > t);
		if (expired.some((r) => r.kind === 'ban')) this._save();
	}

	list() {
		this.sweep();
		return this._records.map((r) => ({ ...r, keys: [...r.keys] }));
	}

	/** Load persisted bans (called once at startup). */
	load(bans) {
		const t = this._now();
		for (const b of Array.isArray(bans) ? bans : []) {
			if (b && b.kind === 'ban' && Array.isArray(b.keys) && (b.until === null || b.until > t)) {
				this._records.push({ kind: 'ban', keys: b.keys.map(String), at: Number(b.at) || t, until: b.until === null ? null : Number(b.until), reason: String(b.reason || ''), by: String(b.by || 'operator') });
			}
		}
	}

	_save() {
		if (!this._persist) return;
		const bans = this._records.filter((r) => r.kind === 'ban');
		this._persist.save(bans).catch((err) => {
			console.warn('[moderation] could not persist bans:', err?.message || err);
		});
	}
}

/**
 * Apply one moderation action to the store for a set of identity keys.
 * `kick` has no store effect (it only closes a socket).
 */
export function applyToStore(store, action, keys, { minutes, reason, by } = {}) {
	if (!keys || keys.length === 0) return false;
	if (action === 'mute') return !!store.mute(keys, { minutes, reason, by });
	if (action === 'ban') return !!store.ban(keys, { minutes, reason, by });
	if (action === 'unmute') return store.unmute(keys);
	if (action === 'unban') return store.unban(keys);
	return false;
}

async function upstash(command) {
	const res = await fetch(REDIS_URL, {
		method: 'POST',
		headers: { authorization: `Bearer ${REDIS_TOKEN}`, 'content-type': 'application/json' },
		body: JSON.stringify(command),
		signal: AbortSignal.timeout(5000),
	});
	if (!res.ok) throw new Error(`upstash HTTP ${res.status}`);
	const json = await res.json();
	if (json.error) throw new Error(json.error);
	return json.result;
}

function buildSingleton() {
	if (!REDIS_URL || !REDIS_TOKEN) {
		console.log('[moderation] bans are memory-only (set UPSTASH_REDIS_REST_URL/_TOKEN so they survive a restart)');
		return new ModerationStore();
	}
	const store = new ModerationStore({
		persist: { save: (bans) => upstash(['SET', BAN_KEY, JSON.stringify(bans)]).then(() => {}) },
	});
	upstash(['GET', BAN_KEY])
		.then((raw) => {
			store.load(typeof raw === 'string' ? JSON.parse(raw) : raw);
			console.log(`[moderation] bans persisted in Upstash Redis (${store.list().filter((r) => r.kind === 'ban').length} active)`);
		})
		.catch((err) => console.error('[moderation] could not load persisted bans:', err?.message || err));
	return store;
}

/** The process-wide store every walk_world room shares. */
export const moderation = buildSingleton();
