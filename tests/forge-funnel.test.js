import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	clampFunnelDays,
	rate,
	summarizeOutput,
	summarizeNewActors,
	summarizeRetention,
	summarizeDestinations,
	summarizeLanes,
	summarizeRevenue,
	MIN_SAMPLE,
	FUNNEL_DEFAULT_DAYS,
} from '../api/_lib/forge-funnel.js';
import {
	FORGE_DESTINATIONS,
	validForgeDestination,
	forgeDestinationLabel,
} from '../src/shared/forge-destinations.js';

describe('forge destinations', () => {
	it('accepts known ids regardless of case and padding', () => {
		expect(validForgeDestination('game')).toBe('game');
		expect(validForgeDestination('  Simulation ')).toBe('simulation');
	});

	it('rejects anything that is not one of ours', () => {
		for (const bad of [undefined, null, '', 42, {}, 'robots', 'game; drop table']) {
			expect(validForgeDestination(bad)).toBeNull();
		}
	});

	it('labels known ids and echoes unknown ones', () => {
		expect(forgeDestinationLabel('ar')).toBe('AR');
		expect(forgeDestinationLabel('holodeck')).toBe('holodeck');
	});

	it('keeps ids unique, since they are a stored wire format', () => {
		const ids = FORGE_DESTINATIONS.map((d) => d.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

// The chips are static markup (so the i18n pass localizes them), which means
// the list exists in three places: the shared module, /forge and /forge-studio.
// A chip the server does not know is a tap that silently records nothing.
describe('destination chips in the composer pages', () => {
	const expected = FORGE_DESTINATIONS.map((d) => d.id);
	const en = JSON.parse(readFileSync(new URL('../public/locales/en.json', import.meta.url), 'utf8'));

	for (const page of ['forge.html', 'forge-studio.html']) {
		it(`${page} offers exactly the destinations the server accepts, in order`, () => {
			const html = readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');
			const ids = [...html.matchAll(/data-dest="([^"]+)"/g)].map((m) => m[1]);
			expect(ids).toEqual(expected);
		});
	}

	it('has an English label and hint for every destination', () => {
		for (const d of FORGE_DESTINATIONS) {
			expect(en.forge[`dest_${d.id}`]).toBe(d.label);
			expect(en.forge[`dest_${d.id}_hint`]).toBe(d.hint);
		}
	});
});

describe('clampFunnelDays', () => {
	it('defaults when the parameter is absent, not to a one-day window', () => {
		// Number(null) and Number('') are 0; a naive clamp would return 1.
		expect(clampFunnelDays(null)).toBe(FUNNEL_DEFAULT_DAYS);
		expect(clampFunnelDays(undefined)).toBe(FUNNEL_DEFAULT_DAYS);
		expect(clampFunnelDays('')).toBe(FUNNEL_DEFAULT_DAYS);
		expect(clampFunnelDays('abc')).toBe(FUNNEL_DEFAULT_DAYS);
	});

	it('clamps to the supported range and floors fractions', () => {
		expect(clampFunnelDays('7')).toBe(7);
		expect(clampFunnelDays(7.9)).toBe(7);
		expect(clampFunnelDays(0)).toBe(1);
		expect(clampFunnelDays(-5)).toBe(1);
		expect(clampFunnelDays(10_000)).toBe(365);
	});
});

describe('rate', () => {
	it('is null on an empty base rather than 0 or NaN', () => {
		expect(rate(0, 0)).toBeNull();
		expect(rate(5, 0)).toBeNull();
	});

	it('rounds to four places', () => {
		expect(rate(1, 3)).toBe(0.3333);
		expect(rate(2, 2)).toBe(1);
	});
});

describe('summarizeOutput', () => {
	it('computes useful output and coverage over finished rows only', () => {
		const out = summarizeOutput({
			requests: 130, in_flight: 5, done: 100, failed: 25,
			useful: 40, accepted: 30, rejected: 10, downloaded: 25, rated: 8,
			avg_rating: '3.666', signalled: 55, unattributed: 12,
		});
		expect(out.generation_success_rate).toMatchObject({ value: 0.8, n: 100, of: 125 });
		expect(out.useful_output_rate).toMatchObject({ value: 0.4, n: 40, of: 100, low_sample: false });
		expect(out.feedback_coverage.value).toBe(0.55);
		expect(out.avg_rating).toBe(3.67);
		expect(out.unattributed_requests).toBe(12);
	});

	it('renders an empty window without NaN and flags it low sample', () => {
		const out = summarizeOutput();
		expect(out.done).toBe(0);
		expect(out.useful_output_rate).toEqual({ value: null, n: 0, of: 0, low_sample: true });
		expect(out.avg_rating).toBeNull();
	});

	it('flags a rate that rests on fewer rows than the minimum sample', () => {
		const out = summarizeOutput({ done: MIN_SAMPLE - 1, useful: MIN_SAMPLE - 1 });
		expect(out.useful_output_rate.value).toBe(1);
		expect(out.useful_output_rate.low_sample).toBe(true);
	});
});

describe('summarizeNewActors', () => {
	it('bases the second-asset rate on makers who got a first asset, not on everyone', () => {
		const a = summarizeNewActors({ new_actors: 200, with_asset: 120, with_second_asset: 30, with_useful: 50 });
		expect(a.first_asset_success_rate).toMatchObject({ value: 0.25, of: 200 });
		expect(a.reached_any_asset_rate.value).toBe(0.6);
		expect(a.second_asset_rate).toMatchObject({ value: 0.25, n: 30, of: 120 });
	});
});

describe('summarizeRetention', () => {
	it('keeps the D7 and D30 cohorts separate', () => {
		const r = summarizeRetention({ d7_cohort: 400, d7_retained: 60, d30_cohort: 250, d30_retained: 20 });
		expect(r.d7).toMatchObject({ value: 0.15, of: 400 });
		expect(r.d30).toMatchObject({ value: 0.08, of: 250 });
		expect(r.cohort_lookback_days).toBeGreaterThan(30);
	});
});

describe('summarizeDestinations', () => {
	it('lists every known destination even with no rows, and the unanswered bucket last', () => {
		const d = summarizeDestinations([
			{ destination: 'game', done: 50, useful: 30, downloaded: 28 },
			{ destination: null, done: 150, useful: 20, downloaded: 15 },
		]);
		expect(d.rows.map((x) => x.destination)).toEqual([...FORGE_DESTINATIONS.map((x) => x.id), null]);
		expect(d.rows.find((x) => x.destination === 'print')).toMatchObject({ done: 0, useful: 0 });
		expect(d.rows.at(-1)).toMatchObject({ label: 'Not answered', done: 150 });
		expect(d.answer_rate).toMatchObject({ value: 0.25, n: 50, of: 200 });
	});

	it('keeps a stored id this build does not know instead of dropping its rows', () => {
		const d = summarizeDestinations([{ destination: 'holodeck', done: 4, useful: 1, downloaded: 1 }]);
		const row = d.rows.find((x) => x.destination === 'holodeck');
		expect(row).toMatchObject({ label: 'holodeck', done: 4 });
		expect(d.rows.at(-1).destination).toBeNull();
	});
});

describe('summarizeLanes', () => {
	it('counts failed attempts in attempts-per-useful and sorts by volume', () => {
		const lanes = summarizeLanes([
			{ backend: 'hunyuan3d', done: 10, failed: 0, useful: 5, timed: 10, gen_seconds: 600 },
			{ backend: 'trellis_selfhost', done: 60, failed: 40, useful: 20, timed: 50, gen_seconds: 4500 },
		]);
		expect(lanes[0].backend).toBe('trellis_selfhost');
		expect(lanes[0]).toMatchObject({
			attempts: 100,
			attempts_per_useful: 5,
			avg_generation_seconds: 90,
			generation_seconds_per_useful: 225,
		});
		expect(lanes[0].generation_success_rate.value).toBe(0.6);
		expect(['free', 'paid']).toContain(lanes[0].cost_class);
	});

	it('reports null, never Infinity, when a lane produced nothing useful or untimed rows', () => {
		const [lane] = summarizeLanes([{ backend: null, done: 3, failed: 2, useful: 0, timed: 0, gen_seconds: 0 }]);
		expect(lane.backend).toBe('unknown');
		expect(lane.attempts_per_useful).toBeNull();
		expect(lane.avg_generation_seconds).toBeNull();
		expect(lane.generation_seconds_per_useful).toBeNull();
	});
});

describe('summarizeRevenue', () => {
	it('converts atomics to USDC and divides by useful assets', () => {
		const v = summarizeRevenue(
			{ paid: 40, payers: 6, atomic: '6150000', prior_week_payers: 4, retained_payers: 1 },
			{ useful: 25 },
		);
		expect(v.usdc).toBe(6.15);
		expect(v.usdc_per_useful_asset).toBe(0.246);
		expect(v.agent_weekly_retention).toMatchObject({ value: 0.25, n: 1, of: 4, low_sample: true });
		expect(v.rail).toBe('x402');
	});

	it('has no per-asset figure when nothing useful was produced', () => {
		expect(summarizeRevenue({ atomic: 500000 }, { useful: 0 }).usdc_per_useful_asset).toBeNull();
		expect(summarizeRevenue().usdc).toBe(0);
	});
});
