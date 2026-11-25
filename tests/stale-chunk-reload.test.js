// A tab opened before a deploy still references the previous build's hashed
// chunks, and the container only ships the current build, so the next lazy
// import fails with "Failed to fetch dynamically imported module" or "Unable to
// preload CSS" and the feature never loads. Nothing handled Vite's
// vite:preloadError, so the visitor was stuck until they reloaded by hand.
//
// The bootstrap reloads once when the failed chunk is really gone (404), and
// leaves the error alone when the chunk still serves (a transient network abort
// or a crawler cancelling the request), so a reload can never loop.

import { describe, it, expect } from 'vitest';
import { installStaleChunkReload, staleChunkReloadSnippet } from '../scripts/vite/stale-chunk-reload.mjs';

function fakeWindow({ status = 404, origin = 'https://three.ws', seen = {} } = {}) {
	const listeners = {};
	const store = { ...seen };
	const win = {
		reloads: 0,
		heads: [],
		location: { origin, reload() { win.reloads++; } },
		sessionStorage: {
			getItem: (k) => (k in store ? store[k] : null),
			setItem: (k, v) => { store[k] = String(v); },
		},
		fetch: async (url, init) => {
			win.heads.push({ url, method: init?.method });
			if (status === 'throw') throw new TypeError('Failed to fetch');
			return { status };
		},
		addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
		store,
	};
	win.fire = async (message) => {
		const ev = { type: 'vite:preloadError', payload: new Error(message) };
		for (const fn of listeners['vite:preloadError'] || []) await fn(ev);
	};
	return win;
}

describe('stale chunk reload', () => {
	it('reloads once when a dynamically imported chunk is gone after a deploy', async () => {
		const win = fakeWindow({ status: 404 });
		installStaleChunkReload(win);
		await win.fire('Failed to fetch dynamically imported module: https://three.ws/assets/main-D28UyZV3.js');
		expect(win.heads).toEqual([{ url: 'https://three.ws/assets/main-D28UyZV3.js', method: 'HEAD' }]);
		expect(win.reloads).toBe(1);
	});

	it('reloads for a CSS preload of a chunk that is gone', async () => {
		const win = fakeWindow({ status: 404 });
		installStaleChunkReload(win);
		await win.fire('Unable to preload CSS for https://three.ws/assets/main-4m8R2dim.css');
		expect(win.reloads).toBe(1);
	});

	it('does not reload a second time for the same chunk in the session', async () => {
		const win = fakeWindow({ status: 404 });
		installStaleChunkReload(win);
		await win.fire('Failed to fetch dynamically imported module: https://three.ws/assets/a-1.js');
		await win.fire('Failed to fetch dynamically imported module: https://three.ws/assets/a-1.js');
		expect(win.reloads).toBe(1);
	});

	it('leaves the error alone when the chunk still serves (a transient abort)', async () => {
		const win = fakeWindow({ status: 200 });
		installStaleChunkReload(win);
		await win.fire('Failed to fetch dynamically imported module: https://three.ws/assets/main-D28UyZV3.js');
		expect(win.reloads).toBe(0);
	});

	it('leaves the error alone when the check itself cannot reach the server', async () => {
		const win = fakeWindow({ status: 'throw' });
		installStaleChunkReload(win);
		await win.fire('Failed to fetch dynamically imported module: https://three.ws/assets/main-D28UyZV3.js');
		expect(win.reloads).toBe(0);
	});

	it('ignores chunks on another origin and errors without a chunk URL', async () => {
		const win = fakeWindow({ status: 404 });
		installStaleChunkReload(win);
		await win.fire('Failed to fetch dynamically imported module: https://cdn.example.com/assets/x.js');
		await win.fire('Importing a module script failed.');
		expect(win.heads).toEqual([]);
		expect(win.reloads).toBe(0);
	});

	it('renders a self-contained snippet for the inline bootstrap', () => {
		const snippet = staleChunkReloadSnippet();
		expect(snippet.startsWith('(')).toBe(true);
		expect(snippet.endsWith(')(window);')).toBe(true);
		const win = fakeWindow();
		// The snippet must run with nothing but the window in scope.
		new Function('window', snippet)(win);
	});
});
