'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { classifyFile, findSplitPair, buildTrim, buildCaptureBody, isTwoToOne, extensionOf, QUALITIES } = require('../src/core/detect');
const { probeDimensions } = require('../src/core/probe');
const { resultFolder, filesFor, viewerLink, BIN_NAME } = require('../src/core/results');
const { formatBytes, formatDuration } = require('../src/core/format');
const { bufferFile } = require('./c4-server');

const box = (type, payload) => {
	const b = Buffer.alloc(8 + payload.length);
	b.writeUInt32BE(b.length, 0);
	b.write(type, 4, 'ascii');
	payload.copy(b, 8);
	return b;
};

function syntheticMp4(width, height, seconds, timescale = 1000) {
	const mvhd = Buffer.alloc(100);
	mvhd.writeUInt32BE(timescale, 12);
	mvhd.writeUInt32BE(seconds * timescale, 16);
	const tkhd = Buffer.alloc(84);
	tkhd.writeUInt32BE(width * 65536, 76);
	tkhd.writeUInt32BE(height * 65536, 80);
	const moov = box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('tkhd', tkhd))]));
	return Buffer.concat([box('ftyp', Buffer.from('isom0000isomiso2')), box('mdat', Buffer.alloc(4096)), moov]);
}

const probe = (name, buf) => probeDimensions(name, buf.length, bufferFile(name, buf).readRange);

test('360 detection: raw camera files, 2:1 frames, and files that need the user to confirm', () => {
	assert.deepEqual(
		['insv', 'insp'].map((e) => classifyFile({ name: `VID_1.${e}` })).map((c) => [c.lane, c.source_kind, c.is360]),
		[['capture', 'insv', true], ['scene', 'insp', true]],
	);
	assert.equal(classifyFile({ name: 'a.mp4', width: 5760, height: 2880 }).is360, true);
	assert.equal(classifyFile({ name: 'a.mp4', width: 3840, height: 2160 }).is360, false);
	assert.equal(classifyFile({ name: 'a.mov' }).is360, null);
	assert.equal(classifyFile({ name: 'a.mp4', vrTagged: true }).is360, true);
	assert.equal(classifyFile({ name: 'a.jpg', width: 6000, height: 3000 }).lane, 'scene');
	assert.equal(classifyFile({ name: 'a.jpg', width: 6000, height: 3000 }).source_kind, 'equirect_image');
	assert.equal(classifyFile({ name: 'a.lrv' }).error.code, 'invalid_filename');
	assert.equal(classifyFile({ name: 'a.exe' }).error.code, 'invalid_content_type');
	assert.equal(isTwoToOne(4096, 2048), true);
	assert.equal(isTwoToOne(16, 9), false);
	assert.equal(extensionOf('C:\\clips\\A.INSV'), '.insv');
});

test('split-pair .insv partner is found in either direction, case-insensitively', () => {
	const sib = ['VID_20240101_120000_00_001.insv', 'VID_20240101_120000_10_001.INSV', 'other.mp4'];
	assert.deepEqual(findSplitPair('VID_20240101_120000_00_001.insv', sib), ['VID_20240101_120000_00_001.insv', 'VID_20240101_120000_10_001.INSV']);
	assert.deepEqual(findSplitPair('VID_20240101_120000_10_001.INSV', sib), ['VID_20240101_120000_00_001.insv', 'VID_20240101_120000_10_001.INSV']);
	assert.deepEqual(findSplitPair('VID_20240101_120000_00_001.insv', ['x']), ['VID_20240101_120000_00_001.insv']);
	assert.deepEqual(findSplitPair('plain.insv', sib), ['plain.insv']);
});

test('in and out points become trim; whole clip or tiny ranges send no trim', () => {
	assert.deepEqual(buildTrim(2, 12.5, 60), { start_s: 2, end_s: 12.5 });
	assert.equal(buildTrim(0, 60, 60), null);
	assert.equal(buildTrim(0, 59.98, 60), null);
	assert.equal(buildTrim(5, 5.5, 60), null);
	assert.equal(buildTrim(NaN, 10, 60), null);
	assert.deepEqual(buildTrim(0, 10, 60), { start_s: 0, end_s: 10 });
});

test('capture body matches the pano-capture contract', () => {
	assert.deepEqual(buildCaptureBody({ sourceUrls: ['https://a'], sourceKind: 'equirect_video' }), { source_url: 'https://a', source_kind: 'equirect_video', quality: 'standard' });
	const pair = buildCaptureBody({ sourceUrls: ['https://a', 'https://b'], sourceKind: 'insv', trim: { start_s: 1, end_s: 9 }, quality: 'high' });
	assert.deepEqual(pair, { source_url: 'https://a', source_urls: ['https://a', 'https://b'], source_kind: 'insv', quality: 'high', trim: { start_s: 1, end_s: 9 } });
	assert.deepEqual(QUALITIES.map((q) => q.id), ['preview', 'standard', 'high']);
});

