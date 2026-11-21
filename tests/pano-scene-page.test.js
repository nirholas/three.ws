import { describe, it, expect } from 'vitest';
import { Euler, Quaternion } from 'three';
import {
	MAX_PHOTO_BYTES,
	classifyFile,
	isEquirectSize,
	stepsFor,
	stepStates,
	stageCopy,
	errorCopy,
	walkRadius,
	clampOffset,
	deviceQuaternion,
} from '../src/pano-scene-core.js';

describe('classifyFile', () => {
	it('accepts JPEG, PNG and raw .insp', () => {
		expect(classifyFile({ name: 'a.jpg', type: 'image/jpeg' })).toEqual({ kind: 'equirect_image', contentType: 'image/jpeg' });
		expect(classifyFile({ name: 'a.png', type: 'image/png' }).kind).toBe('equirect_image');
		expect(classifyFile({ name: 'IMG_1.INSP', type: '' })).toEqual({ kind: 'insp', contentType: 'application/octet-stream' });
	});
	it('infers from the extension when the browser gives no type', () => {
		expect(classifyFile({ name: 'x.jpeg', type: '' }).contentType).toBe('image/jpeg');
	});
	it('rejects everything else', () => {
		expect(classifyFile({ name: 'a.gif', type: 'image/gif' })).toBeNull();
		expect(classifyFile({ name: 'a.exe', type: 'application/octet-stream' })).toBeNull();
		expect(classifyFile({})).toBeNull();
	});
});

describe('isEquirectSize', () => {
	it('wants 2:1 within tolerance', () => {
		expect(isEquirectSize(6080, 3040)).toBe(true);
		expect(isEquirectSize(6080, 3050)).toBe(true);
		expect(isEquirectSize(4000, 3000)).toBe(false);
		expect(isEquirectSize(0, 0)).toBe(false);
	});
});

describe('progress model', () => {
	it('shows a stitch step only for insp', () => {
		expect(stepsFor('insp').map((s) => s.key)).toEqual(['upload', 'stitch', 'depth', 'mesh', 'done']);
		expect(stepsFor('equirect_image').map((s) => s.key)).toEqual(['upload', 'depth', 'mesh', 'done']);
	});
	it('marks earlier steps done and the current one active', () => {
		const s = stepStates('insp', 'depth', 'running').map((x) => x.state);
		expect(s).toEqual(['done', 'done', 'active', 'todo', 'todo']);
	});
	it('treats save as the tail of mesh', () => {
		const s = stepStates('equirect_image', 'save', 'running').map((x) => x.state);
		expect(s).toEqual(['done', 'done', 'active', 'todo']);
	});
	it('marks everything done on success', () => {
		expect(stepStates('insp', 'done', 'succeeded').every((x) => x.state === 'done')).toBe(true);
	});
	it('clamps the percentage in the copy', () => {
		expect(stageCopy('depth', 2)).toContain('100%');
		expect(stageCopy('mesh', -1)).toContain('0%');
	});
});

describe('errorCopy', () => {
	it('asks signed-out visitors to sign in', () => {
		expect(errorCopy('sign_in_required').signIn).toBe(true);
	});
	it('names the limit', () => {
		expect(errorCopy('too_large').body).toContain(String(MAX_PHOTO_BYTES / 1024 / 1024));
	});
	it('falls back to the server message', () => {
		expect(errorCopy('weird', 'boom').body).toBe('boom');
	});
});

describe('walking limits', () => {
	it('scales with depth and stays in range', () => {
		expect(walkRadius(2)).toBeCloseTo(0.6);
		expect(walkRadius(100)).toBe(1.5);
		expect(walkRadius(0.1)).toBe(0.25);
		expect(walkRadius(null)).toBeCloseTo(0.9);
	});
	it('clamps an offset to the disc', () => {
		const c = clampOffset(3, 4, 1);
		expect(Math.hypot(c.x, c.z)).toBeCloseTo(1);
		expect(clampOffset(0.1, 0.1, 1)).toEqual({ x: 0.1, z: 0.1 });
	});
});

describe('deviceQuaternion', () => {
	it('matches three.js for the same reading', () => {
		const [a, b, g, s] = [40, 80, 10, 90];
		const rad = Math.PI / 180;
		const q = new Quaternion().setFromEuler(new Euler(b * rad, a * rad, -g * rad, 'YXZ'));
		q.multiply(new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
		q.multiply(new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, -s * rad));
		const got = deviceQuaternion(a, b, g, s);
		expect(got[0]).toBeCloseTo(q.x, 6);
		expect(got[1]).toBeCloseTo(q.y, 6);
		expect(got[2]).toBeCloseTo(q.z, 6);
		expect(got[3]).toBeCloseTo(q.w, 6);
	});
});
