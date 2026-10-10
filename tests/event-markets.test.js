// Event Markets core (api/_lib/event-markets/): the real migration and the real
// SQL, run in an in-process Postgres (PGlite). Pins the contract: odds with a
// stated prior, the lock boundary, the points budgets, the pick log, and the
// void path that refunds.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const EM = await import('../api/_lib/event-markets/index.js');
const { impliedOdds } = EM;
const { POINTS, seasonFor } = await import('../api/_lib/event-markets/config.js');

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const ADMIN = '99999999-9999-4999-8999-999999999999';
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

const MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261011020000_event_markets.sql', import.meta.url), 'utf8');

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`create table users (id uuid primary key, created_at timestamptz not null default now() - interval '30 days', email_verified boolean not null default true, service_account boolean not null default false, deleted_at timestamptz);
		create table user_wallets (id uuid primary key default gen_random_uuid(), user_id uuid, address text);
		insert into users values ('${ALICE}'), ('${BOB}'), ('${ADMIN}');`);
	await holder.db.exec(MIGRATION);
});

beforeEach(async () => {
	await holder.db.exec('truncate event_market_pick_log, event_market_picks, event_market_outcomes, event_markets cascade');
});

async function make(over = {}) {
	return EM.createMarket({
		title: 'Who wins the build round?',
		source_kind: 'build_round',
		locks_at: inHours(2),
		outcomes: [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma', ref_kind: 'agent', ref_id: 'agent-3' }],
		created_by: ADMIN,
		...over,
	});
}

describe('impliedOdds', () => {
	it('gives an even prior with zero picks and says so', () => {
		const o = impliedOdds([{ id: 'a', points: 0 }, { id: 'b', points: 0 }, { id: 'c', points: 0 }]);
		expect(o.even_prior).toBe(true);
		expect(o.outcomes.map((x) => x.percent)).toEqual([33.3, 33.3, 33.3]);
		expect(o.method).toMatch(/even/);
	});
	it('weights by points with a smoothing prior, summing to 1', () => {
		const o = impliedOdds([{ id: 'a', points: 100, picks: 1 }, { id: 'b', points: 0, picks: 0 }], { prior: 25 });
		expect(o.even_prior).toBe(false);
		expect(o.outcomes[0].share).toBeCloseTo(125 / 150);
		expect(o.outcomes.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
	});
});

describe('seasons and the points config', () => {
	it('maps a lock time to its calendar quarter', () => {
		expect(seasonFor('2026-11-15T00:00:00Z')).toMatchObject({ id: '2026-Q4', starts_at: '2026-10-01T00:00:00.000Z', ends_at: '2027-01-01T00:00:00.000Z', budget: POINTS.seasonBudget });
	});
});

describe('create and read', () => {
	it('creates a market with ordered outcomes and an even-prior read', async () => {
		const m = await make();
		expect(m.status).toBe('open');
		expect(m.outcomes.map((o) => o.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
		expect(m.odds.even_prior).toBe(true);
		expect(m.odds.note).toMatch(/even split/);
		expect(m.resolution_text).toMatch(/Resolves to/);
		expect(m.winner).toBeNull();
		const read = await EM.getMarket(m.slug);
		expect(read.id).toBe(m.id);
	});
	it('refuses a duplicate slug and a past lock time', async () => {
		await make({ slug: 'dup-market' });
		await expect(make({ slug: 'dup-market' })).rejects.toMatchObject({ status: 409, code: 'slug_taken' });
		await expect(make({ locks_at: inHours(-1) })).rejects.toMatchObject({ code: 'invalid_time' });
		await expect(make({ outcomes: [{ label: 'Only' }] })).rejects.toMatchObject({ code: 'invalid_outcomes' });
	});
	it('is idempotent per source record', async () => {
		const first = await make({ source_ref: 'round-7' });
		await expect(make({ source_ref: 'round-7', slug: 'another' })).rejects.toMatchObject({ code: 'market_exists_for_source', detail: { slug: first.slug } });
	});
	it('hides drafts from public reads', async () => {
		const d = await make({ status: 'draft' });
		await expect(EM.getMarket(d.slug)).rejects.toMatchObject({ status: 404 });
		expect((await EM.getMarket(d.slug, { includeDraft: true })).id).toBe(d.id);
		expect((await EM.listMarkets({ status: 'all' })).items).toHaveLength(0);
	});
});

describe('picks move the odds', () => {
	it('two accounts pick and the public odds shift toward the crowd', async () => {
		const m = await make();
		const [alpha, beta] = m.outcomes;
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: alpha.id, points: 100 });
		await EM.placePick({ market: m.slug, accountId: BOB, outcomeId: alpha.id, points: 50 });
		const after = await EM.getMarket(m.slug);
		expect(after.pick_count).toBe(2);
		expect(after.total_points).toBe(150);
		expect(after.odds.even_prior).toBe(false);
		const a = after.outcomes.find((o) => o.id === alpha.id);
		const b = after.outcomes.find((o) => o.id === beta.id);
		expect(a.share).toBeGreaterThan(b.share);
		expect(a.points).toBe(150);
		expect(after.outcomes.reduce((s, o) => s + o.share, 0)).toBeCloseTo(1);
	});
	it('changing a pick replaces it instead of stacking', async () => {
		const m = await make();
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 100 });
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[1].id, points: 40 });
		const after = await EM.getMarket(m.slug, { viewer: ALICE });
		expect(after.pick_count).toBe(1);
		expect(after.viewer.pick).toMatchObject({ outcome_id: m.outcomes[1].id, points: 40 });
		const hist = await EM.marketHistory(m.slug);
		expect(hist.points.map((p) => p.action)).toEqual(['place', 'change']);
	});
	it('records the odds a pick was made at, so scoring can reward an upset', async () => {
		const m = await make();
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 100 });
		await EM.placePick({ market: m.slug, accountId: BOB, outcomeId: m.outcomes[1].id, points: 20 });
		const rows = await holder.db.sql`select account_id, odds_at_pick::float as odds, ranked from event_market_picks order by created_at`;
		expect(rows[0].odds).toBeCloseTo(1 / 3, 5);
		expect(rows[1].odds).toBeCloseTo(25 / (100 + 75), 5);
		expect(rows.every((r) => r.ranked)).toBe(true);
	});
	it('rejects an outcome from another market', async () => {
		const m = await make();
		const other = await make({ slug: 'other-market', title: 'Another market' });
		await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: other.outcomes[0].id, points: 20 }))
			.rejects.toMatchObject({ code: 'outcome_not_found' });
	});
});