test('probe reads size and duration from a hand-built mp4 with moov at the end', async () => {
	assert.deepEqual(await probe('a.mp4', syntheticMp4(5760, 2880, 12)), { width: 5760, height: 2880, durationSeconds: 12 });
});

test('probe reads a real ffmpeg-made 2:1 mp4 (faststart and default layouts)', async (t) => {
	let ffmpeg = true;
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
	} catch {
		ffmpeg = false;
	}
	if (!ffmpeg) return t.skip('ffmpeg not installed');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uxp-probe-'));
	try {
		for (const flags of [[], ['-movflags', '+faststart']]) {
			const out = path.join(dir, `t${flags.length}.mp4`);
			execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x320:rate=10:duration=3', '-pix_fmt', 'yuv420p', ...flags, out]);
			const buf = fs.readFileSync(out);
			const r = await probe('t.mp4', buf);
			assert.equal(r.width, 640);
			assert.equal(r.height, 320);
			assert.ok(Math.abs(r.durationSeconds - 3) < 0.2, `duration ${r.durationSeconds}`);
			assert.equal(classifyFile({ name: 't.mp4', width: r.width, height: r.height }).is360, true);
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('probe reads PNG and JPEG headers and never throws on junk', async () => {
	const png = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
	png.writeUInt32BE(13, 8);
	png.write('IHDR', 12, 'ascii');
	png.writeUInt32BE(4096, 16);
	png.writeUInt32BE(2048, 20);
	assert.deepEqual(await probe('p.png', png), { width: 4096, height: 2048 });

	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x0b, 0xb8, 0x17, 0x70, 3, 0, 0, 0]);
	assert.deepEqual(await probe('p.jpg', jpeg), { width: 6000, height: 3000 });

	assert.deepEqual(await probe('junk.mp4', crypto.randomBytes(2000)), {});
	assert.deepEqual(await probe('junk.png', Buffer.alloc(4)), {});
	assert.deepEqual(await probe('x.insv', Buffer.alloc(100)), {});
	assert.deepEqual(await probeDimensions('x.mp4', 100, async () => { throw new Error('io'); }), {});
});

test('result folder sits next to the project file, with a safe job id', () => {
	const f = resultFolder('/Users/me/Edits/Trip.prproj', 'abc-123');
	assert.deepEqual(f.levels, ['Trip_three.ws', 'abc-123']);
	assert.equal(f.dir, '/Users/me/Edits');
	assert.equal(f.full, '/Users/me/Edits/Trip_three.ws/abc-123');
	const win = resultFolder('C:\\Edits\\Trip.prproj', 'job/../x');
	assert.equal(win.sep, '\\');
	assert.equal(win.levels[1], 'job____x');
	assert.equal(resultFolder('', 'a'), null);
	assert.equal(resultFolder('Trip.prproj', 'a'), null);
	const long = resultFolder('/p/a.prproj', 'x'.repeat(200) + 'TAIL');
	assert.ok(long.levels[1].length <= 40 && long.levels[1].endsWith('TAIL'));
	assert.equal(BIN_NAME, 'three.ws captures');
});

test('result files per lane and viewer link derivation', () => {
	const cap = { preview_url: 'p', poster_url: 'q', ply_url: 'r', spz_url: 's', viewer_url: '/splat?job=1' };
	assert.deepEqual(filesFor('capture', cap).map((f) => f.file), ['preview.mp4', 'poster.jpg', 'scene.ply', 'scene.spz']);
	assert.deepEqual(filesFor('scene', { glb_url: 'g', ply_url: 'r' }).map((f) => f.file), ['scene.glb', 'scene.ply']);
	assert.deepEqual(filesFor('capture', { preview_url: null }), []);
	assert.equal(viewerLink('https://three.ws', cap), 'https://three.ws/splat?job=1');
	assert.equal(viewerLink('https://three.ws', { viewer_url: 'https://x.y/z' }), 'https://x.y/z');
	assert.equal(viewerLink('https://three.ws', { spz_url: 'https://r2/a b.spz' }), 'https://three.ws/splat?src=https%3A%2F%2Fr2%2Fa%20b.spz');
	assert.equal(viewerLink('https://three.ws', {}), '');
});

test('formatters', () => {
	assert.equal(formatBytes(512), '512 B');
	assert.equal(formatBytes(1536), '1.5 KB');
	assert.equal(formatBytes(5 * 1024 ** 3), '5.0 GB');
	assert.equal(formatDuration(75), '1m 15s');
	assert.equal(formatDuration(9), '9s');
});
