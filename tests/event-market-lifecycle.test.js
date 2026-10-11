// Lifecycle policy and idempotence for Event Markets auto-resolution. `decide` is
// pure; tickMarkets runs against an in-memory stand-in for the three statements it
// issues, so the status guards (what makes a rerun a no-op) are exercised for real.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { markets: [], outcomes: [], writes: [] };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...vals) => {
		const q = strings.join('?').replace(/\s+/g, ' ').trim();
		if (q.startsWith('update event_markets set status = \'locked\'')) {
			const hit = state.markets.filter((m) => m.status === 'open' && new Date(m.locks_at) <= new Date());
			hit.forEach((m) => { m.status = 'locked'; });
			return hit.map((m) => ({ id: m.id }));
		}
		if (q.startsWith('select * from event_markets')) {
			return state.markets.filter((m) => ['open', 'locked'].includes(m.status) && new Date(m.resolves_at) <= new Date()).map((m) => ({ ...m }));
		}
		if (q.includes('from event_market_outcomes where market_id = any')) return state.outcomes;
		if (q.startsWith('update event_markets m set status = \'resolved\'')) {
			const [evidence, , , winner, id] = [vals[1], 0, 0, vals[0], vals[2]];
			const m = state.markets.find((x) => x.id === id && ['open', 'locked'].includes(x.status));
			const ok = m && state.outcomes.some((o) => o.id === winner && o.market_id === id);
			if (!ok) return [];
			Object.assign(m, { status: 'resolved', winner_outcome_id: winner, resolution_evidence: JSON.parse(evidence) });
			state.writes.push(['resolve', id]);
			return [{ id }];
		}
		if (q.startsWith('with m as ( update event_markets set status = \'void\'')) {
			const [reason, evidence, id] = [vals[0], vals[1], vals[2]];
			const m = state.markets.find((x) => x.id === id && ['open', 'locked'].includes(x.status));
			if (!m) return [{ voided: 0 }];
			Object.assign(m, { status: 'void', void_reason: reason, resolution_evidence: JSON.parse(evidence) });
			state.writes.push(['void', id, reason]);
			return [{ voided: 1 }];
		}
		if (q.startsWith('update event_markets set last_checked_at')) {
			const m = state.markets.find((x) => x.id === vals[1] && ['open', 'locked'].includes(x.status));
			if (m) { m.pending_reason = vals[0]; m.check_count = (m.check_count || 0) + 1; }
			state.writes.push(['pending', vals[1], vals[0]]);
			return [];
		}
		throw new Error(`unexpected sql: ${q.slice(0, 80)}`);
	};
	return { sql };
});

const { decide, tickMarkets, timeoutHours } = await import('../api/_lib/event-markets/lifecycle.js');
const { parseOverride } = await import('../api/_lib/event-markets/override.js');

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-10T00:00:00Z');
const mk = (over = {}) => ({ id: 'm1', slug: 'm1', source_kind: 'arena_tournament', status: 'locked', opens_at: new Date(T0 - 2 * DAY).toISOString(), locks_at: new Date(T0 - DAY).toISOString(), resolves_at: new Date(T0 - 1000).toISOString(), ...over });
const O1 = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
	state.markets = [mk({ id: 'm1' })];
	state.outcomes = [{ id: O1, market_id: 'm1', label: 'A', ref_kind: 'agent', ref_id: 'a', position: 0 }];
	state.writes = [];
});

describe('decide', () => {
	it('resolves on a winner, voids on a void result, waits on pending', () => {
		expect(decide(mk(), { winnerOutcomeId: O1, evidence: { a: 1 } }, T0)).toMatchObject({ action: 'resolve', winnerOutcomeId: O1 });
		expect(decide(mk(), { void: true, reason: 'tie', evidence: {} }, T0)).toMatchObject({ action: 'void', reason: 'tie' });
		expect(decide(mk(), { pending: true, reason: 'event_running' }, T0)).toMatchObject({ action: 'wait', reason: 'event_running' });
	});
	it('voids a market whose source is still pending past the per-kind timeout', () => {
		const m = mk();
		const late = Date.parse(m.resolves_at) + timeoutHours('arena_tournament') * 3_600_000;
		expect(decide(m, { pending: true, reason: 'awaiting_finalization' }, late - 1).action).toBe('wait');
		const d = decide(m, { pending: true, reason: 'awaiting_finalization' }, late);
		expect(d).toMatchObject({ action: 'void', reason: 'resolution_timeout' });
		expect(d.evidence.last_pending_reason).toBe('awaiting_finalization');
	});
	it('treats a thrown resolver as pending until the timeout, never as a result', () => {
		expect(decide(mk(), { error: 'boom' }, T0)).toMatchObject({ action: 'wait', reason: 'resolver_error' });
	});
	it('gives every source kind a timeout', () => {
		for (const k of ['arena_tournament', 'event_leaderboard', 'launch_cohort', 'build_round', 'bounty', 'custom']) expect(timeoutHours(k)).toBeGreaterThan(0);
	});
});

