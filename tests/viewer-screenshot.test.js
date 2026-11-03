// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { captureScreenshot } from '../src/viewer/screenshot.js';

function makeViewer({ render, toBlob }) {
	const domElement = document.createElement('canvas');
	domElement.toBlob = toBlob;
	return {
		el: document.createElement('div'),
		scene: {},
		activeCamera: {},
		renderer: { render, domElement },
	};
}

const hangs = (p) =>
	Promise.race([p.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('hung'), 300))]);

describe('captureScreenshot failure handling', () => {
	it('rejects when the renderer throws instead of hanging forever', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
		const viewer = makeViewer({
			render: () => {
				throw new Error('context lost');
			},
			toBlob: (cb) => cb(new Blob(['x'])),
		});
		expect(await hangs(captureScreenshot(viewer))).toBe('rejected');
	});

	it('resolves with the canvas blob when no watermark is available', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
		const blob = new Blob(['png']);
		const viewer = makeViewer({ render: () => {}, toBlob: (cb) => cb(blob) });
		expect(await captureScreenshot(viewer)).toBe(blob);
	});
});
