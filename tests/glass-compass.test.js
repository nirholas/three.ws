import { describe, it, expect } from 'vitest';
import { bearingTo, distanceMetres, relativeBearing, headingFromEvent, smoothHeading, normalizeRad, createCompass } from '../src/glass/compass.js';

const deg = (r) => (r * 180) / Math.PI;

describe('glass compass', () => {
	it('bearing to a point due east is +90 degrees', () => {
		expect(deg(bearingTo({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }))).toBeCloseTo(90, 3);
		expect(deg(bearingTo({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }))).toBeCloseTo(0, 3);
		expect(deg(bearingTo({ lat: 0, lng: 0 }, { lat: -1, lng: 0 }))).toBeCloseTo(180, 3);
	});
	it('distance matches roughly 111 km per degree of latitude', () => {
		expect(distanceMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(110500);
		expect(distanceMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(111700);
	});
	it('relative bearing is positive when the target is to the right', () => {
		const rel = relativeBearing(0, Math.PI / 2);
		expect(deg(rel)).toBeCloseTo(90, 5);
		expect(deg(relativeBearing(Math.PI / 2, 0))).toBeCloseTo(-90, 5);
	});
	it('takes the short way across the seam', () => {
		expect(deg(relativeBearing((350 * Math.PI) / 180, (10 * Math.PI) / 180))).toBeCloseTo(20, 5);
		expect(deg(smoothHeading(normalizeRad((179 * Math.PI) / 180), normalizeRad((-179 * Math.PI) / 180), 0.5))).toBeCloseTo(180, 3);
	});
	it('reads heading from iOS and absolute-alpha events, null otherwise', () => {
		expect(deg(headingFromEvent({ webkitCompassHeading: 90 }))).toBeCloseTo(90, 5);
		expect(deg(headingFromEvent({ absolute: true, alpha: 270 }))).toBeCloseTo(90, 5);
		expect(headingFromEvent({ absolute: false, alpha: 10 })).toBeNull();
	});
	it('reports unsupported and denied states without throwing', async () => {
		const c1 = createCompass({ target: { addEventListener() {}, removeEventListener() {} } });
		expect(await c1.start()).toBe('unsupported');
		const target = {
			DeviceOrientationEvent: { requestPermission: async () => 'denied' },
			addEventListener() {}, removeEventListener() {},
		};
		expect(await createCompass({ target }).start()).toBe('denied');
	});
	it('goes live on a compass event', async () => {
		const handlers = {};
		const target = {
			DeviceOrientationEvent: function () {},
			addEventListener: (n, h) => { handlers[n] = h; },
			removeEventListener() {},
		};
		const seen = [];
		const c = createCompass({ target, onHeading: (h) => seen.push(h) });
		await c.start();
		handlers.deviceorientation({ webkitCompassHeading: 90 });
		expect(c.state).toBe('live');
		expect(seen).toHaveLength(1);
	});
});
