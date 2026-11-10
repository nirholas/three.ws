// The web half of the native wearables lane, against a fake plugin boundary
// (the Swift and Kotlin plugin cannot run in vitest). The pose math is the real
// marker-pose module; only the native plugin, JPEG decode and QR decode are faked.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {
	getWearablesPlugin,
	nativeWearablesAvailable,
	relocalizeFromDetections,
	createWearablesLane,
	WEARABLES_PLUGIN,
} from '../src/irl/glasses/native-bridge.js';
import { markerRoomId } from '../src/irl/marker-anchor.js';
import { focalLengthPx } from '../src/irl/marker-pose.js';

const PAYLOAD = 'https://three.ws/irl?m=lobby-door';
const ROOM = markerRoomId(PAYLOAD);
const FRAME = { w: 1280, h: 960 };
const VFOV = 60;

/** Corners of a 0.16 m marker seen fronto-parallel `distM` away, centred at (cx, cy). */
function corners(distM, cx = 640, cy = 480) {
	const half = (0.16 * focalLengthPx(VFOV, FRAME.h)) / distM / 2;
	return [
		{ x: cx - half, y: cy - half },
		{ x: cx + half, y: cy - half },
		{ x: cx + half, y: cy + half },
		{ x: cx - half, y: cy + half },
	];
}

describe('feature detection', () => {
	it('is absent on the plain web build', () => {
		expect(getWearablesPlugin({})).toBeNull();
		expect(getWearablesPlugin({ Capacitor: { isNativePlatform: () => false, Plugins: {} } })).toBeNull();
		expect(nativeWearablesAvailable(undefined)).toBe(false);
	});

	it('is absent when the shell does not carry the plugin', () => {
		expect(getWearablesPlugin({ Capacitor: { isNativePlatform: () => true, Plugins: {} } })).toBeNull();
	});

	it('returns the plugin on a native shell that carries it', () => {
		const plugin = { getSession: async () => ({ state: 'connected' }) };
		const win = { Capacitor: { isNativePlatform: () => true, Plugins: { [WEARABLES_PLUGIN]: plugin } } };
		expect(getWearablesPlugin(win)).toBe(plugin);
		expect(nativeWearablesAvailable(win)).toBe(true);
	});

	it('never throws on a hostile Capacitor object', () => {
		const win = { get Capacitor() { throw new Error('boom'); } };
		expect(getWearablesPlugin(win)).toBeNull();
	});
});

describe('relocalizeFromDetections', () => {
	it('recovers the distance to the pin marker', () => {
		const r = relocalizeFromDetections({
			detections: [{ rawValue: PAYLOAD, cornerPoints: corners(2) }],
			frame: FRAME, vfovDeg: VFOV, anchorRoomId: ROOM,
		});
		expect(r.ok).toBe(true);
		expect(r.distanceM).toBeCloseTo(2, 1);
		expect(r.center.z).toBeCloseTo(-2, 1);
		expect(r.center.x).toBeCloseTo(0, 5);
		expect(r.roomId).toBe(ROOM);
	});

	it('places an off-centre marker to the right of the camera axis', () => {
		const r = relocalizeFromDetections({
			detections: [{ rawValue: PAYLOAD, cornerPoints: corners(1, 900, 480) }],
			frame: FRAME, vfovDeg: VFOV, anchorRoomId: ROOM,
		});
		expect(r.ok).toBe(true);
		expect(r.center.x).toBeGreaterThan(0.2);
	});

	it('ignores a different marker in view', () => {
		const r = relocalizeFromDetections({
			detections: [{ rawValue: 'https://three.ws/irl?m=other', cornerPoints: corners(1) }],
			frame: FRAME, vfovDeg: VFOV, anchorRoomId: ROOM,
		});
		expect(r).toEqual({ ok: false, reason: 'wrong_marker' });
	});

	it('picks the pin marker out of several', () => {
		const r = relocalizeFromDetections({
			detections: [
				{ rawValue: 'https://three.ws/irl?m=other', cornerPoints: corners(0.6) },
				{ rawValue: PAYLOAD, cornerPoints: corners(3) },
			],
			frame: FRAME, vfovDeg: VFOV, anchorRoomId: ROOM,
		});
		expect(r.ok).toBe(true);
		expect(r.distanceM).toBeCloseTo(3, 1);
	});

	it('reports no marker for an empty frame and a speck', () => {
		expect(relocalizeFromDetections({ detections: [], frame: FRAME, vfovDeg: VFOV, anchorRoomId: ROOM }))
			.toEqual({ ok: false, reason: 'no_marker' });
		expect(relocalizeFromDetections({
			detections: [{ rawValue: PAYLOAD, cornerPoints: corners(40) }],
			frame: FRAME, vfovDeg: VFOV, anchorRoomId: ROOM,
		})).toEqual({ ok: false, reason: 'no_marker' });
	});

	it('rejects an implausibly far read', () => {
		const r = relocalizeFromDetections({
			detections: [{ rawValue: PAYLOAD, cornerPoints: corners(12) }],
			frame: { w: 4000, h: 3000 }, vfovDeg: 10, anchorRoomId: ROOM, markerSizeM: 5,
		});
		expect(r.ok).toBe(false);
	});
});

