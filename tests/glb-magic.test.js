import { describe, it, expect, vi } from 'vitest';
import { isValidGlbMagic } from '../src/shared/glb-magic.js';

function header({ magic = 0x46546c67, version = 2, declared = 12 } = {}) {
	const b = new ArrayBuffer(12);
	const v = new DataView(b);
	v.setUint32(0, magic, true);
	v.setUint32(4, version, true);
	v.setUint32(8, declared, true);
	return new Uint8Array(b);
}

// A file of `size` bytes whose first 12 bytes are `head`.
function glb(head, size = head.length) {
	const body = new Uint8Array(Math.max(size, head.length));
	body.set(head);
	return new File([body], 'a.glb');
}

describe('isValidGlbMagic', () => {
	it('accepts a valid header whose declared length equals the file size', async () => {
		expect(await isValidGlbMagic(glb(header({ declared: 64 }), 64))).toBe(true);
	});

	it('accepts a declared length smaller than the file (trailing bytes)', async () => {
		expect(await isValidGlbMagic(glb(header({ declared: 40 }), 64))).toBe(true);
	});

	it('rejects a declared length larger than the file (truncated)', async () => {
		expect(await isValidGlbMagic(glb(header({ declared: 5000 })))).toBe(false);
	});

	it('rejects a declared length below the 20-byte minimum', async () => {
		expect(await isValidGlbMagic(glb(header({ declared: 8 }), 64))).toBe(false);
		expect(await isValidGlbMagic(glb(header({ declared: 19 }), 64))).toBe(false);
		expect(await isValidGlbMagic(glb(header({ declared: 20 }), 64))).toBe(true);
	});

	it('rejects wrong magic, version 1, short files and a missing file', async () => {
		expect(await isValidGlbMagic(glb(header({ magic: 0x12345678, declared: 64 }), 64))).toBe(false);
		expect(await isValidGlbMagic(glb(header({ version: 1, declared: 64 }), 64))).toBe(false);
		expect(await isValidGlbMagic(new File([new Uint8Array(11)], 'a.glb'))).toBe(false);
		expect(await isValidGlbMagic(null)).toBe(false);
		expect(await isValidGlbMagic(undefined)).toBe(false);
	});

	it('reads only the first 12 bytes', async () => {
		const file = glb(header({ declared: 64 }), 64);
		const slice = vi.spyOn(file, 'slice');
		await isValidGlbMagic(file);
		expect(slice).toHaveBeenCalledTimes(1);
		expect(slice).toHaveBeenCalledWith(0, 12);
	});
});
