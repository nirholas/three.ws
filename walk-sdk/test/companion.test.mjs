// @three-ws/walk: companion deep-link resolution.
// ====================================================
// The playground launch paths (`?walk=play` and the drop-in resume) read the
// avatar id straight out of storage and never looked at `?avatar=`, so a deep
// link like `?walk=play&avatar=fox` silently loaded the stored (or default)
// avatar instead of `fox`. Pure logic; `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/config.js';

// This Node test run has no DOM, so `lsGet`/`lsSet` (src/internal/storage.js)
// hit a bare `localStorage` global that doesn't exist here. Shim the Web
// Storage API with a plain Map so deepLinkAvatarId's persistence is actually
// observable, the same way it would be in a browser.
const store = new Map();
globalThis.localStorage = {
	getItem: (k) => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
	removeItem: (k) => store.delete(k),
};

const { deepLinkAvatarId } = await import('../src/companion.js');

test('deepLinkAvatarId prefers the ?avatar= query param over the stored choice', () => {
	const config = resolveConfig({ storagePrefix: `test-${Date.now()}-a` });
	localStorage.setItem(config.keys.avatar, 'wolf');
	const params = new URLSearchParams('walk=play&avatar=fox');
	assert.equal(deepLinkAvatarId(config, params), 'fox');
});

test('deepLinkAvatarId persists the query param so it survives into the playground', () => {
	const config = resolveConfig({ storagePrefix: `test-${Date.now()}-b` });
	const params = new URLSearchParams('walk=play&avatar=fox');
	deepLinkAvatarId(config, params);
	assert.equal(localStorage.getItem(config.keys.avatar), 'fox');
});

test('deepLinkAvatarId falls back to the stored choice when there is no ?avatar=', () => {
	const config = resolveConfig({ storagePrefix: `test-${Date.now()}-c` });
	localStorage.setItem(config.keys.avatar, 'wolf');
	const params = new URLSearchParams('walk=play');
	assert.equal(deepLinkAvatarId(config, params), 'wolf');
});

test('deepLinkAvatarId returns null when there is neither a param nor a stored choice', () => {
	const config = resolveConfig({ storagePrefix: `test-${Date.now()}-d` });
	const params = new URLSearchParams('walk=play');
	assert.equal(deepLinkAvatarId(config, params), null);
});
