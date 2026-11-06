// Live, keyless points-of-interest search and detail over the OpenStreetMap
// Overpass API. Overpass is a free, shared community resource that refuses
// requests without an identifying User-Agent (HTTP 406), so every call here
// declares one with a contact address, per Overpass's usage policy.
//
// Upstream x402-places also offers Yelp-review enrichment on its detail
// route, with a deterministic FIXTURE fallback when no Yelp key is set.
// three.ws ships no fake data, so that enrichment is dropped entirely here:
// places-detail returns only the real, live OSM record.

const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
// Public Overpass instances stall or 5xx under shared load. Try each mirror in
// order with a per-attempt budget so one slow instance cannot fail the request
// (2026-11-05: a single 25s abort on overpass-api.de surfaced as a 502).
const OVERPASS_URLS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
];
const TIMEOUT_MS = 12_000;

function upstreamError(detail) {
	const err = new Error(`Overpass request failed: ${detail}`);
	err.status = 502;
	err.code = 'upstream_error';
	return err;
}

async function overpass(query) {
	let last = null;
	for (const url of OVERPASS_URLS) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': THREE_WS_UA, accept: 'application/json' },
				body: new URLSearchParams({ data: query }),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!res.ok) {
				last = upstreamError(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
				continue;
			}
			const body = await res.json();
			return body.elements ?? [];
		} catch (e) {
			last = upstreamError(e?.message || 'network error');
		}
	}
	throw last;
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
	const elements = await overpass(query);
	const places = elements.filter((e) => e.tags?.name).slice(0, limit).map(toPoi);
	return {
		source: 'overpass',
		query: { latitude, longitude, radiusM, category, limit },
		count: places.length,
		places,
		retrievedAt: new Date().toISOString(),
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
	const elements = await overpass(query);
	if (elements.length === 0) return null;
	const place = toPoi(elements[0]);
	return { source: 'overpass', place, retrievedAt: new Date().toISOString() };
}
