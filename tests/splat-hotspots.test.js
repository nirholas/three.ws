// @vitest-environment jsdom
//
// Camera hotspots, the camera timeline built from them, and in-browser video
// export for the Splat Viewer. The scene is a minimal host exposing the same
// surface mountSplatScene() returns (camera, controls, canvas, setOnFrame,
// setOnRendered); three.js vectors are real. The recorder is the only stub:
// jsdom has no MediaRecorder or canvas capture.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';

import { MAX_HOTSPOTS, initHotspotTimeline, sampleCamera } from '../src/splat-hotspots.js';

const PAGE = readFileSync(resolve(import.meta.dirname, '..', 'pages/splat.html'), 'utf8');
const CARD = PAGE.match(/<div class="sp-card sp-timeline-card"[\s\S]*?<div class="sp-note" id="sp-export-status"[^>]*><\/div>\s*<\/div>/)[0];

const kf = (time, x) => ({ time, position: new Vector3(x, 0, 5), target: new Vector3(x, 1, 0) });

function makeScene({ requestFrame = true } = {}) {
	let onFrame = null;
	let onRendered = null;
	const rendered = { frames: 0 };
	const track = requestFrame ? { requestFrame: vi.fn(), stop: vi.fn() } : { stop: vi.fn() };
	const canvas = {
		clientWidth: 400,
		clientHeight: 300,
		captureStream: vi.fn(() => ({ getVideoTracks: () => [track] })),
	};
	const camera = new PerspectiveCamera(50, 4 / 3, 0.1, 100);
	camera.position.set(0, 0, 5);
	camera.updateMatrixWorld(true);
	const scene = {
		canvas,
		camera,
		controls: { target: new Vector3(0, 0, 0), update() {} },
		setOnFrame: (fn) => { onFrame = fn; },
		setOnRendered: (fn) => { onRendered = fn; },
	};
	return {
		scene,
		track,
		/** Drive one render loop tick, the way splat-stage's rAF loop does. */
		tick() { onFrame?.(); rendered.frames += 1; onRendered?.(); },
		rendered,
	};
}

describe('sampleCamera', () => {
	it('clamps to the first and last keyframe outside the path', () => {
		const kfs = [kf(1, 0), kf(3, 10)];
		expect(sampleCamera(kfs, -5).position.x).toBe(0);
		expect(sampleCamera(kfs, 99).position.x).toBe(10);
	});

	it('eases between keyframes and hits the midpoint exactly at half time', () => {
		const kfs = [kf(0, 0), kf(4, 10)];
		expect(sampleCamera(kfs, 2).position.x).toBeCloseTo(5, 6);
		const early = sampleCamera(kfs, 1).position.x;
		expect(early).toBeGreaterThan(0);
		expect(early).toBeLessThan(2.5);
	});

	it('returns null for an empty path', () => {
		expect(sampleCamera([], 1)).toBeNull();
	});

	it('copies vectors so sampling never mutates a keyframe', () => {
		const kfs = [kf(0, 0), kf(2, 10)];
		sampleCamera(kfs, 1).position.x = 999;
		expect(kfs[0].position.x).toBe(0);
		expect(kfs[1].position.x).toBe(10);
	});
});

