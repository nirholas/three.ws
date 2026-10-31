// Party service: the live half of /play parties (docs/play-parties.md).
//
// party-store.js owns the durable state (Redis or memory). This module owns the
// sockets: which local clients belong to which party member, what each of them
// is told, the go-to teleport, and the party chat relay. WalkRoom only delegates
// three things here: attach on join, detach on leave, and the single `party`
// message. Everything is off-schema, so older clients are unaffected.
//
// Cost model: nothing here runs per player per tick. A 5s sweep makes two MGETs
// for every local account (membership + invites) and a get+mget per distinct
// party that has a local member; clients are pushed to only when their view
// changed. Same-process mutations fan out immediately.

import { PartyStore, createKv, PARTY_CAP, LOC_GRACE_SEC } from './party-store.js';
import { containsHateSlur } from './display-name-safety.js';

const SWEEP_MS = 5000;
const LOC_REFRESH_MS = 25_000;
export const GOTO_COOLDOWN_MS = 20_000;
const CHAT_COOLDOWN_MS = 700;
const CHAT_MAX = 200;
const GOTO_RINGS_M = [1.8, 2.6];
const GOTO_ANGLES = 8;
const DEFAULT_BOUND_M = 198;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function memberKeyFor(client) {
	const ud = client?.userData || {};
	if (ud.accountUid) return 'u:' + ud.accountUid;
	if (ud.playerKey) return 'p:' + ud.playerKey;
	return null;
}

/**
 * Pure: pick a free ground spot on a ring around `target`, trying the cell behind
 * them first. `blocked(x, z)` and `occupied(x, z)` come from the room.
 */
export function pickArrival(target, { bound = DEFAULT_BOUND_M, blocked = () => false, occupied = () => false } = {}) {
	const base = (target.yaw || 0) + Math.PI;
	for (const r of GOTO_RINGS_M) {
		for (let i = 0; i < GOTO_ANGLES; i++) {
			const a = base + (i * Math.PI * 2) / GOTO_ANGLES;
			const x = target.x + Math.sin(a) * r;
			const z = target.z + Math.cos(a) * r;
			if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
			if (blocked(x, z) || occupied(x, z)) continue;
			// Face the target on arrival.
			return { x, y: target.y, z, yaw: Math.atan2(target.x - x, target.z - z) };
		}
	}
	return null;
}

export class PartyService {
	constructor({ store, now = Date.now, startSweep = true } = {}) {
		this.store = store || new PartyStore({ kv: createKv(), now });
		this.now = now;
		this.entries = new Map(); // client -> entry
		this.byKey = new Map(); // memberKey -> Set(entry)
		this.pidOf = new Map(); // memberKey -> pid (null when none), last known
		this.delivered = new Map(); // pid -> Set(chat n)
		this.gotoAt = new Map(); // memberKey -> ts
		this.chatAt = new Map(); // memberKey -> ts
		this._locAt = 0;
		this._timer = null;
		if (startSweep) {
			this._timer = setInterval(() => this.sweep().catch((e) => console.warn('[party] sweep failed:', e?.message)), SWEEP_MS);
			if (typeof this._timer.unref === 'function') this._timer.unref();
		}
	}

	// ---- lifecycle ----------------------------------------------------------
	attach(client, room, boundM = DEFAULT_BOUND_M) {
		const key = memberKeyFor(client);
		if (!key || this.entries.has(client)) return;
		const entry = { client, room, key, last: '', boundM };
		this.entries.set(client, entry);
		let set = this.byKey.get(key);
		if (!set) this.byKey.set(key, (set = new Set()));
		set.add(entry);
		// A returning member (reconnect or world hop inside the grace window) is
		// re-stamped alive so the party never saw them leave.
		this._push(key)
			.then(() => {
				const pid = this.pidOf.get(key);
				if (!pid) return null;
				return this.store.setLoc(key, this._loc(entry)).then(() => this._pushParty(pid));
			})
			.catch(() => {});
	}

	detach(client) {
		const entry = this.entries.get(client);
		if (!entry) return;
		this.entries.delete(client);
		const set = this.byKey.get(entry.key);
		set?.delete(entry);
		if (set && set.size) return;
		this.byKey.delete(entry.key);
		const pid = this.pidOf.get(entry.key);
		this.pidOf.delete(entry.key);
		this.gotoAt.delete(entry.key);
		this.chatAt.delete(entry.key);
		if (!pid) return;
		// Keep the member for a short grace window: a world hop or a reconnect
		// re-attaches within it and the party never notices. A real exit lapses.
		this.store.setLoc(entry.key, { ...this._loc(entry), away: true }, LOC_GRACE_SEC)
			.then(() => this._pushParty(pid))
			.catch(() => {});
	}

