#!/usr/bin/env node
// Renders the camera frames the wearables re-localization tests decode
// (tests/fixtures/glasses-relocalize/). Each frame is a real QR symbol projected
// through the same pinhole model the glasses lane uses (src/irl/marker-pose.js),
// at a known distance and image position, over a lit-wall gradient with sensor
// noise and lens blur, then JPEG-encoded the way the toolkit hands frames back.
// manifest.json records the ground truth each frame was rendered from.
//
// Deterministic: a seeded PRNG drives the noise, so rerunning reproduces the
// same pixels. Replace or extend with frames recorded on Ray-Ban Display
// hardware once the native lane runs there (ios/docs/WEARABLES.md).
//
//   node scripts/glasses/render-relocalize-fixtures.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { focalLengthPx, DEFAULT_MARKER_SIZE_M } from '../../src/irl/marker-pose.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'tests', 'fixtures', 'glasses-relocalize');

// Glasses-class camera: 4:3 still, 60 degree vertical field of view.
const W = 1280;
const H = 960;
const VFOV = 60;
const QUIET_MODULES = 4;
const PIN = 'https://three.ws/irl?m=lobby-door';
const OTHER = 'https://three.ws/irl?m=loading-dock';

const FRAMES = [
	{ file: 'pin-1p2m-centre.jpg', payload: PIN, distanceM: 1.2, cx: 640, cy: 480 },
	{ file: 'pin-0p8m-right.jpg', payload: PIN, distanceM: 0.8, cx: 900, cy: 430 },
	{ file: 'pin-1p6m-left.jpg', payload: PIN, distanceM: 1.6, cx: 420, cy: 540 },
	{ file: 'other-marker-1m.jpg', payload: OTHER, distanceM: 1.0, cx: 640, cy: 480 },
	{ file: 'empty-wall.jpg', payload: null },
];

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function render({ payload, distanceM, cx, cy }, seed) {
	const rand = mulberry32(seed);
	const px = new Uint8Array(W * H);
	// Wall lit from the upper left, slightly warm-grey in luma terms.
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			px[y * W + x] = 150 + 40 * (1 - (x / W) * 0.6 - (y / H) * 0.4);
		}
	}
	if (payload) {
		const { modules } = QRCode.create(payload, { errorCorrectionLevel: 'M' });
		const n = modules.size;
		const spanPx = (DEFAULT_MARKER_SIZE_M * focalLengthPx(VFOV, H)) / distanceM;
		const mod = spanPx / n;
		const x0 = cx - spanPx / 2;
		const y0 = cy - spanPx / 2;
		const q = QUIET_MODULES * mod;
		for (let y = Math.floor(y0 - q); y < Math.ceil(y0 + spanPx + q); y++) {
			for (let x = Math.floor(x0 - q); x < Math.ceil(x0 + spanPx + q); x++) {
				if (x < 0 || y < 0 || x >= W || y >= H) continue;
				const mx = Math.floor((x + 0.5 - x0) / mod);
				const my = Math.floor((y + 0.5 - y0) / mod);
				const dark = mx >= 0 && my >= 0 && mx < n && my < n && modules.data[my * n + mx];
				// Printed paper: off-white, ink not quite black.
				px[y * W + x] = dark ? 28 : 236;
			}
		}
	}
	for (let i = 0; i < px.length; i++) {
		const noise = (rand() + rand() + rand() - 1.5) * 10;
		px[i] = Math.max(0, Math.min(255, px[i] + noise));
	}
	return sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 1 } })
		.blur(0.7)
		.jpeg({ quality: 82, mozjpeg: true })
		.toBuffer();
}

mkdirSync(OUT, { recursive: true });
const manifest = { frame: { w: W, h: H }, vfovDeg: VFOV, markerSizeM: DEFAULT_MARKER_SIZE_M, pinPayload: PIN, frames: [] };
for (const [i, f] of FRAMES.entries()) {
	const jpg = await render(f, 0x3e5 + i);
	writeFileSync(join(OUT, f.file), jpg);
	manifest.frames.push(f.payload ? f : { file: f.file, payload: null });
	console.log(`${f.file}  ${(jpg.length / 1024).toFixed(1)} KiB`);
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
