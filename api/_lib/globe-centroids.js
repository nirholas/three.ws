// globe-centroids: country code to a point on the globe.
//
// Two of the /globe layers report by country rather than by coordinate: IODA
// names the country whose connectivity dropped (ISO 3166-1 alpha-2), and the
// World Bank keys its indicators by alpha-3. Both have to land somewhere on the
// sphere, and "somewhere" has to be inside the country, so the table is baked
// from the same Natural Earth polygons the globe draws (see
// scripts/build-globe-geometry.mjs) instead of typed in by hand.
//
// The World Bank also returns aggregates ("Arab World", "OECD members") in the
// same shape as countries. Those have no polygon, so lookup returns null and the
// caller drops them, which is the correct outcome: an aggregate has no place on
// a map of countries.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/country-centroids.json');

let _index = null;

function index() {
	if (_index) return _index;
	const raw = JSON.parse(readFileSync(TABLE_PATH, 'utf8'));
	const map = new Map();
	for (const [iso2, row] of Object.entries(raw.countries)) {
		const point = { lat: row.lat, lon: row.lon, name: row.name, iso2, iso3: row.iso3 };
		map.set(iso2, point);
		if (row.iso3) map.set(row.iso3, point);
		if (row.numeric) map.set(row.numeric, point);
	}
	_index = map;
	return map;
}

/**
 * Resolve an ISO 3166-1 alpha-2, alpha-3 or numeric code to a point.
 * @param {string} code
 * @returns {{ lat: number, lon: number, name: string, iso2: string, iso3: string|null } | null}
 */
export function countryCentroid(code) {
	const key = String(code || '').trim().toUpperCase();
	if (!key) return null;
	return index().get(key) || null;
}

/** How many codes resolve, for the health payload. */
export function centroidCount() {
	return index().size;
}
