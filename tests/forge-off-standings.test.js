// The Forge-Off contest rules as pure functions: entry windows, the vote
// deadline, self-votes, the per-network cap, the tie-break and who may win.
// Every boundary is pinned to the second against the shipped event's own
// times, so a time-zone or off-by-one slip in any board fails here first.

import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
	Object.assign(process.env, {
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
});

const {
	RULES,
	VOTES_PER_NETWORK_PER_ENTRY,
	countVotes,
	hasPassedScreen,
	isEligibleEntry,
	pickWinner,
	rankBoard,
	votedBy,
} = await import('../api/_lib/forge-off-standings.js');
const { getEvent } = await import('../api/_lib/forge-off-events.js');

const EVENT = getEvent('ibm-forge-off-open');
const [DAY1, DAY2] = EVENT.days;
const S = 1000;
const t = (d) => d.getTime();

const entry = (id, createdAt, extra = {}) => ({
	id,
	prompt: id,
	glb_url: `https://cdn.example.com/${id}.glb`,
	status: 'done',
	outcome: null,
	visibility: null,
	safety_status: 'clear',
	client_key: `owner-${id}`,
	created_at: new Date(createdAt),
	...extra,
});
let n = 0;
const vote = (id, at, extra = {}) => {
	n += 1;
	return { creation_id: id, voter_key: `v${n}`, ip_hash: `ip${n}`, created_at: new Date(at), ...extra };
};
const board = (d) => ({ from: d.start, to: d.end, closesAt: d.end });
const ids = (ranked) => ranked.map((r) => r.entry.id);

describe('entry windows are UTC and half-open', () => {
	it('a model made one second before a day closes is on that day; one made at the close is on the next', () => {
		const last = entry('last-second', t(DAY1.end) - S);
		const next = entry('at-close', t(DAY1.end));
		const entries = [last, next];
		expect(ids(rankBoard(entries, [], board(DAY1)))).toEqual(['last-second']);
		expect(ids(rankBoard(entries, [], board(DAY2)))).toEqual(['at-close']);
	});

	it('a model made at the event end or before its start is not in the event', () => {
		const before = entry('before', t(EVENT.start) - S);
		const first = entry('first', t(EVENT.start));
		const after = entry('after', t(EVENT.end));
		const entries = [before, first, after];
		expect(ids(rankBoard(entries, [], { from: EVENT.start, to: EVENT.end }))).toEqual(['first']);
	});

	it('every day starts at 00:00:00 UTC whatever the visitor time zone', () => {
		for (const d of EVENT.days) {
			expect(d.start.toISOString()).toMatch(/T00:00:00\.000Z$/);
			expect(t(d.end) - t(d.start)).toBe(86_400_000);
		}
	});
});

describe('the vote deadline', () => {
	const a = entry('a', t(DAY1.start) + 3600 * S);

	it('a vote one second before the close counts; a vote at the close does not', () => {
		const votes = [vote('a', t(DAY1.end) - S), vote('a', t(DAY1.end))];
		expect(countVotes(votes, { closesAt: DAY1.end }).get('a')).toBe(1);
		expect(rankBoard([a], votes, board(DAY1))[0].votes).toBe(1);
	});

	it('a day-1 entry keeps collecting overall votes after day 1 closes, until the event ends', () => {
		const votes = [vote('a', t(DAY1.end) + 3600 * S), vote('a', t(EVENT.end) - S), vote('a', t(EVENT.end))];
		expect(rankBoard([a], votes, board(DAY1))[0].votes).toBe(0);
		expect(rankBoard([a], votes, { from: EVENT.start, to: EVENT.end })[0].votes).toBe(2);
	});

	it('the result does not depend on when it is computed', () => {
		const b = entry('b', t(DAY1.start) + 7200 * S);
		const votes = [vote('a', t(DAY1.end) - 10 * S), vote('b', t(DAY1.end) + S), vote('b', t(DAY1.end) + 86_400 * S)];
		const atClose = rankBoard([a, b], votes.filter((v) => t(v.created_at) < t(DAY1.end)), board(DAY1));
		const weekLater = rankBoard([a, b], votes, board(DAY1));
		expect(weekLater.map((r) => [r.entry.id, r.votes])).toEqual(atClose.map((r) => [r.entry.id, r.votes]));
	});
});

describe('one vote per rule', () => {
	it('a vote from the browser that made the entry does not count', () => {
		const a = entry('a', t(DAY1.start), { client_key: 'maker' });
		const votes = [vote('a', t(DAY1.start) + S, { voter_key: 'maker' }), vote('a', t(DAY1.start) + S)];
		expect(rankBoard([a], votes, board(DAY1))[0].votes).toBe(1);
	});

	it('the weekly board can keep counting self-votes when it asks to', () => {
		const a = entry('a', t(DAY1.start), { client_key: 'maker' });
		const votes = [vote('a', t(DAY1.start) + S, { voter_key: 'maker' })];
		expect(rankBoard([a], votes, { ...board(DAY1), excludeSelf: false })[0].votes).toBe(1);
	});

	it('one network counts at most three times per entry, the earliest three', () => {
		expect(VOTES_PER_NETWORK_PER_ENTRY).toBe(3);
		const votes = Array.from({ length: 10 }, (_, i) => vote('a', t(DAY1.start) + i * S, { ip_hash: 'same' }));
		votes.push(vote('b', t(DAY1.start), { ip_hash: 'same' }));
		const tally = countVotes(votes, { closesAt: DAY1.end });
		expect(tally.get('a')).toBe(3);
		expect(tally.get('b')).toBe(1);
	});

	it('votes with no recorded network are not capped', () => {
		const votes = Array.from({ length: 5 }, (_, i) => vote('a', t(DAY1.start) + i * S, { ip_hash: null }));
		expect(countVotes(votes, { closesAt: DAY1.end }).get('a')).toBe(5);
	});
});

