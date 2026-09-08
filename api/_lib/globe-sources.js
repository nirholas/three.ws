// globe-sources: the upstream readers behind /globe.
//
// Eleven layers, six upstreams, one shape. Every layer on the globe resolves to
// the same normalized event record, so the renderer never learns which service a
// point came from:
//
//   { id, layer, lat, lon, title, detail, severity, at, source, url, place }
//
// severity is always 0..1 and always means "how much should this pull the eye",
// which is what the globe encodes as radius, colour and pulse. Each upstream
// computes it from whatever it actually publishes (Goldstein score and mention
// count for GDELT, magnitude for USGS, alert level for GDACS, the depth of an
// outage for IODA) rather than from a shared guess.
//
// Not one of these upstreams needs a credential, which is deliberate: the page
// has to work on a fresh clone and on a deploy where nobody has provisioned a
// key. Where a source publishes less than the UI asks for (GDELT ships one file
// every 15 minutes, so a 30-day window has to be accumulated rather than
// requested), the reader reports the window it actually covered instead of
// implying the full range.
//
// Parsers and normalizers here are pure and exported on their own so they can be
// tested against captured payloads with no network. The fetch wrappers below
// them own timeouts, retries and the breaker via fetchUpstream.

import { unzipSync } from 'fflate';
import { fetchUpstream, fetchUpstreamJson } from './upstream-fetch.js';

const UA = 'three.ws-globe/1.0 (+https://three.ws/globe)';

export const LIVE_LAYERS = ['conflicts', 'military', 'sanctions', 'hotspots', 'natural', 'weather', 'outages', 'economic'];
export const REFERENCE_LAYERS = ['bases', 'nuclear', 'waterways'];
export const ALL_LAYERS = [...LIVE_LAYERS, ...REFERENCE_LAYERS];

export const RANGES = {
	'24h': { hours: 24, label: 'Last 24 hours' },
	'7d': { hours: 24 * 7, label: 'Last 7 days' },
	'30d': { hours: 24 * 30, label: 'Last 30 days' },
};

