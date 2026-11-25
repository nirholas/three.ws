// Scenes on the terminal rasterizer: a profile walk, a flock, a lit torus, a
// raymarched solid, a counted point garden, two characters in one frame.
//
// These render real meshes and real clips. A scene that comes back empty, or a
// walk whose side view is no wider than the front view, is a broken picture.

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { createScene, createRenderer, ColorMode, loadModel } from '../src/index.js';
import { createFramebuffer, renderToFramebuffer } from '../src/raster.js';
import { torusMesh } from '../src/solid.js';

const root = resolve(import.meta.dirname, '../../..');
const size = { cwd: root, width: 56, height: 24, mode: ColorMode.MONO };

function covered(fb) {
	let n = 0;
	let minX = fb.width;
	let maxX = 0;
	let minY = fb.height;
	let maxY = 0;
	let left = 0;
	let right = 0;
	let r = 0;
	let g = 0;
	let b = 0;
	for (let y = 0; y < fb.height; y += 1) {
		for (let x = 0; x < fb.width; x += 1) {
			const idx = y * fb.width + x;
			if (!fb.coverage[idx]) continue;
			n += 1;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (x < fb.width / 3) left += 1;
			if (x > (fb.width * 2) / 3) right += 1;
			r += fb.color[idx * 3];
			g += fb.color[idx * 3 + 1];
			b += fb.color[idx * 3 + 2];
		}
	}
	return {
		n,
		w: n ? maxX - minX + 1 : 0,
		h: n ? maxY - minY + 1 : 0,
		left,
		right,
		r: n ? r / n : 0,
		g: n ? g / n : 0,
		b: n ? b / n : 0,
	};
}

describe('terminal scenes', () => {
	let walk;
	let front;
	let meet;
	let birds;
	let donut;
	let shader;
	let splats;
	let draw;
	let sayGm;
	let sayHi;

	beforeAll(async () => {
		walk = await createScene('walk', size);
		front = await createScene('walk', { ...size, yaw: 0 });
		meet = await createScene('meet', size);
		birds = await createScene('birds', size);
		donut = await createScene('donut', { ...size, mode: ColorMode.ANSI256 });
		shader = await createScene('shader', { cwd: root, width: 40, height: 16, mode: ColorMode.ANSI256 });
		splats = await createScene('splats', { cwd: root, width: 48, height: 20, mode: ColorMode.ANSI256 });
		draw = await createScene('draw', size);
		sayGm = await createScene('say', { ...size, text: 'gm' });
		sayHi = await createScene('say', { ...size, text: 'hi' });
	}, 120000);

	it('draws the walk in profile, wider than the front view, and full height', () => {
		walk.frame(0.5);
		front.frame(0.5);
		const side = covered(walk.buffer);
		const blob = covered(front.buffer);
		expect(side.n).toBeGreaterThan(80);
		expect(side.h).toBeGreaterThan(walk.buffer.height * 0.45);
		expect(side.w).toBeGreaterThan(blob.w);
	});

	it('puts one character on each side of meet', () => {
		meet.frame(0.4);
		const box = covered(meet.buffer);
		// The fox is long, so on a narrow frame the walker sits just inside the
		// right third. Both sides have to carry real coverage.
		expect(box.left).toBeGreaterThan(30);
		expect(box.right).toBeGreaterThan(10);
	});

	it('moves the flock between two times', () => {
		const a = birds.frame(0);
		const b = birds.frame(1.2);
		expect(a).not.toBe(b);
		expect(covered(birds.buffer).n).toBeGreaterThan(30);
	});

	it('draws a lit torus and a lathed solid', () => {
		const text = donut.frame(0.4);
		expect(text).toContain('▀');
		expect(covered(donut.buffer).n).toBeGreaterThan(40);
		draw.frame(0.3);
		expect(covered(draw.buffer).n).toBeGreaterThan(40);
	});

	it('raymarches a coloured solid, not a grey disc', () => {
		shader.frame(0.2);
		const box = covered(shader.buffer);
		expect(box.n).toBeGreaterThan(30);
		const spread = Math.abs(box.r - box.g) + Math.abs(box.g - box.b) + Math.abs(box.r - box.b);
		expect(spread).toBeGreaterThan(0.08);
	});

	it('states the real point count and draws the garden', () => {
		expect(splats.detail).toMatch(/^[0-9,]+ points$/);
		const count = Number(splats.detail.replace(/[^0-9]/g, ''));
		expect(count).toBeGreaterThan(1000);
		expect(count).toBeLessThan(20000);
		splats.frame(0.3);
		expect(covered(splats.buffer).n).toBeGreaterThan(80);
	});

	it('changes the balloon when the words change', () => {
		expect(sayGm.frame(0.4)).not.toBe(sayHi.frame(0.4));
	});

	it('keeps braille output to one line per requested row', async () => {
		const braille = await createScene('donut', { cwd: root, width: 32, height: 12, style: 'braille', mode: ColorMode.ANSI256 });
		const lines = braille.frame(0.2).split('\n');
		expect(lines).toHaveLength(12);
		expect(lines.some((line) => /[⠀-⣿]/.test(line))).toBe(true);
	});

	it('composites a second mesh when clear is off, and can plot points', () => {
		const model = torusMesh();
		const fb = createFramebuffer(48, 32);
		renderToFramebuffer(fb, model, { yaw: 0.4, pitch: 0.5, zoom: 1.1, clear: true, translate: [-0.7, 0, 0] });
		const first = covered(fb).n;
		renderToFramebuffer(fb, model, { yaw: 0.4, pitch: 0.5, zoom: 1.1, clear: false, translate: [0.7, 0, 0] });
		const both = covered(fb);
		expect(both.n).toBeGreaterThan(first);
		expect(both.left).toBeGreaterThan(10);
		expect(both.right).toBeGreaterThan(10);

		const points = createFramebuffer(48, 32);
		renderToFramebuffer(points, model, { yaw: 0.4, pitch: 0.5, zoom: 1.1, points: true, pointRadius: 1.2 });
		expect(covered(points).n).toBeGreaterThan(15);
	});

	it('honours a starting yaw on the model renderer', async () => {
		const model = await loadModel(resolve(root, 'public/avatars/cesium-man.glb'));
		const side = createRenderer(model, { width: 40, height: 18, mode: ColorMode.MONO, yaw: Math.PI / 2, spin: 0, pitch: 0, zoom: 1.05 });
		const ahead = createRenderer(model, { width: 40, height: 18, mode: ColorMode.MONO, yaw: 0, spin: 0, pitch: 0, zoom: 1.05 });
		expect(side.frame(0.5)).not.toBe(ahead.frame(0.5));
	});
});