function fakeLane({ state = 'connected', detections } = {}) {
	const listeners = [];
	const removed = vi.fn();
	const plugin = {
		getSession: vi.fn(async () => ({ state })),
		addListener: vi.fn(async (_evt, fn) => { listeners.push(fn); return { remove: removed }; }),
		startAudioRoute: vi.fn(async () => ({ input: 'glasses-mic', output: 'glasses-speaker' })),
		stopAudioRoute: vi.fn(async () => {}),
		capturePhoto: vi.fn(async () => ({ base64: btoa('jpegbytes'), mime: 'image/jpeg', vfovDeg: VFOV })),
	};
	const close = vi.fn();
	const decode = vi.fn(async () => ({ bitmap: {}, w: FRAME.w, h: FRAME.h, close }));
	const detectQr = vi.fn(async () => detections ?? [{ rawValue: PAYLOAD, cornerPoints: corners(1.5) }]);
	return { lane: createWearablesLane({ plugin, decode, detectQr }), plugin, listeners, removed, close, decode };
}

describe('wearables lane', () => {
	it('opens and closes the glasses audio route', async () => {
		const { lane, plugin } = fakeLane();
		const route = await lane.startVoice();
		expect(route.input).toBe('glasses-mic');
		await lane.stopVoice();
		await lane.stopVoice();
		expect(plugin.stopAudioRoute).toHaveBeenCalledTimes(1);
	});

	it('refuses voice when the glasses are not connected', async () => {
		const { lane, plugin } = fakeLane({ state: 'disconnected' });
		await expect(lane.startVoice()).rejects.toMatchObject({ code: 'not_connected' });
		expect(plugin.startAudioRoute).not.toHaveBeenCalled();
	});

	it('relocalizes from one captured frame and releases the bitmap', async () => {
		const { lane, close, plugin } = fakeLane();
		const r = await lane.relocalize({ anchorRoomId: ROOM });
		expect(r.ok).toBe(true);
		expect(r.distanceM).toBeCloseTo(1.5, 1);
		expect(plugin.capturePhoto).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('releases the bitmap when detection throws', async () => {
		const { lane, close } = fakeLane();
		const bad = createWearablesLane({
			plugin: { getSession: async () => ({ state: 'connected' }), capturePhoto: async () => ({ base64: btoa('x') }) },
			decode: async () => ({ bitmap: {}, w: 10, h: 10, close }),
			detectQr: async () => { throw new Error('detector down'); },
		});
		await expect(bad.relocalize({ anchorRoomId: ROOM, vfovDeg: VFOV })).rejects.toThrow('detector down');
		expect(close).toHaveBeenCalledTimes(1);
		expect(lane).toBeTruthy();
	});

	it('never touches the network: the frame is not uploaded', async () => {
		const fetchSpy = vi.fn();
		const prev = globalThis.fetch;
		globalThis.fetch = fetchSpy;
		try {
			const { lane } = fakeLane();
			await lane.relocalize({ anchorRoomId: ROOM });
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = prev;
		}
	});

	it('refuses to guess the camera field of view', async () => {
		const close = vi.fn();
		const plugin = {
			getSession: async () => ({ state: 'connected' }),
			capturePhoto: async () => ({ base64: btoa('x') }),
		};
		const l = createWearablesLane({ plugin, decode: async () => ({ bitmap: {}, w: 1, h: 1, close }), detectQr: async () => [] });
		await expect(l.relocalize({ anchorRoomId: ROOM })).rejects.toMatchObject({ code: 'fov_unknown' });
		expect(close).not.toHaveBeenCalled();
	});

	it('refuses to capture when not connected', async () => {
		const { lane, plugin } = fakeLane({ state: 'connecting' });
		await expect(lane.relocalize({ anchorRoomId: ROOM })).rejects.toMatchObject({ code: 'not_connected' });
		expect(plugin.capturePhoto).not.toHaveBeenCalled();
	});

	it('fans one native listener out to many watchers and removes it at zero', async () => {
		const { lane, plugin, listeners, removed } = fakeLane();
		const a = vi.fn(), b = vi.fn();
		const offA = await lane.watchSession(a);
		const offB = await lane.watchSession(b);
		expect(plugin.addListener).toHaveBeenCalledTimes(1);
		listeners[0]({ state: 'connected' });
		expect(a).toHaveBeenCalledWith({ state: 'connected' });
		expect(b).toHaveBeenCalled();
		await offA();
		expect(removed).not.toHaveBeenCalled();
		await offB();
		expect(removed).toHaveBeenCalledTimes(1);
	});

	it('requires a plugin', () => {
		expect(() => createWearablesLane({ plugin: null })).toThrow(/plugin missing/);
	});
});

// Camera frames on disk (rendered by scripts/glasses/render-relocalize-fixtures.mjs
// from the ground truth in manifest.json), decoded with a real JPEG decoder and a
// real QR detector, so the pose math is exercised on pixels rather than on corners
// the test wrote itself.
const FIX_DIR = join(import.meta.dirname, 'fixtures', 'glasses-relocalize');
const MANIFEST = JSON.parse(readFileSync(join(FIX_DIR, 'manifest.json'), 'utf8'));
const PIN_ROOM = markerRoomId(MANIFEST.pinPayload);

async function decodeJpeg(input) {
	const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	return { bitmap: { data: new Uint8ClampedArray(data), w: info.width, h: info.height }, w: info.width, h: info.height };
}

function detectWithJsQr(bitmap) {
	const code = jsQR(bitmap.data, bitmap.w, bitmap.h);
	if (!code) return [];
	const l = code.location;
	return [{ rawValue: code.data, cornerPoints: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner] }];
}

describe('relocalization on recorded frames', () => {
	for (const f of MANIFEST.frames.filter((x) => x.payload === MANIFEST.pinPayload)) {
		it(`recovers ${f.distanceM} m at (${f.cx}, ${f.cy}) from ${f.file}`, async () => {
			const decoded = await decodeJpeg(readFileSync(join(FIX_DIR, f.file)));
			const detections = detectWithJsQr(decoded.bitmap);
			expect(detections).toHaveLength(1);
			const r = relocalizeFromDetections({
				detections, frame: MANIFEST.frame, vfovDeg: MANIFEST.vfovDeg, anchorRoomId: PIN_ROOM,
			});
			expect(r.ok).toBe(true);
			expect(Math.abs(r.distanceM - f.distanceM) / f.distanceM).toBeLessThan(0.05);
			const fpx = focalLengthPx(MANIFEST.vfovDeg, MANIFEST.frame.h);
			const trueX = ((f.cx - MANIFEST.frame.w / 2) / fpx) * f.distanceM;
			const trueY = -((f.cy - MANIFEST.frame.h / 2) / fpx) * f.distanceM;
			expect(r.center.x).toBeCloseTo(trueX, 1);
			expect(r.center.y).toBeCloseTo(trueY, 1);
			expect(r.center.z).toBeLessThan(0);
		});
	}

	it('reports a different marker as wrong_marker', async () => {
		const decoded = await decodeJpeg(readFileSync(join(FIX_DIR, 'other-marker-1m.jpg')));
		const r = relocalizeFromDetections({
			detections: detectWithJsQr(decoded.bitmap), frame: MANIFEST.frame, vfovDeg: MANIFEST.vfovDeg, anchorRoomId: PIN_ROOM,
		});
		expect(r).toEqual({ ok: false, reason: 'wrong_marker' });
	});

	it('reports a bare wall as no_marker', async () => {
		const decoded = await decodeJpeg(readFileSync(join(FIX_DIR, 'empty-wall.jpg')));
		const r = relocalizeFromDetections({
			detections: detectWithJsQr(decoded.bitmap), frame: MANIFEST.frame, vfovDeg: MANIFEST.vfovDeg, anchorRoomId: PIN_ROOM,
		});
		expect(r).toEqual({ ok: false, reason: 'no_marker' });
	});

	it('runs a captured frame end to end through the lane without touching the network', async () => {
		const jpg = readFileSync(join(FIX_DIR, 'pin-1p2m-centre.jpg'));
		const fetchSpy = vi.fn();
		const prev = globalThis.fetch;
		globalThis.fetch = fetchSpy;
		try {
			const lane = createWearablesLane({
				plugin: {
					getSession: async () => ({ state: 'connected' }),
					capturePhoto: async () => ({ base64: jpg.toString('base64'), mime: 'image/jpeg', vfovDeg: MANIFEST.vfovDeg }),
				},
				decode: async (blob) => decodeJpeg(Buffer.from(await blob.arrayBuffer())),
				detectQr: async (bitmap) => detectWithJsQr(bitmap),
			});
			const r = await lane.relocalize({ anchorRoomId: PIN_ROOM });
			expect(r.ok).toBe(true);
			expect(r.distanceM).toBeCloseTo(1.2, 1);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = prev;
		}
	});
});
