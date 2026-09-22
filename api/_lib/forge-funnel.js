// @ts-check
// Forge funnel report: does a generation turn into an asset someone keeps?
//
// The forge health sensor (ops/forge-health-sensor.js) answers "did the mesh
// come back?". That is a pipeline question. This module answers the product
// question that sits after it: of the meshes that came back, how many did a
// person accept or download, do makers come back for a second one, which lane
// earns its attempts, and what is each generation for. forge_creations has
// carried the verdict columns (outcome, rating, downloaded) since its first
// migration; nothing read them until now.
//
// Definitions, stated once so the endpoint, the CLI and the page quote one
// number computed one way:
//
//   useful     A finished row the maker accepted OR downloaded. Either is a
//              deliberate act on the result; a rating alone is not.
//   actor      coalesce(user_id, client_key). Rows written with no client key
//              hash to the literal key 'anon', which pools every keyless API
//              caller into one pseudo-actor, so per-actor metrics leave those
//              rows out and the report says how many it left out.
//   new actor  An actor whose first-ever creation falls inside the window.
//   internal   Platform-generated rows (catalog seeder, quality benchmark).
//              Excluded everywhere: by the `internal` flag going forward and by
//              forge_seed_jobs.creation_id for seeder rows that predate it.
//   superseded An attempt that failed over to another lane. The successor row
//              carries the request to its real outcome, so request-level metrics
//              skip the superseded attempt. The per-lane table keeps it, because
//              an attempt a lane lost is exactly what that table measures.
//
// Read-only. Every query is a SELECT.

import { sql } from './db.js';
import { backendCostClass } from './forge-tiers.js';
import { FORGE_DESTINATIONS } from '../../src/shared/forge-destinations.js';

export const FUNNEL_MIN_DAYS = 1;
export const FUNNEL_MAX_DAYS = 365;
export const FUNNEL_DEFAULT_DAYS = 30;

// A rate over fewer finished rows than this is reported, but flagged, so nobody
// reads "100% useful" off three generations.
export const MIN_SAMPLE = 20;

// Retention cohorts look back this far for first-time actors. Long enough to
// hold a judgeable cohort at Forge's volume, short enough to describe the
// current product rather than last spring's.
const COHORT_LOOKBACK_DAYS = 90;

/** Clamp a caller-supplied window to a whole number of days in range. */
export function clampFunnelDays(value) {
	// Number(null) and Number('') are both 0, which would clamp an absent
	// parameter to a one-day window instead of the default.
	if (value == null || value === '') return FUNNEL_DEFAULT_DAYS;
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return FUNNEL_DEFAULT_DAYS;
	return Math.min(FUNNEL_MAX_DAYS, Math.max(FUNNEL_MIN_DAYS, n));
}

/** n/d as a 0..1 number rounded to 4 places, or null when the base is empty. */
export function rate(n, d) {
	const num = Number(n) || 0;
	const den = Number(d) || 0;
	if (den <= 0) return null;
	return Math.round((num / den) * 10_000) / 10_000;
}

