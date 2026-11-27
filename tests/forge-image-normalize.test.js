import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { buildIntakeImageSet } from '../scripts/forge-intake-fixtures.mjs';
import { normalizeForgeImage } from '../src/shared/forge-image-normalize.js';
import { UPLOAD_MAX_BYTES, CONVERT_MAX_SIDE } from '../src/shared/forge-image-intake.js';

// The convert step of Forge's photo intake, driven by a sharp-backed codec with
// the same interface the browser codec implements (createImageBitmap + canvas).
// What this pins: a photo that already worked is handed back as the very same
// File (so the lane request is unchanged), and everything else comes out as an
// upright, right-sized JPEG or WebP under the upload cap, or a clear refusal.

function sharpCodec() {
	const calls = { decode: 0 };
	return {
		calls,
		async decode(blob, { format, maxSide }) {
			calls.decode++;
			const buf = Buffer.from(await blob.arrayBuffer());
			const { data, info } = await sharp(buf, { animated: false, density: format === 'svg' ? 288 : undefined })
				.rotate()
				.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			return { width: info.width, height: info.height, handle: { data, info } };
		},
		async hasAlpha({ data }) {
			for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
			return false;
		},
		async encode({ data, info }, { width, height, type, quality }) {
			let img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(width, height);
			img = type === 'image/webp' ? img.webp({ quality: Math.round(quality * 100) }) : img.flatten({ background: '#ffffff' }).jpeg({ quality: Math.round(quality * 100) });
			return new Blob([await img.toBuffer()], { type });
		},
		release() {},
	};
}

const refusingCodec = () => ({
	decode() {
		throw new Error('the codec must not be touched for a photo that already works');
	},
	hasAlpha() {
		throw new Error('unexpected');
	},
	encode() {
		throw new Error('unexpected');
	},
	release() {},
});

let set;
const fileOf = (id) => {
	const item = set.find((x) => x.id === id);
	return new File([item.bytes], item.name, { type: item.type });
};
const dims = async (file) => sharp(Buffer.from(await file.arrayBuffer())).metadata();

beforeAll(async () => {
	set = await buildIntakeImageSet();
}, 60_000);

describe('normalizeForgeImage: photos that already work are not touched', () => {
	it.each(['jpeg', 'png-alpha', 'webp'])('%s goes up as the same File object, never decoded', async (id) => {
		const file = fileOf(id);
		const r = await normalizeForgeImage(file, { codec: refusingCodec() });
		expect(r.ok).toBe(true);
		expect(r.file).toBe(file);
		expect(r.changed).toBe(false);
		expect(r.note).toBeNull();
	});

	it('a JPEG saved as .png keeps its exact bytes and is relabeled image/jpeg', async () => {
		const file = fileOf('jpeg-named-png');
		const r = await normalizeForgeImage(file, { codec: refusingCodec() });
		expect(r.ok).toBe(true);
		expect(r.file.type).toBe('image/jpeg');
		expect(r.file.name).toBe('photo.jpg');
		expect(Buffer.from(await r.file.arrayBuffer()).equals(Buffer.from(await file.arrayBuffer()))).toBe(true);
	});
});

