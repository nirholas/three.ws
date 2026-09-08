// GET /api/globe/intel - every layer the /globe page draws, in one call.
//
//   /api/globe/intel?layers=conflicts,natural,outages&range=7d
//
// Eleven layers over six upstreams and one local table. They are resolved
// independently and in parallel, and a layer that fails comes back as
// `status: "unavailable"` with a reason rather than taking the response with it:
// on a situational map, "the outage feed is down" is itself information, and a
// dead third party must never blank the other ten layers.
//
// Every layer reports the window it actually covered. That is not decoration.
// The 24h / 7d / 30d control is honest for the layers whose upstream serves
// history, and for the GDELT-derived layers it is honest only as far back as
// this deployment has been ingesting (api/cron/globe-ingest). Saying so in the
// payload is the difference between a dashboard and a decoration.
//
// Keyless by design: nothing here reads a credential, so the page works on a
// fresh clone and on any deploy.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cors, method, wrap, json, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { cacheWrapLastGood } from '../_lib/cache.js';
import { sql, isDbUnavailableError } from '../_lib/db.js';
import { countryCentroid } from '../_lib/globe-centroids.js';
import {
	ALL_LAYERS,
	RANGES,
	DEFAULT_RANGE,
	fetchUsgs,
	fetchEonet,
	fetchGdacs,
	fetchIoda,
	fetchWorldBank,
	fetchGdeltFile,
	gdeltLatestStamp,
	gdeltStampFor,
	gdeltRowToEvent,
	computeHotspots,
	chokepointPressure,
} from '../_lib/globe-sources.js';

const REFERENCE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/globe-reference.json');

let _reference = null;
function reference() {
	if (!_reference) _reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8'));
	return _reference;
}

// A browser can draw far more points than a person can read. The cap keeps the
// payload in the hundreds of kilobytes and the frame budget intact; hotspots are
// computed from the FULL set before the cap is applied, so density is never
// distorted by what the point layer had room for.
const MAX_POINTS = 1500;

// How many 15-minute GDELT files to pull live when the table is empty. This is
// the cold-start path only (fresh deploy, or the ingest cron has not run yet);
// four files is one hour of coverage, which the response says plainly.
const COLD_START_FILES = 4;

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const nowIso = () => new Date().toISOString();

/** Trim a layer to MAX_POINTS, loudest first, and say what was left out. */
function capPoints(events) {
	if (events.length <= MAX_POINTS) return { events, total: events.length, truncated: false };
	const ranked = [...events].sort((a, b) => (b.severity || 0) - (a.severity || 0) || (b.weight || 0) - (a.weight || 0));
	return { events: ranked.slice(0, MAX_POINTS), total: events.length, truncated: true };
}

function withinRange(events, hours) {
	const cutoff = Date.now() - hours * 3600 * 1000;
	return events.filter((e) => {
		const t = Date.parse(e.at);
		return !Number.isFinite(t) || t >= cutoff;
	});
}

// ── GDELT-derived layers ─────────────────────────────────────────────────────

/**
 * Read the ingested window out of Postgres. Returns null (not an empty array)
 * when the table holds nothing for the window, so the caller can tell "no events
 * happened" apart from "this deployment has not ingested yet" and pick the
 * cold-start path for the second one.
 */
async function gdeltFromDb(hours) {
	const rows = await sql`
		select id, layer, occurred_at, lat, lon, place, country, cameo_code, root_code,
		       goldstein, mentions, avg_tone, actor1, actor2, source_url
		from globe_events
		where occurred_at >= now() - make_interval(hours => ${hours})
		order by occurred_at desc
	`;
	if (!rows.length) return null;
	return rows.map((r) =>
		gdeltRowToEvent({
			id: r.id,
			layer: r.layer,
			lat: r.lat,
			lon: r.lon,
			place: r.place,
			country: r.country,
			cameoCode: r.cameo_code,
			rootCode: r.root_code,
			goldstein: r.goldstein,
			mentions: r.mentions,
			avgTone: r.avg_tone,
			actor1: r.actor1,
			actor2: r.actor2,
			sourceUrl: r.source_url,
			at: new Date(r.occurred_at),
		}),
	);
}

