// GET /api/cron/market-anomalies: scan live market series for anomalies and
// write them to market_anomaly_events.
//
// Runs every 15 minutes. Each processor loads its real series (see
// api/_lib/market-anomaly-sources.js), the detectors in api/_lib/market-anomaly.js
// score it, and new events are inserted with ON CONFLICT DO NOTHING on the
// event_key time bucket, so a persisting condition writes once per bucket. A
// processor whose source is down is reported in `errors` and never blocks the
// others; a series too short or flat to score is reported in `skipped` with the
// reason. Perp open interest has no public history, so every tick also appends a
// snapshot to market_anomaly_samples and that accumulated series is what the
// open_interest processor scores. Events feed the paid /api/x402/market-anomalies
// endpoint and the market_anomaly alert rules (api/_lib/pump-alert-runner.js).
// Docs: docs/market-anomalies.md.

import { json, wrapCron, method } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import {
	PROCESSORS,
	PRICE_SPEC,
	TVL_SPEC,
	STABLE_SUPPLY_SPEC,
	FUNDING_SPEC,
	OPEN_INTEREST_SPEC,
	detectMany,
	detectPegDeviation,
} from '../_lib/market-anomaly.js';
import {
	loadPriceSeries,
	loadSolanaTvlSeries,
	loadSolanaStablecoinSupplySeries,
	loadStablecoinBoard,
	loadPerpSnapshot,
	loadFundingSeries,
} from '../_lib/market-anomaly-sources.js';

const SAMPLE_RETENTION = '14 days';
const OI_METRIC = 'open_interest_usd';
const OI_HISTORY_LIMIT = 400;
const CONCURRENCY = 6;

async function pool(items, fn) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]);
			}
		}),
	);
	return out;
}

/** Append this tick's OI snapshot and return each perp's accumulated series. */
async function openInterestSeries(perps) {
	const live = perps.filter((p) => Number.isFinite(p.open_interest_usd) && p.open_interest_usd > 0);
	for (const p of live) {
		await sql`
			insert into market_anomaly_samples (metric, subject, value)
			values (${OI_METRIC}, ${p.symbol}, ${p.open_interest_usd})
			on conflict do nothing
		`;
	}
	await sql`delete from market_anomaly_samples where sampled_at < now() - ${SAMPLE_RETENTION}::interval`;
	return pool(live, async (p) => {
		const rows = await sql`
			select extract(epoch from sampled_at) * 1000 as t, value
			from market_anomaly_samples
			where metric = ${OI_METRIC} and subject = ${p.symbol}
			order by sampled_at desc
			limit ${OI_HISTORY_LIMIT}
		`;
		return {
			subject: p.symbol,
			points: rows.reverse().map((r) => ({ t: Number(r.t), v: Number(r.value) })),
		};
	});
}

/**
 * Run every processor once. Returns the anomalies found plus per-processor
 * skip and error logs; persistence is the caller's step.
 */
export async function scanMarkets() {
	const anomalies = [];
	const skipped = [];
	const errors = [];
	const stats = {};

	const run = async (name, fn) => {
		try {
			const r = await fn();
			stats[name] = r.scored;
			anomalies.push(...r.anomalies);
			skipped.push(...(r.skipped || []));
		} catch (err) {
			errors.push({ processor: name, error: err?.message || String(err) });
		}
	};

	const series = (spec) => async (load) => {
		const list = await load();
		const r = detectMany(spec, list);
		return { scored: list.length - r.skipped.length, ...r };
	};

	await Promise.all([
		run('price', async () => series(PRICE_SPEC)(loadPriceSeries)),
		run('tvl', async () => series(TVL_SPEC)(loadSolanaTvlSeries)),
		run('stablecoin_supply', async () => series(STABLE_SUPPLY_SPEC)(loadSolanaStablecoinSupplySeries)),
		run('stablecoin_peg', async () => {
			const board = await loadStablecoinBoard();
			const found = board.map((c) => detectPegDeviation(c)).filter(Boolean);
			return { scored: board.length, anomalies: found };
		}),
		run('funding', async () => {
			const perps = await loadPerpSnapshot();
			const list = (await pool(perps, async (p) => {
				try {
					return await loadFundingSeries(p.coin);
				} catch {
					return null;
				}
			})).filter(Boolean);
			if (!list.length) throw new Error('no funding history returned');
			const r = detectMany(FUNDING_SPEC, list);
			return { scored: list.length - r.skipped.length, ...r };
		}),
		run('open_interest', async () => {
			const perps = await loadPerpSnapshot();
			const list = await openInterestSeries(perps);
			const r = detectMany(OPEN_INTEREST_SPEC, list);
			return { scored: list.length - r.skipped.length, ...r };
		}),
	]);

	return { anomalies, skipped, errors, stats };
}

/** Insert new events; returns the rows that were actually new. */
export async function persistAnomalies(anomalies) {
	const fresh = [];
	for (const a of anomalies) {
		const [row] = await sql`
			insert into market_anomaly_events
				(event_key, processor, subject, metric, severity, direction, value, baseline, change_pct, score, detectors, summary, observed_at)
			values
				(${a.event_key}, ${a.processor}, ${a.subject}, ${a.metric}, ${a.severity}, ${a.direction}, ${a.value}, ${a.baseline},
				 ${a.change_pct}, ${a.score}, ${JSON.stringify(a.detectors)}::jsonb, ${a.summary}, ${a.observed_at})
			on conflict (event_key) do nothing
			returning id
		`;
		if (row) fresh.push({ ...a, id: Number(row.id) });
	}
	return fresh;
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const scan = await scanMarkets();
	const fresh = await persistAnomalies(scan.anomalies);

	for (const s of scan.skipped) {
		console.warn(`[market-anomalies] skip ${s.processor}/${s.subject}: ${s.reason} (have ${s.have}, need ${s.need})`);
	}
	return json(res, 200, {
		ok: scan.errors.length < PROCESSORS.length,
		scored: scan.stats,
		detected: scan.anomalies.length,
		written: fresh.length,
		events: fresh,
		skipped: scan.skipped.length,
		skipped_detail: scan.skipped.slice(0, 50),
		errors: scan.errors,
	});
});
