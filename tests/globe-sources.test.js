/**
 * /globe upstream readers - unit tests.
 *
 * The parsers and normalizers behind api/globe/intel, exercised against payload
 * shapes captured from the real services (a GDELT 2.0 export row, a USGS
 * feature, an EONET event, a GDACS feature, an IODA alert, a World Bank row).
 * No network: these tests are about what we do with the bytes, and the classes
 * of bad byte every one of these feeds actually emits - null island coordinates,
 * a missing value, an aggregate with no polygon, an alert that is not an outage.
 */

import { describe, it, expect } from 'vitest';
import {
	cameoLabel,
	chokepointPressure,
	computeHotspots,
	gdeltLayerFor,
	gdeltRowToEvent,
	gdeltSeverity,
	gdeltStampFor,
	growthSeverity,
	haversineKm,
	normalizeEonet,
	normalizeGdacs,
	normalizeIoda,
	normalizeUsgs,
	normalizeWorldBank,
	outageSeverity,
	outageThreshold,
	parseGdeltExport,
	parseGdeltStamp,
	quakeSeverity,
} from '../api/_lib/globe-sources.js';

/** One real GDELT 2.0 export record, as 61 tab-separated fields. */
function gdeltRow({ id = '1322088921', root = '19', base = '193', code = '193', lat = '31.5', lon = '34.47', place = 'Gaza', country = 'GZ', goldstein = '-10.0', mentions = '12', added = '20260908214500' } = {}) {
	const f = new Array(61).fill('');
	f[0] = id;
	f[1] = '20260908';
	f[6] = 'ISRAEL';
	f[16] = 'HAMAS';
	f[26] = code;
	f[27] = base;
	f[28] = root;
	f[29] = '4';
	f[30] = goldstein;
	f[31] = mentions;
	f[34] = '-6.5';
	f[52] = place;
	f[53] = country;
	f[56] = lat;
	f[57] = lon;
	f[59] = added;
	f[60] = 'https://example.org/story';
	return f.join('\t');
}

describe('gdeltLayerFor', () => {
	it('routes the three CAMEO families the globe draws', () => {
		expect(gdeltLayerFor('19', '193')).toBe('conflicts');
		expect(gdeltLayerFor('18', '183')).toBe('conflicts');
		expect(gdeltLayerFor('20', '202')).toBe('conflicts');
		expect(gdeltLayerFor('15', '154')).toBe('military');
	});

	it('finds sanctions under both of the roots they live under', () => {
		// 163 sits under "reduce relations", 172x under "coerce"; matching on the
		// root alone would drop half of them and drag in unrelated coercion.
		expect(gdeltLayerFor('16', '163')).toBe('sanctions');
		expect(gdeltLayerFor('17', '1723')).toBe('sanctions');
	});

	it('drops everything else rather than putting the news cycle on a globe', () => {
		expect(gdeltLayerFor('04', '040')).toBeNull();
		expect(gdeltLayerFor('17', '175')).toBeNull();
		expect(gdeltLayerFor('', '')).toBeNull();
	});
});

describe('parseGdeltExport', () => {
	it('keeps a conflict row and reports how much it scanned', () => {
		const { rows, scanned } = parseGdeltExport([gdeltRow(), gdeltRow({ id: '2', root: '04', base: '040' })].join('\n'), '20260908214500');
		expect(scanned).toBe(2);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ layer: 'conflicts', lat: 31.5, lon: 34.47, place: 'Gaza', country: 'GZ', mentions: 12 });
		expect(rows[0].at.toISOString()).toBe('2026-09-08T21:45:00.000Z');
	});

	it('drops a row that never got geocoded', () => {
		// GDELT writes 0/0 for "unknown", and a globe that believes it grows an
		// island of events in the Gulf of Guinea.
		expect(parseGdeltExport(gdeltRow({ lat: '0', lon: '0' })).rows).toHaveLength(0);
		expect(parseGdeltExport(gdeltRow({ lat: '', lon: '' })).rows).toHaveLength(0);
	});

	it('drops a truncated line instead of reading the wrong columns', () => {
		const { rows, scanned } = parseGdeltExport('a\tb\tc\n');
		expect(rows).toHaveLength(0);
		expect(scanned).toBe(0);
	});

	it('handles an empty file', () => {
		expect(parseGdeltExport('').rows).toEqual([]);
		expect(parseGdeltExport('\n\n').scanned).toBe(0);
	});
});

