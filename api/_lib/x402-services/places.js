// Live, keyless points-of-interest search and detail over the OpenStreetMap
// Overpass API. Overpass is a free, shared community resource that refuses
// requests without an identifying User-Agent (HTTP 406), so every call here
// declares one with a contact address, per Overpass's usage policy.
//
// Upstream x402-places also offers Yelp-review enrichment on its detail
// route, with a deterministic FIXTURE fallback when no Yelp key is set.
// three.ws ships no fake data, so that enrichment is dropped entirely here:
// places-detail returns only the real, live OSM record.

import { createHash } from 'node:crypto';

import { cacheGet, cacheSet } from '../cache.js';

const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
// Public Overpass instances stall or 5xx under shared load, and on a bad day
// several stall at once. On 2026-11-10 overpass-api.de answered 502 while
// private.coffee and kumi.systems hung past 20s, and the only healthy public
// instance (maps.mail.ru) needed 19s. Trying mirrors one after another with a
// short cap each could never reach it, so places-search 502'd for every caller.
//
// Attempts are therefore HEDGED: the first mirror starts at once, the next one
// starts OVERPASS_HEDGE_MS later (or immediately when the previous one fails
// outright), and the first good answer wins and aborts the rest. A healthy
// primary costs one request; a stalled one costs a few seconds, not the call.
const OVERPASS_URLS = [
	'https://overpass-api.de/api/interpreter',
	'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
];
export const OVERPASS_HEDGE_MS = 3_000;
// One attempt may run this long. Kept under the queries' own [timeout:25] and
// short enough that a call with every mirror hung still answers inside ~30s.
export const OVERPASS_ATTEMPT_TIMEOUT_MS = 22_000;

// POIs change on the scale of days, so a recent answer is served straight from
// cache. The last good answer is kept far longer and served, flagged
// `stale: true` with its original retrievedAt, only when every mirror is down.
const FRESH_TTL_S = 3_600;
const LAST_GOOD_TTL_S = 7 * 86_400;
const freshKey = (hash) => `x402:places:overpass:fresh:${hash}`;
const lastGoodKey = (hash) => `x402:places:overpass:last-good:${hash}`;
const issuedFreshKeys = new Set();

function upstreamError(detail) {
	const err = new Error(`Overpass request failed: ${detail}`);
	err.status = 502;
	err.code = 'upstream_error';
	return err;
}

async function attempt(url, query, signal) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': THREE_WS_UA, accept: 'application/json' },
		body: new URLSearchParams({ data: query }),
		signal,
	});
	if (!res.ok) throw upstreamError(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
	const body = await res.json();
	return body.elements ?? [];
}

// Race the mirrors with staggered starts. Resolves with the first mirror's
// elements; rejects with the last failure once every mirror has failed.
function hedgedOverpass(query) {
	return new Promise((resolve, reject) => {
		const controllers = [];
		const timers = new Set();
		let next = 0;
		let failed = 0;
		let settled = false;
		let last = null;

		const finish = () => {
			settled = true;
			for (const t of timers) clearTimeout(t);
			timers.clear();
			for (const c of controllers) c.abort();
		};

		const launch = () => {
			if (settled || next >= OVERPASS_URLS.length) return;
			const url = OVERPASS_URLS[next++];
			const controller = new AbortController();
			controllers.push(controller);
			const timeout = setTimeout(() => controller.abort(), OVERPASS_ATTEMPT_TIMEOUT_MS);
			timers.add(timeout);
			// Arm the hedge: if this attempt is still pending when it fires, the
			// next mirror joins the race.
			const hedge = setTimeout(() => { timers.delete(hedge); launch(); }, OVERPASS_HEDGE_MS);
			timers.add(hedge);
			attempt(url, query, controller.signal).then(
				(elements) => {
					if (settled) return;
					finish();
					resolve(elements);
				},
				(e) => {
					clearTimeout(timeout);
					timers.delete(timeout);
					if (settled) return;
					last = e?.code === 'upstream_error' ? e : upstreamError(e?.message || 'network error');
					failed += 1;
					if (failed >= OVERPASS_URLS.length) {
						finish();
						reject(last);
						return;
					}
					// A mirror that failed outright frees its slot now rather than
					// waiting out the hedge delay.
					clearTimeout(hedge);
					timers.delete(hedge);
					launch();
				},
			);
		};

		launch();
	});
}

