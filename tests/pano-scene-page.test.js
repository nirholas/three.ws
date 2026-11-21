import { describe, it, expect } from 'vitest';
import { Euler, Quaternion } from 'three';
import {
	MAX_PHOTO_BYTES,
	classifyFile,
	classifyUrl,
	isEquirectSize,
	stepsFor,
	stepStates,
	stageCopy,
	errorCopy,
	walkRadius,
	clampOffset,
	deviceQuaternion,
	backdropGrid,
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

describe('classifyUrl', () => {
	it('accepts a public https link and infers the source kind from the path', () => {
		expect(classifyUrl('https://example.com/room.jpg')).toEqual({ kind: 'equirect_image', url: 'https://example.com/room.jpg' });
		expect(classifyUrl('  https://example.com/raw/IMG_1.INSP?x=1 ').kind).toBe('insp');
		expect(classifyUrl('https://example.com/photo?id=9').kind).toBe('equirect_image');
	});
	it('rejects anything that is not https', () => {
		expect(classifyUrl('http://example.com/room.jpg')).toBeNull();
		expect(classifyUrl('javascript:alert(1)')).toBeNull();
		expect(classifyUrl('room.jpg')).toBeNull();
		expect(classifyUrl('')).toBeNull();
	});
});

describe('errorCopy storage_unavailable', () => {
	it('tells the visitor uploads are paused and to paste a link instead', () => {
		const copy = errorCopy('storage_unavailable', 'server text');
		expect(copy.title).toMatch(/upload/i);
		expect(copy.body).toMatch(/link/i);
		expect(copy.pasteLink).toBe(true);
	});
});

describe('errorCopy upload_failed', () => {
	it('keeps the server or network detail and offers the link path', () => {
		const copy = errorCopy('upload_failed', 'Upload failed (HTTP 401).');
		expect(copy.body).toContain('HTTP 401');
		expect(copy.pasteLink).toBe(true);
	});
});

describe('errorCopy for a file the stitcher refuses', () => {
	it('names the camera problem, keeps the worker detail and offers no pointless retry', () => {
		const message = "The camera model found in the file is 'Insta360 ONE'. Only the dual lens Insta360 ONE X, ONE X2, ONE R, ONE RS and X2 to X6 are supported.";
		const copy = errorCopy('unsupported_camera', message);
		expect(copy.title).toMatch(/camera/i);
		expect(copy.body).toContain('Insta360 ONE');
		expect(copy.body).toMatch(/JPEG/);
		expect(copy.permanent).toBe(true);
	});

	it('treats an unreadable or damaged raw file as permanent too', () => {
		for (const code of ['corrupt_input', 'corrupt_trailer', 'corrupt_calibration', 'unreadable_input', 'no_calibration', 'unsupported_layout']) {
			const copy = errorCopy(code, 'detail from the worker');
			expect(copy.title).not.toBe('Something went wrong');
			expect(copy.body).toContain('detail from the worker');
			expect(copy.permanent).toBe(true);
		}
	});

	it('keeps retry for transient failures', () => {
		expect(errorCopy('task_lost', 'restarted').permanent).toBeFalsy();
		expect(errorCopy('weird', 'boom').permanent).toBeFalsy();
	});
});

describe('backdropGrid', () => {
	// The depth worker culls shell faces that bridge a depth jump, so the stage
	// draws the photo on a far sphere behind the shell. It must sample the photo
	// in the worker's frame (workers/model-panodepth/shell_mesh.py directions():
	// centre pixel looks along -Z, u grows toward +X, v from the top grows down),
	// or the gaps would show a rotated photo instead of the missing pixels.
	const grid = backdropGrid(8, 4, 100);
	const vertex = (u, v) => {
		for (let i = 0; i < grid.uvs.length / 2; i++) {
			if (Math.abs(grid.uvs[2 * i] - u) < 1e-9 && Math.abs(grid.uvs[2 * i + 1] - v) < 1e-9) return Array.from(grid.positions.slice(3 * i, 3 * i + 3));
		}
		throw new Error(`no vertex at ${u},${v}`);
	};
	const near = (a, b) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));

	it('puts the photo centre straight ahead and the right edge behind, at the radius', () => {
		near(vertex(0.5, 0.5), [0, 0, -100]);
		near(vertex(0.75, 0.5), [100, 0, 0]);
		near(vertex(0.25, 0.5), [-100, 0, 0]);
		near(vertex(0, 0.5), [0, 0, 100]);
		near(vertex(1, 0.5), [0, 0, 100]);
	});

	it('puts the top row at the zenith and the bottom row at the nadir', () => {
		near(vertex(0.5, 0), [0, 100, 0]);
		near(vertex(0.5, 1), [0, -100, 0]);
		near(vertex(0.5, 0.25), [0, 100 * Math.SQRT1_2, -100 * Math.SQRT1_2]);
	});

	it('closes the sphere with two triangles per cell and in-range indices', () => {
		const verts = grid.positions.length / 3;
		expect(verts).toBe((8 + 1) * (4 + 1));
		expect(grid.indices.length).toBe(8 * 4 * 6);
		expect(Math.max(...grid.indices)).toBe(verts - 1);
		for (let i = 0; i < verts; i++) expect(Math.hypot(...grid.positions.slice(3 * i, 3 * i + 3))).toBeCloseTo(100, 6);
	});
});