describe('gdeltSeverity', () => {
	it('reads harm and reach as separate signals', () => {
		const quietBombing = gdeltSeverity(-10, 1);
		const loudMobilization = gdeltSeverity(-4, 500);
		expect(quietBombing).toBeGreaterThan(0.5);
		expect(loudMobilization).toBeGreaterThan(0.5);
	});

	it('rates a widely reported atrocity above a single-source one', () => {
		expect(gdeltSeverity(-10, 400)).toBeGreaterThan(gdeltSeverity(-10, 1));
	});

	it('stays inside 0..1 for anything the feed can emit', () => {
		for (const [g, m] of [[-10, 9999], [10, 1], [0, 0], [null, null]]) {
			const s = gdeltSeverity(g, m);
			expect(s).toBeGreaterThanOrEqual(0);
			expect(s).toBeLessThanOrEqual(1);
		}
	});
});

describe('GDELT stamps', () => {
	it('reads a stamp as UTC and writes back its 15-minute bucket', () => {
		expect(parseGdeltStamp('20260908214500').toISOString()).toBe('2026-09-08T21:45:00.000Z');
		expect(gdeltStampFor(new Date('2026-09-08T21:52:31Z'))).toBe('20260908214500');
		expect(gdeltStampFor(new Date('2026-09-08T22:00:00Z'))).toBe('20260908220000');
	});

	it('refuses anything that is not a stamp', () => {
		expect(parseGdeltStamp('2026-09-08')).toBeNull();
		expect(parseGdeltStamp('')).toBeNull();
		expect(parseGdeltStamp(null)).toBeNull();
	});
});

describe('cameoLabel', () => {
	it('prefers the exact code, then the base, then the root', () => {
		expect(cameoLabel('1831', '18')).toBe('Carry out suicide bombing');
		expect(cameoLabel('1934', '19')).toBe('Fight with small arms');
		expect(cameoLabel('999', '19')).toBe('Armed clash');
		expect(cameoLabel('999', '99')).toBe('Reported event');
	});
});

describe('gdeltRowToEvent', () => {
	it('turns a parsed row into the shape the globe renders', () => {
		const [row] = parseGdeltExport(gdeltRow(), '20260908214500').rows;
		const event = gdeltRowToEvent(row);
		expect(event).toMatchObject({
			id: 'gdelt:1322088921',
			layer: 'conflicts',
			title: 'Fight with small arms',
			detail: 'ISRAEL to HAMAS',
			place: 'Gaza',
			weight: 12,
		});
		expect(event.severity).toBeGreaterThan(0);
		expect(event.at).toBe('2026-09-08T21:45:00.000Z');
	});

	it('says so plainly when an event names no actors', () => {
		const row = { id: 1, layer: 'conflicts', lat: 1, lon: 1, place: 'Somewhere', cameoCode: '193', rootCode: '19', goldstein: -8, mentions: 2, at: new Date() };
		expect(gdeltRowToEvent(row).detail).toBe('Somewhere');
		expect(gdeltRowToEvent({ ...row, place: '' }).detail).toBe('Reported without named actors');
	});
});

describe('normalizeUsgs', () => {
	const feed = {
		features: [
			{
				id: 'us7000tfur',
				geometry: { coordinates: [83.98, 29.27, 10] },
				properties: { mag: 4.9, place: '97 km NNE of Chitre, Nepal', time: 1788867314980, url: 'https://earthquake.usgs.gov/x' },
			},
			{ id: 'nogeom', geometry: null, properties: { mag: 5 } },
		],
	};

	it('reads a quake and drops a feature with no geometry', () => {
		const events = normalizeUsgs(feed);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ layer: 'natural', kind: 'earthquake', title: 'M4.9 earthquake', lat: 29.27, lon: 83.98 });
		expect(events[0].detail).toContain('10 km deep');
	});

	it('scales severity by magnitude, anchored on the feed it comes from', () => {
		expect(quakeSeverity(4.5)).toBeLessThan(quakeSeverity(7.2));
		expect(quakeSeverity(8)).toBe(1);
		expect(quakeSeverity(null)).toBeGreaterThan(0);
	});

	it('survives a payload that is not a feature collection', () => {
		expect(normalizeUsgs(null)).toEqual([]);
		expect(normalizeUsgs({})).toEqual([]);
	});
});

