// Party store state transitions, run against both KV backends: the in-memory
// TTL map (local dev) and a Redis-shaped client (production Upstash), with a
// fake clock so TTL ghost cleanup is deterministic.
import { describe, it, expect, beforeEach } from 'vitest';
import { PartyStore, MemoryKV, RedisKV, PARTY_CAP, LOC_TTL_SEC, INVITE_TTL_SEC } from '../multiplayer/src/party-store.js';

// Redis-shaped client: string values, SET with {ex,nx}, MGET variadic, and the
// Upstash habit of handing JSON strings back already parsed.
function fakeRedis(clock) {
	const m = new Map();
	const live = (k) => { const e = m.get(k); if (!e) return null; if (e.exp && e.exp <= clock.t) { m.delete(k); return null; } return e; };
	const out = (e) => { if (!e) return null; try { return JSON.parse(e.v); } catch { return e.v; } };
	return {
		async get(k) { return out(live(k)); },
		async mget(...ks) { return ks.map((k) => out(live(k))); },
		async set(k, v, o = {}) { if (o.nx && live(k)) return null; m.set(k, { v: String(v), exp: o.ex ? clock.t + o.ex * 1000 : 0 }); return 'OK'; },
		async del(k) { m.delete(k); },
	};
}

const P = (n) => ({ key: 'u:' + n, name: n });