describe('ranking and the tie-break', () => {
	it('most votes first; a tie goes to the entry published first; the id settles an exact tie', () => {
		const early = entry('z-early', t(DAY1.start) + 1 * S);
		const late = entry('a-late', t(DAY1.start) + 9 * S);
		const twinA = entry('twin-a', t(DAY1.start) + 5 * S);
		const twinB = entry('twin-b', t(DAY1.start) + 5 * S);
		const top = entry('top', t(DAY1.start) + 99 * S);
		const votes = [
			vote('top', t(DAY1.start) + 200 * S), vote('top', t(DAY1.start) + 200 * S),
			vote('z-early', t(DAY1.start) + 200 * S), vote('a-late', t(DAY1.start) + 200 * S),
			vote('twin-a', t(DAY1.start) + 200 * S), vote('twin-b', t(DAY1.start) + 200 * S),
		];
		expect(ids(rankBoard([late, twinB, top, early, twinA], votes, board(DAY1)))).toEqual(['top', 'z-early', 'twin-a', 'twin-b', 'a-late']);
	});

	it('the weekly board breaks ties newest first, like its live view', () => {
		const early = entry('early', t(DAY1.start) + S);
		const late = entry('late', t(DAY1.start) + 9 * S);
		const votes = [vote('early', t(DAY1.start) + 20 * S), vote('late', t(DAY1.start) + 20 * S)];
		expect(ids(rankBoard([early, late], votes, { ...board(DAY1), ties: 'latest' }))).toEqual(['late', 'early']);
	});
});

describe('eligibility and who may win', () => {
	it('only finished, public, unrejected entries the screen has not stopped are on a board', () => {
		const base = entry('x', t(DAY1.start));
		expect(isEligibleEntry(base)).toBe(true);
		expect(isEligibleEntry({ ...base, visibility: 'public' })).toBe(true);
		expect(isEligibleEntry({ ...base, safety_status: null })).toBe(true);
		expect(isEligibleEntry({ ...base, safety_status: 'pending' })).toBe(true);
		for (const bad of [
			{ visibility: 'private' }, { visibility: 'unlisted' }, { outcome: 'rejected' },
			{ safety_status: 'held' }, { safety_status: 'blocked' }, { status: 'failed' }, { glb_url: null },
		]) {
			expect(isEligibleEntry({ ...base, ...bad })).toBe(false);
		}
		expect(isEligibleEntry(null)).toBe(false);
	});

	it('a removed entry drops off the board and its votes go nowhere', () => {
		const removed = entry('removed', t(DAY1.start), { visibility: 'private' });
		const kept = entry('kept', t(DAY1.start) + S);
		const votes = [vote('removed', t(DAY1.start) + 9 * S), vote('removed', t(DAY1.start) + 9 * S), vote('kept', t(DAY1.start) + 9 * S)];
		const ranked = rankBoard([removed, kept], votes, board(DAY1));
		expect(ranked.map((r) => [r.entry.id, r.votes])).toEqual([['kept', 1]]);
	});

	it('a winner needs a counted vote and a clear content screen', () => {
		const clear = entry('clear', t(DAY1.start));
		const pending = entry('pending', t(DAY1.start), { safety_status: 'pending' });
		expect(pickWinner([])).toEqual({ status: 'no_entries' });
		expect(pickWinner([{ entry: clear, votes: 0 }])).toEqual({ status: 'no_votes' });
		expect(pickWinner([{ entry: clear, votes: 1 }])).toMatchObject({ status: 'crowned', votes: 1 });
		expect(pickWinner([{ entry: pending, votes: 4 }, { entry: clear, votes: 1 }])).toMatchObject({ status: 'deferred', entry: pending });
		expect(hasPassedScreen({ safety_status: null })).toBe(false);
	});
});

describe('page helpers', () => {
	it('votedBy reports the browser own votes, late or not', () => {
		const votes = [vote('a', t(DAY1.end) + S, { voter_key: 'me' }), vote('b', t(DAY1.start), { voter_key: 'me' }), vote('c', t(DAY1.start))];
		expect([...votedBy(votes, 'me')].sort()).toEqual(['a', 'b']);
		expect(votedBy(votes, null).size).toBe(0);
	});

	it('the published rules state the same cap the code applies', () => {
		expect(RULES.join(' ')).toContain(`at most ${VOTES_PER_NETWORK_PER_ENTRY} votes from one network`);
		expect(RULES.join(' ')).toMatch(/tie goes to the model published first/i);
	});
});
