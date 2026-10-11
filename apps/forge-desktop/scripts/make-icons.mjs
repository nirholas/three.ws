#!/usr/bin/env node
// Cuts the three.ws Forge app icon from the three.ws brand plate, so the
// installer, the window, the taskbar and the update dialog wear the same mark
// as every other three.ws desktop app.
//
//   node apps/forge-desktop/scripts/make-icons.mjs          # write
//   node apps/forge-desktop/scripts/make-icons.mjs --check  # fail when the committed icon drifted
//
// Output: resources/icons/icon.png (1024px). electron-builder converts it to
// .icns (macOS) and .ico (Windows) at package time, and the running app loads
// it for the window and the update dialog.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '../..');
const PLATE = join(REPO, 'apple/macos/ThreeWSGlance/Assets.xcassets/AppIcon.appiconset/icon_512x512@2x.png');
const OUT = join(APP, 'resources/icons/icon.png');

// sharp is a dependency of the monorepo root, not of this app.
const sharp = createRequire(join(REPO, 'package.json'))('sharp');

if (!existsSync(PLATE)) {
	console.error(`[forge-icons] source missing: ${PLATE}`);
	process.exit(1);
}

const produced = await sharp(PLATE).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer();
const digest = (buf) => createHash('sha256').update(buf).digest('hex');

if (process.argv.includes('--check')) {
	if (!existsSync(OUT) || digest(readFileSync(OUT)) !== digest(produced)) {
		console.error('[forge-icons] resources/icons/icon.png differs from the brand plate. Run: node apps/forge-desktop/scripts/make-icons.mjs');
		process.exit(1);
	}
	console.log('[forge-icons] icon matches the brand plate');
} else {
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, produced);
	console.log(`[forge-icons] wrote resources/icons/icon.png (${produced.length} bytes)`);
}