describe('normalizeEonet', () => {
	it('splits the categories between the natural and weather layers', () => {
		const events = normalizeEonet({
			events: [
				{ id: 'a', title: 'Wildfire', categories: [{ id: 'wildfires', title: 'Wildfires' }], geometry: [{ type: 'Point', coordinates: [-80.5, 26.3], date: '2026-09-04T15:16:00Z' }] },
				{ id: 'b', title: 'Storm', categories: [{ id: 'severeStorms', title: 'Severe Storms' }], geometry: [{ type: 'Point', coordinates: [133.5, 33.1], date: '2026-09-08T00:00:00Z' }] },
			],
		});
		expect(events.map((e) => e.layer)).toEqual(['natural', 'weather']);
	});

	it('takes the latest geometry, so a moving storm is where it is now', () => {
		const [event] = normalizeEonet({
			events: [
				{
					id: 'c',
					title: 'Cyclone',
					categories: [{ id: 'severeStorms' }],
					geometry: [
						{ type: 'Point', coordinates: [120, 10], date: '2026-09-01T00:00:00Z' },
						{ type: 'Point', coordinates: [130, 20], date: '2026-09-08T00:00:00Z' },
					],
				},
			],
		});
		expect(event.lat).toBe(20);
		expect(event.lon).toBe(130);
	});

	it('reduces a polygon to the point it encloses', () => {
		const [event] = normalizeEonet({
			events: [
				{
					id: 'd',
					title: 'Ice',
					categories: [{ id: 'seaLakeIce' }],
					geometry: [{ type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10]]], date: '2026-09-08T00:00:00Z' }],
				},
			],
		});
		expect(event.lon).toBeCloseTo(5, 6);
		expect(event.lat).toBeCloseTo(5, 6);
	});

	it('drops an event with no geometry at all', () => {
		expect(normalizeEonet({ events: [{ id: 'e', title: 'x', categories: [{ id: 'wildfires' }], geometry: [] }] })).toEqual([]);
		expect(normalizeEonet(null)).toEqual([]);
	});
});

describe('normalizeGdacs', () => {
	const feature = (props, coords = [116, 28]) => ({ geometry: { coordinates: coords }, properties: props });

	it('reads the alert level as severity and strips the HTML blurb', () => {
		const events = normalizeGdacs({
			features: [
				feature({ eventtype: 'FL', eventid: 1104081, episodeid: 17, alertlevel: 'Orange', name: 'Flood in China', htmldescription: '<b>Orange</b> Flood in China', country: 'China', fromdate: '2026-07-31T01:00:00' }),
				feature({ eventtype: 'EQ', eventid: 2, alertlevel: 'Red', name: 'Quake', country: 'Peru' }, [-77, -12]),
			],
		});
		expect(events[0]).toMatchObject({ layer: 'weather', kind: 'fl', severity: 0.66 });
		expect(events[0].detail).toBe('Orange Flood in China');
		expect(events[1]).toMatchObject({ layer: 'natural', severity: 0.92 });
	});

	it('falls back for an unknown alert level rather than dropping the event', () => {
		const [event] = normalizeGdacs({ features: [feature({ eventtype: 'TC', eventid: 3, alertlevel: 'Purple', name: 'Cyclone' })] });
		expect(event.severity).toBeGreaterThan(0);
	});
});

describe('normalizeIoda', () => {
	const centroid = (code) => (code === 'IQ' ? { lat: 33, lon: 43 } : code === 'CV' ? { lat: 16, lon: -24 } : null);
	const alert = (over) => ({ datasource: 'bgp', entity: { code: 'IQ', name: 'Iraq', type: 'country' }, time: 1788867314, level: 'critical', condition: '< 0.25', value: 100, historyValue: 1000, ...over });

	it('reads the measured drop and floors it at the threshold that was crossed', () => {
		const [event] = normalizeIoda({ data: [alert()] }, centroid);
		expect(event).toMatchObject({ layer: 'outages', country: 'IQ', lat: 33 });
		expect(event.severity).toBeCloseTo(0.9, 6);
		expect(event.detail).toContain('below 25%');
	});

	it('ignores a one-percent wobble dressed up as an alert', () => {
		// A "< 0.99" alert is normal variance in a national address space, and
		// putting it beside a blackout would be a lie of emphasis.
		expect(normalizeIoda({ data: [alert({ condition: '< 0.99', value: 990, historyValue: 1000 })] }, centroid)).toEqual([]);
	});

	it('drops alerts that say nothing is wrong', () => {
		expect(normalizeIoda({ data: [alert({ level: 'normal', condition: 'normal' })] }, centroid)).toEqual([]);
	});

	it('collapses a country to one marker and keeps the worst reading', () => {
		const events = normalizeIoda(
			{
				data: [
					alert({ datasource: 'ping-slash24', condition: '< 0.8', value: 700, historyValue: 1000 }),
					alert({ datasource: 'bgp', condition: '< 0.25', value: 100, historyValue: 1000 }),
				],
			},
			centroid,
		);
		expect(events).toHaveLength(1);
		expect(events[0].severity).toBeCloseTo(0.9, 6);
	});

	it('drops an entity with no point on the globe', () => {
		expect(normalizeIoda({ data: [alert({ entity: { code: 'ZZ', name: 'Nowhere' } })] }, centroid)).toEqual([]);
	});

	it('reads the crossed threshold out of the condition string', () => {
		expect(outageThreshold('< 0.25')).toBe(0.25);
		expect(outageThreshold('normal')).toBeNull();
		expect(outageSeverity(500, 1000, '< 0.8')).toBeCloseTo(0.5, 6);
		expect(outageSeverity(0, 0, null)).toBe(0.5);
	});
});

