#!/usr/bin/env node
// The image set Forge's photo intake is tested against: every kind of file a
// person can reasonably drop on /forge, generated from scratch with sharp so no
// binary fixture lives in the repo.
//
//   node scripts/forge-intake-fixtures.mjs <out-dir> [--heic <real.heic>]
//
// writes each image to <out-dir> for the browser verification
// (scripts/forge-intake-verify.mjs). tests/forge-image-intake.test.js imports
// buildIntakeImageSet() and runs the same set through the intake planner.
//
// The HEIC entry is a structurally valid HEIF header (ftyp + meta/iprp/ipco/ispe),
// which is everything the planner reads. Pass --heic with a real iPhone or
// libheif sample to add a full, decodable HEIC for the browser run.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

function box(type, ...payloads) {
	const body = Buffer.concat(payloads.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
	const head = Buffer.alloc(8);
	head.writeUInt32BE(8 + body.length, 0);
	head.write(type, 4, 'latin1');
	return Buffer.concat([head, body]);
}

function fullBox(type, version, flags, ...payloads) {
	const vf = Buffer.alloc(4);
	vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0);
	return box(type, vf, ...payloads);
}

/** HEIF header as an iPhone writes it: ftyp(heic) then meta with an ispe property. */
export function heifHeader({ width, height, brand = 'heic', compatible = ['mif1', 'heic'] }) {
	const ftyp = box('ftyp', Buffer.from(brand, 'latin1'), Buffer.alloc(4), Buffer.from(compatible.join(''), 'latin1'));
	const dims = Buffer.alloc(8);
	dims.writeUInt32BE(width, 0);
	dims.writeUInt32BE(height, 4);
	const ispe = fullBox('ispe', 0, 0, dims);
	const hdlr = fullBox('hdlr', 0, 0, Buffer.alloc(4), Buffer.from('pict', 'latin1'), Buffer.alloc(13));
	const meta = fullBox('meta', 0, 0, hdlr, box('iprp', box('ipco', ispe)));
	return Buffer.concat([ftyp, meta]);
}

