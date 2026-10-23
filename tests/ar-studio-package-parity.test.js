// The in-app AR Studio (/ar/studio) and the 3d-ar-studio package share one
// implementation: src/ar-studio.js imports the package's core modules from
// packages/ar-studio. The one thing that exists in two places by necessity is the
// Colyseus wire schema (the room server in multiplayer/ cannot import a client
// package), so this suite fails the moment the two layouts drift.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Every `defineTypes(Class, { ... })` call, whitespace-normalised, keyed by class. */
function definedTypes(source) {
	const out = {};
	const re = /defineTypes\(\s*(\w+)\s*,\s*(\{[\s\S]*?\n\})\s*\)/g;
	for (const m of source.matchAll(re)) {
		out[m[1]] = m[2].replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
	}
	return out;
}

describe('studio room wire schema', () => {
	const server = definedTypes(read('multiplayer/src/studio-schemas.js'));
	const client = definedTypes(read('packages/ar-studio/src/studio/schemas.js'));

	it('declares the same classes on both sides', () => {
		expect(Object.keys(server).sort()).toEqual(['StudioModel', 'StudioState', 'StudioViewer']);
		expect(Object.keys(client).sort()).toEqual(Object.keys(server).sort());
	});

	it.each(['StudioModel', 'StudioViewer', 'StudioState'])('%s has the same field layout', (name) => {
		expect(client[name]).toBe(server[name]);
	});
});

describe('one implementation', () => {
	it('the page code imports the package core instead of keeping a copy', () => {
		const app = read('src/ar-studio.js');
		for (const mod of ['multi-place', 'scene-math', 'coords', 'pinch', 'estimated-lighting']) {
			expect(app).toContain(`packages/ar-studio/src/studio/${mod}.js`);
		}
	});

	it('the hosted net client only adds the three.ws server resolution', () => {
		const net = read('src/ar/studio-net.js');
		expect(net).toContain('extends PackageStudioNet');
		expect(net).not.toContain("from 'colyseus.js'");
	});
});
