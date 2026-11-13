// The agent profile (/agents/<id>, pages/avatar-page.html) shows its avatar in
// <model-viewer>, which brings its own renderer. Measured on a Pixel 5 profile
// against production on 2026-11-13, the page still preloaded the site's own
// three.js chunk (three-addons, 653 KB compressed) because three modules that
// only run after a click were imported statically: the Talk overlay, the Pose
// stage and the client-side GLB/OBJ/USDZ export. That chunk was the largest
// script on the page and its evaluation sat on the main thread before the
// profile could finish rendering (LCP 17 s, blocking-time proxy 35 s).
//
// Those three now load on demand. This pins it: nothing reachable from the
// page entry by static import may pull in three.js.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { staticChainsTo, staticImportsOf } from '../scripts/lib/static-import-graph.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const isThree = (spec) => spec === 'three' || spec.startsWith('three/');

describe('agent profile first load', () => {
	it('never statically imports three.js', () => {
		const chains = staticChainsTo(ROOT, 'src/avatar-page.js', isThree).map((c) => c.join(' -> '));
		expect(chains).toEqual([]);
	});

	it('still reaches the on-demand features through dynamic imports', () => {
		const source = readFileSync(path.join(ROOT, 'src/avatar-page.js'), 'utf8');
		for (const mod of ['./voice/talk-mode.js', './avatar-pose.js', './avatar-export.js']) {
			expect(source).toContain(`import('${mod}')`);
			expect(staticImportsOf(source)).not.toContain(mod);
		}
	});
});

describe('static-import-graph helper', () => {
	it('ignores commented-out and dynamic imports', () => {
		const src = [
			"import a from './a.js';",
			"// import b from './b.js';",
			"/* import c from './c.js'; */",
			"const d = await import('./d.js');",
			"export { e } from './e.js';",
		].join('\n');
		expect(staticImportsOf(src)).toEqual(['./a.js', './e.js']);
	});

	it('finds a chain through an intermediate module', () => {
		const chains = staticChainsTo(ROOT, 'src/avatar-pose.js', isThree);
		expect(chains.length).toBeGreaterThan(0);
		expect(chains[0][0]).toBe('src/avatar-pose.js');
	});
});
