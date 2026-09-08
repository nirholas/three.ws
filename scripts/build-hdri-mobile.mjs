#!/usr/bin/env node
/**
 * Generate the phone-sized copies of the curated HDRI set.
 *
 * `public/hdri/{studio,outdoor,sunset}.hdr` are 1024x512 Radiance RGBE files of
 * roughly 1.4-1.5 MB each, and they are the single largest asset any 3D page
 * downloads. Measured on a Pixel 5 over slow 4G against production on
 * 2026-09-08, `/hdri/outdoor.hdr` was 1,435 KB of `/play`'s 5,470 KB, more than
 * a quarter of the page, on a connection where that is seven seconds of radio
 * time before the world is lit.
 *
 * The environment map is PMREM-prefiltered before it lights anything, which
 * throws most of that resolution away, so the mobile tier reads a 512x256 copy
 * instead: about 370 KB, a 74% cut (src/shared/cinematic-render.js picks it).
 *
 * Two details decide whether the output is usable:
 *
 *  1. **zscale, not scale.** swscale converts float input through a 16-bit
 *     fixed-point intermediate and CLAMPS to 1.0, which silently destroys
 *     everything that makes the file an HDRI: a run through `-vf scale` took
 *     outdoor.hdr's peak radiance from 61,408 to exactly 1.00 and halved its
 *     mean. The file still loads, still looks like an image, and lights a scene
 *     completely wrong. zimg keeps the float path intact.
 *  2. **bilinear, not lanczos.** Image-based lighting cares about total energy,
 *     not edge crispness, and a windowed-sinc kernel rings around a sun disc
 *     with 60,000:1 contrast. Measured over outdoor.hdr, mean radiance against
 *     the 1024x512 original: bilinear 0.6976 vs 0.6997 (-0.3%), bicubic 0.7335
 *     (+4.8%), lanczos 0.7840 (+12.0%). Bilinear is also the only kernel that
 *     produced no negative undershoot, and the smallest file.
 *
 * The outputs are COMMITTED. These are three curated, never-changing assets, so
 * baking them into the repo keeps ffmpeg out of the deploy path; this script
 * exists to reproduce them, and to prove the reproduction is sound.
 *
 *   node scripts/build-hdri-mobile.mjs           # write the -mobile.hdr files
 *   node scripts/build-hdri-mobile.mjs --check   # verify without writing
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataUtils } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HDRI_DIR = join(ROOT, 'public/hdri');
const PRESETS = ['studio', 'outdoor', 'sunset'];
export const MOBILE_WIDTH = 512;
export const MOBILE_HEIGHT = 256;
// How far the downscaled copy's mean radiance may drift from the original's.
// A clamped file (the swscale failure above) misses this by a mile; a sound
// bilinear reduction lands inside a fraction of a percent.
export const MEAN_TOLERANCE = 0.02;

export function mobileNameFor(preset) {
	return `${preset}-mobile.hdr`;
}

/** Mean radiance and peak of an .hdr on disk, decoded with the loader the site uses. */
export function hdrStats(file) {
	const buf = readFileSync(file);
	const tex = new HDRLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
	let sum = 0;
	let n = 0;
	let max = -Infinity;
	for (let i = 0; i < tex.data.length; i += 4) {
		for (let c = 0; c < 3; c++) {
			const v = DataUtils.fromHalfFloat(tex.data[i + c]);
			sum += v;
			n++;
			if (v > max) max = v;
		}
	}
	return { width: tex.width, height: tex.height, mean: sum / n, max, bytes: statSync(file).size };
}

function generate(preset) {
	const src = join(HDRI_DIR, `${preset}.hdr`);
	const out = join(HDRI_DIR, mobileNameFor(preset));
	execFileSync(
		'ffmpeg',
		['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
			'-vf', `zscale=w=${MOBILE_WIDTH}:h=${MOBILE_HEIGHT}:f=bilinear`, '-c:v', 'hdr', out],
		{ stdio: ['ignore', 'inherit', 'inherit'] },
	);
	return out;
}

function main() {
	const check = process.argv.includes('--check');
	let failed = 0;
	for (const preset of PRESETS) {
		const src = join(HDRI_DIR, `${preset}.hdr`);
		const out = join(HDRI_DIR, mobileNameFor(preset));
		if (!existsSync(src)) {
			console.error(`missing source: ${src}`);
			failed++;
			continue;
		}
		if (!check) generate(preset);
		if (!existsSync(out)) {
			console.error(`missing output: ${out} (run without --check to write it)`);
			failed++;
			continue;
		}
		const a = hdrStats(src);
		const b = hdrStats(out);
		const drift = Math.abs(b.mean - a.mean) / a.mean;
		const ok = b.width === MOBILE_WIDTH && b.height === MOBILE_HEIGHT && drift <= MEAN_TOLERANCE;
		if (!ok) failed++;
		console.log(
			`${ok ? 'ok  ' : 'FAIL'} ${preset.padEnd(8)} ` +
			`${a.width}x${a.height} ${(a.bytes / 1024).toFixed(0)} KB -> ${b.width}x${b.height} ${(b.bytes / 1024).toFixed(0)} KB ` +
			`(${(100 - (b.bytes / a.bytes) * 100).toFixed(0)}% smaller), ` +
			`mean ${a.mean.toFixed(4)} -> ${b.mean.toFixed(4)} (${(drift * 100).toFixed(2)}% drift), ` +
			`peak ${a.max.toFixed(0)} -> ${b.max.toFixed(0)}`,
		);
	}
	if (failed) {
		console.error(`\n${failed} preset(s) failed.`);
		process.exit(1);
	}
}

if (process.argv[1] && process.argv[1].endsWith('build-hdri-mobile.mjs')) main();
