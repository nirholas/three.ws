// The static ndarray-ops twin must produce the same bytes as the real
// cwise-generated package on the shapes ndarray-pixels hands it (an RGBA image
// plane, a strided RGB sub-view, and a single-channel scalar fill).
import { describe, it, expect } from 'vitest';
import ndarray from 'ndarray';
import realOps from 'ndarray-ops';
import { assign, assigns } from '../src/shims/ndarray-ops-static.js';

function image(w, h, fill) {
	const data = new Uint8Array(w * h * 4);
	for (let i = 0; i < data.length; i++) data[i] = fill(i);
	return data;
}

describe('ndarray-ops-static', () => {
	it('assign matches ndarray-ops on a strided RGB view into an RGBA buffer', () => {
		const w = 7, h = 5;
		const src = image(w, h, (i) => (i * 37) % 256);
		const a = new Uint8Array(w * h * 4);
		const b = new Uint8Array(w * h * 4);
		const view = (buf) => ndarray(buf, [w, h, 3], [4, 4 * w, 1]);
		const s = ndarray(src, [w, h, 3], [4, 4 * w, 1]);
		realOps.assign(view(a), s);
		assign(view(b), s);
		expect(Array.from(b)).toEqual(Array.from(a));
	});

	it('assigns matches ndarray-ops filling the alpha plane', () => {
		const w = 6, h = 4;
		const a = image(w, h, (i) => i % 251);
		const b = a.slice();
		const alpha = (buf) => ndarray(buf, [w * h], [4], 3);
		realOps.assigns(alpha(a), 255);
		assigns(alpha(b), 255);
		expect(Array.from(b)).toEqual(Array.from(a));
	});

	it('rejects mismatched shapes and handles empty arrays', () => {
		expect(() => assign(ndarray(new Uint8Array(4), [4]), ndarray(new Uint8Array(3), [3]))).toThrow(/shape/);
		expect(() => assigns(ndarray(new Uint8Array(0), [0]), 1)).not.toThrow();
	});
});
