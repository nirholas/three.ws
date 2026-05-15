#!/usr/bin/env node
// Build @three-ws/avatar by copying the prebuilt CDN bundle out of the parent
// repo's dist-lib/ into this package's dist/. The CDN bundle is built by
// `npm run build:lib` at the root of the repo and is already self-contained
// (Three.js inlined, side-effectful custom-element registration on import).
//
// We do NOT re-bundle here — Vite has already produced a single ES module
// suitable for both browser <script type="module"> use and bundler consumption.
// All this script does is materialise that file as dist/index.mjs plus an
// empty stylesheet placeholder (kept for forward-compatibility with the
// "@three-ws/avatar/style.css" subpath import).

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const src = resolve(repoRoot, 'dist-lib', 'agent-3d.js');
if (!existsSync(src)) {
	console.error(
		'[avatar-sdk] dist-lib/agent-3d.js is missing — run `npm run build:lib` at the repo root first.',
	);
	process.exit(1);
}

const outDir = resolve(here, 'dist');
mkdirSync(outDir, { recursive: true });

copyFileSync(src, resolve(outDir, 'index.mjs'));

// Stylesheet stub. The custom element injects its own styles, so this is empty
// — but consumers that bundle ".css" side-effect imports get a no-op instead
// of a missing-file error.
writeFileSync(
	resolve(outDir, 'style.css'),
	'/* @three-ws/avatar — styles are injected by the custom element at runtime. */\n',
);

console.log('[avatar-sdk] built dist/index.mjs from dist-lib/agent-3d.js');
