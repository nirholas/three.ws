// Both Forge pages (/forge and Forge Studio) send every photo through the same
// intake: judged by its bytes, converted on the device when the lane could not
// read it as is, uploaded by the shared client, and retried with the same photo.
//
// Before this, each page filtered files on the MIME type the operating system
// guessed (a HEIC with no type vanished without a word, a PDF renamed .jpg went
// up), refused anything over 8 MB instead of shrinking it, sent EXIF-rotated
// photos sideways, and its Retry button opened the picker, so a dropped upload
// meant finding the photo again. The modules themselves are tested on their own
// (tests/forge-image-intake.test.js, forge-image-normalize.test.js,
// forge-upload-client.test.js, forge-dropzone.test.js); this pins that both
// pages are wired to them and that no page-local copy of the old rules is left.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const PAGES = [
	{ name: '/forge', js: 'src/forge.js', html: 'pages/forge.html', shared: './shared/' },
	{ name: 'Forge Studio', js: 'src/forge-studio/forge.js', html: 'pages/forge-studio.html', shared: '../shared/' },
];

function fnBody(src, name) {
	const start = src.search(new RegExp(`(async )?function ${name}\\(`));
	if (start < 0) throw new Error(`${name} not found`);
	const open = src.indexOf('{', start);
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
	}
	throw new Error(`${name} has no end`);
}

describe.each(PAGES)('$name photo intake wiring', ({ js, html, shared }) => {
	const src = read(js);
	const page = read(html);

	it('imports the shared normalizer and upload client', () => {
		expect(src).toContain(`import { normalizeForgeImage } from '${shared}forge-image-normalize.js'`);
		expect(src).toContain(`import { uploadForgePhoto } from '${shared}forge-upload-client.js'`);
	});

	it('the file pickers offer HEIC, HEIF and AVIF, not only PNG, JPEG and WebP', () => {
		const values = [...page.matchAll(/id="(?:view|sketch)-file-input"\s+accept="([^"]+)"/g)].map((m) => m[1]);
		expect(values).toHaveLength(2);
		for (const v of values) {
			expect(v).toMatch(/\.heic/);
			expect(v).toMatch(/\.avif/);
		}
	});

	it('hands every chosen file on instead of filtering on the guessed MIME type', () => {
		const body = fnBody(src, 'handleFiles');
		expect(body).not.toMatch(/\.type\.startsWith\('image\/'\)/);
	});

	it('every photo and every sketch goes through normalizeForgeImage before upload', () => {
		expect(fnBody(src, 'uploadToSlot')).toMatch(/await normalizeForgeImage\(/);
		expect(fnBody(src, 'uploadSketch')).toMatch(/await normalizeForgeImage\(/);
	});

	it('uploads with the shared client (timeouts, designed failures, retryable flag)', () => {
		expect(fnBody(src, 'presignAndPut')).toMatch(/uploadForgePhoto\(/);
	});

	it('Retry re-sends the same photo when the failure is retryable', () => {
		expect(src).toMatch(/if \(slots\[i\]\.retry\) slots\[i\]\.retry\(\);/);
		expect(src).toMatch(/if \(sketch\.state === 'error' && sketch\.retry\) sketch\.retry\(\);/);
		expect(fnBody(src, 'putToSlot')).toMatch(/up\.retryable \? \(\) => putToSlot\(/);
	});

	it('keeps no page-local copy of the old MIME allowlist or the 8 MB refusal', () => {
		expect(src).not.toMatch(/const ACCEPTED_TYPES = new Set/);
		expect(src).not.toContain('Use PNG, JPG, or WebP.');
		expect(src).not.toContain('Too large (max 8 MB).');
	});
});