async function overpass(query) {
	const hash = createHash('sha256').update(query).digest('hex').slice(0, 32);
	const fresh = await cacheGet(freshKey(hash)).catch(() => null);
	if (fresh && Array.isArray(fresh.elements)) return { elements: fresh.elements, retrievedAt: fresh.retrievedAt };

	try {
		const elements = await hedgedOverpass(query);
		const record = { elements, retrievedAt: new Date().toISOString() };
		issuedFreshKeys.add(freshKey(hash));
		await Promise.all([
			cacheSet(freshKey(hash), record, FRESH_TTL_S).catch(() => {}),
			cacheSet(lastGoodKey(hash), record, LAST_GOOD_TTL_S).catch(() => {}),
		]);
		return record;
	} catch (err) {
		const lastGood = await cacheGet(lastGoodKey(hash)).catch(() => null);
		if (lastGood && Array.isArray(lastGood.elements)) {
			return { elements: lastGood.elements, retrievedAt: lastGood.retrievedAt, stale: true };
		}
		throw err;
	}
}

/**
 * Drop every fresh-cache entry this process wrote, leaving the last-good copies,
 * so a test can exercise the every-mirror-down path against a remembered answer.
 */
export async function expireFreshPlacesCacheForTests() {
	await Promise.all([...issuedFreshKeys].map((k) => cacheSet(k, null, 1).catch(() => {})));
	issuedFreshKeys.clear();
}

function buildAddress(tags) {
	const parts = [[tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '), tags['addr:city'], tags['addr:postcode']].filter((p) => p && p.length > 0);
	return parts.length > 0 ? parts.join(', ') : null;
}

function toPoi(el) {
	const tags = el.tags ?? {};
	const lat = el.lat ?? el.center?.lat ?? null;
	const lon = el.lon ?? el.center?.lon ?? null;
	const category = tags.amenity ?? tags.shop ?? tags.leisure ?? tags.tourism ?? null;
	return {
		id: `${el.type}-${el.id}`,
		osmType: el.type,
		osmId: el.id,
		name: tags.name ?? '(unnamed)',
		category,
		latitude: lat,
		longitude: lon,
		openingHours: tags.opening_hours ?? null,
		phone: tags.phone ?? tags['contact:phone'] ?? null,
		website: tags.website ?? tags['contact:website'] ?? null,
		address: buildAddress(tags),
		cuisine: tags.cuisine ?? null,
		tags,
	};
}

function esc(v) {
	return v.replace(/[\\"]/g, '\\$&');
}

export async function searchPlaces(latitude, longitude, radiusM, category, limit) {
	const around = `(around:${radiusM},${latitude},${longitude})`;
	const filters = category
		? ['amenity', 'shop', 'leisure', 'tourism'].map((k) => `nwr["${k}"="${esc(category)}"]["name"]${around};`).join('\n  ')
		: `nwr["amenity"]["name"]${around};`;
	const query = `[out:json][timeout:25];
(
  ${filters}
);
out tags center ${Math.min(limit * 3, 200)};`;
	const { elements, retrievedAt, stale } = await overpass(query);
	const places = elements.filter((e) => e.tags?.name).slice(0, limit).map(toPoi);
	return {
		source: 'overpass',
		query: { latitude, longitude, radiusM, category, limit },
		count: places.length,
		places,
		retrievedAt,
		...(stale ? { stale: true } : {}),
	};
}

export function parsePoiId(id) {
	const m = /^(node|way|relation)-(\d+)$/.exec(id);
	if (!m) return null;
	return { osmType: m[1], osmId: Number(m[2]) };
}

export async function placeDetail(osmType, osmId) {
	const query = `[out:json][timeout:25];
${osmType}(${osmId});
out tags center 1;`;
	const { elements, retrievedAt, stale } = await overpass(query);
	if (elements.length === 0) return null;
	const place = toPoi(elements[0]);
	return { source: 'overpass', place, retrievedAt, ...(stale ? { stale: true } : {}) };
}
