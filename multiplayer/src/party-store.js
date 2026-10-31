// Party store: server-side state for /play parties (docs/play-parties.md).
//
// Same shape as social-hub.js: Upstash Redis in production (so a party spans
// realm-room processes and survives a deploy), an in-memory TTL map locally.
// Members are keyed by a stable identity, not a sessionId: `u:<accountUid>` for
// signed-in players, `p:<playerKey>` for guests and wallet-only players. That
// is what lets a party survive a reconnect and a cross-world handoff.
//
// Keys
//   party:<pid>      {id, leader, members:[{key,name,username}], pending:[{key,name,from,ts}], v, touched}
//   partyof:<key>    pid. Set NX, so a member can only ever be in one party.
//   partyinv:<key>   [{pid, from, fromName, ts}] pending invites addressed to a player
//   partyloc:<key>   {coin,tier,name,symbol,image,roomId,ts}. A member's heartbeat
//                    (TTL = presence TTL). When it lapses the member is a ghost
//                    and `prune` drops them, so a crashed session never pins a party.
//   partychat:<pid>  last CHAT_KEEP party chat lines, for cross-process relay
//   partylock:<pid>  short NX lock around read-modify-write of one party

export const PARTY_CAP = 8;
export const INVITE_TTL_SEC = 120;
export const LOC_TTL_SEC = 75; // equals presence TTL in social-hub.js
export const LOC_GRACE_SEC = 45; // kept after the last socket closes, so a handoff keeps the party
export const PARTY_TTL_SEC = 1800;
export const TOUCH_EVERY_MS = 300_000;
const CHAT_KEEP = 30;
const LOCK_TTL_SEC = 5;

const parse = (v) => {
	if (v == null) return null;
	if (typeof v === 'string') {
		try { return JSON.parse(v); } catch { return v; }
	}
	return v;
};

/** In-memory KV with TTLs and an injectable clock. Mirrors the Redis subset used here. */
export class MemoryKV {
	constructor(now = Date.now) {
		this.now = now;
		this.m = new Map();
		this.kind = 'memory';
	}
	_live(key) {
		const e = this.m.get(key);
		if (!e) return null;
		if (e.exp && e.exp <= this.now()) { this.m.delete(key); return null; }
		return e;
	}
	async get(key) { return this._live(key)?.v ?? null; }
	async mget(keys) { return keys.map((k) => this._live(k)?.v ?? null); }
	async set(key, value, { ex, nx } = {}) {
		if (nx && this._live(key)) return false;
		this.m.set(key, { v: value, exp: ex ? this.now() + ex * 1000 : 0 });
		return true;
	}
	async del(key) { this.m.delete(key); }
}

/** Upstash adapter. `redis` is an @upstash/redis client (or any object with the same calls). */
export class RedisKV {
	constructor(redisOrPromise) {
		this.ready = Promise.resolve(redisOrPromise);
		this.kind = 'redis';
	}
	async get(key) { return (await this.ready).get(key); }
	async mget(keys) {
		if (!keys.length) return [];
		return (await this.ready).mget(...keys);
	}
	async set(key, value, { ex, nx } = {}) {
		const opts = {};
		if (ex) opts.ex = ex;
		if (nx) opts.nx = true;
		const r = await (await this.ready).set(key, value, opts);
		return r === 'OK' || r === true;
	}
	async del(key) { await (await this.ready).del(key); }
}

