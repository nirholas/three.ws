#!/usr/bin/env node
// Writes the pinned-release constant file for each site-builder embed
// (WordPress, Framer, Webflow) from data/agent-3d-releases.json.
//
//   npm run build:site-builder-embeds
//
// Run this after `npm run release:lib` cuts a new <agent-3d> version so every
// embed picks up the new version and hash in one pass. check:site-builder-embeds
// fails the build if a committed file drifts from what this would generate.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readLedger } from './lib/agent-3d-releases.mjs';
import { GENERATED_FILES, latestPin } from './lib/site-builder-pin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pin = latestPin(readLedger(root));

for (const { path, render } of GENERATED_FILES) {
	const abs = resolve(root, path);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, render(pin));
	console.log(`[site-builder-embeds] wrote ${path} (agent-3d ${pin.version})`);
}
