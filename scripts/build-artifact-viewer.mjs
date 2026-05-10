#!/usr/bin/env node
// Build the artifact-viewer bundle that gets inlined into /api/artifact.
//
// Output: public/artifact-viewer.bundle.js — an IIFE containing three.js +
// GLTFLoader + viewer code. Inlined verbatim into the artifact HTML so the
// document needs no external script (Claude.ai's sandbox CSP forbids that).
//
// Run via: node scripts/build-artifact-viewer.mjs
//          (or `npm run build:artifact-viewer`)

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENTRY = resolve(ROOT, 'scripts/artifact-viewer/src.js');
const OUT = resolve(ROOT, 'public/artifact-viewer.bundle.js');

mkdirSync(dirname(OUT), { recursive: true });

const result = await build({
	entryPoints: [ENTRY],
	bundle: true,
	format: 'iife',
	platform: 'browser',
	target: ['es2020'],
	minify: true,
	legalComments: 'none',
	write: false,
	logLevel: 'info',
	define: { 'process.env.NODE_ENV': '"production"' },
});

const [bundle] = result.outputFiles;
const banner =
	'/* artifact-viewer bundle — three.js + GLTFLoader + viewer.\n' +
	' * Built from scripts/artifact-viewer/src.js. Do not edit by hand.\n' +
	' * Generated: ' +
	new Date().toISOString() +
	' */\n';
writeFileSync(OUT, banner + bundle.text);

const { size } = statSync(OUT);
console.log(`✓ ${OUT}`);
console.log(`  ${(size / 1024).toFixed(1)} KB`);
