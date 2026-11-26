import { describe, it, expect, beforeAll } from 'vitest';
import { buildIntakeImageSet } from '../scripts/forge-intake-fixtures.mjs';
import { planIntake, sniffImage, UPLOAD_MAX_BYTES } from '../src/shared/forge-image-intake.js';

// Every kind of file a person can reasonably drop on /forge, run through the one
// intake rule both Forge pages and the URL import share. Before this rule, the
// page decided by the browser's MIME type (which comes from the file name), so a
// HEIC from an iPhone, an AVIF, or a GIF was refused, a 30 MB photo was refused
// instead of shrunk, a sideways phone JPEG reached the lane sideways, and a PDF
// renamed .jpg was uploaded and failed on the GPU.

let set;
beforeAll(async () => {
	set = await buildIntakeImageSet();
}, 60_000);

const header = (bytes) => new Uint8Array(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 512 * 1024));

describe('forge photo intake: the full image set', () => {
	const ids = [
		'jpeg',
		'png-alpha',
		'webp',
		'avif',
		'heic',
		'heic-untyped',
		'tiny',
		'wide',
		'huge-bytes',
		'exif-rotated',
		'gif-animated',
		'svg',
		'pdf-as-jpg',
		'html-as-jpg',
		'empty',
		'jpeg-named-png',
	];

	it.each(ids)('%s', (id) => {
		const item = set.find((x) => x.id === id);
		expect(item, `fixture ${id}`).toBeTruthy();
		const plan = planIntake({ header: header(item.bytes), size: item.bytes.length, type: item.type, name: item.name });
		const want = item.expect;
		expect(plan.action).toBe(want.action);
		for (const key of ['format', 'width', 'height', 'orientation', 'animated', 'mime', 'code']) {
			if (key in want) expect(plan[key], key).toBe(want[key]);
		}
		if (want.reasons) expect(plan.reasons.slice().sort()).toEqual(want.reasons.slice().sort());
		if (plan.action === 'refuse') {
			expect(plan.message).toMatch(/\S/);
			expect(plan.message).not.toMatch(/[\u2013\u2014]/);
		}
	});

	it('the 30 MB photo really is over the upload cap (so the test means something)', () => {
		const item = set.find((x) => x.id === 'huge-bytes');
		expect(item.bytes.length).toBeGreaterThan(UPLOAD_MAX_BYTES);
	});

	it('refuses a file that is not an image by its content and names the accepted formats', () => {
		const item = set.find((x) => x.id === 'pdf-as-jpg');
		const plan = planIntake({ header: header(item.bytes), size: item.bytes.length, type: item.type, name: item.name });
		expect(plan.message).toMatch(/PDF/);
		for (const f of ['JPG', 'PNG', 'WebP', 'HEIC']) expect(plan.message).toContain(f);
	});

	it('tells the person how small a 1 x 1 image is and what size works', () => {
		const item = set.find((x) => x.id === 'tiny');
		const plan = planIntake({ header: header(item.bytes), size: item.bytes.length, type: item.type, name: item.name });
		expect(plan.message).toMatch(/1 x 1/);
	});
});

describe('sniffImage', () => {
	it('names common non-image files so the refusal can say what was dropped', () => {
		expect(sniffImage(new TextEncoder().encode('%PDF-1.7\n')).notImage).toBe('a PDF document');
		expect(sniffImage(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])).notImage).toBe('a ZIP archive');
		const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]);
		expect(sniffImage(mp4).notImage).toBe('a video');
	});
});