describe('tickMarkets', () => {
	const resolverFor = (result) => () => ({ resolve: async () => result });
	it('settles once and a rerun changes nothing', async () => {
		const deps = { resolverFor: resolverFor({ winnerOutcomeId: O1, evidence: { tournament_id: 't' } }) };
		const first = await tickMarkets({ now: T0, deps });
		expect(first.resolved).toEqual(['m1']);
		expect(state.markets[0]).toMatchObject({ status: 'resolved', winner_outcome_id: O1 });
		expect(state.markets[0].resolution_evidence).toEqual({ tournament_id: 't' });
		const writes = state.writes.length;
		const again = await tickMarkets({ now: T0 + 1000, deps });
		expect(again).toMatchObject({ checked: 0, resolved: [], voided: [] });
		expect(state.writes.length).toBe(writes);
	});
	it('voids with the documented reason and then stays void', async () => {
		const deps = { resolverFor: resolverFor({ void: true, reason: 'tie', evidence: { x: 1 } }) };
		expect((await tickMarkets({ now: T0, deps })).voided).toEqual([{ id: 'm1', reason: 'tie' }]);
		expect(state.markets[0]).toMatchObject({ status: 'void', void_reason: 'tie' });
		expect((await tickMarkets({ now: T0, deps })).voided).toEqual([]);
	});
	it('retries while pending, then voids at the timeout', async () => {
		const deps = { resolverFor: resolverFor({ pending: true, reason: 'event_running', evidence: {} }) };
		expect((await tickMarkets({ now: T0, deps })).pending).toBe(1);
		expect(state.markets[0]).toMatchObject({ status: 'locked', pending_reason: 'event_running' });
		const late = T0 + (timeoutHours('arena_tournament') + 1) * 3_600_000;
		expect((await tickMarkets({ now: late, deps })).voided[0].reason).toBe('resolution_timeout');
	});
	it('locks an open market at locks_at and leaves custom markets to an admin until the timeout', async () => {
		state.markets = [mk({ source_kind: 'custom', status: 'open', resolves_at: new Date(T0 - 1000).toISOString() })];
		const r = await tickMarkets({ now: T0 });
		expect(r.locked).toBe(1);
		expect(state.markets[0]).toMatchObject({ status: 'locked', pending_reason: 'awaiting_admin' });
	});
	it('records a resolver crash as an error without settling anything', async () => {
		const deps = { resolverFor: () => ({ resolve: async () => { throw new Error('rpc down'); } }) };
		const r = await tickMarkets({ now: T0, deps });
		expect(r.errors[0]).toMatch(/rpc down/);
		expect(state.markets[0].status).toBe('locked');
	});
});

describe('parseOverride', () => {
	it('requires a written reason of at least 20 characters', () => {
		expect(() => parseOverride({ action: 'void', reason: 'too short' })).toThrow(/reason/);
		expect(() => parseOverride({ action: 'void' })).toThrow(/reason/);
		expect(parseOverride({ action: 'void', reason: 'The tournament was rerun after a feed outage.' }).action).toBe('void');
	});
	it('requires a real outcome id for set_winner and rejects unknown actions', () => {
		const reason = 'Standings were corrected by the Arena team.';
		expect(() => parseOverride({ action: 'set_winner', reason, winner_outcome_id: 'x' })).toThrow(/outcome/);
		expect(parseOverride({ action: 'set_winner', reason, winner_outcome_id: O1 }).winnerOutcomeId).toBe(O1);
		expect(() => parseOverride({ action: 'delete', reason })).toThrow(/action/);
	});
});
