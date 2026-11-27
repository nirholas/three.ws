// Sketch to 3D input guards and drawing maths (src/forge-studio/sketch-guard.js).
//
// A sketch that is blank, a single dot, or scribbled over the whole frame gives
// the TripoSG scribble model nothing to build from, so it spends a GPU slot and
// minutes of waiting on a blob. The guard refuses those on the device, before
// any upload or generation request, with a message that says what to draw.
//
// Pixel buffers here are built with real RGBA bytes (the same shape
// canvas.getImageData returns), not stand-ins for a model or a network.

import { describe, it, expect, vi } from 'vitest';
import {
	assessSketch,
	guardSketchFile,
	toCanvasPoint,
	createUndoStack,
	SKETCH_GUARD_CODES,
} from '../src/forge-studio/sketch-guard.js';

const N = 128;

function frame({ bg = [255, 255, 255, 255], width = N, height = N } = {}) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i++) data.set(bg, i * 4);
	return { data, width, height };
}

function paint(img, x0, y0, x1, y1, rgba = [17, 19, 24, 255]) {
	for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
		for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
			img.data.set(rgba, (y * img.width + x) * 4);
		}
	}
	return img;
}

function ring(img, cx, cy, r, thick = 2, rgba) {
	for (let y = 0; y < img.height; y++) {
		for (let x = 0; x < img.width; x++) {
			const d = Math.hypot(x - cx, y - cy);
			if (Math.abs(d - r) <= thick / 2) paint(img, x, y, x + 1, y + 1, rgba);
		}
	}
	return img;
}

describe('assessSketch', () => {
	it('refuses a blank white canvas as empty', () => {
		const r = assessSketch(frame());
		expect(r.ok).toBe(false);
		expect(r.code).toBe(SKETCH_GUARD_CODES.empty);
		expect(r.message).toMatch(/draw/i);
	});

	it('refuses a fully transparent image as empty', () => {
		const r = assessSketch(frame({ bg: [0, 0, 0, 0] }));
		expect(r.ok).toBe(false);
		expect(r.code).toBe('empty');
	});

	it('refuses a single dot', () => {
		const img = paint(frame(), 60, 60, 64, 64);
		const r = assessSketch(img);
		expect(r.ok).toBe(false);
		expect(r.code).toBe('dot');
		expect(r.message).toMatch(/outline|shape/i);
	});

	it('refuses a drawing smeared over the whole frame', () => {
		const img = frame();
		// A dense scribble: most of the canvas is ink.
		for (let y = 0; y < N; y++) if (y % 4 !== 0) paint(img, 0, y, N, y + 1);
		const r = assessSketch(img);
		expect(r.ok).toBe(false);
		expect(r.code).toBe('full_frame');
		expect(r.message).toMatch(/whole frame|space/i);
	});

	it('refuses a solid dark frame as filling the whole frame', () => {
		const r = assessSketch(frame({ bg: [10, 10, 12, 255] }));
		expect(r.ok).toBe(false);
		expect(r.code).toBe('full_frame');
	});

	it('accepts a line drawing of one object', () => {
		const img = ring(frame(), 64, 64, 36, 3);
		paint(img, 62, 20, 66, 100);
		const r = assessSketch(img);
		expect(r.ok).toBe(true);
		expect(r.stats.inkFraction).toBeGreaterThan(0.01);
		expect(r.stats.inkFraction).toBeLessThan(0.3);
	});

	it('accepts a large outline that touches every edge (a box drawn big is still a drawing)', () => {
		const img = frame();
		paint(img, 0, 0, N, 3);
		paint(img, 0, N - 3, N, N);
		paint(img, 0, 0, 3, N);
		paint(img, N - 3, 0, N, N);
		expect(assessSketch(img).ok).toBe(true);
	});

	it('accepts a photographed drawing on grey paper (judges ink against the paper, not pure white)', () => {
		const img = frame({ bg: [188, 184, 176, 255] });
		ring(img, 64, 64, 34, 3, [40, 40, 44, 255]);
		const r = assessSketch(img);
		expect(r.ok).toBe(true);
	});

	it('accepts thin strokes drawn on a transparent background', () => {
		const img = frame({ bg: [0, 0, 0, 0] });
		ring(img, 64, 64, 30, 3, [17, 19, 24, 255]);
		expect(assessSketch(img).ok).toBe(true);
	});

	it('does not read a malformed buffer as a drawing', () => {
		expect(assessSketch({ data: new Uint8ClampedArray(3), width: 4, height: 4 }).code).toBe('unreadable');
		expect(assessSketch(null).code).toBe('unreadable');
	});
});