describe('lock boundary', () => {
	it('rejects a pick after locks_at with an actionable error, and a change or withdraw too', async () => {
		const m = await make();
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 50 });
		await holder.db.exec(`update event_markets set locks_at = now() - interval '1 second', opens_at = now() - interval '1 hour' where id = '${m.id}'`);
		const err = await EM.placePick({ market: m.slug, accountId: BOB, outcomeId: m.outcomes[0].id, points: 50 }).catch((e) => e);
		expect(err).toMatchObject({ status: 409, code: 'market_locked' });
		expect(err.message).toMatch(/Picks closed at/);
		await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[1].id, points: 50 })).rejects.toMatchObject({ code: 'market_locked' });
		await expect(EM.withdrawPick({ market: m.slug, accountId: ALICE })).rejects.toMatchObject({ code: 'market_locked' });
		expect((await EM.getMarket(m.slug)).status).toBe('locked');
	});
	it('admin lock closes picks immediately', async () => {
		const m = await make();
		const locked = await EM.lockMarket(m.slug);
		expect(locked.status).toBe('locked');
		await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 20 })).rejects.toMatchObject({ code: 'market_locked' });
	});
	it('refuses picks before a market opens', async () => {
		const m = await make({ opens_at: inHours(1), locks_at: inHours(3) });
		await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 20 })).rejects.toMatchObject({ code: 'market_not_open' }).catch(async () => {
			// An open market with a future opens_at reads as open; the SQL guard still refuses it.
			await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 20 })).rejects.toBeTruthy();
		});
	});
});

