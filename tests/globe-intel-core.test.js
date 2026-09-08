/**
 * /globe page logic - unit tests.
 *
 * Everything the globe decides before it draws anything: which layers exist,
 * what a shared URL means, where a coordinate lands in each of the two
 * projections, how loud a marker should be, and what the layer panel is allowed
 * to claim about a window. These are the rules a rendering bug hides behind, so
 * they are tested away from WebGL entirely.
 */

import { describe, it, expect } from 'vitest';
import {
	DEFAULT_STATE,
	LAYERS,
	LAYER_IDS,
	MAX_ZOOM,
	MIN_ZOOM,
	PLANE_HEIGHT,
	PLANE_WIDTH,
	blendProjection,
	cameraDistance,
	coveredHours,
	formatCount,
	formatDuration,
	hoursForRange,
	latLonToPlane,
	latLonToSphere,
	layerById,
	layerStatusLine,
	markerAlpha,
	markerSize,
	matchesQuery,
	normalizeLon,
	parseGlobeState,
	rankEvents,
	relativeTime,
	serializeGlobeState,
	zoomFromDistance,
} from '../src/globe-intel-core.js';

describe('layer registry', () => {
	it('gives every layer a unique id, a colour and a blurb', () => {
		expect(new Set(LAYER_IDS).size).toBe(LAYERS.length);
		for (const layer of LAYERS) {
			expect(layer.color).toMatch(/^#[0-9a-f]{6}$/i);
			expect(layer.label.length).toBeGreaterThan(2);
			expect(layer.blurb.length).toBeGreaterThan(20);
		}
	});

	it('carries the eleven layers the shared URL names', () => {
		// The link this page was built to honour turns on all of them at once.
		const fromLink = 'conflicts,bases,hotspots,nuclear,sanctions,weather,economic,waterways,outages,military,natural';
		for (const id of fromLink.split(',')) expect(layerById(id), id).toBeTruthy();
		expect(LAYERS).toHaveLength(11);
	});

	it('resolves an unknown id to null rather than throwing', () => {
		expect(layerById('spaceports')).toBeNull();
		expect(layerById('')).toBeNull();
	});
});

describe('parseGlobeState', () => {
	it('reads the full shared link', () => {
		const state = parseGlobeState(
			'?lat=20.0000&lon=0.0000&zoom=1.00&view=global&timeRange=7d&layers=conflicts,bases,hotspots,nuclear,sanctions,weather,economic,waterways,outages,military,natural',
		);
		expect(state).toMatchObject({ lat: 20, lon: 0, zoom: 1, view: 'global', timeRange: '7d' });
		expect(state.layers).toHaveLength(11);
	});

	it('falls back to the defaults for a bare URL', () => {
		expect(parseGlobeState('')).toEqual({ ...DEFAULT_STATE, layers: [...DEFAULT_STATE.layers] });
	});

	it('drops unknown layers but keeps the rest', () => {
		expect(parseGlobeState('?layers=conflicts,teapots,natural').layers).toEqual(['conflicts', 'natural']);
	});

	it('falls back rather than rendering a bare sphere when nothing survives', () => {
		expect(parseGlobeState('?layers=teapots').layers).toEqual(DEFAULT_STATE.layers);
	});

	it('de-duplicates a repeated layer', () => {
		expect(parseGlobeState('?layers=natural,natural,natural').layers).toEqual(['natural']);
	});

	it('clamps a hostile camera instead of trusting it', () => {
		const state = parseGlobeState('?lat=999&lon=900&zoom=-4');
		expect(state.lat).toBe(85);
		expect(state.lon).toBe(180);
		expect(state.zoom).toBe(MIN_ZOOM);
		expect(parseGlobeState('?zoom=9000').zoom).toBe(MAX_ZOOM);
	});

	it('ignores values that are not numbers at all', () => {
		const state = parseGlobeState('?lat=north&zoom=near');
		expect(state.lat).toBe(DEFAULT_STATE.lat);
		expect(state.zoom).toBe(DEFAULT_STATE.zoom);
	});

	it('ignores an unknown view or range', () => {
		const state = parseGlobeState('?view=hologram&timeRange=1y');
		expect(state.view).toBe(DEFAULT_STATE.view);
		expect(state.timeRange).toBe(DEFAULT_STATE.timeRange);
	});
});

describe('serializeGlobeState', () => {
	it('round-trips a state unchanged', () => {
		const state = { lat: 48.85, lon: 2.35, zoom: 2.5, view: 'flat', timeRange: '24h', layers: ['conflicts', 'outages'] };
		expect(parseGlobeState(serializeGlobeState(state))).toEqual(state);
	});

	it('writes the parameters in a stable order so a shared link diffs cleanly', () => {
		const search = serializeGlobeState({ ...DEFAULT_STATE, layers: ['natural'] });
		expect(search.startsWith('?lat=')).toBe(true);
		expect([...new URLSearchParams(search).keys()]).toEqual(['lat', 'lon', 'zoom', 'view', 'timeRange', 'layers']);
	});

	it('wraps a spun-past-180 longitude back into range', () => {
		expect(new URLSearchParams(serializeGlobeState({ ...DEFAULT_STATE, lon: 540 })).get('lon')).toBe('180.0000');
		expect(normalizeLon(-190)).toBeCloseTo(170, 6);
		expect(normalizeLon(0)).toBe(0);
	});
});

describe('projection', () => {
	it('puts the poles on the axis and the equator on the sphere', () => {
		expect(latLonToSphere(90, 0).y).toBeCloseTo(1, 6);
		expect(latLonToSphere(-90, 0).y).toBeCloseTo(-1, 6);
		const equator = latLonToSphere(0, 0);
		expect(Math.hypot(equator.x, equator.y, equator.z)).toBeCloseTo(1, 6);
		expect(equator.y).toBeCloseTo(0, 6);
	});

	it('keeps every coordinate on the sphere of the radius it was given', () => {
		for (const [lat, lon] of [
			[0, 0],
			[45, 90],
			[-33.9, 151.2],
			[64.1, -21.9],
		]) {
			const p = latLonToSphere(lat, lon, 2.5);
			expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(2.5, 6);
		}
	});

	it('places east to the right of west on the sphere', () => {
		// The camera looks down -X from (0,0), so screen-right is -Z. East of the
		// prime meridian must therefore have the smaller z.
		expect(latLonToSphere(0, 45).z).toBeLessThan(latLonToSphere(0, -45).z);
	});

	it('maps the corners of the flat map to the corners of the plane', () => {
		expect(latLonToPlane(90, 180)).toMatchObject({ x: PLANE_WIDTH / 2, y: PLANE_HEIGHT / 2 });
		expect(latLonToPlane(-90, -180)).toMatchObject({ x: -PLANE_WIDTH / 2, y: -PLANE_HEIGHT / 2 });
		expect(latLonToPlane(0, 0)).toMatchObject({ x: 0, y: 0, z: 0 });
	});

	it('blends the two projections end to end', () => {
		const sphere = latLonToSphere(10, 20);
		const plane = latLonToPlane(10, 20);
		expect(blendProjection(sphere, plane, 0)).toEqual({ x: sphere.x, y: sphere.y, z: sphere.z });
		expect(blendProjection(sphere, plane, 1)).toEqual({ x: plane.x, y: plane.y, z: plane.z });
		const half = blendProjection(sphere, plane, 0.5);
		expect(half.x).toBeCloseTo((sphere.x + plane.x) / 2, 9);
	});
});

describe('camera', () => {
	it('round-trips zoom through distance in both views', () => {
		for (const view of ['global', 'flat']) {
			for (const zoom of [0.8, 1, 2.4, 5]) {
				expect(zoomFromDistance(cameraDistance(zoom, view), view)).toBeCloseTo(zoom, 6);
			}
		}
	});

	it('pulls further back for the flat map, which is twice as wide as the globe', () => {
		expect(cameraDistance(1, 'flat')).toBeGreaterThan(cameraDistance(1, 'global'));
	});

	it('moves closer as zoom increases and never crosses the near plane', () => {
		expect(cameraDistance(4)).toBeLessThan(cameraDistance(1));
		expect(cameraDistance(1000)).toBeGreaterThan(0.05);
	});
});

describe('marker scaling', () => {
	it('grows with severity and stays inside its band', () => {
		expect(markerSize(0)).toBeLessThan(markerSize(0.5));
		expect(markerSize(0.5)).toBeLessThan(markerSize(1));
		expect(markerSize(0)).toBeCloseTo(0.008, 6);
		expect(markerSize(1)).toBeCloseTo(0.024, 6);
	});

	it('spends most of its range where the reader is looking', () => {
		// The square-root curve exists so a 0.8 and a 0.95 are visibly different.
		const lowHalf = markerSize(0.5) - markerSize(0);
		const highHalf = markerSize(1) - markerSize(0.5);
		expect(lowHalf).toBeGreaterThan(highHalf);
	});

	it('clamps a severity outside 0..1 rather than producing a wild size', () => {
		expect(markerSize(-3)).toBe(markerSize(0));
		expect(markerSize(9)).toBe(markerSize(1));
		expect(markerAlpha(9)).toBeLessThanOrEqual(1);
		expect(markerAlpha(-9)).toBeGreaterThan(0);
	});
});

describe('relativeTime', () => {
	const now = Date.parse('2026-09-08T12:00:00Z');

	it('reads recent events in the unit a person would use', () => {
		expect(relativeTime('2026-09-08T11:58:00Z', now)).toBe('2m ago');
		expect(relativeTime('2026-09-08T08:00:00Z', now)).toBe('4h ago');
		expect(relativeTime('2026-09-02T12:00:00Z', now)).toBe('6d ago');
	});

	it('calls reference geography reference, not "56 years ago"', () => {
		expect(relativeTime(null, now)).toBe('Reference');
		expect(relativeTime('not a date', now)).toBe('Reference');
	});

	it('never renders a future timestamp as a negative age', () => {
		expect(relativeTime('2026-09-08T12:05:00Z', now)).toBe('Just now');
	});
});

describe('rankEvents', () => {
	const now = Date.parse('2026-09-08T12:00:00Z');

	it('puts the severe event first', () => {
		const ranked = rankEvents(
			[
				{ id: 'quiet', severity: 0.2, at: '2026-09-08T11:00:00Z' },
				{ id: 'loud', severity: 0.95, at: '2026-09-08T11:00:00Z' },
			],
			now,
		);
		expect(ranked[0].id).toBe('loud');
	});

	it('keeps a fresh moderate event above a stale severe one', () => {
		const ranked = rankEvents(
			[
				{ id: 'old-severe', severity: 0.72, at: '2026-08-25T12:00:00Z' },
				{ id: 'fresh', severity: 0.62, at: '2026-09-08T11:30:00Z' },
			],
			now,
		);
		expect(ranked[0].id).toBe('fresh');
	});

	it('does not mutate the array it was handed', () => {
		const input = [
			{ id: 'a', severity: 0.1, at: '2026-09-08T11:00:00Z' },
			{ id: 'b', severity: 0.9, at: '2026-09-08T11:00:00Z' },
		];
		rankEvents(input, now);
		expect(input.map((e) => e.id)).toEqual(['a', 'b']);
	});

	it('ranks timeless reference geography without crashing', () => {
		const ranked = rankEvents([{ id: 'base', severity: 0.5, at: null }], now);
		expect(ranked).toHaveLength(1);
	});
});

describe('matchesQuery', () => {
	const event = { title: 'Impose embargo', detail: 'RUSSIA to GERMANY', place: 'Berlin, Germany', country: 'DE' };

	it('matches any of the fields a person would type', () => {
		expect(matchesQuery(event, 'berlin')).toBe(true);
		expect(matchesQuery(event, 'RUSSIA')).toBe(true);
		expect(matchesQuery(event, 'embargo')).toBe(true);
		expect(matchesQuery(event, 'de')).toBe(true);
	});

	it('matches everything on an empty or whitespace query', () => {
		expect(matchesQuery(event, '')).toBe(true);
		expect(matchesQuery(event, '   ')).toBe(true);
	});

	it('does not match an unrelated term', () => {
		expect(matchesQuery(event, 'volcano')).toBe(false);
	});
});

describe('layerStatusLine', () => {
	const week = hoursForRange('7d');

	it('names the reason a layer is missing rather than reading as empty', () => {
		expect(layerStatusLine({ status: 'unavailable', reason: 'gdacs timed out' }, week)).toBe('Unavailable: gdacs timed out');
	});

	it('says so when the window is shorter than the range that was asked for', () => {
		const line = layerStatusLine(
			{ status: 'ok', count: 900, coverage: 'ingested', window: { from: '2026-09-08T07:00:00Z', to: '2026-09-08T22:00:00Z' } },
			week,
		);
		expect(line).toBe('Covers 15h so far');
	});

	it('says nothing about coverage when the window really spans the range', () => {
		const line = layerStatusLine(
			{ status: 'ok', count: 900, coverage: 'ingested', window: { from: '2026-09-01T22:00:00Z', to: '2026-09-08T22:00:00Z' } },
			week,
		);
		expect(line).toBe('Live');
	});

	it('flags the cold-start path, the cap and the cache', () => {
		expect(layerStatusLine({ status: 'ok', count: 90, coverage: 'live' }, week)).toBe('Live, last hour only');
		expect(
			layerStatusLine({ status: 'stale', count: 1500, total: 5590, truncated: true, coverage: 'live' }, week),
		).toBe('Live, last hour only · top 1,500 of 5,590 · cached');
		expect(layerStatusLine({ status: 'ok', count: 210, coverage: 'static' }, week)).toBe('Reference geography');
	});

	it('never repeats the count the row already shows beside it', () => {
		expect(layerStatusLine({ status: 'ok', count: 1141, coverage: 'static' }, week)).not.toContain('1,141');
	});

	it('says a layer is not loaded rather than inventing a status', () => {
		expect(layerStatusLine(null)).toBe('Not loaded');
	});
});

describe('formatting helpers', () => {
	it('formats counts and durations for a reader, not a machine', () => {
		expect(formatCount(1141)).toBe('1,141');
		expect(formatCount(0)).toBe('0');
		expect(formatDuration(0.2)).toBe('under an hour');
		expect(formatDuration(15)).toBe('15h');
		expect(formatDuration(72)).toBe('3d');
		expect(formatDuration(24 * 30)).toBe('4w');
	});

	it('returns null for a window it cannot measure', () => {
		expect(coveredHours(null)).toBeNull();
		expect(coveredHours({ from: 'nonsense', to: '2026-09-08T22:00:00Z' })).toBeNull();
		expect(coveredHours({ from: '2026-09-08T19:00:00Z', to: '2026-09-08T22:00:00Z' })).toBe(3);
	});

	it('maps every range id to hours and falls back for an unknown one', () => {
		expect(hoursForRange('24h')).toBe(24);
		expect(hoursForRange('30d')).toBe(720);
		expect(hoursForRange('nonsense')).toBe(hoursForRange('7d'));
	});
});
