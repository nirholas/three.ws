// Build the browser bundles.
//
// Two artefacts, both ES modules:
//
//   dist/ar-studio.js       everything bundled (three.js and the room client
//                           included), registers <ar-studio>, readable, with a
//                           source map. This is what a `<script type="module">`
//                           tag on a plain HTML page loads.
//   dist/ar-studio.min.js   the same, minified, for production pages.
//
// Package consumers who already bundle (Vite, webpack, Rollup) import the source
// under `src/` instead and share their own copy of three.

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

const banner = `/*! ${pkg.name} v${pkg.version} · ${pkg.homepage}
 * ${pkg.license} licensed. Bundles three.js (MIT) and colyseus.js (MIT). */`;

await mkdir(resolve(root, 'dist'), { recursive: true });

const common = {
	entryPoints: [resolve(root, 'src/auto.js')],
	bundle: true,
	format: 'esm',
	target: ['es2022', 'safari16', 'chrome111', 'firefox115'],
	platform: 'browser',
	banner: { js: banner },
	logLevel: 'info',
	// The WASM decoder modules are fetched at runtime from a CDN, never inlined.
	external: [],
};

await build({ ...common, outfile: resolve(root, 'dist/ar-studio.js'), sourcemap: true });
const min = await build({
	...common,
	outfile: resolve(root, 'dist/ar-studio.min.js'),
	minify: true,
	sourcemap: false,
	metafile: true,
});

const bytes = Object.values(min.metafile.outputs)[0]?.bytes ?? 0;
await writeFile(
	resolve(root, 'dist/BUILD.txt'),
	`${pkg.name} ${pkg.version}\nminified bundle: ${(bytes / 1024).toFixed(0)} kB\n`,
);
console.log(`\nminified bundle: ${(bytes / 1024).toFixed(0)} kB`);
