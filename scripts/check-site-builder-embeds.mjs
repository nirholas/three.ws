#!/usr/bin/env node
// Holds the committed WordPress/Framer/Webflow pinned-release files to the
// <agent-3d> release ledger. Fails if a file is missing or stale; `--fix`
// regenerates them (same thing npm run build:site-builder-embeds does).

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readLedger } from './lib/agent-3d-releases.mjs';
import { GENERATED_FILES, latestPin } from './lib/site-builder-pin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fix = process.argv.includes('--fix');
const pin = latestPin(readLedger(root));

let problems = 0;
for (const { path, render } of GENERATED_FILES) {
	const abs = resolve(root, path);
	const expected = render(pin);
	const actual = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
	if (actual === expected) continue;
	problems++;
	if (fix) {
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, expected);
		console.log(`[site-builder-embeds] rewrote ${path} (agent-3d ${pin.version})`);
	} else {
		console.error(`[site-builder-embeds] ${path} does not match the ledger (agent-3d ${pin.version}); run: npm run build:site-builder-embeds`);
	}
}

if (problems && !fix) process.exit(1);
if (!problems) console.log(`[site-builder-embeds] ${GENERATED_FILES.length} pinned-release file(s) match agent-3d ${pin.version}`);