/** The cold-start path: read the newest few files straight from GDELT. */
async function gdeltLive() {
	const latest = await gdeltLatestStamp();
	const base = new Date(
		`${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}T${latest.slice(8, 10)}:${latest.slice(10, 12)}:00Z`,
	);
	const stamps = [];
	for (let i = 0; i < COLD_START_FILES; i++) stamps.push(gdeltStampFor(new Date(base.getTime() - i * FIFTEEN_MIN_MS)));
	const files = await Promise.allSettled(stamps.map((s) => fetchGdeltFile(s)));
	const events = [];
	for (const f of files) {
		if (f.status !== 'fulfilled') continue;
		for (const row of f.value.rows) events.push(gdeltRowToEvent(row));
	}
	return events;
}

/**
 * The three CAMEO layers plus the hotspot clusters derived from them, resolved
 * once per request because they all read the same event set.
 */
async function resolveGdelt(hours) {
	let events = null;
	let coverage = 'ingested';
	let liveReason = null;

	try {
		events = await gdeltFromDb(hours);
	} catch (err) {
		if (!isDbUnavailableError(err)) throw err;
		liveReason = 'db_unavailable';
	}

	if (!events) {
		// Two different situations reach the cold-start path and they deserve two
		// different sentences on the page: a young deployment whose window has not
		// filled yet, and a database we cannot currently read.
		liveReason = liveReason || 'not_ingested';
		events = await gdeltLive();
		coverage = 'live';
	}

	const times = events.map((e) => Date.parse(e.at)).filter(Number.isFinite);
	return {
		events,
		coverage,
		liveReason,
		window: times.length
			? { from: new Date(Math.min(...times)).toISOString(), to: new Date(Math.max(...times)).toISOString() }
			: null,
	};
}

const GDELT_NOTE = {
	ingested: 'Ingested continuously from the GDELT 2.0 event stream by /api/cron/globe-ingest.',
	not_ingested:
		'Read live from the newest GDELT export files. This deployment has not ingested a longer window yet, so the events shown cover about the last hour rather than the selected range.',
	db_unavailable:
		'Read live from the newest GDELT export files because the stored window could not be read. The events shown cover about the last hour rather than the selected range.',
};

const gdeltNote = (g) => (g.coverage === 'ingested' ? GDELT_NOTE.ingested : GDELT_NOTE[g.liveReason] || GDELT_NOTE.not_ingested);

// ── the resolver table ───────────────────────────────────────────────────────

/**
 * One entry per layer. `ttl` is how long the shared cache holds a fresh result;
 * they differ because the upstreams differ: GDELT lands every 15 minutes, the
 * World Bank publishes once a year.
 */