describe('normalizeWorldBank', () => {
	const centroid = (code) => (code === 'ARG' ? { lat: -34, lon: -64 } : null);
	const payload = [
		{ page: 1 },
		[
			{ countryiso3code: 'ARG', country: { value: 'Argentina' }, date: '2024', value: -1.6 },
			{ countryiso3code: 'ARB', country: { value: 'Arab World' }, date: '2024', value: 2.1 },
			{ countryiso3code: 'ARG', country: { value: 'Argentina' }, date: '2023', value: null },
		],
	];

	it('keeps countries and drops aggregates that have no polygon', () => {
		const events = normalizeWorldBank(payload, centroid);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ layer: 'economic', country: 'ARG', value: -1.6, year: '2024' });
		expect(events[0].title).toBe('Argentina: -1.6% GDP growth');
		expect(events[0].detail).toContain('contracted');
	});

	it('draws a contraction louder than healthy growth', () => {
		expect(growthSeverity(-6)).toBeGreaterThan(growthSeverity(4));
		expect(growthSeverity(8)).toBe(0);
		expect(growthSeverity(null)).toBe(0);
		expect(growthSeverity(-20)).toBeLessThanOrEqual(1);
	});
});

describe('computeHotspots', () => {
	const at = '2026-09-08T21:00:00Z';
	const event = (lat, lon, weight, place) => ({ lat, lon, severity: 0.8, weight, place, title: 'Armed clash', at, url: null });

	it('weights a cell by press attention, not by raw event count', () => {
		const cells = computeHotspots(
			[
				...Array.from({ length: 6 }, () => event(31.5, 34.4, 1, 'Rafah')),
				...Array.from({ length: 2 }, () => event(50.4, 30.5, 200, 'Kyiv')),
			],
			{ limit: 5 },
		);
		expect(cells[0].place).toBe('Kyiv');
		expect(cells[0].severity).toBe(1);
	});

	it('places a cell at the weighted centre of what is in it', () => {
		const [cell] = computeHotspots([event(30, 34, 1, 'A'), event(31, 34, 3, 'B')], { limit: 1 });
		expect(cell.lat).toBeCloseTo(30.75, 6);
	});

	it('ignores a cell holding a single event', () => {
		expect(computeHotspots([event(0.5, 0.5, 5, 'Lonely')])).toEqual([]);
	});

	it('carries a readable sample of its members', () => {
		const [cell] = computeHotspots([event(31, 34, 1, 'Gaza'), event(31.2, 34.2, 1, 'Gaza')], { limit: 1 });
		expect(cell.members.length).toBe(2);
		expect(cell.detail).toContain('2 force or coercion events');
	});
});

describe('chokepointPressure', () => {
	const hormuz = [{ id: 'hormuz_strait', name: 'Strait of Hormuz', lat: 26.5, lon: 56.5, note: 'Oil chokepoint' }];

	it('scores a chokepoint from the live events near it', () => {
		const [point] = chokepointPressure(hormuz, [
			{ lat: 27.1, lon: 56.2, severity: 0.9, title: 'Naval seizure', place: 'Bandar Abbas', at: '2026-09-08T20:00:00Z' },
		]);
		expect(point.nearbyEvents).toBe(1);
		expect(point.severity).toBeGreaterThan(0.8);
		expect(point.nearest.title).toBe('Naval seizure');
	});

	it('sits quiet when nothing is happening near it', () => {
		const [point] = chokepointPressure(hormuz, [{ lat: -33.9, lon: 151.2, severity: 0.9, title: 'Far away', at: '2026-09-08T20:00:00Z' }]);
		expect(point.nearbyEvents).toBe(0);
		expect(point.severity).toBeLessThan(0.3);
		expect(point.source).toContain('reference');
	});

	it('measures distance on the sphere, not on the flat coordinates', () => {
		// London to Paris is about 344 km; a naive degree distance would say 2.6.
		expect(haversineKm(51.5, -0.13, 48.86, 2.35)).toBeGreaterThan(330);
		expect(haversineKm(51.5, -0.13, 48.86, 2.35)).toBeLessThan(360);
		expect(haversineKm(0, 179.9, 0, -179.9)).toBeLessThan(30);
	});
});
