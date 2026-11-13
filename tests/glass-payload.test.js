// The /glass lens app has a hard budget: under 60 KB of gzipped JavaScript and
// no three.js, because it runs in the Meta Ray-Ban Display's on-lens browser.
// These tests hold the two things that decide it: the lens bundle itself, and
// which site-wide scripts the build injects into pages/glass.html.
//
// Regression (2026-11-13): src/irl/glasses/protocol.js kept a `Buffer` fallback
// next to TextEncoder. The bare `Buffer` reference made the node-polyfills
// plugin pull an 11 KB polyfill chunk into /glass, and the build also injected
// the Atlas palette, the iOS app bridge and the easter eggs (35 KB together),
// which left the built page at 59.9 KB against the 60 KB line.

import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldInject as atlasShouldInject } from '../scripts/inject-atlas.mjs';
import { LENS_ENTRIES, isLensEntry, LENS_JS_BUDGET_BYTES, firstPaintScripts } from '../scripts/lib/lens-surfaces.mjs';

const entry = fileURLToPath(new URL('../src/glass/main.js', import.meta.url));

function stripComments(code) {
	return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

async function bundleGlass() {
	const out = await build({
		entryPoints: [entry],
		bundle: true,
		minify: true,
		format: 'esm',
		platform: 'browser',
		write: false,
		metafile: true,
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return { code: out.outputFiles[0].text, inputs: Object.keys(out.metafile.inputs) };
}

describe('/glass lens bundle', () => {
	// The polyfill plugin injects its shim into any module whose source names a
	// Node global, before tree-shaking runs, so the check reads every module the
	// lens imports rather than the minified output (where dead code is gone).
	it('imports no module that names a Node global the polyfill plugin would shim', async () => {
		const { inputs } = await bundleGlass();
		const offenders = inputs.filter((p) => {
			const code = stripComments(readFileSync(p, 'utf8'));
			return /\b(Buffer|global)\b\s*[.(]|\bprocess\.\w/.test(code);
		});
		expect(offenders).toEqual([]);
	});

	it('stays far inside the lens budget and pulls in no three.js', async () => {
		const { code, inputs } = await bundleGlass();
		expect(inputs.filter((p) => /node_modules\/three\b/.test(p))).toEqual([]);
		expect(gzipSync(code).length).toBeLessThan(LENS_JS_BUDGET_BYTES / 4);
	});
});

describe('site chrome on lens surfaces', () => {
	it('names /glass as a lens surface', () => {
		expect(LENS_ENTRIES.has('glass.html')).toBe(true);
		expect(isLensEntry('dist/glass.html')).toBe(true);
		expect(isLensEntry('irl.html')).toBe(false);
	});

	it('keeps the Atlas palette off the lens and on ordinary pages', () => {
		expect(atlasShouldInject('dist/glass.html')).toBe(false);
		expect(atlasShouldInject('dist/irl.html')).toBe(true);
	});
});

describe('first-paint script walk used by check:dist', () => {
	// The shape of a built page: a tour gate that names a script only inside an
	// inline string, a module entry, a modulepreload, and an external script.
	const html = [
		'<script>var s=document.querySelector(\'script[src="/feature-tour.js"]\')</script>',
		'<script type="module" crossorigin src="/assets/entry-AAAAAAAA.js"></script>',
		'<link rel="modulepreload" crossorigin href="/assets/shared-BBBBBBBB.js">',
		'<script src="https://cdn.example.org/x.js"></script>',
	].join('\n');
	const files = {
		'/assets/entry-AAAAAAAA.js': 'import"./shared-BBBBBBBB.js";import{a}from"./deep-CCCCCCCC.js";import("./lazy-DDDDDDDD.js")',
		'/assets/shared-BBBBBBBB.js': 'export const s=1',
		'/assets/deep-CCCCCCCC.js': 'import"../atlas/score.js";export const a=1',
		'/atlas/score.js': 'export default 1',
	};
	const scripts = firstPaintScripts(html, (u) => files[u] ?? null);

	it('follows script tags, modulepreloads and static imports transitively', () => {
		expect(scripts).toEqual(['/assets/entry-AAAAAAAA.js', '/assets/shared-BBBBBBBB.js', '/assets/deep-CCCCCCCC.js', '/atlas/score.js']);
	});

	it('skips dynamic imports, external hosts and script names inside inline code', () => {
		expect(scripts).not.toContain('/assets/lazy-DDDDDDDD.js');
		expect(scripts).not.toContain('/feature-tour.js');
		expect(scripts.some((u) => u.includes('example.org'))).toBe(false);
	});
});