	// ---- message entry point ------------------------------------------------
	async handle(room, client, payload) {
		const entry = this.entries.get(client);
		if (!entry || !payload || typeof payload !== 'object') return;
		if (typeof room._actionOk === 'function' && !room._actionOk(client.sessionId, 'party')) return;
		try {
			switch (payload.op) {
				case 'state': return await this._push(entry.key, true);
				case 'invite': return await this._invite(entry, payload);
				case 'accept': return await this._accept(entry, payload);
				case 'decline': return await this._decline(entry, payload);
				case 'leave': return await this._leave(entry);
				case 'goto': return await this._goto(entry, payload);
				case 'chat': return await this._chat(entry, payload);
				default: return;
			}
		} catch (err) {
			console.warn('[party] op failed:', payload.op, err?.message);
			this._result(entry, payload.op, false, 'error');
		}
	}

	// ---- ops ----------------------------------------------------------------
	_identity(entry) {
		const p = entry.room.state.players.get(entry.client.sessionId);
		return { key: entry.key, name: clean(p?.name, 32) || 'Player', username: clean(p?.username, 32) };
	}

	_loc(entry) {
		const s = entry.room.state;
		const id = this._identity(entry);
		return {
			coin: s.coin || '', tier: s.tier || '', name: s.coinName || '', symbol: s.coinSymbol || '', image: s.coinImage || '',
			roomId: entry.room.roomId, pname: id.name,
		};
	}

	async _resolveTarget(entry, payload) {
		// By session in the same room (inspect panel), or by account uid (friends drawer).
		if (typeof payload.sid === 'string') {
			for (const e of this.entries.values()) {
				if (e.room === entry.room && e.client.sessionId === payload.sid) {
					return { key: e.key, name: this._identity(e).name, username: this._identity(e).username };
				}
			}
			return null;
		}
		if (typeof payload.uid === 'string' && /^[0-9a-f-]{8,64}$/i.test(payload.uid)) {
			const key = 'u:' + payload.uid;
			const local = this.byKey.get(key);
			if (local?.size) {
				const id = this._identity([...local][0]);
				return { key, name: id.name, username: id.username };
			}
			const presence = await this.store.kv.get('presence:' + payload.uid);
			if (!presence) return null;
			return { key, name: clean(payload.name, 32) || 'Friend', username: '' };
		}
		return null;
	}

	async _invite(entry, payload) {
		const me = this._identity(entry);
		const target = await this._resolveTarget(entry, payload);
		if (!target) return this._result(entry, 'invite', false, 'offline');
		await this.store.setLoc(me.key, this._loc(entry));
		const res = await this.store.invite(me, target);
		if (!res.ok) return this._result(entry, 'invite', false, res.reason, { name: target.name });
		this._result(entry, 'invite', true, 'sent', { name: target.name });
		await this._pushParty(res.party.id, [target.key]);
		this._deliverTo(target.key, { type: 'invited', pid: res.party.id, from: me.name, fromKey: me.key });
	}

	async _accept(entry, payload) {
		const me = this._identity(entry);
		const pid = clean(payload.pid, 24);
		await this.store.setLoc(me.key, this._loc(entry));
		const res = await this.store.accept(me, pid);
		if (!res.ok) return this._result(entry, 'accept', false, res.reason);
		this._result(entry, 'accept', true, 'joined');
		this._tellParty(res.party, { type: 'event', ev: 'joined', name: me.name }, me.key);
		await this._pushParty(pid, [me.key]);
	}

	async _decline(entry, payload) {
		const me = this._identity(entry);
		const pid = clean(payload.pid, 24);
		const before = await this.store.load(pid, { allowSolo: true });
		const res = await this.store.decline(me, pid);
		if (!res.ok) return this._result(entry, 'decline', false, res.reason);
		this._result(entry, 'decline', true, 'declined');
		if (before) {
			const leaders = [before.leader, ...before.members.map((m) => m.key)];
			for (const k of new Set(leaders)) this._deliverTo(k, { type: 'event', ev: 'declined', name: me.name });
		}
		await this._push(me.key, true);
		if (res.party) await this._pushParty(pid);
		else if (before) {
			for (const m of before.members) {
				this.pidOf.set(m.key, null);
				await this._push(m.key, true);
			}
		}
	}

	async _leave(entry) {
		const me = this._identity(entry);
		const res = await this.store.leave(me.key);
		if (!res.ok) return this._result(entry, 'leave', false, res.reason);
		this.pidOf.set(me.key, null);
		this._result(entry, 'leave', true, 'left');
		await this._push(me.key, true);
		if (res.party) {
			this._tellParty(res.party, { type: 'event', ev: 'left', name: me.name });
			await this._pushParty(res.party.id);
		} else {
			for (const k of res.members || []) { this.pidOf.set(k, null); this._deliverTo(k, { type: 'event', ev: 'dissolved' }); await this._push(k, true); }
		}
	}

