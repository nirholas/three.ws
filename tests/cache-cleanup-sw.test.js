// public/cache-cleanup-sw.js evaluated as the service worker would run it, plus
// the two build-config facts it exists to back up.
//
// Hashed /assets/ chunks must never be answered by the service worker: Chrome
// discards a <link rel=modulepreload> for a script whose fetch a worker answers
// ("cross-world service worker resource mismatch"), so every preloaded chunk was
// requested twice and logged a warning on every repeat visit. The route is gone;
// these tests keep it gone and keep the cache it left behind getting deleted.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/cache-cleanup-sw.js'), 'utf8');
const VITE_CONFIG = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8');

function runWorker(existing) {
	const names = new Set(existing);
	const listeners = new Map();
	const scope = {
		addEventListener: (type, fn) => listeners.set(type, fn),
	};
	const caches = {
		delete: vi.fn(async (name) => names.delete(name)),
	};
	new Function('self', 'caches', SW_SOURCE)(scope, caches);
	return { names, listeners, caches };
}

describe('cache-cleanup-sw', () => {
	it('deletes the retired app-assets cache on activate and leaves live caches alone', async () => {
		const { names, listeners } = runWorker(['app-assets', 'app-shell-assets', 'threews-glance']);
		let settled;
		listeners.get('activate')({ waitUntil: (p) => { settled = p; } });
		await settled;
		expect([...names].sort()).toEqual(['app-shell-assets', 'threews-glance']);
	});

	it('does not fail activation when the cache was never there', async () => {
		const { listeners } = runWorker([]);
		let settled;
		listeners.get('activate')({ waitUntil: (p) => { settled = p; } });
		await expect(settled).resolves.toBeDefined();
	});
});

describe('service worker build config', () => {
	it('imports the cleanup script into the generated worker', () => {
		expect(VITE_CONFIG).toMatch(/importScripts:\s*\[[^\]]*'\/cache-cleanup-sw\.js'/);
	});

	it('routes no runtime cache at hashed /assets/ chunks', () => {
		expect(VITE_CONFIG).not.toContain("cacheName: 'app-assets'");
		// The generic script/style rule must exclude /assets/ or it would catch them.
		expect(VITE_CONFIG).toMatch(/!url\.pathname\.startsWith\('\/assets\/'\)\s*&&\s*\(request\.destination === 'script'/);
	});
});
