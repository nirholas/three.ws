import { describe, it, expect, vi } from 'vitest';
import {
	streakEventFor,
	mergeRecipients,
	chunk,
	streakPayload,
	traderUrl,
	runHotStreakPush,
	LOOKBACK_MS,
	STREAK_FETCH_LIMIT,
} from '../api/_lib/hot-streak-push.js';
import { categoryForType, pushPayloadFor } from '../api/_lib/notify-prefs.js';
import { winStreaksByAgent } from '../api/_lib/win-streak.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const row = (id, pnl, minsAgo) => ({
	id,
	realized_pnl_lamports: pnl,
	closed_at: new Date(NOW - minsAgo * 60_000).toISOString(),
});
const wins = (n, startMinsAgo = 2) =>
	Array.from({ length: n }, (_, i) => row(`p${n - i}`, '1000', startMinsAgo + i * 10));

describe('streakEventFor', () => {
	it('fires when the newest close lifts the streak to a milestone', () => {
		const e = streakEventFor([...wins(3), row('loss', '-5', 90)], { now: NOW });
		expect(e.streak).toBe(3);
		expect(e.positionId).toBe('p3');
	});
	it('stays quiet between milestones', () => {
		expect(streakEventFor(wins(4), { now: NOW })).toBeNull();
		expect(streakEventFor(wins(6), { now: NOW })).toBeNull();
		expect(streakEventFor(wins(2), { now: NOW })).toBeNull();
	});
	it('fires again at 5, 7, 10 and 15', () => {
		for (const n of [5, 7, 10, 15]) expect(streakEventFor(wins(n), { now: NOW })?.streak).toBe(n);
	});
	it('never announces when the newest close lost', () => {
		expect(streakEventFor([row('l', '-1', 1), ...wins(5, 10)], { now: NOW })).toBeNull();
	});
	it('never announces an old streak', () => {
		const old = wins(3, LOOKBACK_MS / 60_000 + 5);
		expect(streakEventFor(old, { now: NOW })).toBeNull();
	});
	it('rejects a close dated in the future and junk input', () => {
		expect(streakEventFor([row('f', '1', -30), ...wins(2, 10)], { now: NOW })).toBeNull();
		expect(streakEventFor([], { now: NOW })).toBeNull();
		expect(streakEventFor(undefined, { now: NOW })).toBeNull();
		expect(streakEventFor([{ id: 'x', realized_pnl_lamports: '1', closed_at: 'nope' }], { now: NOW })).toBeNull();
	});
	it('skips a run that fills the fetch window because its length is unknown', () => {
		const full = Array.from({ length: STREAK_FETCH_LIMIT }, (_, i) => row(`q${i}`, '1', 2 + i));
		expect(streakEventFor(full, { now: NOW })).toBeNull();
	});
	it('agrees with the leaderboard badge streak for the same rows', () => {
		const rows = [...wins(5), row('l', '-1', 120)].map((r) => ({ ...r, agent_id: 'a' }));
		expect(streakEventFor(rows, { now: NOW }).streak).toBe(winStreaksByAgent(rows).get('a'));
	});
});

describe('mergeRecipients', () => {
	it('dedupes across followers, copiers and mirrors', () => {
		expect(mergeRecipients([['a', 'b'], ['b', 'c'], ['a', 'd']])).toEqual(['a', 'b', 'c', 'd']);
	});
	it('excludes the agent owner', () => {
		expect(mergeRecipients([['owner', 'a'], ['owner']], { excludeUserId: 'owner' })).toEqual(['a']);
	});
	it('caps the list and skips empty ids', () => {
		expect(mergeRecipients([['a', null, 'b', 'c', 'd']], { cap: 2 })).toEqual(['a', 'b']);
		expect(mergeRecipients(undefined)).toEqual([]);
	});
});

describe('chunk and payload', () => {
	it('chunks into batches', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(chunk([], 3)).toEqual([]);
		expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
	});
	it('links to the trader profile on the right network', () => {
		expect(traderUrl('abc')).toBe('/trader/abc');
		expect(traderUrl('abc', 'devnet')).toBe('/trader/abc?network=devnet');
		const p = streakPayload({ agentId: 'abc', agentName: 'Zed', streak: 5 });
		expect(p).toMatchObject({ agent_id: 'abc', agent_name: 'Zed', streak: 5, url: '/trader/abc', link: '/trader/abc' });
	});
	it('maps to the social category and builds a push that opens the profile', () => {
		expect(categoryForType('trader_hot_streak')).toBe('social');
		const push = pushPayloadFor('trader_hot_streak', streakPayload({ agentId: 'abc', agentName: 'Zed', streak: 7 }), 'n1');
		expect(push.title).toContain('Zed');
		expect(push.body).toContain('7');
		expect(push.url).toBe('/trader/abc');
	});
});