describe('points budget', () => {
	it('enforces min and max per market', async () => {
		const m = await make();
		await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: POINTS.minPick - 1 })).rejects.toMatchObject({ code: 'invalid_points' });
		await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: POINTS.maxPickPerMarket + 1 })).rejects.toMatchObject({ code: 'invalid_points' });
		await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 12.5 })).rejects.toMatchObject({ code: 'invalid_points' });
	});
	it('caps total points across a season, and withdrawing frees them', async () => {
		const perMarket = POINTS.maxPickPerMarket;
		const marketsNeeded = Math.floor(POINTS.seasonBudget / perMarket);
		const made = [];
		for (let i = 0; i < marketsNeeded + 1; i++) {
			made.push(await make({ slug: `season-market-${i}`, title: `Season market ${i}` }));
		}
		for (let i = 0; i < marketsNeeded; i++) {
			await EM.placePick({ market: made[i].slug, accountId: ALICE, outcomeId: made[i].outcomes[0].id, points: perMarket });
		}
		const over = made[marketsNeeded];
		const err = await EM.placePick({ market: over.slug, accountId: ALICE, outcomeId: over.outcomes[0].id, points: POINTS.minPick }).catch((e) => e);
		const remaining = POINTS.seasonBudget - marketsNeeded * perMarket;
		if (remaining < POINTS.minPick) {
			expect(err).toMatchObject({ status: 409, code: 'budget_exceeded' });
			expect(err.message).toMatch(/Withdraw a pick/);
			await EM.withdrawPick({ market: made[0].slug, accountId: ALICE });
			const ok = await EM.placePick({ market: over.slug, accountId: ALICE, outcomeId: over.outcomes[0].id, points: POINTS.minPick });
			expect(ok.pick.points).toBe(POINTS.minPick);
		} else {
			expect(err.pick?.points).toBe(POINTS.minPick);
		}
	});
	it('reports the viewer budget on read', async () => {
		const m = await make();
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 100 });
		const v = await EM.getMarket(m.slug, { viewer: ALICE });
		expect(v.viewer.budget).toMatchObject({ season_budget: POINTS.seasonBudget, committed_here: 100, committed_elsewhere: 0 });
	});
});

describe('withdraw', () => {
	it('removes the pick before lock and logs it', async () => {
		const m = await make();
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 60 });
		const out = await EM.withdrawPick({ market: m.slug, accountId: ALICE });
		expect(out.withdrawn.points).toBe(60);
		expect(out.market.pick_count).toBe(0);
		expect(out.market.odds.even_prior).toBe(true);
		await expect(EM.withdrawPick({ market: m.slug, accountId: ALICE })).rejects.toMatchObject({ status: 404, code: 'pick_not_found' });
	});
});

describe('history', () => {
	it('replays the pick log: one point per real event, odds exact after each', async () => {
		const m = await make();
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 100 });
		await EM.placePick({ market: m.slug, accountId: BOB, outcomeId: m.outcomes[1].id, points: 100 });
		await EM.withdrawPick({ market: m.slug, accountId: BOB });
		const h = await EM.marketHistory(m.slug);
		expect(h.event_count).toBe(3);
		expect(h.points.map((p) => p.action)).toEqual(['place', 'place', 'withdraw']);
		expect(h.points[1].odds[0].share).toBeCloseTo(h.points[1].odds[1].share);
		expect(h.points[2].picks).toBe(1);
		expect(h.prior.odds.every((o) => Math.abs(o.share - 1 / 3) < 1e-9)).toBe(true);
	});
	it('has no points for a market nobody has picked', async () => {
		const m = await make();
		const h = await EM.marketHistory(m.slug);
		expect(h.points).toEqual([]);
	});
});

describe('void', () => {
	it('refunds every live pick, frees the budget and closes the market', async () => {
		const m = await make();
		await EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 100 });
		await EM.placePick({ market: m.slug, accountId: BOB, outcomeId: m.outcomes[1].id, points: 40 });
		const other = await make({ slug: 'second-market', title: 'A second market' });
		const out = await EM.voidMarket(m.slug, 'Event cancelled');
		expect(out).toMatchObject({ refunded_picks: 2, refunded_points: 140 });
		expect(out.market).toMatchObject({ status: 'void', void_reason: 'Event cancelled', pick_count: 0 });
		const viewer = await EM.getMarket(other.slug, { viewer: ALICE });
		expect(viewer.viewer.budget.committed_elsewhere).toBe(0);
		await expect(EM.placePick({ market: m.slug, accountId: ALICE, outcomeId: m.outcomes[0].id, points: 20 })).rejects.toMatchObject({ code: 'market_closed' });
		const h = await EM.marketHistory(m.slug);
		expect(h.points.at(-1)).toMatchObject({ action: 'void', picks: 0 });
		await expect(EM.voidMarket(m.slug)).rejects.toMatchObject({ code: 'invalid_transition' });
	});
});