export const DEFAULT_RANGE = '7d';

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
// Number(null), Number(undefined) and Number('') are all 0, which is exactly the
// wrong answer for a feed that uses an empty field to mean "not reported". The
// World Bank ships a null growth figure for a country that has not filed yet,
// and reading that as 0% would put a fabricated point on the map.
const num = (v) => {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/** A lat/lon pair GDELT and friends can leave empty, at 0,0, or as a string. */
function validCoords(lat, lon) {
	const a = num(lat);
	const b = num(lon);
	if (a === null || b === null) return null;
	if (a === 0 && b === 0) return null; // null island: the upstream's "unknown"
	if (a < -90 || a > 90 || b < -180 || b > 180) return null;
	return { lat: a, lon: b };
}

// ── GDELT 2.0 event stream ───────────────────────────────────────────────────
//
// GDELT's GEO 2.0 API has 404'd for every query, documented examples included,
// for long enough that building on it is not an option. The raw 15-minute event
// export it is derived from is healthy, tab-separated, and about 70 KB zipped
// per file, so we read that directly: parse the CAMEO codes ourselves and keep
// the three families the globe actually renders.

export const GDELT_LASTUPDATE_URL = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';
export const GDELT_FILE_BASE = 'http://data.gdeltproject.org/gdeltv2';

// Column indexes in the 61-field GDELT 2.0 export record.
const COL = {
	id: 0,
	day: 1,
	actor1: 6,
	actor2: 16,
	eventCode: 26,
	baseCode: 27,
	rootCode: 28,
	quadClass: 29,
	goldstein: 30,
	mentions: 31,
	avgTone: 34,
	place: 52,
	countryCode: 53,
	lat: 56,
	lon: 57,
	dateAdded: 59,
	sourceUrl: 60,
};

// The CAMEO codebook entries the globe surfaces. Anything outside these three
// families is counted for context and then dropped: the point of the layer is
// force and coercion, not the whole news cycle.
const CAMEO_LABELS = {
	150: 'Demonstrate military or police power',
	151: 'Increase police alert status',
	152: 'Increase military alert status',
	153: 'Mobilize or increase police power',
	154: 'Mobilize or increase armed forces',
	155: 'Mobilize or increase cyber-forces',
	163: 'Impose embargo, boycott or sanctions',
	172: 'Impose administrative sanctions',
	1721: 'Impose restrictions on political freedoms',
	1722: 'Ban political parties or politicians',
	1723: 'Impose curfew',
	1724: 'Impose state of emergency or martial law',
	180: 'Use unconventional violence',
	181: 'Abduct, hijack or take hostage',
	182: 'Physically assault',
	1821: 'Sexually assault',
	1822: 'Torture',
	1823: 'Kill by physical assault',
	183: 'Conduct bombing',
	1831: 'Carry out suicide bombing',
	1832: 'Carry out vehicular bombing',
	1833: 'Carry out roadside bombing',
	1834: 'Carry out location bombing',
	184: 'Use as human shield',
	185: 'Attempt to assassinate',
	186: 'Assassinate',
	190: 'Use conventional military force',
	191: 'Impose blockade or restrict movement',
	192: 'Occupy territory',
	193: 'Fight with small arms',
	194: 'Fight with artillery and tanks',
	195: 'Employ aerial weapons',
	1951: 'Employ precision-guided aerial munitions',
	1952: 'Employ remotely piloted aerial munitions',
	196: 'Violate ceasefire',
	200: 'Use unconventional mass violence',
	201: 'Engage in mass expulsion',
	202: 'Engage in mass killings',
	203: 'Engage in ethnic cleansing',
	204: 'Use weapons of mass destruction',
	2041: 'Use chemical, biological or radiological weapons',
	2042: 'Use chemical weapons',
	2043: 'Use biological weapons',
	2044: 'Use radiological weapons',
	2045: 'Detonate a nuclear weapon',
};

const ROOT_LABELS = { 15: 'Force posture', 16: 'Reduce relations', 17: 'Coerce', 18: 'Assault', 19: 'Armed clash', 20: 'Mass violence' };

/** Human label for a CAMEO code, narrowing from the full code to its root. */
export function cameoLabel(eventCode, rootCode) {
	const exact = CAMEO_LABELS[Number(eventCode)];
	if (exact) return exact;
	const base = CAMEO_LABELS[Number(String(eventCode).slice(0, 3))];
	if (base) return base;
	return ROOT_LABELS[Number(rootCode)] || 'Reported event';
}

/**
 * Which globe layer a raw GDELT record belongs to, or null to drop it.
 * Sanctions are matched on the base code because they are a single leaf of two
 * different roots (163 under "reduce relations", 172 under "coerce"), while
 * conflict and posture are whole roots.
 */
export function gdeltLayerFor(rootCode, baseCode) {
	const base = String(baseCode || '').trim();
	if (base === '163' || base.startsWith('172')) return 'sanctions';
	const root = Number(rootCode);
	if (root === 18 || root === 19 || root === 20) return 'conflicts';
	if (root === 15) return 'military';
	return null;
}

/**
 * How hard a GDELT event should pull the eye, on 0..1.
 *
 * Two independent signals, because either alone misreads the feed: the Goldstein
 * score says how destabilizing the act is regardless of how loudly it was
 * covered, and the mention count says how much of the world's press picked it
 * up. A single-source report of a bombing and a thousand-source report of a
 * mobilization both deserve to be visible, for different reasons.
 */
export function gdeltSeverity(goldstein, mentions) {
	const g = num(goldstein) ?? 0;
	const m = Math.max(1, num(mentions) ?? 1);
	const harm = clamp01(-g / 10);
	const reach = clamp01(Math.log10(m) / 2); // 100 mentions saturates
	return Number(clamp01(0.62 * harm + 0.38 * reach).toFixed(3));
}

/** GDELT stamps (YYYYMMDDHHMMSS, always UTC) to a Date. */
export function parseGdeltStamp(stamp) {
	const s = String(stamp || '').trim();
	if (!/^\d{14}$/.test(s)) return null;
	const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** A Date back to the GDELT file stamp of the 15-minute bucket containing it. */
export function gdeltStampFor(date) {
	const d = new Date(date);
	d.setUTCSeconds(0, 0);
	d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15);
	const p = (n, w = 2) => String(n).padStart(w, '0');
	return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

/**
 * Parse one GDELT export file into the rows the globe keeps.
 *
 * Returns `{ rows, scanned }` so a caller can tell "the file was empty" apart
 * from "the file had no force or coercion in it", which are very different
 * things to see in a log line.
 */
export function parseGdeltExport(text, stamp) {
	const rows = [];
	let scanned = 0;
	for (const line of String(text).split('\n')) {
		if (!line) continue;
		const f = line.split('\t');
		if (f.length < 61) continue;
		scanned++;
		const layer = gdeltLayerFor(f[COL.rootCode], f[COL.baseCode]);
		if (!layer) continue;
		const coords = validCoords(f[COL.lat], f[COL.lon]);
		if (!coords) continue;
		const id = num(f[COL.id]);
		if (id === null) continue;
		const at = parseGdeltStamp(f[COL.dateAdded]) || parseGdeltStamp(`${f[COL.day]}000000`);
		if (!at) continue;
		rows.push({
			id,
			layer,
			lat: coords.lat,
			lon: coords.lon,
			place: (f[COL.place] || '').trim(),
			country: (f[COL.countryCode] || '').trim().slice(0, 2) || null,
			cameoCode: (f[COL.eventCode] || '').trim(),
			rootCode: (f[COL.rootCode] || '').trim(),
			quadClass: num(f[COL.quadClass]),
			goldstein: num(f[COL.goldstein]),
			mentions: Math.max(1, num(f[COL.mentions]) ?? 1),
			avgTone: num(f[COL.avgTone]),
			actor1: (f[COL.actor1] || '').trim() || null,
			actor2: (f[COL.actor2] || '').trim() || null,
			sourceUrl: (f[COL.sourceUrl] || '').trim() || null,
			at,
			stamp: stamp || null,
		});
	}
	return { rows, scanned };
}

/** A parsed GDELT row as the event record the globe renders. */
export function gdeltRowToEvent(row) {
	const actors = [row.actor1, row.actor2].filter(Boolean);
	return {
		id: `gdelt:${row.id}`,
		layer: row.layer,
		lat: row.lat,
		lon: row.lon,
		title: cameoLabel(row.cameoCode, row.rootCode),
		detail: actors.length ? actors.join(' to ') : row.place || 'Reported without named actors',
		place: row.place,
		country: row.country,
		severity: gdeltSeverity(row.goldstein, row.mentions),
		at: (row.at instanceof Date ? row.at : new Date(row.at)).toISOString(),
		source: 'GDELT 2.0 event stream',
		url: row.sourceUrl,
		weight: row.mentions,
	};
}

/** The most recent GDELT export file stamp, read from the project's own index. */
export async function gdeltLatestStamp() {
	const res = await fetchUpstream(GDELT_LASTUPDATE_URL, { headers: { 'user-agent': UA } }, { name: 'gdelt-lastupdate', timeoutMs: 8_000, attempts: 2 });
	const text = await res.text();
	const line = text.split('\n').find((l) => l.includes('.export.CSV.zip'));
	const url = line?.trim().split(/\s+/).pop();
	const stamp = url?.match(/(\d{14})\.export\.CSV\.zip/)?.[1];
	if (!stamp) throw new Error('gdelt lastupdate carried no export file');
	return stamp;
}

/** Download and parse one 15-minute GDELT export file. */
export async function fetchGdeltFile(stamp) {
	const res = await fetchUpstream(
		`${GDELT_FILE_BASE}/${stamp}.export.CSV.zip`,
		{ headers: { 'user-agent': UA } },
		{ name: 'gdelt-export', timeoutMs: 20_000, attempts: 2 },
	);
	const buf = new Uint8Array(await res.arrayBuffer());
	const files = unzipSync(buf);
	const name = Object.keys(files).find((n) => n.toUpperCase().endsWith('.CSV'));
	if (!name) throw new Error(`gdelt archive ${stamp} held no CSV`);
	return parseGdeltExport(new TextDecoder().decode(files[name]), stamp);
}

// ── USGS + NASA EONET: the natural layer ─────────────────────────────────────

const USGS_FEEDS = {
	'24h': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
	'7d': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
	'30d': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson',
};

/**
 * Quake magnitude to 0..1. M4.5 is where the USGS weekly feed starts and M8 is
 * the practical top of the scale, so the ramp is anchored there rather than on
 * the theoretical 0..10.
 */
export function quakeSeverity(mag) {
	const m = num(mag);
	if (m === null) return 0.3;
	return Number(clamp01((m - 3) / 5).toFixed(3));
}

export function normalizeUsgs(geojson) {
	const features = Array.isArray(geojson?.features) ? geojson.features : [];
	const out = [];
	for (const f of features) {
		const c = f?.geometry?.coordinates;
		const coords = validCoords(c?.[1], c?.[0]);
		if (!coords) continue;
		const p = f.properties || {};
		const depth = num(c?.[2]);
		out.push({
			id: `usgs:${f.id}`,
			layer: 'natural',
			kind: 'earthquake',
			lat: coords.lat,
			lon: coords.lon,
			title: `M${(num(p.mag) ?? 0).toFixed(1)} earthquake`,
			detail: `${p.place || 'Location not given'}${depth !== null ? `, ${Math.round(depth)} km deep` : ''}`,
			place: p.place || '',
			severity: quakeSeverity(p.mag),
			at: new Date(num(p.time) ?? Date.now()).toISOString(),
			source: 'USGS earthquake feed',
			url: p.url || null,
		});
	}
	return out;
}

// `days` bounds the feed by when each event last MOVED, which is what an open
// event's recency means here: a volcano erupting for six months is still current,
// a wildfire whose last perimeter update was in April is not. Asking for a bare
// limit instead truncated the response at an arbitrary 300 and silently dropped
// whatever sorted last.
const EONET_URL = (days) => `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=${days}`;

// EONET categories split cleanly between "the ground moved or burned" and "the
// weather did it", which is exactly the natural/weather split the globe draws.
const EONET_WEATHER = new Set(['severeStorms', 'floods', 'drought', 'dustHaze', 'temperatureExtremes']);
const EONET_SEVERITY = {
	volcanoes: 0.72,
	wildfires: 0.5,
	severeStorms: 0.7,
	floods: 0.62,
	landslides: 0.55,
	drought: 0.45,
	seaLakeIce: 0.3,
	snow: 0.35,
	dustHaze: 0.35,
	earthquakes: 0.6,
	manmade: 0.45,
	temperatureExtremes: 0.5,
	waterColor: 0.25,
};

export function normalizeEonet(payload) {
	const events = Array.isArray(payload?.events) ? payload.events : [];
	const out = [];
	for (const e of events) {
		const category = e?.categories?.[0]?.id || 'manmade';
		const geoms = Array.isArray(e.geometry) ? e.geometry : [];
		const last = geoms[geoms.length - 1];
		if (!last) continue;
		// Polygonal geometries carry a ring; the globe wants the point it encloses.
		const point = last.type === 'Point' ? last.coordinates : centroidOf(last.coordinates);
		const coords = validCoords(point?.[1], point?.[0]);
		if (!coords) continue;
		out.push({
			id: `eonet:${e.id}`,
			layer: EONET_WEATHER.has(category) ? 'weather' : 'natural',
			kind: category,
			lat: coords.lat,
			lon: coords.lon,
			title: e.title || 'Natural event',
			detail: e.description || `${e.categories?.[0]?.title || 'Event'} tracked by NASA EONET`,
			place: e.title || '',
			severity: EONET_SEVERITY[category] ?? 0.4,
			at: last.date ? new Date(last.date).toISOString() : new Date().toISOString(),
			source: 'NASA EONET',
			url: e.sources?.[0]?.url || e.link || null,
		});
	}
	return out;
}

/** Mean of a nested coordinate ring, to any depth. */
function centroidOf(coords) {
	const pts = [];
	const walk = (node) => {
		if (!Array.isArray(node)) return;
		if (typeof node[0] === 'number' && typeof node[1] === 'number') {
			pts.push(node);
			return;
		}
		for (const child of node) walk(child);
	};
	walk(coords);
	if (!pts.length) return null;
	const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
	const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
	return [lon, lat];
}

// ── GDACS: the weather layer ─────────────────────────────────────────────────
//
// The Global Disaster Alert and Coordination System is the joint UN and European
// Commission feed, and it is the one place that publishes cyclones, floods and
// droughts on the same alert scale, already geocoded.

const GDACS_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC%3BFL%3BDR%3BWF%3BEQ%3BVO&alertlevel=Green%3BOrange%3BRed';
const GDACS_TYPES = { TC: 'Tropical cyclone', FL: 'Flood', DR: 'Drought', WF: 'Wildfire', EQ: 'Earthquake', VO: 'Volcano' };
const GDACS_WEATHER = new Set(['TC', 'FL', 'DR']);
const GDACS_ALERT_SEVERITY = { green: 0.32, orange: 0.66, red: 0.92 };

export function normalizeGdacs(geojson) {
	const features = Array.isArray(geojson?.features) ? geojson.features : [];
	const out = [];
	for (const f of features) {
		const c = f?.geometry?.coordinates;
		const coords = validCoords(c?.[1], c?.[0]);
		if (!coords) continue;
		const p = f.properties || {};
		const type = String(p.eventtype || '').toUpperCase();
		const alert = String(p.alertlevel || 'green').toLowerCase();
		out.push({
			id: `gdacs:${type}${p.eventid}${p.episodeid ?? ''}`,
			layer: GDACS_WEATHER.has(type) ? 'weather' : 'natural',
			kind: type.toLowerCase(),
			lat: coords.lat,
			lon: coords.lon,
			title: p.name || p.eventname || `${GDACS_TYPES[type] || 'Disaster'} alert`,
			detail: stripTags(p.htmldescription || p.description || ''),
			place: p.country || '',
			severity: GDACS_ALERT_SEVERITY[alert] ?? 0.4,
			at: p.todate || p.fromdate ? new Date(p.todate || p.fromdate).toISOString() : new Date().toISOString(),
			source: `GDACS ${alert} alert`,
			url: p.url?.report || p.link || null,
		});
	}
	return out;
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ── IODA: the outages layer ──────────────────────────────────────────────────
//
// Georgia Tech's Internet Outage Detection and Analysis project watches BGP,
// active probing and telescope traffic per country and flags the moment a
// country's reachable address space drops below its own recent baseline. That is
// the only open feed that names national connectivity loss as it happens.

const IODA_URL = 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts';

// IODA states the threshold an alert crossed in its `condition` field ("< 0.8"
// means the country fell below 80% of its own baseline). Anything at 0.99 is a
// one-percent wobble in a national address space, which is weather in the data,
// not an outage, and putting it on a globe next to a real blackout is a lie of
// emphasis.
const OUTAGE_MAX_THRESHOLD = 0.9;

export function outageThreshold(condition) {
	const m = String(condition || '').match(/([\d.]+)/);
	const n = m ? Number(m[1]) : NaN;
	return Number.isFinite(n) ? n : null;
}

/**
 * How far a country fell below its own baseline, on 0..1.
 *
 * The measured drop (observed against IODA's historical median) is the honest
 * number, but a country can trip a serious threshold on a datasource whose
 * absolute counts barely move. The crossed threshold therefore sets a floor, so
 * a "below a quarter of normal" alert can never render as a hairline.
 */
export function outageSeverity(value, historyValue, condition) {
	const v = Math.max(0, num(value) ?? 0);
	const h = num(historyValue);
	const measured = !h || h <= 0 ? 0.5 : clamp01(1 - v / h);
	const threshold = outageThreshold(condition);
	const floor = threshold === null ? 0 : clamp01(1 - threshold);
	return Number(Math.max(measured, floor).toFixed(3));
}

export function normalizeIoda(payload, countryCentroid) {
	const rows = Array.isArray(payload?.data) ? payload.data : [];
	const byCountry = new Map();
	for (const r of rows) {
		if (String(r?.condition || '').toLowerCase() === 'normal') continue;
		if (String(r?.level || '').toLowerCase() === 'normal') continue;
		const threshold = outageThreshold(r?.condition);
		if (threshold !== null && threshold > OUTAGE_MAX_THRESHOLD) continue;
		const code = r?.entity?.code;
		if (!code) continue;
		const centre = countryCentroid?.(code);
		if (!centre) continue;
		const severity = outageSeverity(r.value, r.historyValue, r.condition);
		const at = new Date((num(r.time) ?? 0) * 1000).toISOString();
		// One country, one marker: IODA alerts per datasource (BGP, active probing,
		// telescope) and three views of the same blackout is still one blackout.
		const prev = byCountry.get(code);
		if (prev && prev.severity >= severity) {
			prev.sources.add(r.datasource);
			continue;
		}
		byCountry.set(code, {
			id: `ioda:${code}`,
			layer: 'outages',
			kind: 'connectivity',
			lat: centre.lat,
			lon: centre.lon,
			title: `${r.entity?.name || code} connectivity drop`,
			severity,
			at,
			place: r.entity?.name || code,
			country: code,
			threshold,
			sources: new Set([r.datasource].filter(Boolean)),
			url: `https://ioda.inetintel.cc.gatech.edu/country/${code}`,
		});
	}
	return [...byCountry.values()].map((e) => {
		const sources = [...e.sources].join(', ');
		const { sources: _drop, threshold, ...rest } = e;
		const depth = threshold === null ? 'below its own recent baseline' : `below ${Math.round(threshold * 100)}% of its own recent baseline`;
		return {
			...rest,
			detail: `Reachability ${depth}${sources ? `, measured in ${sources}` : ''}`,
			source: 'IODA (Georgia Tech)',
		};
	});
}

// ── World Bank: the economic layer ───────────────────────────────────────────

const WORLDBANK_INDICATOR = 'NY.GDP.MKTP.KD.ZG'; // GDP growth, annual percent
const WORLDBANK_URL = `https://api.worldbank.org/v2/country/all/indicator/${WORLDBANK_INDICATOR}?format=json&per_page=1200&mrnev=1`;

/**
 * Growth to 0..1, where a deep contraction is loud and healthy growth is quiet.
 * A shrinking economy is the signal worth seeing on a situational map, so the
 * scale is deliberately asymmetric: -8% saturates, +6% is near silent.
 */
export function growthSeverity(growth) {
	const g = num(growth);
	if (g === null) return 0;
	return Number(clamp01((3 - g) / 11).toFixed(3));
}

export function normalizeWorldBank(payload, countryCentroid) {
	const rows = Array.isArray(payload?.[1]) ? payload[1] : [];
	const out = [];
	for (const r of rows) {
		const iso3 = r?.countryiso3code;
		const value = num(r?.value);
		if (!iso3 || value === null) continue;
		const centre = countryCentroid?.(iso3);
		if (!centre) continue; // aggregates ("Arab World", "OECD") have no polygon
		out.push({
			id: `wb:${iso3}`,
			layer: 'economic',
			kind: 'gdp-growth',
			lat: centre.lat,
			lon: centre.lon,
			title: `${r.country?.value || iso3}: ${value >= 0 ? '+' : ''}${value.toFixed(1)}% GDP growth`,
			detail: `Annual real GDP growth, ${r.date}. ${value < 0 ? 'The economy contracted over the year.' : 'Latest year reported to the World Bank.'}`,
			place: r.country?.value || iso3,
			country: iso3,
			value,
			year: r.date,
			severity: growthSeverity(value),
			at: `${r.date}-12-31T00:00:00.000Z`,
			source: 'World Bank open data',
			url: `https://data.worldbank.org/indicator/${WORLDBANK_INDICATOR}?locations=${iso3}`,
		});
	}
	return out;
}

// ── Hotspots and chokepoint pressure: computed, not fetched ──────────────────

/**
 * Where force and coercion concentrate geographically.
 *
 * Events are binned into equal-degree cells and scored by the press attention
 * behind them, not by raw count: fifty single-source reports of the same skirmish
 * should not outrank one event carried by every wire service. The returned cells
 * carry their own members so the UI can open a cluster rather than just colour it.
 */
export function computeHotspots(events, { cellDegrees = 3, limit = 40, minEvents = 2 } = {}) {
	const cells = new Map();
	for (const e of events) {
		const key = `${Math.floor(e.lat / cellDegrees)}:${Math.floor(e.lon / cellDegrees)}`;
		let cell = cells.get(key);
		if (!cell) {
			cell = { key, latSum: 0, lonSum: 0, weight: 0, count: 0, severitySum: 0, names: new Map(), members: [] };
			cells.set(key, cell);
		}
		const weight = Math.max(1, Number(e.weight) || 1);
		cell.latSum += e.lat * weight;
		cell.lonSum += e.lon * weight;
		cell.weight += weight;
		cell.severitySum += e.severity || 0;
		cell.count++;
		if (e.place) cell.names.set(e.place, (cell.names.get(e.place) || 0) + weight);
		if (cell.members.length < 8) cell.members.push({ title: e.title, place: e.place, at: e.at, url: e.url });
	}
	const ranked = [...cells.values()]
		.filter((c) => c.count >= minEvents)
		.sort((a, b) => b.weight - a.weight)
		.slice(0, limit);
	const top = ranked[0]?.weight || 1;
	return ranked.map((c) => {
		const name = [...c.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unnamed area';
		return {
			id: `hotspot:${c.key}`,
			layer: 'hotspots',
			kind: 'cluster',
			lat: c.latSum / c.weight,
			lon: c.lonSum / c.weight,
			title: name,
			detail: `${c.count} force or coercion events, ${c.weight.toLocaleString('en-US')} press mentions`,
			place: name,
			severity: Number(clamp01(0.35 + 0.65 * (c.weight / top)).toFixed(3)),
			count: c.count,
			weight: c.weight,
			meanSeverity: Number((c.severitySum / c.count).toFixed(3)),
			members: c.members,
			at: new Date().toISOString(),
			source: 'Computed from the GDELT event stream',
			url: null,
		};
	});
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function haversineKm(aLat, aLon, bLat, bLon) {
	const toRad = (d) => (d * Math.PI) / 180;
	const dLat = toRad(bLat - aLat);
	const dLon = toRad(bLon - aLon);
	const s =
		Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Chokepoints do not publish a risk number, so we compute one: how much armed
 * activity and force posture the live feed puts within reach of each passage.
 * This is what makes the waterways layer worth switching on rather than a set of
 * pins that never change.
 */
export function chokepointPressure(waterways, events, { radiusKm = 600 } = {}) {
	return waterways.map((w) => {
		let count = 0;
		let severity = 0;
		let nearest = null;
		for (const e of events) {
			const d = haversineKm(w.lat, w.lon, e.lat, e.lon);
			if (d > radiusKm) continue;
			count++;
			severity = Math.max(severity, e.severity || 0);
			if (!nearest || d < nearest.km) nearest = { km: d, title: e.title, place: e.place, at: e.at, url: e.url };
		}
		return {
			id: `waterway:${w.id}`,
			layer: 'waterways',
			kind: 'chokepoint',
			lat: w.lat,
			lon: w.lon,
			title: w.name,
			detail: w.note,
			place: w.name,
			severity: count ? Number(clamp01(0.3 + 0.7 * severity).toFixed(3)) : 0.18,
			nearbyEvents: count,
			nearest,
			radiusKm,
			at: new Date().toISOString(),
			source: count ? 'Chokepoint pressure computed from the live event feed' : 'Maritime chokepoint reference',
			url: null,
		};
	});
}

// ── Network readers ──────────────────────────────────────────────────────────

export async function fetchUsgs(range) {
	const url = USGS_FEEDS[range] || USGS_FEEDS[DEFAULT_RANGE];
	const payload = await fetchUpstreamJson(url, { headers: { 'user-agent': UA } }, { name: 'usgs', timeoutMs: 10_000, attempts: 2 });
	return normalizeUsgs(payload);
}

export async function fetchEonet(range) {
	const days = Math.ceil((RANGES[range]?.hours ?? RANGES[DEFAULT_RANGE].hours) / 24);
	const payload = await fetchUpstreamJson(EONET_URL(days), { headers: { 'user-agent': UA } }, { name: 'eonet', timeoutMs: 12_000, attempts: 2 });
	return normalizeEonet(payload);
}

export async function fetchGdacs() {
	const payload = await fetchUpstreamJson(
		GDACS_URL,
		{ headers: { 'user-agent': UA, accept: 'application/json' } },
		{ name: 'gdacs', timeoutMs: 15_000, attempts: 2 },
	);
	return normalizeGdacs(payload);
}

export async function fetchIoda(range, countryCentroid) {
	const hours = RANGES[range]?.hours ?? RANGES[DEFAULT_RANGE].hours;
	const until = Math.floor(Date.now() / 1000);
	// IODA's alert index is keyed on absolute seconds; a relative "from" is refused.
	const from = until - Math.min(hours, 24 * 7) * 3600;
	const payload = await fetchUpstreamJson(
		`${IODA_URL}?from=${from}&until=${until}&entityType=country&limit=500`,
		{ headers: { 'user-agent': UA } },
		{ name: 'ioda', timeoutMs: 15_000, attempts: 2 },
	);
	return normalizeIoda(payload, countryCentroid);
}

export async function fetchWorldBank(countryCentroid) {
	const payload = await fetchUpstreamJson(WORLDBANK_URL, { headers: { 'user-agent': UA } }, { name: 'worldbank', timeoutMs: 15_000, attempts: 2 });
	return normalizeWorldBank(payload, countryCentroid);
}
