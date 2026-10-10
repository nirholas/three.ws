/**
 * Event Markets auto-open (api/_lib/event-markets/auto-open.js): which events get a
 * market, how it is phrased and timed, and the guarantees around it: idempotent on
 * the event, late entrants added before lock and never after, every declined event
 * logged with a reason, and the outbox row written on open.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queries = [];
let route = () => [];
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const q = Array.isArray(strings) ? strings.join('?') : String(strings);
		queries.push({ q, values });
		return Promise.resolve().then(() => route(q, values));
	},
}));

const created = [];
let createError = null;
vi.mock('../api/_lib/event-markets/index.js', async () => {
	class EventMarketError extends Error {
		constructor(status, code, message) {
			super(message);
			this.status = status;
			this.code = code;
		}
	}
	return {
		EventMarketError,
		slugify: (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
		createMarket: async (input) => {
			if (createError) throw createError;
			created.push(input);
			return { id: 'm1', slug: input.slug, title: input.title, locks_at: input.locks_at, resolves_at: input.resolves_at, outcomes: input.outcomes };
		},
	};
});

const A = await import('../api/_lib/event-markets/auto-open.js');

const NOW = new Date('2026-10-12T12:00:00Z');
const hour = 3_600_000;
const entrant = (n) => ({ label: `Agent ${n}`, refKind: 'agent', refId: `agent-${n}`, imageUrl: null });
function event(over = {}) {
	return {
		sourceKind: 'arena_tournament',
		sourceRef: 't-1',
		title: 'Spring Cup',
		startsAt: new Date(NOW.getTime() + 2 * hour),
		endsAt: new Date(NOW.getTime() + 10 * hour),
		lockAt: new Date(NOW.getTime() + 2 * hour),
		resolvesAt: new Date(NOW.getTime() + 10 * hour),
		entrants: [entrant(1), entrant(2), entrant(3)],
		rule: { type: 'tournament_final_rank', description: 'Top of the standings.' },
		winnerDefined: true,
		...over,
	};
}

beforeEach(() => {
	queries.length = 0;
	created.length = 0;
	createError = null;
	route = () => [];
});

describe('question phrasing and slugs', () => {
	it('phrases the title as a question and caps its length', () => {
		expect(A.questionTitle('Spring Cup')).toBe('Who wins Spring Cup?');
		const long = A.questionTitle('x'.repeat(400));
		expect(long.length).toBeLessThanOrEqual(160);
		expect(long.endsWith('...?')).toBe(true);
	});

	it('derives a deterministic slug from the event identity', () => {
		const a = A.marketSlug(event());
		expect(a).toBe(A.marketSlug(event()));
		expect(a).not.toBe(A.marketSlug(event({ sourceRef: 't-2' })));
		expect(a).toMatch(/^[a-z0-9][a-z0-9-]{1,78}$/);
	});
});

describe('planOpen', () => {
	it('opens an event with a winner, enough entrants and a future lock', () => {
		expect(A.planOpen(event(), NOW)).toEqual({ action: 'open' });
	});

	it('skips fewer than two entrants', () => {
		const p = A.planOpen(event({ entrants: [entrant(1)] }), NOW);
		expect(p).toMatchObject({ action: 'skip', reason: 'too_few_entrants' });
	});

	it('skips an event with no defined winner, whatever its entrants', () => {
		const p = A.planOpen(event({ winnerDefined: false, noWinnerReason: 'no judging criteria' }), NOW);
		expect(p).toMatchObject({ action: 'skip', reason: 'no_defined_winner', detail: 'no judging criteria' });
	});

	it('skips when picks would already have closed, unless forced', () => {
		const late = event({ lockAt: new Date(NOW.getTime() - hour) });
		expect(A.planOpen(late, NOW)).toMatchObject({ action: 'skip', reason: 'lock_passed' });
		expect(A.planOpen(late, NOW, { force: true })).toEqual({ action: 'open' });
	});
});

describe('openForEvent', () => {
	it('opens a market with the entrants as outcomes and writes the outbox row', async () => {
		const r = await A.openForEvent(event(), { now: NOW });
		expect(r.result).toBe('opened');
		expect(created).toHaveLength(1);
		const c = created[0];
		expect(c.title).toBe('Who wins Spring Cup?');
		expect(c.status).toBe('open');
		expect(c.source_kind).toBe('arena_tournament');
		expect(c.source_ref).toBe('t-1');
		expect(c.locks_at).toBe(event().lockAt.toISOString());
		expect(c.resolves_at).toBe(event().resolvesAt.toISOString());
		expect(c.outcomes.map((o) => o.ref_id)).toEqual(['agent-1', 'agent-2', 'agent-3']);
		expect(c.resolution_rule.type).toBe('tournament_final_rank');
		const outbox = queries.find((q) => q.q.includes('event_market_outbox'));
		expect(outbox.values[0]).toBe('event_market.opened');
		expect(queries.some((q) => q.q.includes('delete from event_market_skips'))).toBe(true);
	});

	it('records a skip with its reason instead of opening', async () => {
		const r = await A.openForEvent(event({ entrants: [entrant(1)] }), { now: NOW });
		expect(r).toMatchObject({ result: 'skipped', reason: 'too_few_entrants' });
		expect(created).toHaveLength(0);
		const skip = queries.find((q) => q.q.includes('insert into event_market_skips'));
		expect(skip.values).toEqual(expect.arrayContaining(['arena_tournament', 't-1', 'too_few_entrants']));
	});

	it('is idempotent: an event that already has a market is not created again', async () => {
		route = (q) => (q.includes('from event_markets') ? [{ id: 'm1', slug: 's', status: 'open', locks_at: event().lockAt }]
			: q.includes('from event_market_outcomes')
				? ['agent-1', 'agent-2', 'agent-3'].map((id) => ({ ref_kind: 'agent', ref_id: id }))
				: []);
		const r = await A.openForEvent(event(), { now: NOW });
		expect(r.result).toBe('unchanged');
		expect(created).toHaveLength(0);
		expect(queries.some((q) => q.q.includes('insert into event_market_outcomes'))).toBe(false);
	});

	it('treats a lost creation race as the existing market', async () => {
		const { EventMarketError } = await import('../api/_lib/event-markets/index.js');
		createError = new EventMarketError(409, 'market_exists_for_source', 'exists');
		let lookups = 0;
		route = (q) => (q.includes('from event_markets') ? (lookups++ === 0 ? [] : [{ id: 'm1', slug: 'raced', status: 'open', locks_at: event().lockAt }]) : []);
		const r = await A.openForEvent(event(), { now: NOW });
		expect(r).toMatchObject({ result: 'unchanged', slug: 'raced' });
	});

	it('adds an entrant that joined before lock and leaves existing outcomes alone', async () => {
		route = (q) => {
			if (q.includes('from event_markets')) return [{ id: 'm1', slug: 's', status: 'open', locks_at: event().lockAt }];
			if (q.includes('select ref_kind, ref_id')) return ['agent-1', 'agent-2'].map((id) => ({ ref_kind: 'agent', ref_id: id }));
			if (q.includes('insert into event_market_outcomes')) return [{ id: 'new' }];
			return [];
		};
		const r = await A.openForEvent(event(), { now: NOW });
		expect(r).toMatchObject({ result: 'synced', added: 1 });
		const inserts = queries.filter((q) => q.q.includes('insert into event_market_outcomes'));
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toContain('agent-3');
		expect(queries.some((q) => /delete from event_market_outcomes|update event_market_outcomes/.test(q.q))).toBe(false);
	});

	it('never changes outcomes after lock', async () => {
		const locked = new Date(NOW.getTime() - hour);
		route = (q) => (q.includes('from event_markets') ? [{ id: 'm1', slug: 's', status: 'open', locks_at: locked }] : []);
		const r = await A.openForEvent(event(), { now: NOW });
		expect(r.result).toBe('unchanged');
		expect(queries.some((q) => q.q.includes('event_market_outcomes'))).toBe(false);
	});

	it('never changes outcomes of a locked, resolved or void market', async () => {
		for (const status of ['locked', 'resolved', 'void']) {
			queries.length = 0;
			route = (q) => (q.includes('from event_markets') ? [{ id: 'm1', slug: 's', status, locks_at: event().lockAt }] : []);
			const r = await A.openForEvent(event(), { now: NOW });
			expect(r.result).toBe('unchanged');
			expect(queries.some((q) => q.q.includes('event_market_outcomes'))).toBe(false);
		}
	});

	it('forced open of a past-lock event gets a manual lock window', async () => {
		const late = event({ lockAt: new Date(NOW.getTime() - hour) });
		const r = await A.openForEvent(late, { now: NOW, force: true });
		expect(r.result).toBe('opened');
		expect(new Date(created[0].locks_at).getTime()).toBeGreaterThan(NOW.getTime());
	});
});

describe('runAutoOpen', () => {
	it('reports a failing source without stopping the others', async () => {
		const sources = [
			{ sourceKind: 'bounty', listEvents: async () => { throw new Error('db down'); } },
			{ sourceKind: 'arena_tournament', listEvents: async () => [event()] },
		];
		const rep = await A.runAutoOpen({ now: NOW, sources });
		expect(rep.errors).toEqual([{ source_kind: 'bounty', message: 'db down' }]);
		expect(rep.opened).toHaveLength(1);
		expect(rep.seen).toBe(1);
	});
});