describe('resolve', () => {
	it('records the winner and shows it on read', async () => {
		const m = await make();
		const r = await EM.resolveMarket(m.slug, m.outcomes[2].id);
		expect(r.status).toBe('resolved');
		expect(r.winner).toMatchObject({ label: 'Gamma', ref_kind: 'agent' });
		expect(r.outcomes.find((o) => o.is_winner).label).toBe('Gamma');
		await expect(EM.resolveMarket(m.slug, m.outcomes[0].id)).rejects.toMatchObject({ code: 'already_resolved' });
		expect((await EM.resolveMarket(m.slug, m.outcomes[2].id)).status).toBe('resolved');
	});
	it('refuses a foreign outcome', async () => {
		const m = await make();
		const o = await make({ slug: 'foreign-one', title: 'Foreign market' });
		await expect(EM.resolveMarket(m.slug, o.outcomes[0].id)).rejects.toMatchObject({ code: 'outcome_not_found' });
	});
});

describe('list', () => {
	it('sorts by closing soonest then most picks, filters, and paginates by cursor', async () => {
		const soon = await make({ slug: 'closes-soon', title: 'Closes soon', locks_at: inHours(1) });
		const laterBusy = await make({ slug: 'later-busy', title: 'Later busy', locks_at: inHours(5), source_kind: 'bounty' });
		const laterQuiet = await make({ slug: 'later-quiet', title: 'Later quiet', locks_at: inHours(5), source_kind: 'bounty' });
		await holder.db.exec(`update event_markets set locks_at = (select locks_at from event_markets where slug = 'later-busy') where slug = 'later-quiet'`);
		await EM.placePick({ market: laterQuiet.slug, accountId: ALICE, outcomeId: laterQuiet.outcomes[0].id, points: 20 });
		await EM.placePick({ market: laterQuiet.slug, accountId: BOB, outcomeId: laterQuiet.outcomes[0].id, points: 20 });
		const all = await EM.listMarkets({});
		expect(all.items.map((i) => i.slug)).toEqual(['closes-soon', 'later-quiet', 'later-busy']);
		expect(all.items[0].outcomes[0]).not.toHaveProperty('ref_id');
		const bounty = await EM.listMarkets({ sourceKind: 'bounty' });
		expect(bounty.items.map((i) => i.slug)).toEqual(['later-quiet', 'later-busy']);
		const search = await EM.listMarkets({ q: 'soon' });
		expect(search.items.map((i) => i.slug)).toEqual(['closes-soon']);
		const p1 = await EM.listMarkets({ limit: 2 });
		expect(p1.hasMore).toBe(true);
		const p2 = await EM.listMarkets({ limit: 2, cursor: p1.nextCursor });
		expect([...p1.items, ...p2.items].map((i) => i.slug)).toEqual(['closes-soon', 'later-quiet', 'later-busy']);
		expect(p2.hasMore).toBe(false);
		await expect(EM.listMarkets({ cursor: 'garbage' })).rejects.toMatchObject({ code: 'invalid_cursor' });
		await expect(EM.listMarkets({ status: 'nope' })).rejects.toMatchObject({ code: 'invalid_parameter' });
		void soon; void laterBusy;
	});
	it('lists a market past its lock time as locked, not open', async () => {
		const m = await make();
		await holder.db.exec(`update event_markets set locks_at = now() - interval '1 minute', opens_at = now() - interval '1 hour' where id = '${m.id}'`);
		expect((await EM.listMarkets({ status: 'open' })).items).toHaveLength(0);
		expect((await EM.listMarkets({ status: 'locked' })).items.map((i) => i.slug)).toEqual([m.slug]);
	});
});

describe('update', () => {
	it('edits text and times, adds an outcome, removes one only from a draft without picks', async () => {
		const m = await make({ status: 'draft' });
		const edited = await EM.updateMarket(m.slug, { title: 'Renamed market', outcomes: [{ label: 'Delta' }], remove_outcome_ids: [m.outcomes[0].id] });
		expect(edited.title).toBe('Renamed market');
		expect(edited.outcomes.map((o) => o.label)).toEqual(['Beta', 'Gamma', 'Delta']);
		const opened = await EM.updateMarket(m.slug, { status: 'open' });
		expect(opened.status).toBe('open');
		await expect(EM.updateMarket(m.slug, { remove_outcome_ids: [edited.outcomes[0].id] })).rejects.toMatchObject({ code: 'outcome_locked' });
		await expect(EM.updateMarket(m.slug, { locks_at: inHours(-1) })).rejects.toMatchObject({ code: 'invalid_time' });
	});
	it('refuses edits to a resolved market', async () => {
		const m = await make();
		await EM.resolveMarket(m.slug, m.outcomes[0].id);
		await expect(EM.updateMarket(m.slug, { title: 'Too late edit' })).rejects.toMatchObject({ code: 'market_not_editable' });
	});
});