function int(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** A rate plus the counts behind it and whether the base is big enough to trust. */
function measured(n, d) {
	return { value: rate(n, d), n: int(n), of: int(d), low_sample: int(d) < MIN_SAMPLE };
}

// ── Pure summarizers ────────────────────────────────────────────────────────
// Each takes the exact row shape its query returns, so thresholds and edge
// cases (empty window, zero useful rows, unknown destination ids) are testable
// without a database.

/**
 * @param {Record<string, unknown>|undefined} r
 */
export function summarizeOutput(r = {}) {
	const done = int(r.done);
	const failed = int(r.failed);
	const useful = int(r.useful);
	const signalled = int(r.signalled);
	return {
		requests: int(r.requests),
		in_flight: int(r.in_flight),
		done,
		failed,
		generation_success_rate: measured(done, done + failed),
		useful_output_rate: measured(useful, done),
		accepted: int(r.accepted),
		rejected: int(r.rejected),
		downloaded: int(r.downloaded),
		rated: int(r.rated),
		avg_rating: r.avg_rating == null ? null : Math.round(Number(r.avg_rating) * 100) / 100,
		// How much of the finished output carries ANY human signal. This bounds
		// every other number here: a useful-output rate over rows nobody judged
		// undercounts, and a router cannot learn from rows with no label.
		feedback_coverage: measured(signalled, done),
		unattributed_requests: int(r.unattributed),
	};
}

/**
 * @param {Record<string, unknown>|undefined} r
 */
export function summarizeNewActors(r = {}) {
	const actors = int(r.new_actors);
	const withAsset = int(r.with_asset);
	return {
		new_actors: actors,
		// Of people who tried Forge for the first time in the window, how many
		// reached an asset they accepted or downloaded.
		first_asset_success_rate: measured(r.with_useful, actors),
		reached_any_asset_rate: measured(withAsset, actors),
		// Of those who got one finished asset, how many made a second. The
		// closest thing here to "did it work well enough to use again".
		second_asset_rate: measured(r.with_second_asset, withAsset),
	};
}

/**
 * @param {Record<string, unknown>|undefined} r
 */
export function summarizeRetention(r = {}) {
	return {
		cohort_lookback_days: COHORT_LOOKBACK_DAYS,
		d7: measured(r.d7_retained, r.d7_cohort),
		d30: measured(r.d30_retained, r.d30_cohort),
	};
}

/**
 * One row per destination, in the composer's order, then any id this build does
 * not know, then the unanswered bucket last. A known destination with no rows
 * still appears, so the table reads as "nobody chose Print", not as a gap.
 * @param {Array<Record<string, unknown>>} rows
 */
export function summarizeDestinations(rows = []) {
	const byId = new Map(rows.map((r) => [r.destination == null ? null : String(r.destination), r]));
	const shape = (id, label, r = {}) => ({
		destination: id,
		label,
		done: int(r.done),
		useful: int(r.useful),
		downloaded: int(r.downloaded),
		useful_output_rate: measured(r.useful, r.done),
	});
	const out = FORGE_DESTINATIONS.map((d) => shape(d.id, d.label, byId.get(d.id)));
	const known = new Set(FORGE_DESTINATIONS.map((d) => d.id));
	for (const [id, r] of byId) {
		if (id !== null && !known.has(id)) out.push(shape(id, id, r));
	}
	out.push(shape(null, 'Not answered', byId.get(null)));
	const answered = out.filter((d) => d.destination !== null).reduce((s, d) => s + d.done, 0);
	const total = out.reduce((s, d) => s + d.done, 0);
	return { rows: out, answer_rate: measured(answered, total) };
}

/**
 * Per-lane table. `attempts_per_useful` is the honest cost driver: how many
 * terminal attempts a lane spends for each asset someone keeps. Generation
 * seconds are summed only over rows that carry completed_at.
 * @param {Array<Record<string, unknown>>} rows
 */
export function summarizeLanes(rows = []) {
	return rows
		.map((r) => {
			const backend = r.backend == null ? 'unknown' : String(r.backend);
			const attempts = int(r.done) + int(r.failed);
			const useful = int(r.useful);
			const timed = int(r.timed);
			const seconds = Number(r.gen_seconds) || 0;
			return {
				backend,
				cost_class: backendCostClass(backend),
				attempts,
				done: int(r.done),
				failed: int(r.failed),
				useful,
				generation_success_rate: measured(r.done, attempts),
				useful_output_rate: measured(useful, r.done),
				attempts_per_useful: useful > 0 ? Math.round((attempts / useful) * 100) / 100 : null,
				avg_generation_seconds: timed > 0 ? Math.round(seconds / timed) : null,
				generation_seconds_per_useful: useful > 0 && timed > 0 ? Math.round(seconds / useful) : null,
				timed_attempts: timed,
			};
		})
		.sort((a, b) => b.attempts - a.attempts);
}

/**
 * x402 is the only payment rail whose price is recorded on the row, so this is
 * x402 revenue specifically, never "total revenue".
 * @param {Record<string, unknown>|undefined} r
 * @param {{ useful: number }} ctx
 */
export function summarizeRevenue(r = {}, { useful = 0 } = {}) {
	const atomic = Number(r.atomic) || 0;
	const usdc = Math.round(atomic / 10_000) / 100;
	return {
		rail: 'x402',
		paid_generations: int(r.paid),
		distinct_payers: int(r.payers),
		usdc,
		usdc_per_useful_asset: useful > 0 ? Math.round((atomic / 1_000_000 / useful) * 10_000) / 10_000 : null,
		// Distinct paying agents last week who paid again this week.
		agent_weekly_retention: measured(r.retained_payers, r.prior_week_payers),
	};
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Build the whole report. The panels are read independently: one failing query
 * names itself in `degraded` and leaves the others standing, matching the other
 * ops boards.
 * @param {{ days?: number }} [opts]
 */
export async function gatherForgeFunnel({ days = FUNNEL_DEFAULT_DAYS } = {}) {
	const windowDays = clampFunnelDays(days);
	const degraded = [];
	const panel = async (name, fn, fallback) => {
		try {
			return await fn();
		} catch (err) {
			degraded.push({ panel: name, error: String(err?.message || err).slice(0, 200) });
			return fallback;
		}
	};

	const outputPending = panel(
		'output',
		async () => {
			const [r] = await sql`
				select
					count(*)::int                                                            as requests,
					count(*) filter (where fc.status = 'generating')::int                    as in_flight,
					count(*) filter (where fc.status = 'done')::int                          as done,
					count(*) filter (where fc.status = 'failed')::int                        as failed,
					count(*) filter (where fc.status = 'done'
						and (fc.outcome = 'accepted' or fc.downloaded))::int                 as useful,
					count(*) filter (where fc.status = 'done' and fc.outcome = 'accepted')::int as accepted,
					count(*) filter (where fc.status = 'done' and fc.outcome = 'rejected')::int as rejected,
					count(*) filter (where fc.status = 'done' and fc.downloaded)::int        as downloaded,
					count(*) filter (where fc.status = 'done' and fc.rating is not null)::int as rated,
					avg(fc.rating) filter (where fc.status = 'done')                         as avg_rating,
					count(*) filter (where fc.status = 'done' and (fc.outcome in ('accepted', 'rejected')
						or fc.downloaded or fc.rating is not null))::int                     as signalled,
					count(*) filter (where fc.user_id is null and fc.client_key = 'anon')::int as unattributed
				from forge_creations fc
				where fc.created_at > now() - make_interval(days => ${windowDays})
				  and fc.internal = false
				  and fc.superseded_by is null
				  and not exists (select 1 from forge_seed_jobs sj where sj.creation_id = fc.id)
			`;
			return summarizeOutput(r);
		},
		summarizeOutput(),
	);

	const newActorsPending = panel(
		'new_actors',
		async () => {
			const [r] = await sql`
				with mine as (
					select coalesce(fc.user_id::text, fc.client_key) as actor,
					       fc.created_at, fc.status,
					       (fc.status = 'done' and (fc.outcome = 'accepted' or fc.downloaded)) as useful
					from forge_creations fc
					where fc.internal = false
					  and fc.superseded_by is null
					  and (fc.user_id is not null or fc.client_key <> 'anon')
					  and not exists (select 1 from forge_seed_jobs sj where sj.creation_id = fc.id)
				), per_actor as (
					select actor,
					       min(created_at)                          as first_at,
					       count(*) filter (where status = 'done')  as assets,
					       bool_or(useful)                          as any_useful
					from mine
					group by actor
				)
				select
					count(*)::int                                        as new_actors,
					count(*) filter (where assets >= 1)::int             as with_asset,
					count(*) filter (where assets >= 2)::int             as with_second_asset,
					count(*) filter (where any_useful)::int              as with_useful
				from per_actor
				where first_at > now() - make_interval(days => ${windowDays})
			`;
			return summarizeNewActors(r);
		},
		summarizeNewActors(),
	);

	const retentionPending = panel(
		'retention',
		async () => {
			const [r] = await sql`
				with mine as (
					select coalesce(fc.user_id::text, fc.client_key) as actor, fc.created_at
					from forge_creations fc
					where fc.internal = false
					  and (fc.user_id is not null or fc.client_key <> 'anon')
					  and not exists (select 1 from forge_seed_jobs sj where sj.creation_id = fc.id)
				), per_actor as (
					select actor, min(created_at) as first_at, max(created_at) as last_at
					from mine
					group by actor
				)
				select
					count(*) filter (where first_at <= now() - interval '7 days')::int   as d7_cohort,
					count(*) filter (where first_at <= now() - interval '7 days'
						and last_at >= first_at + interval '7 days')::int                as d7_retained,
					count(*) filter (where first_at <= now() - interval '30 days')::int  as d30_cohort,
					count(*) filter (where first_at <= now() - interval '30 days'
						and last_at >= first_at + interval '30 days')::int               as d30_retained
				from per_actor
				where first_at > now() - make_interval(days => ${COHORT_LOOKBACK_DAYS})
			`;
			return summarizeRetention(r);
		},
		summarizeRetention(),
	);

	const destinationsPending = panel(
		'destinations',
		async () => {
			const rows = await sql`
				select fc.destination,
				       count(*) filter (where fc.status = 'done')::int                   as done,
				       count(*) filter (where fc.status = 'done'
				           and (fc.outcome = 'accepted' or fc.downloaded))::int          as useful,
				       count(*) filter (where fc.status = 'done' and fc.downloaded)::int as downloaded
				from forge_creations fc
				where fc.created_at > now() - make_interval(days => ${windowDays})
				  and fc.internal = false
				  and fc.superseded_by is null
				  and not exists (select 1 from forge_seed_jobs sj where sj.creation_id = fc.id)
				group by fc.destination
			`;
			return summarizeDestinations(rows);
		},
		summarizeDestinations(),
	);

	const lanesPending = panel(
		'lanes',
		async () => {
			const rows = await sql`
				select fc.backend,
				       count(*) filter (where fc.status = 'done')::int   as done,
				       count(*) filter (where fc.status = 'failed')::int as failed,
				       count(*) filter (where fc.status = 'done'
				           and (fc.outcome = 'accepted' or fc.downloaded))::int as useful,
				       count(*) filter (where fc.completed_at is not null
				           and fc.status in ('done', 'failed'))::int     as timed,
				       coalesce(sum(extract(epoch from (fc.completed_at - fc.created_at)))
				           filter (where fc.completed_at is not null
				               and fc.status in ('done', 'failed')), 0)  as gen_seconds
				from forge_creations fc
				where fc.created_at > now() - make_interval(days => ${windowDays})
				  and fc.internal = false
				  and fc.status in ('done', 'failed')
				  and not exists (select 1 from forge_seed_jobs sj where sj.creation_id = fc.id)
				group by fc.backend
			`;
			return summarizeLanes(rows);
		},
		[],
	);

	const revenueRawPending = panel(
		'revenue',
		async () => {
			const [r] = await sql`
				with paid as (
					select fc.x402_payer, fc.x402_price_atomic, fc.created_at
					from forge_creations fc
					where fc.x402_tx_sig is not null and fc.internal = false
				), this_week as (
					select distinct x402_payer from paid
					where created_at > now() - interval '7 days' and x402_payer is not null
				), prior_week as (
					select distinct x402_payer from paid
					where created_at <= now() - interval '7 days'
					  and created_at > now() - interval '14 days' and x402_payer is not null
				)
				select
					(select count(*) from paid
						where created_at > now() - make_interval(days => ${windowDays}))::int as paid,
					(select count(distinct x402_payer) from paid
						where created_at > now() - make_interval(days => ${windowDays}))::int as payers,
					(select coalesce(sum(x402_price_atomic), 0) from paid
						where created_at > now() - make_interval(days => ${windowDays}))      as atomic,
					(select count(*) from prior_week)::int                                   as prior_week_payers,
					(select count(*) from prior_week p
						where exists (select 1 from this_week t
							where t.x402_payer = p.x402_payer))::int                         as retained_payers
			`;
			return r;
		},
		undefined,
	);

	// Independent reads, so they run together. Revenue per useful asset needs the
	// useful count from the output panel, so it is summarized once both are in.
	const [output, newActors, retention, destinations, lanes, revenueRaw] = await Promise.all([
		outputPending,
		newActorsPending,
		retentionPending,
		destinationsPending,
		lanesPending,
		revenueRawPending,
	]);
	const revenue = summarizeRevenue(revenueRaw, { useful: output.useful_output_rate.n });

	return {
		ok: degraded.length === 0,
		degraded,
		window_days: windowDays,
		generated_at: new Date().toISOString(),
		min_sample: MIN_SAMPLE,
		output,
		new_actors: newActors,
		retention,
		destinations,
		lanes,
		revenue,
	};
}