	async _chat(entry, payload) {
		const text = clean(payload.text, CHAT_MAX);
		if (!text || containsHateSlur(text)) return;
		const t = this.now();
		if (t - (this.chatAt.get(entry.key) || 0) < CHAT_COOLDOWN_MS) return;
		this.chatAt.set(entry.key, t);
		const party = await this.store.partyOf(entry.key);
		if (!party) return this._result(entry, 'chat', false, 'not_in_party');
		const me = this._identity(entry);
		const line = await this.store.chatPost(party.id, me, text);
		if (!line || line.ok === false) return this._result(entry, 'chat', false, 'busy');
		this._fanChat(party, line);
	}

	_fanChat(party, line) {
		let seen = this.delivered.get(party.id);
		if (!seen) this.delivered.set(party.id, (seen = new Set()));
		if (seen.has(line.n)) return;
		seen.add(line.n);
		if (seen.size > 60) seen.delete(seen.values().next().value);
		const msg = { type: 'chat', pid: party.id, key: line.key, name: line.name, text: line.text, ts: line.ts };
		for (const m of party.members) this._deliverTo(m.key, msg);
	}

	/** Server-validated teleport to a safe spot beside a party member in the same room. */
	async _goto(entry, payload) {
		const { room, client } = entry;
		const me = this._identity(entry);
		const fail = (reason, extra) => this._result(entry, 'goto', false, reason, extra);
		const party = await this.store.partyOf(me.key);
		const targetKey = clean(payload.key, 80);
		if (!party || !party.members.some((m) => m.key === targetKey) || targetKey === me.key) return fail('not_in_party');
		const target = [...(this.byKey.get(targetKey) || [])].find((e) => e.room === room);
		const tName = party.members.find((m) => m.key === targetKey)?.name || '';
		if (!target) return fail('other_world', { name: tName });
		const mine = room.state.players.get(client.sessionId);
		const theirs = room.state.players.get(target.client.sessionId);
		if (!mine || !theirs) return fail('other_world', { name: tName });
		if (mine.dead) return fail('dead');
		if (theirs.dead) return fail('target_dead', { name: tName });
		if (typeof room._vehicleDrivenBy === 'function' && room._vehicleDrivenBy(client.sessionId)) return fail('driving');
		const wait = GOTO_COOLDOWN_MS - (this.now() - (this.gotoAt.get(me.key) || 0));
		if (wait > 0) return fail('cooldown', { wait: Math.ceil(wait / 1000) });
		const spot = pickArrival(theirs, {
			bound: entry.boundM,
			blocked: (x, z) => this._blockedCell(room, x, z),
			occupied: (x, z) => {
				for (const [id, p] of room.state.players) {
					if (id !== client.sessionId && Math.hypot(p.x - x, p.z - z) < 1.1) return true;
				}
				return false;
			},
		});
		if (!spot) return fail('no_space', { name: tName });
		this.gotoAt.set(me.key, this.now());
		const from = { x: mine.x, y: mine.y, z: mine.z };
		mine.x = spot.x; mine.y = spot.y; mine.z = spot.z; mine.yaw = spot.yaw;
		mine.tsServer = this.now();
		client.send('party', { type: 'warp', ...spot, name: tName });
		room.broadcast('party', { type: 'fx', id: client.sessionId, from, to: { x: spot.x, y: spot.y, z: spot.z } });
		this._result(entry, 'goto', true, 'arrived', { name: tName });
	}

	_blockedCell(room, x, z) {
		if (typeof room._cellKey !== 'function' || !room.state.blocks) return false;
		const size = 1.5;
		const cx = Math.round(x / size);
		const cz = Math.round(z / size);
		for (let cy = 0; cy < 3; cy++) {
			const k = room._cellKey({ x: cx, y: cy, z: cz });
			if (k !== null && room.state.blocks.get(k)) return true;
		}
		return false;
	}

	// ---- views --------------------------------------------------------------
	async _viewFor(entry, party, invites, locs) {
		const view = { type: 'state', cap: PARTY_CAP, me: entry.key, party: null, invites: [] };
		view.invites = invites.map((i) => ({ pid: i.pid, from: i.fromName, ts: i.ts }));
		if (!party) return view;
		const local = new Map();
		for (const set of this.byKey.values()) {
			for (const e of set) if (e.room === entry.room && !local.has(e.key)) local.set(e.key, e);
		}
		view.party = {
			id: party.id, v: party.v, leader: party.leader,
			members: party.members.map((m) => {
				const here = local.get(m.key);
				const loc = locs.get(m.key);
				const state = here ? 'here' : loc && !loc.away ? 'elsewhere' : 'away';
				return {
					key: m.key, name: m.name, username: m.username, leader: m.key === party.leader, me: m.key === entry.key,
					state, sid: here ? here.client.sessionId : undefined,
					world: loc ? { coin: loc.coin, tier: loc.tier, name: loc.name, symbol: loc.symbol, image: loc.image } : null,
				};
			}),
			pending: party.pending.map((p) => ({ key: p.key, name: p.name })),
		};
		return view;
	}

