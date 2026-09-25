#!/usr/bin/env node
// Cuts every icon three.ws Desktop ships from the brand mark, so a new mark is
// one command and the installer, the Dock, the taskbar and the tray never
// disagree.
//
//   node apps/desktop/scripts/make-icons.mjs          # write
//   node apps/desktop/scripts/make-icons.mjs --check  # fail when a committed icon drifted
//
// Outputs:
//   build/icon.png          1024px app icon. electron-builder converts it to
//                           .icns (macOS) and .ico (Windows) at package time.
//                           It is the macOS Glance icon (apple/scripts/make-macos-icon.mjs),
//                           so every three.ws app on a Mac wears the same plate.
//   assets/icon.png         512px copy the running app uses for its windows.
//   assets/tray-icon.png    Full-colour mark for the Windows and Linux tray.
//   assets/trayTemplate.png + trayTemplate@2x.png
//                           macOS menu-bar template: black with the mark's alpha,
//                           so the system tints it for light and dark menu bars.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '../..');
const PLATE = join(REPO, 'apple/macos/ThreeWSGlance/Assets.xcassets/AppIcon.appiconset/icon_512x512@2x.png');
const MARK = join(REPO, 'public/pwa-512x512.png');

async function template(size) {
	// Pad the mark a little so it sits at the same optical size as system icons.
	const inner = Math.round(size * 0.88);
	const alpha = await sharp(MARK).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().extractChannel('alpha').raw().toBuffer();
	const black = await sharp({ create: { width: inner, height: inner, channels: 3, background: { r: 0, g: 0, b: 0 } } }).joinChannel(alpha, { raw: { width: inner, height: inner, channels: 1 } }).png().toBuffer();
	const pad = Math.floor((size - inner) / 2);
	return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
		.composite([{ input: black, left: pad, top: pad }])
		.png({ compressionLevel: 9 })
		.toBuffer();
}

const TARGETS = [
	{ file: 'build/icon.png', make: () => sharp(PLATE).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer() },
	{ file: 'assets/icon.png', make: () => sharp(PLATE).resize(512, 512).png({ compressionLevel: 9 }).toBuffer() },
	{ file: 'assets/tray-icon.png', make: () => sharp(MARK).resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer() },
	{ file: 'assets/trayTemplate.png', make: () => template(16) },
	{ file: 'assets/trayTemplate@2x.png', make: () => template(32) },
];

const check = process.argv.includes('--check');
for (const src of [PLATE, MARK]) {
	if (!existsSync(src)) {
		console.error(`[desktop-icons] source missing: ${src}`);
		process.exit(1);
	}
}

const digest = (buf) => createHash('sha256').update(buf).digest('hex');
let drifted = 0;
for (const t of TARGETS) {
	const path = join(APP, t.file);
	const produced = await t.make();
	if (check) {
		if (!existsSync(path) || digest(readFileSync(path)) !== digest(produced)) {
			drifted++;
			console.log(`[desktop-icons] DRIFT ${t.file}`);
		}
		continue;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, produced);
	console.log(`[desktop-icons] wrote ${t.file} (${produced.length} bytes)`);
}
if (check) {
	if (drifted) {
		console.error(`[desktop-icons] ${drifted} icon(s) differ from the brand mark. Run: node apps/desktop/scripts/make-icons.mjs`);
		process.exit(1);
	}
	console.log(`[desktop-icons] ok ${TARGETS.length} icons match the brand mark`);
}
