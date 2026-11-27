// HEIC photos are decoded by a vendored libheif build in /public/vendor/libheif/
// on every browser without a native HEIC decoder (Chrome, Edge, Firefox).
//
// The loader used to `import()` that file directly. Vite rewrites every
// non-literal dynamic import to request `<path>?import`, and its dev server
// refuses a module import of a /public file with a 500, so on the dev server
// every HEIC failed with "Could not open this HEIC" (found by
// scripts/forge-intake-verify.mjs). The loader now fetches the bytes and imports
// them from an object URL, which the dev server and production serve the same way.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { resolveObjectURL } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { loadLibheif } from '../src/shared/forge-image-normalize.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIBHEIF = '/vendor/libheif/libheif-bundle.mjs';
const README_SHA = readFileSync(join(ROOT, 'public/vendor/libheif/README.md'), 'utf8').match(/sha256 `([0-9a-f]{64})`/)[1];

let server;
let base;
let emptyRoot;

beforeAll(async () => {
	emptyRoot = mkdtempSync(join(tmpdir(), 'forge-libheif-'));
	server = await createServer({
		configFile: false,
		root: emptyRoot,
		publicDir: join(ROOT, 'public'),
		logLevel: 'silent',
		appType: 'custom',
		server: { port: 0, host: '127.0.0.1', ws: false, watch: { ignored: ['**/*'] } },
	});
	await server.listen();
	base = server.resolvedUrls.local[0].replace(/\/$/, '');
}, 60_000);

afterAll(async () => {
	await server?.close();
	if (emptyRoot) rmSync(emptyRoot, { recursive: true, force: true });
});

describe('libheif loader on the Vite dev server', () => {
	it('the dev server refuses a module import of the /public file (the request a dynamic import() makes)', async () => {
		const asModule = await fetch(`${base}${LIBHEIF}?import`);
		expect(asModule.status).toBe(500);
		const asBytes = await fetch(`${base}${LIBHEIF}`);
		expect(asBytes.status).toBe(200);
	});

	it('fetches the vendored bytes and imports them from an object URL, never the /public path itself', async () => {
		const fetched = [];
		const imported = [];
		const lib = await loadLibheif({
			fetchImpl: (url, init) => {
				fetched.push(url);
				return fetch(`${base}${url}`, init);
			},
			importImpl: async (url) => {
				imported.push(url);
				expect(url.startsWith('blob:')).toBe(true);
				const code = await resolveObjectURL(url).text();
				expect(createHash('sha256').update(code).digest('hex')).toBe(README_SHA);
				return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
			},
		});
		expect(fetched).toEqual([LIBHEIF]);
		expect(imported).toHaveLength(1);
		expect(typeof lib.HeifDecoder).toBe('function');
	}, 60_000);
});