/** A minimal, valid one-page PDF with a correct xref table. */
export function tinyPdf() {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
	];
	let out = '%PDF-1.4\n';
	const offsets = [];
	objects.forEach((o, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

// A plain product-style photo: a flat backdrop with a centered disc. The disc is
// drawn at the shorter side and centered, so a 12000 px panorama stays cheap.
const photo = (width, height, channels = 3) => {
	const side = Math.min(width, height);
	return sharp({ create: { width, height, channels, background: { r: 180, g: 120, b: 60, alpha: channels === 4 ? 0.6 : 1 } } }).composite([
		{
			input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><circle cx="${side / 2}" cy="${side / 2}" r="${side / 3}" fill="#2a6"/></svg>`),
			gravity: 'centre',
		},
	]);
};

// About 30 MB: a 4000 x 3000 JPEG at quality 100 with 4:4:4 chroma, filled with
// noise so it cannot compress. The noise is one 400 x 300 tile repeated (JPEG
// codes each 8 x 8 block on its own, so repetition does not shrink it), which
// builds in about 2 s instead of 20.
async function hugePhoto() {
	const W = 4000;
	const H = 3000;
	const TW = 400;
	const TH = 300;
	const tile = await sharp({ create: { width: TW, height: TH, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).raw().toBuffer();
	const out = Buffer.alloc(W * H * 3);
	for (let y = 0; y < H; y++) {
		const row = (y % TH) * TW * 3;
		for (let x = 0; x < W; x += TW) tile.copy(out, (y * W + x) * 3, row, row + TW * 3);
	}
	return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
}

/**
 * Every entry: { id, name (as the person's file is called), type (what the
 * browser reports from the extension), bytes, expect } where expect is the
 * intake outcome: { action: 'pass'|'convert'|'refuse', ... }.
 */
export async function buildIntakeImageSet({ realHeic = null } = {}) {
	const set = [];
	const add = (id, name, type, bytes, expect) => set.push({ id, name, type, bytes, expect });

	add('jpeg', 'mug.jpg', 'image/jpeg', await photo(1600, 1200).jpeg({ quality: 88 }).toBuffer(), {
		action: 'pass',
		format: 'jpeg',
		width: 1600,
		height: 1200,
	});
	add('png-alpha', 'cutout.png', 'image/png', await photo(900, 900, 4).png().toBuffer(), {
		action: 'pass',
		format: 'png',
		width: 900,
		height: 900,
	});
	add('webp', 'shoe.webp', 'image/webp', await photo(1200, 800).webp({ quality: 85 }).toBuffer(), {
		action: 'pass',
		format: 'webp',
		width: 1200,
		height: 800,
	});
	add('avif', 'lamp.avif', 'image/avif', await photo(1000, 750).avif({ quality: 60 }).toBuffer(), {
		action: 'convert',
		format: 'avif',
		reasons: ['format'],
	});
	add('heic', 'IMG_0412.HEIC', 'image/heic', heifHeader({ width: 4032, height: 3024 }), {
		action: 'convert',
		format: 'heic',
		width: 4032,
		height: 3024,
		reasons: ['format'],
	});
	// Chrome on Windows and Linux reports no type at all for a .heic file.
	add('heic-untyped', 'IMG_0413.heic', '', heifHeader({ width: 3024, height: 4032 }), {
		action: 'convert',
		format: 'heic',
		reasons: ['format'],
	});
	if (realHeic) {
		add('heic-real', 'example.heic', 'image/heic', realHeic, { action: 'convert', format: 'heic', reasons: ['format'] });
	}
	add('tiny', 'pixel.png', 'image/png', await photo(1, 1).png().toBuffer(), {
		action: 'refuse',
		code: 'too_small',
	});
	add('wide', 'panorama.jpg', 'image/jpeg', await photo(12000, 3000).jpeg({ quality: 80 }).toBuffer(), {
		action: 'convert',
		format: 'jpeg',
		width: 12000,
		height: 3000,
		reasons: ['dimensions'],
	});
	const big = await hugePhoto();
	add('huge-bytes', 'dslr.jpg', 'image/jpeg', big, {
		action: 'convert',
		format: 'jpeg',
		reasons: ['bytes'],
	});
	add('exif-rotated', 'sideways.jpg', 'image/jpeg', await photo(1600, 1200).withMetadata({ orientation: 6 }).jpeg().toBuffer(), {
		action: 'convert',
		format: 'jpeg',
		orientation: 6,
		reasons: ['orientation'],
	});
	const frameA = await photo(320, 240).png().toBuffer();
	const frameB = await sharp(frameA).negate({ alpha: false }).png().toBuffer();
	add('gif-animated', 'spin.gif', 'image/gif', await sharp([frameA, frameB], { join: { animated: true } }).gif().toBuffer(), {
		action: 'convert',
		format: 'gif',
		animated: true,
		reasons: ['format', 'animated'],
	});
	add(
		'svg',
		'logo.svg',
		'image/svg+xml',
		Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#e44"/></svg>'),
		{ action: 'convert', format: 'svg', reasons: ['format'] },
	);
	add('pdf-as-jpg', 'scan.jpg', 'image/jpeg', tinyPdf(), { action: 'refuse', code: 'not_image' });
	add('html-as-jpg', 'download.jpg', 'image/jpeg', Buffer.from('<!DOCTYPE html><html><head><title>Photo</title></head><body></body></html>'), {
		action: 'refuse',
		code: 'not_image',
	});
	add('empty', 'empty.jpg', 'image/jpeg', Buffer.alloc(0), { action: 'refuse', code: 'empty' });
	// A JPEG saved with the wrong extension still goes through untouched; only its label is corrected.
	add('jpeg-named-png', 'photo.png', 'image/png', await photo(1200, 900).jpeg({ quality: 85 }).toBuffer(), {
		action: 'pass',
		format: 'jpeg',
		mime: 'image/jpeg',
	});
	return set;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
	const out = process.argv[2];
	if (!out) {
		console.error('usage: node scripts/forge-intake-fixtures.mjs <out-dir> [--heic <real.heic>]');
		process.exit(2);
	}
	const heicIdx = process.argv.indexOf('--heic');
	const realHeic = heicIdx > 0 ? await readFile(process.argv[heicIdx + 1]) : null;
	await mkdir(out, { recursive: true });
	const set = await buildIntakeImageSet({ realHeic });
	const manifest = [];
	for (const item of set) {
		const file = `${item.id}--${item.name}`;
		await writeFile(join(out, file), item.bytes);
		manifest.push({ id: item.id, file, name: item.name, type: item.type, bytes: item.bytes.length, expect: item.expect });
	}
	await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
	console.log(`wrote ${set.length} images to ${out}`);
}
