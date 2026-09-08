#!/usr/bin/env node
// build-globe-geometry: bake the two geometry files /globe needs.
//
//   public/data/globe-land.json   coastline rings, drawn as the globe's landmass
//   data/country-centroids.json   ISO2/ISO3 to a point, for country-level layers
//
// Both come from world-atlas (Natural Earth, public domain) so nothing is drawn
// or placed by hand, and both are committed: baking them here means the page
// ships one small static file instead of pulling TopoJSON and a decoder into the
// browser bundle, and the API resolves a country code without a network call.
//
// Re-run after bumping world-atlas:
//   node scripts/build-globe-geometry.mjs
//
// Country points are area-weighted polygon centroids, not bounding-box middles.
// The difference is not cosmetic: a bounding-box centre puts the United States
// in Kansas and Norway in Sweden, and puts several archipelago states in open
// water, which reads as a bug on a globe.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = (p) => JSON.parse(readFileSync(resolve(root, 'node_modules', p), 'utf8'));

const COORD_PRECISION = 2; // ~1 km at the equator, far finer than the globe draws
const MIN_RING_POINTS = 4; // a ring below this is a rounding artefact, not an island

const round = (n) => Number(n.toFixed(COORD_PRECISION));

/** Every linear ring in a GeoJSON geometry, as [lon, lat] arrays. */
function ringsOf(geometry) {
	if (!geometry) return [];
	if (geometry.type === 'Polygon') return geometry.coordinates;
	if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
	return [];
}

/**
 * Natural Earth stores a country that straddles the antimeridian as one ring
 * that jumps from +180 to -180 mid-path. Left alone that jump wrecks both jobs
 * here: a shoelace centroid computed across it lands in the wrong ocean (Russia
 * came out at 203 degrees east), and a line drawn across it stripes the globe.
 * Unwrapping walks the ring and keeps longitude continuous, so the geometry is
 * correct even when it runs past 180.
 */
function unwrapRing(ring) {
	const out = [ring[0].slice()];
	let offset = 0;
	for (let i = 1; i < ring.length; i++) {
		const step = ring[i][0] - ring[i - 1][0];
		if (step > 180) offset -= 360;
		else if (step < -180) offset += 360;
		out.push([ring[i][0] + offset, ring[i][1]]);
	}
	return out;
}

/** Longitude back into [-180, 180] after unwrapping. */
function wrapLon(lon) {
	let l = ((lon + 180) % 360 + 360) % 360 - 180;
	if (l === -180) l = 180;
	return l;
}

/**
 * Split a ring wherever it crosses the antimeridian, so each piece can be drawn
 * as a continuous polyline on the sphere instead of a chord straight through it.
 */
function splitAtAntimeridian(ring) {
	const pieces = [];
	let current = [];
	for (let i = 0; i < ring.length; i++) {
		if (i > 0 && Math.abs(ring[i][0] - ring[i - 1][0]) > 180) {
			if (current.length >= MIN_RING_POINTS) pieces.push(current);
			current = [];
		}
		current.push(ring[i]);
	}
	if (current.length >= MIN_RING_POINTS) pieces.push(current);
	return pieces;
}

/**
 * Signed area of a ring in degrees squared, by the shoelace formula. Sign gives
 * winding (holes wind the other way); magnitude gives the weight a ring should
 * carry when several make up one country.
 */
function ringArea(ring) {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
	}
	return sum / 2;
}

/** Area-weighted centroid of a ring. */
function ringCentroid(ring) {
	let x = 0;
	let y = 0;
	let a = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
		a += cross;
		x += (ring[j][0] + ring[i][0]) * cross;
		y += (ring[j][1] + ring[i][1]) * cross;
	}
	a *= 0.5;
	if (!a) return null;
	return [x / (6 * a), y / (6 * a)];
}

/**
 * A country's point: the centroid of its largest landmass, not of all of them
 * averaged. France plus French Guiana averages into the Atlantic; the mainland
 * alone is where a reader expects the marker.
 */
function countryPoint(geometry) {
	let best = null;
	for (const raw of ringsOf(geometry)) {
		const ring = unwrapRing(raw);
		const area = Math.abs(ringArea(ring));
		if (best && area <= best.area) continue;
		const c = ringCentroid(ring);
		if (c) best = { area, lon: wrapLon(c[0]), lat: c[1] };
	}
	return best;
}

// ── land rings ───────────────────────────────────────────────────────────────

const landTopo = require('world-atlas/land-110m.json');
const land = feature(landTopo, landTopo.objects.land);
const rings = [];
for (const f of land.features) {
	for (const raw of ringsOf(f.geometry)) {
		if (raw.length < MIN_RING_POINTS) continue;
		for (const piece of splitAtAntimeridian(raw)) {
			rings.push(piece.map(([lon, lat]) => [round(wrapLon(lon)), round(lat)]));
		}
	}
}
rings.sort((a, b) => b.length - a.length);

const landOut = {
	source: 'Natural Earth 1:110m land, via the world-atlas package (public domain)',
	generator: 'scripts/build-globe-geometry.mjs',
	precision: COORD_PRECISION,
	rings,
};

const publicDir = resolve(root, 'public/data');
mkdirSync(publicDir, { recursive: true });
writeFileSync(resolve(publicDir, 'globe-land.json'), JSON.stringify(landOut));

// ── country centroids ────────────────────────────────────────────────────────

const countryTopo = require('world-atlas/countries-110m.json');
const world = feature(countryTopo, countryTopo.objects.countries);

const centroids = {};
let unmapped = 0;
for (const f of world.features) {
	const numeric = String(f.id || '').padStart(3, '0');
	const iso2 = countries.numericToAlpha2(numeric);
	if (!iso2) {
		unmapped++;
		continue; // Natural Earth carries a few non-ISO polygons (Kosovo, N. Cyprus)
	}
	const point = countryPoint(f.geometry);
	if (!point) continue;
	centroids[iso2] = {
		iso3: countries.alpha2ToAlpha3(iso2) || null,
		numeric,
		name: f.properties?.name || countries.getName(iso2, 'en') || iso2,
		lat: round(point.lat),
		lon: round(point.lon),
	};
}

const centroidOut = {
	$comment: 'Generated by scripts/build-globe-geometry.mjs. Do not hand-edit.',
	source: 'Natural Earth 1:110m country polygons (world-atlas), ISO codes from i18n-iso-countries',
	countries: centroids,
};
writeFileSync(resolve(root, 'data/country-centroids.json'), JSON.stringify(centroidOut, null, '\t') + '\n');

const bytes = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`land rings   ${rings.length} (${bytes(JSON.stringify(landOut).length)}) -> public/data/globe-land.json`);
console.log(`centroids    ${Object.keys(centroids).length} countries (${unmapped} non-ISO polygons skipped) -> data/country-centroids.json`);