describe('hotspot timeline', () => {
	let api;
	beforeEach(() => {
		document.body.innerHTML = `<div id="sp-stage"></div>${CARD}`;
		api = initHotspotTimeline();
	});
	afterEach(() => { vi.unstubAllGlobals(); });

	it('is hidden until a scene mounts and export needs two views', () => {
		const card = document.querySelector('#sp-timeline-card');
		expect(card.hidden).toBe(true);
		const { scene } = makeScene();
		api.onSceneChanged(scene);
		expect(card.hidden).toBe(false);
		expect(document.querySelector('#sp-export-video').disabled).toBe(true);
		document.querySelector('#sp-hotspot-add').click();
		expect(document.querySelector('#sp-export-video').disabled).toBe(true);
		document.querySelector('#sp-hotspot-add').click();
		expect(document.querySelector('#sp-export-video').disabled).toBe(false);
	});

	it(`caps saved camera views at ${MAX_HOTSPOTS} and disables the add button`, () => {
		const { scene } = makeScene();
		api.onSceneChanged(scene);
		const add = document.querySelector('#sp-hotspot-add');
		for (let i = 0; i < MAX_HOTSPOTS + 5; i++) add.click();
		expect(document.querySelectorAll('#sp-hotspot-list li')).toHaveLength(MAX_HOTSPOTS);
		expect(add.disabled).toBe(true);
		expect(MAX_HOTSPOTS).toBe(25);
	});

	it('saves the live camera pose and spaces views along the timeline', () => {
		const { scene } = makeScene();
		api.onSceneChanged(scene);
		scene.camera.position.set(1, 2, 3);
		document.querySelector('#sp-hotspot-add').click();
		scene.camera.position.set(4, 5, 6);
		document.querySelector('#sp-hotspot-add').click();
		const times = [...document.querySelectorAll('.sp-hotspot-time')].map((i) => Number(i.value));
		expect(times).toEqual([0, 2.5]);
		expect(document.querySelector('#sp-timeline-time').textContent).toBe('0.0s / 2.5s');
	});

	it('clears every view when the scene is swapped', () => {
		const { scene } = makeScene();
		api.onSceneChanged(scene);
		document.querySelector('#sp-hotspot-add').click();
		api.onSceneChanged(makeScene().scene);
		expect(document.querySelectorAll('#sp-hotspot-list li')).toHaveLength(0);
	});

	describe('video export', () => {
		function stubRecorder() {
			class FakeRecorder {
				static isTypeSupported() { return true; }
				constructor(stream, opts) { this.stream = stream; this.opts = opts; }
				start() { this.started = true; }
				requestData() {}
				stop() {
					const track = this.stream.getVideoTracks()[0];
					const frames = track.requestFrame ? track.requestFrame.mock.calls.length : 5;
					if (frames > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(frames * 1000)]) });
					queueMicrotask(() => this.onstop?.());
				}
			}
			vi.stubGlobal('MediaRecorder', FakeRecorder);
			vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:fake') }));
		}

		async function runExport(host, fps = 60) {
			const timer = setInterval(() => host.tick(), 1000 / fps);
			try {
				document.querySelector('#sp-export-video').click();
				await vi.waitFor(() => {
					const s = document.querySelector('#sp-export-status');
					expect(s.hidden).toBe(false);
					expect(s.textContent).not.toMatch(/Recording camera path/);
				}, { timeout: 8000, interval: 50 });
			} finally { clearInterval(timer); }
			return document.querySelector('#sp-export-status');
		}

		function fastPath(host) {
			api.onSceneChanged(host.scene);
			const add = document.querySelector('#sp-hotspot-add');
			host.scene.camera.position.set(0, 0, 5); add.click();
			host.scene.camera.position.set(3, 0, 5); add.click();
			const times = document.querySelectorAll('.sp-hotspot-time');
			times[1].value = '0.4';
			times[1].dispatchEvent(new Event('change'));
		}

		it('plays the path, pushes one frame per render, and offers a download', async () => {
			stubRecorder();
			const host = makeScene();
			fastPath(host);
			const status = await runExport(host);
			const link = status.querySelector('a.sp-export-link');
			expect(link).not.toBeNull();
			expect(link.download).toBe('splat-camera-path.webm');
			expect(host.scene.canvas.captureStream).toHaveBeenCalledWith(0);
			expect(host.track.requestFrame.mock.calls.length).toBeGreaterThanOrEqual(2);
			const pushed = host.track.requestFrame.mock.calls.length;
			host.tick();
			expect(host.track.requestFrame.mock.calls.length).toBe(pushed);
			expect(host.scene.camera.position.x).toBeCloseTo(3, 5);
		});

		it('falls back to a fixed-rate capture when requestFrame is unavailable', async () => {
			stubRecorder();
			const host = makeScene({ requestFrame: false });
			fastPath(host);
			const status = await runExport(host);
			expect(host.scene.canvas.captureStream).toHaveBeenLastCalledWith(30);
			expect(status.querySelector('a.sp-export-link')).not.toBeNull();
		});

		it('says so instead of offering an empty file when too few frames render', async () => {
			stubRecorder();
			const host = makeScene();
			fastPath(host);
			const status = await runExport(host, 1.5);
			expect(status.querySelector('a.sp-export-link')).toBeNull();
			expect(status.textContent).toMatch(/Recording failed/);
			expect(status.classList.contains('sp-note--error')).toBe(true);
		});
	});
});
