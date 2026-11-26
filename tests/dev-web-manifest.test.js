// `npm run dev` answers /manifest.webmanifest.
//
// vite-plugin-pwa writes the web manifest only at build time, so in dev every
// one of the ~370 pages linking it logged "Manifest fetch ... failed, code 404"
// on load. server/dev-web-manifest.mjs serves the exact manifest object the build
// emits (one source, PWA_MANIFEST in vite.config.js), so dev and production
// cannot drift.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devWebManifestMiddleware } from '../server/dev-web-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteConfig = readFileSync(resolve(ROOT, 'vite.config.js'), 'utf8');

const MANIFEST = { name: 'three.ws', short_name: 'three.ws', start_url: '/?source=pwa', icons: [] };

function fakeRes() {
	const headers = {};
	return {
		headers,
		statusCode: 200,
		setHeader(k, v) { headers[k.toLowerCase()] = v; },
		end: vi.fn(),
	};
}

describe('dev web manifest middleware', () => {
	it('serves the manifest as application/manifest+json', () => {
		const mw = devWebManifestMiddleware(MANIFEST);
		const res = fakeRes();
		const next = vi.fn();
		mw({ method: 'GET', url: '/manifest.webmanifest' }, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('application/manifest+json');
		expect(JSON.parse(res.end.mock.calls[0][0])).toEqual(MANIFEST);
	});

	it('ignores a query string, as the browser may add one', () => {
		const mw = devWebManifestMiddleware(MANIFEST);
		const res = fakeRes();
		const next = vi.fn();
		mw({ method: 'GET', url: '/manifest.webmanifest?v=2' }, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(JSON.parse(res.end.mock.calls[0][0]).name).toBe('three.ws');
	});

	it('answers HEAD without a body', () => {
		const mw = devWebManifestMiddleware(MANIFEST);
		const res = fakeRes();
		mw({ method: 'HEAD', url: '/manifest.webmanifest' }, res, vi.fn());
		expect(res.end).toHaveBeenCalledWith();
	});

	it('passes every other request on', () => {
		const mw = devWebManifestMiddleware(MANIFEST);
		const next = vi.fn();
		mw({ method: 'GET', url: '/manifest.json' }, fakeRes(), next);
		mw({ method: 'POST', url: '/manifest.webmanifest' }, fakeRes(), next);
		expect(next).toHaveBeenCalledTimes(2);
	});
});

describe('vite.config.js wiring', () => {
	it('builds and serves the manifest from one shared object', () => {
		expect(viteConfig).toMatch(/const PWA_MANIFEST = \{/);
		expect(viteConfig).toMatch(/manifest:\s*PWA_MANIFEST/);
		expect(viteConfig).toMatch(/devWebManifestMiddleware\(PWA_MANIFEST\)/);
	});
});
