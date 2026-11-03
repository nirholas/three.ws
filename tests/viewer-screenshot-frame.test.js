import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The viewer's WebGL canvas has no preserveDrawingBuffer: once the current task
// ends, the browser composites the frame and clears the buffer. A capture that
// renders, then awaits anything that crosses a task boundary (the watermark
// fetch), then reads the canvas, saves a blank image. This fake canvas models
// that: a render marks the buffer fresh and the next task clears it.
function fakeViewer() {
	const canvas = {
		fresh: false,
		width: 64,
		height: 48,
		toBlob(cb, type) {
			cb(new Blob([this.fresh ? 'frame' : 'blank'], { type }));
		},
	};
	return {
		canvas,
		viewer: {
			el: { appendChild() {} },
			scene: {},
			activeCamera: {},
			renderer: {
				domElement: canvas,
				render() {
					canvas.fresh = true;
					setTimeout(() => (canvas.fresh = false), 0);
				},
			},
		},
	};
}

// 2D canvas used to composite the watermark: records whether the WebGL source
// still held the rendered frame at the moment it was drawn.
function fake2dCanvas() {
	const drawn = [];
	return {
		width: 0,
		height: 0,
		drawn,
		getContext: () => ({
			globalAlpha: 1,
			drawImage: (src) => drawn.push(src.isWatermark ? 'watermark' : src.fresh ? 'frame' : 'blank'),
		}),
		toBlob(cb, type) {
			cb(new Blob([drawn.join('+')], { type }));
		},
	};
}

const realFetch = globalThis.fetch;
let composite;

beforeEach(() => {
	vi.resetModules();
	composite = fake2dCanvas();
	globalThis.document = {
		createElement: (tag) =>
			tag === 'canvas' ? composite : { className: '', addEventListener() {}, remove() {} },
	};
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete globalThis.document;
	delete globalThis.Image;
});

describe('captureScreenshot', () => {
	it('captures the rendered frame when the watermark has to be fetched first', async () => {
		globalThis.fetch = () =>
			new Promise((resolve) =>
				setTimeout(() => resolve({ ok: true, text: async () => '<svg xmlns="http://www.w3.org/2000/svg"/>' }), 5),
			);
		globalThis.Image = class {
			constructor() {
				this.isWatermark = true;
				this.width = 10;
				this.height = 10;
			}
			set src(_) {
				setTimeout(() => this.onload?.(), 0);
			}
		};
		const { captureScreenshot } = await import('../src/viewer/screenshot.js');
		const { viewer } = fakeViewer();
		const blob = await captureScreenshot(viewer);
		expect(await blob.text()).toBe('frame+watermark');
	});

	it('captures the rendered frame when the watermark is unavailable', async () => {
		globalThis.fetch = () => new Promise((_, reject) => setTimeout(() => reject(new Error('offline')), 5));
		const { captureScreenshot } = await import('../src/viewer/screenshot.js');
		const { viewer } = fakeViewer();
		const blob = await captureScreenshot(viewer);
		expect(await blob.text()).toBe('frame');
	});
});
