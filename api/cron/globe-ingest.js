// GET /api/cron/globe-ingest - keep the /globe event window filled.
//
// GDELT publishes the world's geolocated event stream as one file every fifteen
// minutes and offers no way to query history: the GEO 2.0 API that used to serve
// that role 404s for every query, its own documented examples included. So the
// globe's 24h / 7d / 30d control is only truthful if we hold the window
// ourselves. This cron reads each new export file as it lands, keeps the three
// CAMEO families the globe renders (armed conflict, force posture, sanctions),
// and writes them to globe_events.
//
// Shape of a run:
//   1. Ask GDELT which file is current.
//   2. Walk backwards from it, skipping stamps already ingested, until either
//      MAX_FILES are read or the backfill horizon is reached.
//   3. Upsert on GlobalEventID, so overlapping runs converge instead of
//      duplicating and a re-read of the same file is free.
//   4. Prune past the retention horizon.
//
// Bounded by design: one tick reads at most MAX_FILES files (a few hundred KB),
// so a cold start after an outage catches up over several ticks rather than
// trying to pull a day of history inside one function invocation.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { gdeltLatestStamp, fetchGdeltFile, gdeltStampFor, parseGdeltStamp } from '../_lib/globe-sources.js';

// One tick's fetch budget. Each file is ~70 KB zipped and yields ~100 kept rows,
// so twelve files is three hours of catch-up per run against a 15-minute cadence.
const MAX_FILES = Number(process.env.GLOBE_INGEST_MAX_FILES) || 12;

// How far back a catching-up instance will reach: the longest window the UI
// offers, so a deployment eventually holds a real 30-day view rather than a
// 30-day label over three days of data.
//
// The arithmetic works out because backfill is far cheaper than it looks. Each
// tick reads MAX_FILES files while only one new file has appeared, so a run at
// this cadence gains eleven files of history for every one it has to keep up
// with, and a cold table fills a month in about three days. Until it does, the
// API reports the window it actually covers and the page says so on the layer.
const BACKFILL_HOURS = Number(process.env.GLOBE_INGEST_BACKFILL_HOURS) || 24 * 30;

// The longest window the UI offers, plus two days of slack so a 30-day view is
// never truncated by the sweep that runs mid-request.
const RETENTION_DAYS = Number(process.env.GLOBE_RETENTION_DAYS) || 32;

// Beyond this age, only multi-source events are kept.
//
// Two reasons, and they agree. Editorially, a 30-day overview should be the
// shape of the month, and a month of single-source reports is mostly noise at
// that zoom; the recent window is where an individual report still matters.
// Practically, this is a chatty table (roughly 120 rows every fifteen minutes)
// on a database already near its retention high-water mark, and thinning the
// tail roughly halves what a full 30-day window costs. Nothing is thinned
// inside the detail window, so no view of the last week loses a point.
const FULL_FIDELITY_DAYS = Number(process.env.GLOBE_FULL_FIDELITY_DAYS) || 7;
const TAIL_MIN_MENTIONS = Number(process.env.GLOBE_TAIL_MIN_MENTIONS) || 3;

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

// GDELT occasionally skips a slot outright, and a stamp with no file will never
// appear in globe_events, so nothing else would stop the backfill queue from
// asking for it on every tick forever. Remembering the misses costs one Set and
// keeps a permanently absent file from holding a fetch slot. It is deliberately
// per instance and unbounded in lifetime rather than persisted: a restart
// retrying a handful of stamps once is cheaper than a table to avoid it.
const MISSING_STAMPS = new Set();

/** The stamps of the last `hours` of files, newest first. */
function candidateStamps(latestStamp, hours) {
	const latest = parseGdeltStamp(latestStamp);
	if (!latest) return [];
	const out = [];
	const buckets = Math.floor((hours * 60) / 15);
	for (let i = 0; i < buckets; i++) {
		out.push(gdeltStampFor(new Date(latest.getTime() - i * FIFTEEN_MIN_MS)));
	}
	return out;
}