for (const backend of ['memory', 'redis']) {
	describe(`PartyStore (${backend})`, () => {
		let clock, store;
		const online = (...ns) => Promise.all(ns.map((n) => store.setLoc('u:' + n, { coin: 'c', tier: 'general' })));
		const join = async (leader, ...others) => {
			for (const o of others) {
				await store.invite(P(leader), P(o));
				await store.accept(P(o), (await store.partyOf('u:' + leader)).id);
			}
			return (await store.partyOf('u:' + leader)).id;
		};
		beforeEach(() => {
			clock = { t: 1_000_000 };
			const kv = backend === 'memory' ? new MemoryKV(() => clock.t) : new RedisKV(fakeRedis(clock));
			store = new PartyStore({ kv, now: () => clock.t });
		});

		it('invite auto-creates a party led by the inviter and accept joins it', async () => {
			await online('a', 'b');
			const r = await store.invite(P('a'), P('b'));
			expect(r.ok).toBe(true);
			expect(r.party.leader).toBe('u:a');
			expect(r.party.pending.map((p) => p.key)).toEqual(['u:b']);
			const invs = await store.invitesFor('u:b');
			expect(invs).toHaveLength(1);
			const acc = await store.accept(P('b'), invs[0].pid);
			expect(acc.ok).toBe(true);
			expect(acc.party.members.map((m) => m.key)).toEqual(['u:a', 'u:b']);
			expect(acc.party.pending).toHaveLength(0);
			expect((await store.partyOf('u:b')).id).toBe(acc.party.id);
			expect(await store.invitesFor('u:b')).toHaveLength(0);
		});

		it('decline removes the invite and dissolves a lone leader', async () => {
			await online('a', 'b');
			const { party } = await store.invite(P('a'), P('b'));
			const d = await store.decline(P('b'), party.id);
			expect(d.ok).toBe(true);
			expect(d.dissolved).toBe(true);
			expect(await store.partyOf('u:a')).toBeNull();
			expect(await store.invitesFor('u:b')).toHaveLength(0);
		});

		it('rejects self, duplicate and already-member invites', async () => {
			await online('a', 'b');
			expect((await store.invite(P('a'), P('a'))).reason).toBe('self');
			await store.invite(P('a'), P('b'));
			expect((await store.invite(P('a'), P('b'))).reason).toBe('already_invited');
			await store.accept(P('b'), (await store.partyOf('u:a')).id);
			expect((await store.invite(P('a'), P('b'))).reason).toBe('already_member');
		});

		it('rejects inviting someone already in another party', async () => {
			await online('a', 'b', 'c', 'd');
			await join('a', 'b');
			await join('c', 'd');
			expect((await store.invite(P('a'), P('c'))).reason).toBe('already_partied');
		});

		it('blocks accepting an invite while in a multi-member party', async () => {
			await online('a', 'b', 'c', 'd');
			await store.invite(P('c'), P('a'));
			const cpid = (await store.partyOf('u:c')).id;
			await join('a', 'b');
			const r = await store.accept(P('a'), cpid);
			expect(r.ok).toBe(false);
			expect(r.reason).toBe('already_partied');
		});

		it('lets a lone inviter accept a crossing invite instead of deadlocking', async () => {
			await online('a', 'b');
			await store.invite(P('a'), P('b'));
			await store.invite(P('b'), P('a'));
			const apid = (await store.partyOf('u:a')).id;
			const r = await store.accept(P('b'), apid);
			expect(r.ok).toBe(true);
			expect(r.party.members.map((m) => m.key).sort()).toEqual(['u:a', 'u:b']);
		});

		it('enforces the cap of 8 counting pending invites', async () => {
			const names = Array.from({ length: PARTY_CAP + 2 }, (_, i) => 'm' + i);
			await online(...names);
			for (let i = 1; i < PARTY_CAP; i++) expect((await store.invite(P('m0'), P(names[i]))).ok).toBe(true);
			const over = await store.invite(P('m0'), P(names[PARTY_CAP]));
			expect(over.ok).toBe(false);
			expect(over.reason).toBe('full');
			const pid = (await store.partyOf('u:m0')).id;
			for (let i = 1; i < PARTY_CAP; i++) expect((await store.accept(P(names[i]), pid)).ok).toBe(true);
			expect((await store.partyOf('u:m0')).members).toHaveLength(PARTY_CAP);
		});

		it('leave hands leadership to the longest-standing member and dissolves when empty', async () => {
			await online('a', 'b', 'c');
			await join('a', 'b', 'c');
			const l1 = await store.leave('u:a');
			expect(l1.party.leader).toBe('u:b');
			expect(await store.partyOf('u:a')).toBeNull();
			const l2 = await store.leave('u:b');
			expect(l2.dissolved).toBe(true);
			expect(await store.partyOf('u:c')).toBeNull();
			expect(await store.leave('u:c')).toMatchObject({ ok: false, reason: 'not_in_party' });
		});

		it('drops a ghost whose heartbeat lapsed, then the whole party when everyone lapses', async () => {
			await online('a', 'b', 'c');
			await join('a', 'b', 'c');
			clock.t += (LOC_TTL_SEC - 5) * 1000;
			await online('a', 'b'); // c crashed and stopped heartbeating
			clock.t += 10_000;
			expect((await store.partyOf('u:a')).members.map((m) => m.key)).toEqual(['u:a', 'u:b']);
			expect(await store.partyOf('u:c')).toBeNull();
			clock.t += (LOC_TTL_SEC + 1) * 1000;
			expect(await store.partyOf('u:a')).toBeNull();
			expect(await store.partyIdOf('u:a')).toBeNull();
		});

		it('re-elects the leader when the leader is the ghost', async () => {
			await online('a', 'b', 'c');
			await join('a', 'b', 'c');
			clock.t += 70_000;
			await online('b', 'c');
			clock.t += 10_000;
			expect((await store.partyOf('u:b')).leader).toBe('u:b');
		});

		it('expires unanswered invites', async () => {
			await online('a', 'b');
			await store.invite(P('a'), P('b'));
			clock.t += (INVITE_TTL_SEC + 1) * 1000;
			await online('a');
			expect(await store.invitesFor('u:b')).toHaveLength(0);
			expect(await store.partyOf('u:a')).toBeNull();
		});

		it('accepting with no invite fails cleanly', async () => {
			await online('a');
			expect((await store.accept(P('a'), 'nope')).reason).toBe('no_invite');
		});

		it('relays party chat in order and only past a given line', async () => {
			await online('a', 'b');
			const pid = await join('a', 'b');
			const l1 = await store.chatPost(pid, P('a'), 'hi');
			const l2 = await store.chatPost(pid, P('a'), 'there');
			expect([l1.n, l2.n]).toEqual([1, 2]);
			expect((await store.chatSince(pid, 1)).map((l) => l.text)).toEqual(['there']);
		});
	});
}