	async _push(key, force = false) {
		const set = this.byKey.get(key);
		if (!set?.size) return;
		const pid = await this.store.partyIdOf(key);
		this.pidOf.set(key, pid);
		const party = pid ? await this.store.load(pid) : null;
		if (pid && !party) this.pidOf.set(key, null);
		const invites = await this.store.invitesFor(key);
		const locs = party ? await this.store.getLocs(party.members.map((m) => m.key)) : new Map();
		for (const e of set) await this._send(e, party, invites, locs, force);
	}

	async _pushParty(pid, extraKeys = []) {
		const party = await this.store.load(pid);
		if (!party) return;
		const keys = new Set([...party.members.map((m) => m.key), ...extraKeys]);
		const locs = await this.store.getLocs(party.members.map((m) => m.key));
		for (const k of keys) {
			const set = this.byKey.get(k);
			if (!set?.size) continue;
			const mine = party.members.some((m) => m.key === k);
			if (mine) this.pidOf.set(k, pid);
			const invites = await this.store.invitesFor(k);
			for (const e of set) await this._send(e, mine ? party : null, invites, locs, false);
		}
	}

	async _send(entry, party, invites, locs, force) {
		const view = await this._viewFor(entry, party, invites, locs);
		const json = JSON.stringify(view);
		if (!force && json === entry.last) return;
		entry.last = json;
		try { entry.client.send('party', view); } catch { /* socket closing */ }
	}

	_deliverTo(key, msg) {
		for (const e of this.byKey.get(key) || []) {
			try { e.client.send('party', msg); } catch { /* socket closing */ }
		}
	}

	_tellParty(party, msg, exceptKey) {
		for (const m of party.members) if (m.key !== exceptKey) this._deliverTo(m.key, msg);
	}

	_result(entry, op, ok, reason, extra = {}) {
		try { entry.client.send('party', { type: 'result', op, ok, reason, ...extra }); } catch { /* socket closing */ }
	}

	// ---- periodic sweep -----------------------------------------------------
	async sweep() {
		const keys = [...this.byKey.keys()];
		if (!keys.length) return;
		const t = this.now();
		const refreshLocs = t - this._locAt >= LOC_REFRESH_MS;
		if (refreshLocs) this._locAt = t;
		const [ofs, invs] = await Promise.all([
			this.store.kv.mget(keys.map((k) => 'partyof:' + k)),
			this.store.kv.mget(keys.map((k) => 'partyinv:' + k)),
		]);
		const parties = new Map(); // pid -> Set(local keys)
		const touched = new Set();
		keys.forEach((k, i) => {
			const pid = ofs[i] == null ? null : String(ofs[i]);
			const hasInv = invs[i] != null;
			if (pid) {
				if (!parties.has(pid)) parties.set(pid, new Set());
				parties.get(pid).add(k);
				if (refreshLocs) this._refreshLoc(k);
			}
			if (this.pidOf.get(k) !== pid || hasInv || (this.pidOf.get(k) && !pid)) touched.add(k);
			if (!pid && this.pidOf.get(k)) this.pidOf.set(k, null);
		});
		for (const [pid, members] of parties) {
			const party = await this.store.load(pid, { touch: true });
			if (!party) { for (const k of members) touched.add(k); continue; }
			await this._pushParty(pid);
			if (!this.delivered.has(pid)) {
				// First sight of this party in this process: history is not replayed.
				this.delivered.set(pid, new Set((await this.store.chatSince(pid, 0)).map((l) => l.n)));
			}
			const seen = this.delivered.get(pid);
			const top = seen.size ? Math.max(...seen) : 0;
			for (const line of await this.store.chatSince(pid, Math.max(0, top - 5))) this._fanChat(party, line);
			for (const k of members) touched.delete(k);
		}
		for (const k of touched) await this._push(k, false);
	}

	_refreshLoc(key) {
		const entry = this.byKey.get(key)?.values().next().value;
		if (entry) this.store.setLoc(key, this._loc(entry)).catch(() => {});
	}

	close() { if (this._timer) clearInterval(this._timer); }
}

export const partyService = new PartyService();