describe('guardSketchFile: the friendly refusal happens before any upload', () => {
	const file = new File([new Uint8Array([1, 2, 3])], 'sketch.png', { type: 'image/png' });

	it('does not call upload for an empty canvas', async () => {
		const upload = vi.fn();
		const out = await guardSketchFile(file, upload, { decode: async () => frame() });
		expect(out.ok).toBe(false);
		expect(out.code).toBe('empty');
		expect(upload).not.toHaveBeenCalled();
	});

	it('does not call upload for a single dot', async () => {
		const upload = vi.fn();
		const out = await guardSketchFile(file, upload, {
			decode: async () => paint(frame(), 60, 60, 64, 64),
		});
		expect(out.ok).toBe(false);
		expect(out.code).toBe('dot');
		expect(upload).not.toHaveBeenCalled();
	});

	it('does not call upload for a drawing that fills the frame', async () => {
		const upload = vi.fn();
		const full = frame();
		paint(full, 0, 0, N, N);
		const out = await guardSketchFile(file, upload, { decode: async () => full });
		expect(out.ok).toBe(false);
		expect(out.code).toBe('full_frame');
		expect(upload).not.toHaveBeenCalled();
	});

	it('uploads exactly once for a real drawing and returns the upload result', async () => {
		const upload = vi.fn(async () => ({ ok: true, url: 'https://three.ws/cdn/forge/x.png' }));
		const out = await guardSketchFile(file, upload, {
			decode: async () => ring(frame(), 64, 64, 36, 3),
		});
		expect(upload).toHaveBeenCalledTimes(1);
		expect(upload).toHaveBeenCalledWith(file);
		expect(out).toEqual({ ok: true, url: 'https://three.ws/cdn/forge/x.png' });
	});

	it('lets an image the browser cannot decode through to the normal upload checks instead of blocking it', async () => {
		const upload = vi.fn(async () => ({ ok: true, url: 'https://three.ws/cdn/forge/y.png' }));
		const out = await guardSketchFile(file, upload, {
			decode: async () => {
				throw new Error('decode failed');
			},
		});
		expect(upload).toHaveBeenCalledTimes(1);
		expect(out.ok).toBe(true);
	});
});

describe('toCanvasPoint', () => {
	it('maps a pointer to the 768px drawing surface when the canvas is shown at full size', () => {
		const rect = { left: 100, top: 50, width: 768, height: 768 };
		expect(toCanvasPoint(150, 250, rect, 768)).toEqual({ x: 50, y: 200 });
	});

	it('scales the pointer when the canvas is shrunk to fit a phone screen', () => {
		// Drawn at 768 logical px, displayed 300 CSS px wide: the centre of the
		// element must be the centre of the drawing surface, not pixel 150 of 768.
		const rect = { left: 10, top: 10, width: 300, height: 300 };
		const p = toCanvasPoint(160, 160, rect, 768);
		expect(p.x).toBeCloseTo(384, 5);
		expect(p.y).toBeCloseTo(384, 5);
	});

	it('returns null for a canvas with no layout size instead of dividing by zero', () => {
		expect(toCanvasPoint(5, 5, { left: 0, top: 0, width: 0, height: 0 }, 768)).toBeNull();
	});
});

describe('createUndoStack', () => {
	it('restores the stroke flag that went with the snapshot, so Undo after Clear brings back a usable drawing', () => {
		const stack = createUndoStack(20);
		// blank -> stroke 1 -> Clear
		stack.push({ image: 'blank', hasStrokes: false }); // before stroke 1
		stack.push({ image: 'one-stroke', hasStrokes: true }); // before Clear
		const undoClear = stack.pop();
		expect(undoClear).toEqual({ image: 'one-stroke', hasStrokes: true });
		// One snapshot is left (the blank one), and the restored drawing still counts as ink.
		expect(stack.size).toBe(1);
	});

	it('caps its memory and drops the oldest snapshot first', () => {
		const stack = createUndoStack(3);
		for (let i = 0; i < 5; i++) stack.push({ image: i, hasStrokes: true });
		expect(stack.size).toBe(3);
		expect(stack.pop().image).toBe(4);
		expect(stack.pop().image).toBe(3);
		expect(stack.pop().image).toBe(2);
		expect(stack.pop()).toBeNull();
	});
});