describe('normalizeForgeImage: converted on the device instead of refused', () => {
	it('turns a sideways phone JPEG upright (EXIF orientation 6)', async () => {
		const r = await normalizeForgeImage(fileOf('exif-rotated'), { codec: sharpCodec() });
		expect(r.ok).toBe(true);
		const meta = await dims(r.file);
		expect([meta.width, meta.height]).toEqual([1200, 1600]);
		expect(meta.orientation ?? 1).toBe(1);
		expect(r.file.type).toBe('image/jpeg');
		expect(r.note).toMatch(/upright/);
	});

	it('shrinks a 12000 px panorama to the convert size and says so', async () => {
		const r = await normalizeForgeImage(fileOf('wide'), { codec: sharpCodec() });
		expect(r.ok).toBe(true);
		const meta = await dims(r.file);
		expect(Math.max(meta.width, meta.height)).toBe(CONVERT_MAX_SIDE);
		expect(r.note).toBe(`Resized from 12000 x 3000 to ${CONVERT_MAX_SIDE} x 1024.`);
	});

	it('brings a 30 MB photo under the 8 MB upload cap', async () => {
		const file = fileOf('huge-bytes');
		expect(file.size).toBeGreaterThan(UPLOAD_MAX_BYTES);
		const r = await normalizeForgeImage(file, { codec: sharpCodec() });
		expect(r.ok).toBe(true);
		expect(r.file.size).toBeLessThanOrEqual(UPLOAD_MAX_BYTES);
		expect(r.file.type).toBe('image/jpeg');
	}, 60_000);

	it('converts AVIF to JPEG', async () => {
		const r = await normalizeForgeImage(fileOf('avif'), { codec: sharpCodec() });
		expect(r.ok).toBe(true);
		expect(r.file.type).toBe('image/jpeg');
		expect(r.file.name).toBe('lamp.jpg');
		expect(r.note).toMatch(/^Converted from AVIF/);
	});

	it('keeps transparency by converting a see-through image to WebP', async () => {
		const bytes = await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
			.composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><circle cx="300" cy="300" r="200" fill="#c33"/></svg>') }])
			.avif()
			.toBuffer();
		const r = await normalizeForgeImage(new File([bytes], 'cutout.avif', { type: 'image/avif' }), { codec: sharpCodec() });
		expect(r.ok).toBe(true);
		expect(r.file.type).toBe('image/webp');
		const meta = await dims(r.file);
		expect(meta.hasAlpha).toBe(true);
	});

	it('uses the first frame of an animated GIF', async () => {
		const r = await normalizeForgeImage(fileOf('gif-animated'), { codec: sharpCodec() });
		expect(r.ok).toBe(true);
		const meta = await dims(r.file);
		expect([meta.width, meta.height, meta.pages ?? 1]).toEqual([320, 240, 1]);
		expect(r.note).toMatch(/first frame/);
	});

	it('rasterizes an SVG', async () => {
		const r = await normalizeForgeImage(fileOf('svg'), { codec: sharpCodec() });
		expect(r.ok).toBe(true);
		expect(['image/jpeg', 'image/webp']).toContain(r.file.type);
	});
});

describe('normalizeForgeImage: refusals are messages, never crashes', () => {
	it.each([
		['empty', 'empty'],
		['pdf-as-jpg', 'not_image'],
		['html-as-jpg', 'not_image'],
		['tiny', 'too_small'],
	])('%s is refused with code %s before any decode', async (id, code) => {
		const r = await normalizeForgeImage(fileOf(id), { codec: refusingCodec() });
		expect(r.ok).toBe(false);
		expect(r.code).toBe(code);
		expect(r.message).toMatch(/\S/);
		// The photo tile shows a short label; the full sentence goes beside it.
		expect(r.short).toMatch(/\S/);
		expect(r.short.length).toBeLessThanOrEqual(28);
	});

	it('a HEIC the codec cannot decode gets a message that says how to recover', async () => {
		const r = await normalizeForgeImage(fileOf('heic'), { codec: sharpCodec() });
		expect(r.ok).toBe(false);
		expect(r.code).toBe('decode_failed');
		expect(r.short).toBe('Could not open this HEIC');
		expect(r.message).toMatch(/HEIC/);
		expect(r.message).toMatch(/JPG/);
	});

	it('a browser that returns an unusable encoding gets encode_failed, not a bad upload', async () => {
		const codec = sharpCodec();
		codec.encode = async () => new Blob([new Uint8Array(10)], { type: 'image/bmp' });
		const r = await normalizeForgeImage(fileOf('avif'), { codec });
		expect(r.ok).toBe(false);
		expect(r.code).toBe('encode_failed');
	});
});
