/**
 * Where the MediaPipe WASM runtime comes from (src/shared/mediapipe-assets.js).
 *
 * The vendored copy under public/vendor/mediapipe exists so that face quality,
 * selfie refinement and mocap keep working when a CDN is blocked. Production
 * was defeating it: on a real /create/selfie load the HEAD probe hit its
 * four-second deadline while the main thread was busy (the same request answers
 * in single-digit milliseconds when the page is idle), the resolver read that
 * as "not there", and every vision feature silently loaded from jsDelivr.
 *
 * These tests pin the rule that fixes it: only a definitive answer moves the
 * runtime off our own origin, and all the callers on a page share one probe.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isLocal = (base) => base.includes('/vendor/mediapipe/wasm') && !base.includes('cdn.');

async function freshModule() {
	vi.resetModules();
	return await import('../src/shared/mediapipe-assets.js');
}

/** A fetch stub that answers per host: 'ok' | 'missing' | 'stall' | 'offline'. */
function stubFetch(plan) {
	return vi.fn(async (url, opts) => {
		const key = String(url).includes('cdn.jsdelivr.net')
			? 'jsdelivr'
			: String(url).includes('unpkg.com')
				? 'unpkg'
				: 'local';
		const verdict = plan[key] || 'ok';
		if (verdict === 'stall') {
			const err = new Error('signal timed out');
			err.name = 'TimeoutError';
			throw err;
		}
		if (verdict === 'offline') throw new TypeError('Failed to fetch');
		if (verdict === 'missing') return { ok: false, status: 404 };
		expect(opts?.method).toBe('HEAD');
		return { ok: true, status: 200 };
	});
}

let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('visionWasmBase', () => {
	it('uses the vendored copy when our origin answers the probe', async () => {
		globalThis.fetch = stubFetch({ local: 'ok' });
		const { visionWasmBase } = await freshModule();
		expect(isLocal(await visionWasmBase())).toBe(true);
	});

	it('keeps the vendored copy when the probe stalls, because a deadline is not evidence', async () => {
		globalThis.fetch = stubFetch({ local: 'stall' });
		const { visionWasmBase } = await freshModule();
		const base = await visionWasmBase();
		expect(isLocal(base)).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it('falls back to jsDelivr only when our origin definitively lacks the file', async () => {
		globalThis.fetch = stubFetch({ local: 'missing', jsdelivr: 'ok' });
		const { visionWasmBase } = await freshModule();
		expect(await visionWasmBase()).toContain('cdn.jsdelivr.net');
	});

	it('walks past a CDN that is missing the file to the next one', async () => {
		globalThis.fetch = stubFetch({ local: 'missing', jsdelivr: 'missing', unpkg: 'ok' });
		const { visionWasmBase } = await freshModule();
		expect(await visionWasmBase()).toContain('unpkg.com');
	});

	it('returns the first CDN when nothing answers, so MediaPipe raises the real error', async () => {
		globalThis.fetch = stubFetch({ local: 'missing', jsdelivr: 'offline', unpkg: 'offline' });
		const { visionWasmBase } = await freshModule();
		expect(await visionWasmBase()).toContain('cdn.jsdelivr.net');
	});

	it('probes once for every caller on the page, not once per caller', async () => {
		globalThis.fetch = stubFetch({ local: 'ok' });
		const { visionWasmBase } = await freshModule();
		const bases = await Promise.all([visionWasmBase(), visionWasmBase(), visionWasmBase(), visionWasmBase()]);
		expect(new Set(bases).size).toBe(1);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it('remembers the answer for later callers', async () => {
		globalThis.fetch = stubFetch({ local: 'ok' });
		const { visionWasmBase } = await freshModule();
		await visionWasmBase();
		await visionWasmBase();
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});
});

describe('withVisionDeadline', () => {
	it('passes a model through when it loads in time', async () => {
		const { withVisionDeadline } = await freshModule();
		await expect(withVisionDeadline(Promise.resolve('landmarker'), 'face landmarker', 50))
			.resolves.toBe('landmarker');
	});

	it('rejects with the label once the deadline passes, instead of awaiting forever', async () => {
		const { withVisionDeadline } = await freshModule();
		const never = new Promise(() => {});
		await expect(withVisionDeadline(never, 'selfie segmenter', 10))
			.rejects.toThrow(/selfie segmenter did not load within 10ms/);
	});

	it('relays the real load failure when one arrives before the deadline', async () => {
		const { withVisionDeadline } = await freshModule();
		await expect(withVisionDeadline(Promise.reject(new Error('wasm 404')), 'face detector', 1000))
			.rejects.toThrow('wasm 404');
	});

	it('leaves no timer running once the load resolves', async () => {
		vi.useFakeTimers();
		try {
			const { withVisionDeadline } = await freshModule();
			await withVisionDeadline(Promise.resolve('ok'), 'face landmarker', 5000);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not leave the late rejection of an abandoned load unhandled', async () => {
		const { withVisionDeadline } = await freshModule();
		let rejectLate;
		const slow = new Promise((_r, reject) => { rejectLate = reject; });
		const unhandled = [];
		const onUnhandled = (err) => unhandled.push(err);
		process.on('unhandledRejection', onUnhandled);
		try {
			await expect(withVisionDeadline(slow, 'selfie segmenter', 5)).rejects.toThrow(/did not load/);
			rejectLate(new Error('network died later'));
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(unhandled).toEqual([]);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});
});

describe('modelUrl', () => {
	it('serves the vendored face landmarker from our own origin', async () => {
		const { modelUrl } = await freshModule();
		expect(modelUrl('face_landmarker/face_landmarker/float16/1/face_landmarker.task'))
			.toContain('/vendor/mediapipe/face_landmarker.task');
	});

	it('leaves the larger models on Google’s bucket', async () => {
		const { modelUrl } = await freshModule();
		expect(modelUrl('pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'))
			.toBe('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task');
	});
});