/** Upstash when the env carries credentials (same names as social-hub), memory otherwise. */
export function createKv(env = process.env) {
	const url = env.UPSTASH_REDIS_REST_URL || env.three_KV_REST_API_URL || env.KV_REST_API_URL || '';
	const token = env.UPSTASH_REDIS_REST_TOKEN || env.three_KV_REST_API_TOKEN || env.KV_REST_API_TOKEN || '';
	if (url && token) {
		const ready = import('@upstash/redis').then(({ Redis }) => new Redis({ url, token }));
		console.log('[party-store] Upstash Redis');
		return new RedisKV(ready);
	}
	console.log('[party-store] in-memory (set UPSTASH_REDIS_REST_URL/_TOKEN to share parties across processes)');
	return new MemoryKV();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

/**
 * Pure: drop members whose heartbeat lapsed and invites past their TTL, hand
 * leadership to the longest-standing survivor, and report whether the party
 * should be deleted (empty, or a lone leader with nobody left to wait for).
 */
export function prune(party, aliveKeys, nowMs) {
	const members = party.members.filter((m) => aliveKeys.has(m.key));
	const pending = party.pending.filter((p) => nowMs - p.ts < INVITE_TTL_SEC * 1000);
	const changed = members.length !== party.members.length || pending.length !== party.pending.length;
	const out = { ...party, members, pending };
	if (members.length && !members.some((m) => m.key === out.leader)) {
		out.leader = members[0].key;
	}
	const dead = members.length === 0 || (members.length === 1 && pending.length === 0);
	if (changed) out.v = (party.v || 0) + 1;
	return { party: out, changed, dead, removed: party.members.filter((m) => !aliveKeys.has(m.key)).map((m) => m.key) };
}

export class PartyStore {
	constructor({ kv = new MemoryKV(), now = Date.now, cap = PARTY_CAP } = {}) {
		this.kv = kv;
		this.now = now;
		this.cap = cap;
	}

	// ---- location heartbeat -------------------------------------------------
	async setLoc(key, loc, ttl = LOC_TTL_SEC) {
		await this.kv.set('partyloc:' + key, JSON.stringify({ ...loc, ts: this.now() }), { ex: ttl });
	}
	async getLoc(key) { return parse(await this.kv.get('partyloc:' + key)); }
	async getLocs(keys) {
		const rows = await this.kv.mget(keys.map((k) => 'partyloc:' + k));
		const out = new Map();
		rows.forEach((r, i) => { const p = parse(r); if (p) out.set(keys[i], p); });
		return out;
	}

	// ---- reads --------------------------------------------------------------
	async partyIdOf(key) {
		const v = await this.kv.get('partyof:' + key);
		return v == null ? null : String(v);
	}
	async invitesFor(key) {
		const list = parse(await this.kv.get('partyinv:' + key)) || [];
		const t = this.now();
		return list.filter((i) => t - i.ts < INVITE_TTL_SEC * 1000);
	}

	/** Loads a party and prunes ghosts in the same pass; persists the pruned form. */
	async load(pid, { touch = false, allowSolo = false } = {}) {
		const raw = parse(await this.kv.get('party:' + pid));
		if (!raw || !raw.members) return null;
		const locs = await this.getLocs(raw.members.map((m) => m.key));
		const res = prune(raw, new Set(locs.keys()), this.now());
		const solo = allowSolo && res.party.members.length === 1;
		if (res.dead && !solo) {
			await this._delete(res.party, raw.members.map((m) => m.key));
			return null;
		}
		if (res.changed) {
			for (const k of res.removed) await this._unlink(k, pid);
			await this._save(res.party);
		} else if (touch && this.now() - (raw.touched || 0) > TOUCH_EVERY_MS) {
			await this._save(raw);
		}
		return res.party;
	}
	async partyOf(key) {
		const pid = await this.partyIdOf(key);
		if (!pid) return null;
		const p = await this.load(pid);
		if (!p || !p.members.some((m) => m.key === key)) {
			if (!p) await this._unlink(key, pid);
			return null;
		}
		return p;
	}

	// ---- mutations ----------------------------------------------------------
	async invite(from, to) {
		if (from.key === to.key) return { ok: false, reason: 'self' };
		const toPid = await this.partyIdOf(to.key);
		let pid = await this.partyIdOf(from.key);
		let created = false;
		if (pid && !(await this.load(pid))) pid = null;
		if (toPid) {
			if (toPid === pid) return { ok: false, reason: 'already_member' };
			const theirs = await this.load(toPid);
			if (theirs && theirs.members.length > 1) return { ok: false, reason: 'already_partied' };
		}
		if (!pid) {
			pid = newId();
			if (!(await this.kv.set('partyof:' + from.key, pid, { ex: PARTY_TTL_SEC, nx: true }))) {
				const existing = await this.partyIdOf(from.key);
				if (!existing) return { ok: false, reason: 'busy' };
				pid = existing;
			} else {
				created = true;
				await this._save({
					id: pid, leader: from.key, v: 1, touched: this.now(), pending: [],
					members: [{ key: from.key, name: from.name, username: from.username || '' }],
				});
			}
		}
		const res = await this._locked(pid, async () => {
			const party = await this.load(pid, { allowSolo: true });
			if (!party) return { ok: false, reason: 'gone' };
			if (!party.members.some((m) => m.key === from.key)) return { ok: false, reason: 'not_member' };
			if (party.members.some((m) => m.key === to.key)) return { ok: false, reason: 'already_member' };
			if (party.pending.some((p) => p.key === to.key)) return { ok: false, reason: 'already_invited' };
			if (party.members.length + party.pending.length >= this.cap) return { ok: false, reason: 'full' };
			party.pending.push({ key: to.key, name: to.name, from: from.key, ts: this.now() });
			party.v += 1;
			await this._save(party);
			const invs = await this.invitesFor(to.key);
			invs.push({ pid, from: from.key, fromName: from.name, ts: this.now() });
			await this.kv.set('partyinv:' + to.key, JSON.stringify(invs), { ex: INVITE_TTL_SEC });
			return { ok: true, party };
		});
		if (!res.ok && created) await this.leave(from.key);
		return res;
	}

	async accept(me, pid) {
		const invs = await this.invitesFor(me.key);
		if (!invs.some((i) => i.pid === pid)) return { ok: false, reason: 'no_invite' };
		const current = await this.partyIdOf(me.key);
		if (current && current !== pid) {
			const cp = await this.load(current);
			if (cp && cp.members.length > 1) return { ok: false, reason: 'already_partied' };
			await this.leave(me.key);
		}
		const res = await this._locked(pid, async () => {
			const party = await this.load(pid);
			if (!party) return { ok: false, reason: 'gone' };
			if (party.members.some((m) => m.key === me.key)) return { ok: true, party };
			if (party.members.length >= this.cap) return { ok: false, reason: 'full' };
			if (!(await this.kv.set('partyof:' + me.key, pid, { ex: PARTY_TTL_SEC, nx: true }))) {
				if ((await this.partyIdOf(me.key)) !== pid) return { ok: false, reason: 'already_partied' };
			}
			party.pending = party.pending.filter((p) => p.key !== me.key);
			party.members.push({ key: me.key, name: me.name, username: me.username || '' });
			party.v += 1;
			await this._save(party);
			return { ok: true, party };
		});
		await this._dropInvite(me.key, pid);
		return res;
	}

	async decline(me, pid) {
		const invs = await this.invitesFor(me.key);
		if (!invs.some((i) => i.pid === pid)) return { ok: false, reason: 'no_invite' };
		await this._dropInvite(me.key, pid);
		const res = await this._locked(pid, async () => {
			const party = await this.load(pid);
			if (!party) return { ok: true, party: null };
			party.pending = party.pending.filter((p) => p.key !== me.key);
			party.v += 1;
			if (party.members.length === 1 && party.pending.length === 0) {
				await this._delete(party, [party.members[0].key]);
				return { ok: true, party: null, dissolved: true, members: party.members.map((m) => m.key) };
			}
			await this._save(party);
			return { ok: true, party };
		});
		return res;
	}

	async leave(key) {
		const pid = await this.partyIdOf(key);
		if (!pid) return { ok: false, reason: 'not_in_party' };
		return this._locked(pid, async () => {
			const raw = parse(await this.kv.get('party:' + pid));
			await this._unlink(key, pid);
			if (!raw) return { ok: true, party: null, dissolved: true, members: [] };
			const was = raw.members.map((m) => m.key);
			const party = { ...raw, members: raw.members.filter((m) => m.key !== key) };
			if (party.leader === key && party.members.length) party.leader = party.members[0].key;
			party.v = (raw.v || 0) + 1;
			if (party.members.length === 0 || (party.members.length === 1 && party.pending.length === 0)) {
				await this._delete(party, party.members.map((m) => m.key));
				return { ok: true, party: null, dissolved: true, members: was.filter((k) => k !== key), left: key };
			}
			await this._save(party);
			return { ok: true, party, left: key };
		});
	}

	// ---- party chat relay ---------------------------------------------------
	async chatPost(pid, from, text) {
		return this._locked(pid, async () => {
			const log = parse(await this.kv.get('partychat:' + pid)) || [];
			const n = (log.length ? log[log.length - 1].n : 0) + 1;
			const line = { n, key: from.key, name: from.name, text, ts: this.now() };
			log.push(line);
			await this.kv.set('partychat:' + pid, JSON.stringify(log.slice(-CHAT_KEEP)), { ex: PARTY_TTL_SEC });
			return line;
		});
	}
	async chatSince(pid, n) {
		const log = parse(await this.kv.get('partychat:' + pid)) || [];
		return log.filter((l) => l.n > n);
	}

	// ---- internals ----------------------------------------------------------
	async _save(party) {
		party.touched = this.now();
		await this.kv.set('party:' + party.id, JSON.stringify(party), { ex: PARTY_TTL_SEC });
		// Keep every member's membership pointer as fresh as the party itself.
		for (const m of party.members) {
			await this.kv.set('partyof:' + m.key, party.id, { ex: PARTY_TTL_SEC });
		}
	}
	async _unlink(key, pid) {
		if ((await this.partyIdOf(key)) === pid) await this.kv.del('partyof:' + key);
	}
	async _delete(party, memberKeys) {
		await this.kv.del('party:' + party.id);
		await this.kv.del('partychat:' + party.id);
		for (const k of memberKeys) await this._unlink(k, party.id);
	}
	async _dropInvite(key, pid) {
		const invs = (await this.invitesFor(key)).filter((i) => i.pid !== pid);
		if (invs.length) await this.kv.set('partyinv:' + key, JSON.stringify(invs), { ex: INVITE_TTL_SEC });
		else await this.kv.del('partyinv:' + key);
	}
	async _locked(pid, fn) {
		const lock = 'partylock:' + pid;
		for (let i = 0; i < 25; i++) {
			if (await this.kv.set(lock, '1', { ex: LOCK_TTL_SEC, nx: true })) {
				try { return await fn(); } finally { await this.kv.del(lock); }
			}
			await sleep(20);
		}
		return { ok: false, reason: 'busy' };
	}
}
