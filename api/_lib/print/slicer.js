// Place a model on a slicer's build plate: Z-up, millimetres, a printable size.
//
// Adapted from Modly (https://github.com/lightningpixel/modly), MIT License,
// Copyright (c) 2026 Lightning Pixel. Modly's slicer export rotates glTF's
// Y-up into the Z-up world every slicer uses and rescales unit-sized AI output
// so it does not import as a 1 mm speck. This version keeps both rules and adds
// two more a print-ready file needs: the part sits on the bed (lowest point at
// Z = 0) and is centred on the plate origin, so it lands where the user expects
// instead of floating above or beside the plate.
//
// Sizing policy. glTF geometry is in meters. A model whose longest edge comes
// out between 10 mm and 250 mm in real units is a believable physical object and
// is kept exactly as authored. Anything else (generated models are usually
// normalised to about 1 m, scans can be centimetres or kilometres) is scaled so
// its longest edge is 100 mm, a size every consumer printer can run. A caller
// that wants a specific size passes `sizeMm` and gets exactly that.

import { boundsOf } from './mesh-io.js';

const MM_PER_METER = 1000;
export const AUTO_SIZE_MM = 100;
export const REAL_SIZE_RANGE_MM = Object.freeze([10, 250]);
export const SIZE_LIMITS_MM = Object.freeze([5, 500]);

/**
 * Resolve the longest edge, in millimetres, the placed model will have.
 *
 * @param {number} longestMeters  the model's longest bounding-box edge in glTF units
 * @param {number|null} sizeMm    an explicit size, or null for the automatic policy
 * @returns {{ longestMm: number, mode: 'requested'|'real'|'auto' }}
 */
export function resolvePrintSize(longestMeters, sizeMm = null) {
	if (sizeMm !== null && sizeMm !== undefined) {
		const n = Number(sizeMm);
		if (!Number.isFinite(n) || n < SIZE_LIMITS_MM[0] || n > SIZE_LIMITS_MM[1]) {
			throw new RangeError(`size must be between ${SIZE_LIMITS_MM[0]} and ${SIZE_LIMITS_MM[1]} mm`);
		}
		return { longestMm: n, mode: 'requested' };
	}
	const real = longestMeters * MM_PER_METER;
	if (real >= REAL_SIZE_RANGE_MM[0] && real <= REAL_SIZE_RANGE_MM[1]) return { longestMm: real, mode: 'real' };
	return { longestMm: AUTO_SIZE_MM, mode: 'auto' };
}

/**
 * Rotate Y-up to Z-up, scale to millimetres, rest on Z = 0 and centre in XY.
 * Returns new positions; the input is untouched. The exporters are then called
 * with `scale: 1`, because these numbers are already millimetres.
 *
 * @param {Float64Array|number[]} positions  xyz triples in glTF meters, Y-up
 * @param {{ sizeMm?: number|null }} [opts]
 * @returns {{ positions: Float64Array, longestMm: number, mode: string, sizeMm: number[] }}
 */
export function placeOnBed(positions, { sizeMm = null } = {}) {
	const bounds = boundsOf(positions);
	if (!bounds || !(bounds.longest > 0)) throw new RangeError('model has no extent to place');
	const { longestMm, mode } = resolvePrintSize(bounds.longest, sizeMm);
	const k = longestMm / bounds.longest;

	// (x, y, z) Y-up becomes (x, -z, y) Z-up: a +90 degree turn about X, so the
	// model's "up" is the slicer's "up" and its front faces the user.
	const [cx, , cz] = bounds.center;
	const minY = bounds.min[1];
	const out = new Float64Array(positions.length);
	for (let i = 0; i < positions.length; i += 3) {
		out[i] = (positions[i] - cx) * k;
		out[i + 1] = -(positions[i + 2] - cz) * k;
		out[i + 2] = (positions[i + 1] - minY) * k;
	}
	const size = [bounds.size[0] * k, bounds.size[2] * k, bounds.size[1] * k];
	return { positions: out, longestMm, mode, sizeMm: size };
}
