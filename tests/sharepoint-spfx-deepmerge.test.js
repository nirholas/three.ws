// The SharePoint SPFx toolchain (jest-config via @microsoft/spfx-web-build-rig)
// depends on deepmerge, and every published deepmerge release (<=4.3.1) is
// vulnerable to prototype poisoning (GHSA-gcqx-w48m-w2h4). The project overrides
// it with the patched copy in integrations/microsoft/sharepoint-spfx/vendor.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const SPFX = new URL('../integrations/microsoft/sharepoint-spfx/', import.meta.url);
const deepmerge = require('../integrations/microsoft/sharepoint-spfx/vendor/deepmerge/index.js');

const poisoned = () => JSON.parse('{"__proto__": {"polluted": "yes"}, "a": 1}');

describe('vendored deepmerge (SPFx override)', () => {
	it('does not let a target own __proto__ key replace the result prototype', () => {
		const out = deepmerge(poisoned(), { b: 2 });
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		expect(out.polluted).toBeUndefined();
		expect(out).toMatchObject({ a: 1, b: 2 });
	});

	it('does not let a source own __proto__ key replace the result prototype', () => {
		const out = deepmerge({ __proto__: null, x: 1 }, poisoned());
		expect(out.polluted).toBeUndefined();
		const viaAll = deepmerge.all([{ x: 1 }, poisoned(), { y: 2 }]);
		expect(Object.getPrototypeOf(viaAll)).toBe(Object.prototype);
		expect(viaAll.polluted).toBeUndefined();
	});

	it('keeps __proto__ as a plain own data property, like JSON.parse does', () => {
		const out = deepmerge(poisoned(), {});
		expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
		expect(Object.getOwnPropertyDescriptor(out, '__proto__').value).toEqual({ polluted: 'yes' });
		expect(Object.prototype.polluted).toBeUndefined();
	});

	it('still deep merges normally', () => {
		const out = deepmerge(
			{ a: { b: 1, list: [1] }, keep: true },
			{ a: { c: 2, list: [2] } },
		);
		expect(out).toEqual({ a: { b: 1, c: 2, list: [1, 2] }, keep: true });
		expect(deepmerge({ a: [1] }, { a: [2] }, { arrayMerge: (_t, s) => s })).toEqual({ a: [2] });
	});

	it('is what the SPFx project resolves deepmerge to', () => {
		const pkg = JSON.parse(readFileSync(new URL('package.json', SPFX), 'utf8'));
		expect(pkg.devDependencies.deepmerge).toBe('file:./vendor/deepmerge');
		expect(pkg.overrides.deepmerge).toBe('$deepmerge');
		const lock = JSON.parse(readFileSync(new URL('package-lock.json', SPFX), 'utf8'));
		const entry = lock.packages['node_modules/deepmerge'];
		expect(entry).toMatchObject({ resolved: 'vendor/deepmerge', link: true });
	});
});