async function persist(rows) {
	if (!rows.length) return 0;
	// Neon's tagged template does not take a multi-row VALUES list built by hand,
	// and these batches are small (~100 rows/file), so the insert is chunked and
	// driven per row inside one awaited group rather than concatenated SQL.
	let written = 0;
	const CHUNK = 25;
	for (let i = 0; i < rows.length; i += CHUNK) {
		const chunk = rows.slice(i, i + CHUNK);
		const results = await Promise.all(
			chunk.map(
				(r) => sql`
					insert into globe_events (
						id, layer, occurred_at, lat, lon, place, country, cameo_code, root_code,
						quad_class, goldstein, mentions, avg_tone, actor1, actor2, source_url, source_stamp
					) values (
						${r.id}, ${r.layer}, ${r.at.toISOString()}, ${r.lat}, ${r.lon}, ${r.place}, ${r.country},
						${r.cameoCode}, ${r.rootCode}, ${r.quadClass}, ${r.goldstein}, ${r.mentions},
						${r.avgTone}, ${r.actor1}, ${r.actor2}, ${r.sourceUrl}, ${r.stamp}
					)
					on conflict (id) do update set
						mentions = greatest(globe_events.mentions, excluded.mentions),
						avg_tone = excluded.avg_tone
					returning (xmax = 0) as inserted
				`,
			),
		);
		written += results.filter((r) => r?.[0]?.inserted).length;
	}
	return written;
}

// requireWriteCapacity: this cron is the platform's chattiest writer per tick and
// the least urgent. When the database is at its storage high-water mark, the
// right move is to stand down and let db-retention reclaim space; a globe window
// that stops growing for an hour is a far smaller problem than a write path that
// cannot take a payment.
export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const startedAt = Date.now();
	const latest = await gdeltLatestStamp();

	const wanted = candidateStamps(latest, BACKFILL_HOURS);
	const known = await sql`
		select distinct source_stamp
		from globe_events
		where source_stamp = any(${wanted})
	`;
	const seen = new Set(known.map((r) => r.source_stamp));
	const outstanding = wanted.filter((s) => !seen.has(s) && !MISSING_STAMPS.has(s));
	const todo = outstanding.slice(0, MAX_FILES);

	const files = [];
	let inserted = 0;
	let scanned = 0;
	for (const stamp of todo) {
		try {
			const { rows, scanned: seenRows } = await fetchGdeltFile(stamp);
			scanned += seenRows;
			const written = await persist(rows);
			inserted += written;
			files.push({ stamp, kept: rows.length, inserted: written, scanned: seenRows });
		} catch (err) {
			// One missing file is not a failed run. Mark it so this instance stops
			// asking for it and the slot goes to a stamp that exists.
			MISSING_STAMPS.add(stamp);
			files.push({ stamp, error: String(err?.message || err) });
		}
	}

	const [pruned] = await sql`
		with gone as (
			delete from globe_events
			where occurred_at < now() - make_interval(days => ${RETENTION_DAYS})
			returning 1
		)
		select count(*)::int as n from gone
	`;

	const [thinned] = await sql`
		with gone as (
			delete from globe_events
			where occurred_at < now() - make_interval(days => ${FULL_FIDELITY_DAYS})
			  and mentions < ${TAIL_MIN_MENTIONS}
			returning 1
		)
		select count(*)::int as n from gone
	`;

	const [coverage] = await sql`
		select
			min(occurred_at) as oldest,
			max(occurred_at) as newest,
			count(*)::int   as rows
		from globe_events
	`;

	return json(res, 200, {
		ok: true,
		latestUpstreamFile: latest,
		filesRead: files.length,
		filesPending: Math.max(0, outstanding.length - files.length),
		filesMissing: MISSING_STAMPS.size,
		eventsScanned: scanned,
		eventsInserted: inserted,
		pruned: pruned?.n ?? 0,
		thinned: thinned?.n ?? 0,
		coverage: {
			oldest: coverage?.oldest ?? null,
			newest: coverage?.newest ?? null,
			rows: coverage?.rows ?? 0,
		},
		files,
		tookMs: Date.now() - startedAt,
	});
}, { requireWriteCapacity: true });