function resolvers({ range, hours, gdelt }) {
	const cached = (key, ttl, fn) => cacheWrapLastGood(`globe:${key}`, ttl, fn, { withMeta: true });

	return {
		conflicts: async () => {
			const g = await gdelt();
			return {
				events: g.events.filter((e) => e.layer === 'conflicts'),
				window: g.window,
				coverage: g.coverage,
				note: GDELT_NOTE[g.coverage],
				source: 'GDELT 2.0 event stream, CAMEO assault, armed clash and mass violence codes',
			};
		},
		military: async () => {
			const g = await gdelt();
			return {
				events: g.events.filter((e) => e.layer === 'military'),
				window: g.window,
				coverage: g.coverage,
				note: GDELT_NOTE[g.coverage],
				source: 'GDELT 2.0 event stream, CAMEO force posture codes (150-155)',
			};
		},
		sanctions: async () => {
			const g = await gdelt();
			return {
				events: g.events.filter((e) => e.layer === 'sanctions'),
				window: g.window,
				coverage: g.coverage,
				note: GDELT_NOTE[g.coverage],
				source: 'GDELT 2.0 event stream, CAMEO embargo, boycott and administrative sanction codes',
			};
		},
		hotspots: async () => {
			const g = await gdelt();
			return {
				events: computeHotspots(g.events),
				window: g.window,
				coverage: g.coverage,
				note: 'Cells where force, posture and coercion coverage concentrates, weighted by press mentions rather than raw event count.',
				source: 'Computed from the GDELT event set behind the conflict layers',
			};
		},
		natural: async () => {
			const [quakes, eonet, gdacs] = await Promise.all([
				cached(`usgs:${range}`, 600, () => fetchUsgs(range)),
				cached(`eonet:${range}`, 1800, () => fetchEonet(range)),
				cached('gdacs', 900, () => fetchGdacs()),
			]);
			const events = [
				...quakes.value,
				...eonet.value.filter((e) => e.layer === 'natural'),
				...gdacs.value.filter((e) => e.layer === 'natural'),
			];
			return {
				events: withinRange(events, hours),
				stale: quakes.stale || eonet.stale || gdacs.stale,
				source: 'USGS earthquake feed, NASA EONET, GDACS',
				note: 'Earthquakes, volcanoes, wildfires and landslides currently open or recorded in the window.',
			};
		},
		weather: async () => {
			const [gdacs, eonet] = await Promise.all([
				cached('gdacs', 900, () => fetchGdacs()),
				cached(`eonet:${range}`, 1800, () => fetchEonet(range)),
			]);
			const events = [
				...gdacs.value.filter((e) => e.layer === 'weather'),
				...eonet.value.filter((e) => e.layer === 'weather'),
			];
			return {
				events: withinRange(events, hours),
				stale: gdacs.stale || eonet.stale,
				source: 'GDACS (UN and European Commission), NASA EONET',
				note: 'Tropical cyclones, floods, drought and severe storms on the GDACS alert scale.',
			};
		},
		outages: async () => {
			const r = await cached(`ioda:${range}`, 600, () => fetchIoda(range, countryCentroid));
			return {
				events: r.value,
				stale: r.stale,
				source: 'IODA, Georgia Tech Internet Outage Detection and Analysis',
				note: 'Countries whose reachable address space fell below its own recent baseline, across BGP, active probing and telescope data.',
			};
		},
		economic: async () => {
			const r = await cached('worldbank', 21_600, () => fetchWorldBank(countryCentroid));
			return {
				// Deliberately not windowed: these are annual figures, and the newest
				// one a country has filed can be a year old. Applying the range filter
				// here would empty the layer rather than narrow it.
				events: r.value,
				stale: r.stale,
				source: 'World Bank open data, annual real GDP growth',
				note: 'One marker per country at its most recent reported year. Contraction is drawn loudest.',
			};
		},
		bases: async () => {
			const ref = reference();
			return {
				events: ref.bases.map((b) => ({
					id: `base:${b.id}`,
					layer: 'bases',
					kind: b.operator,
					lat: b.lat,
					lon: b.lon,
					title: b.name,
					detail: [b.branch, b.host ? `Host: ${b.host}` : '', b.status !== 'active' ? `Status: ${b.status}` : '']
						.filter(Boolean)
						.join('. '),
					place: b.host,
					operator: b.operator,
					status: b.status,
					severity: b.status === 'active' ? 0.5 : b.status === 'controversial' ? 0.65 : 0.3,
					at: null,
					source: 'Overseas military base reference set',
					url: null,
				})),
				static: true,
				source: ref.sources.bases,
				note: 'Reference geography, not a live feed. Switch it on to read the live layers against who is already there.',
			};
		},
		nuclear: async () => {
			const ref = reference();
			const label = { plant: 'Nuclear power station', enrichment: 'Enrichment or fuel-cycle site', weapons: 'Weapons complex' };
			return {
				events: ref.nuclear.map((n) => ({
					id: `nuclear:${n.id}`,
					layer: 'nuclear',
					kind: n.kind,
					lat: n.lat,
					lon: n.lon,
					title: n.name,
					detail: `${label[n.kind] || 'Nuclear facility'}${n.status !== 'active' ? `, ${n.status}` : ''}`,
					place: n.name,
					status: n.status,
					severity: n.kind === 'weapons' ? 0.75 : n.kind === 'enrichment' ? 0.6 : 0.4,
					at: null,
					source: 'Nuclear facility reference set',
					url: null,
				})),
				static: true,
				source: ref.sources.nuclear,
				note: 'Power stations, fuel-cycle sites and weapons complexes.',
			};
		},
		waterways: async () => {
			const ref = reference();
			const g = await gdelt();
			const pressure = g.events.filter((e) => e.layer === 'conflicts' || e.layer === 'military');
			return {
				events: chokepointPressure(ref.waterways, pressure),
				window: g.window,
				coverage: g.coverage,
				source: ref.sources.waterways,
				note: 'Each chokepoint carries the armed activity and force posture the live feed puts within 600 km of it, so the layer reacts instead of sitting still.',
			};
		},
	};
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const ip = clientIp(req);
	const [ipRl, globalRl] = await Promise.all([limits.cryptoDataIp(ip), limits.cryptoDataGlobal()]);
	if (!ipRl.success || !globalRl.success) {
		return error(res, 429, 'rate_limited', 'too many requests - slow down and retry shortly', { retryAfter: 60 });
	}

	const url = new URL(req.url, 'http://x');
	const range = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : DEFAULT_RANGE;
	const hours = RANGES[range].hours;

	const asked = (url.searchParams.get('layers') || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const unknown = asked.filter((l) => !ALL_LAYERS.includes(l));
	if (unknown.length) {
		return error(res, 400, 'unknown_layer', `not a layer on this globe: ${unknown.join(', ')}`, { layers: ALL_LAYERS });
	}
	const wanted = asked.length ? [...new Set(asked)] : ALL_LAYERS;

	// The GDELT read is shared by four layers, so it runs at most once per request
	// no matter how many of them were asked for.
	let gdeltPromise = null;
	const gdelt = () => {
		if (!gdeltPromise) gdeltPromise = resolveGdelt(hours);
		return gdeltPromise;
	};

	const table = resolvers({ range, hours, gdelt });
	const settled = await Promise.allSettled(wanted.map((layer) => table[layer]()));

	const layers = {};
	let totalEvents = 0;
	for (let i = 0; i < wanted.length; i++) {
		const layer = wanted[i];
		const outcome = settled[i];
		if (outcome.status === 'rejected') {
			layers[layer] = {
				status: 'unavailable',
				events: [],
				count: 0,
				reason: String(outcome.reason?.message || outcome.reason || 'upstream failed'),
			};
			continue;
		}
		const r = outcome.value;
		const { events, total, truncated } = capPoints(r.events);
		totalEvents += events.length;
		layers[layer] = {
			status: r.stale ? 'stale' : 'ok',
			events,
			count: events.length,
			total,
			truncated,
			window: r.window ?? (r.static ? null : { from: new Date(Date.now() - hours * 3600 * 1000).toISOString(), to: nowIso() }),
			coverage: r.coverage ?? (r.static ? 'static' : 'upstream'),
			source: r.source,
			note: r.note,
		};
	}

	// GDELT lands a new file every 15 minutes and the ingest cron follows it, so a
	// shorter edge TTL than that would only ever serve the same bytes again.
	res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=900');
	return json(res, 200, {
		generated: nowIso(),
		range,
		rangeLabel: RANGES[range].label,
		requested: wanted,
		maxPointsPerLayer: MAX_POINTS,
		totalEvents,
		layers,
	});
});