// A small in-memory stand-in for the database, routed by statement text, so the
// runner's claim / dedupe / recipient wiring is exercised end to end.
function fakeDb({ closed, followers = [], copiers = [], mirrors = [], ownerId = 'owner', existing = new Set() }) {
	const updates = [];
	const sql = async (strings, ...vals) => {
		const q = strings.join('?');
		if (q.includes('select distinct p.agent_id')) return [...new Set(closed.map((r) => r.agent_id))].map((agent_id) => ({ agent_id }));
		if (q.includes('row_number()')) return closed;
		if (q.includes('insert into trader_streak_events')) {
			const key = `${vals[0]}:${vals[3]}`;
			if (existing.has(key)) return [];
			existing.add(key);
			return [{ id: `evt-${key}` }];
		}
		if (q.includes('from agent_identities where id')) return [{ user_id: ownerId, name: 'Zed' }];
		if (q.includes('from trader_follows')) return followers.map((user_id) => ({ user_id }));
		if (q.includes('from copy_subscriptions')) return copiers.map((user_id) => ({ user_id }));
		if (q.includes('from agent_mirror_follows')) return mirrors.map((user_id) => ({ user_id }));
		if (q.includes('update trader_streak_events')) { updates.push(vals); return []; }
		throw new Error(`unexpected query: ${q}`);
	};
	return { sql, updates };
}

describe('runHotStreakPush', () => {
	const closed = wins(3).map((r) => ({ ...r, agent_id: 'agent-1' }));

	it('notifies followers and copiers once, deduped, excluding the owner', async () => {
		const db = fakeDb({ closed, followers: ['u1', 'u2', 'owner'], copiers: ['u2', 'u3'], mirrors: ['u4'] });
		const notify = vi.fn().mockResolvedValue({ id: 'x' });
		const out = await runHotStreakPush({ sql: db.sql, notify, now: NOW });
		expect(out).toMatchObject({ candidates: 1, events: 1, notified: 4 });
		expect(notify.mock.calls.map((c) => c[0]).sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
		expect(notify.mock.calls[0][1]).toBe('trader_hot_streak');
		expect(notify.mock.calls[0][2]).toMatchObject({ agent_id: 'agent-1', agent_name: 'Zed', streak: 3, url: '/trader/agent-1' });
		expect(db.updates).toHaveLength(1);
	});

	it('does not notify again on a re-run for the same triggering position', async () => {
		const existing = new Set();
		const notify = vi.fn().mockResolvedValue({ id: 'x' });
		const a = fakeDb({ closed, followers: ['u1'], existing });
		await runHotStreakPush({ sql: a.sql, notify, now: NOW });
		const b = fakeDb({ closed, followers: ['u1'], existing });
		const second = await runHotStreakPush({ sql: b.sql, notify, now: NOW });
		expect(second.events).toBe(0);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it('does nothing when no candidate hits a milestone', async () => {
		const db = fakeDb({ closed: wins(4).map((r) => ({ ...r, agent_id: 'agent-1' })), followers: ['u1'] });
		const notify = vi.fn();
		const out = await runHotStreakPush({ sql: db.sql, notify, now: NOW });
		expect(out.events).toBe(0);
		expect(notify).not.toHaveBeenCalled();
	});

	it('reports missing tables instead of throwing', async () => {
		const sql = async (strings) => {
			const q = strings.join('?');
			if (q.includes('select distinct p.agent_id')) return [{ agent_id: 'agent-1' }];
			if (q.includes('row_number()')) return closed.map((r) => ({ ...r, agent_id: 'agent-1' }));
			const err = new Error('relation does not exist');
			err.code = '42P01';
			throw err;
		};
		const out = await runHotStreakPush({ sql, notify: vi.fn(), now: NOW });
		expect(out.skipped_missing_tables).toBe(true);
	});
});
