// The root installs patched copies of a few dependencies whose upstream fixes
// never shipped on the major version our dependents pin (see vendor/ and the
// package.json overrides). These tests pin the security behavior so a lockfile
// refresh that silently swaps a registry copy back in fails here.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('vendored lodash.set (GHSA-p6mc-m468-83gw, prototype pollution)', () => {
	const set = require('lodash.set');

	it('sets nested paths', () => {
		expect(set({}, 'a.b', 1)).toEqual({ a: { b: 1 } });
	});

	it('cannot write through __proto__ or constructor.prototype', () => {
		set({}, '__proto__.pollutedA', 1);
		set({}, 'constructor.prototype.pollutedB', 1);
		expect({}.pollutedA).toBeUndefined();
		expect({}.pollutedB).toBeUndefined();
	});
});

describe('@colyseus/core nanoid (v2 API on patched nanoid 3.3.18+)', () => {
	const core = require('@colyseus/core');
	const nanoidPath = require.resolve('nanoid', { paths: [require.resolve('@colyseus/core')] });

	it('resolves the multiplayer compat shim, not registry nanoid 2.x', () => {
		expect(require(require('node:path').join(nanoidPath, '..', 'package.json')).version).toBe('3.3.18+v2-compat');
	});

	it('still generates room ids of the requested length', () => {
		expect(core.generateId()).toHaveLength(9);
		expect(core.generateId(12)).toHaveLength(12);
	});
});
