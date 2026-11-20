// @vitest-environment jsdom
// /anatomy/:id in a browser without WebGL. The explorer's renderer threw while
// the design was being shown, so the page swapped the machine for "That did
// not work. THREE.WebGLRenderer: Error creating WebGL context." with a Try
// again button that could never work, and Share (Share on X, Ask @grok) never
// unlocked. The design now falls back to a still isometric line drawing with
// the reason underneath, and the rest of the page, Share included, carries on.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountExplorerOrStill, STILL_NOTE } from '../src/anatomy/still.js';

const SPEC = {
	title: 'Honda CD70 carburetor',
	parts: [
		{
			id: 'body', name: 'Carburetor body', color: '#8a8a8a', group: 'Body', parent: null, repeat: null,
			position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
			shape: { axis: 'x', type: 'lathe', profile: [[1.2, -2.5], [1.2, -1.5], [0.9, -1.5], [0.7, -0.5], [0.7, 0.5], [0.9, 1.5], [1.2, 1.5], [1.2, 2.5], [1, 2.5], [1, -2.5]] },
		},
		{
			id: 'slide', name: 'Throttle slide', group: 'Throttle', parent: 'body', repeat: null,
			position: [0, 1.4, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
			shape: { type: 'cylinder', axis: 'y', radius: 0.5, height: 1.2 },
		},
	],
};

// What mountAnatomy does on a machine with no WebGL: it appends its root,
// then the viewer's THREE.WebGLRenderer throws.
function webglLessMount(stage) {
	return () => {
		const root = document.createElement('div');
		root.className = 'anx';
		stage.append(root);
		throw new Error('THREE.WebGLRenderer: Error creating WebGL context.');
	};
}

let stage;
beforeEach(() => {
	document.body.innerHTML = '<div id="anpStage"><div id="anpSkeleton" hidden></div></div>';
	stage = document.getElementById('anpStage');
});

describe('the anatomy explorer without WebGL', () => {
	it('falls back to a still drawing instead of throwing', () => {
		const app = mountExplorerOrStill(stage, webglLessMount(stage));
		expect(app.still).toBe(true);
		expect(stage.querySelector('.anx')).toBeNull();
		expect(stage.querySelector('#anpSkeleton')).toBeTruthy();
		app.update(SPEC);
		const img = stage.querySelector('.anp-still img');
		expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
		expect(img.alt).toBe('Line drawing of Honda CD70 carburetor');
		expect(stage.querySelector('.anp-still figcaption').textContent).toBe(STILL_NOTE);
		expect(app.spec).toBe(SPEC);
		expect(typeof app.root.focus).toBe('function');
	});

	it('keeps the drawing inside an image, so spec text never becomes markup', () => {
		const app = mountExplorerOrStill(stage, webglLessMount(stage));
		const hostile = { ...SPEC, parts: [{ ...SPEC.parts[0], color: '"/><script>window.__pwned=1</script>' }] };
		app.update(hostile);
		expect(stage.querySelector('script, svg, path')).toBeNull();
		expect(window.__pwned).toBeUndefined();
	});

	it('redraws as a design streams in and hides the image while nothing is drawable', () => {
		const app = mountExplorerOrStill(stage, webglLessMount(stage));
		app.update({ parts: [] }, { progressive: true });
		expect(stage.querySelector('.anp-still img').hidden).toBe(true);
		app.update(SPEC, { progressive: true });
		expect(stage.querySelector('.anp-still img').hidden).toBe(false);
		app.dispose();
		expect(stage.querySelector('.anp-still')).toBeNull();
	});

	it('does not hide other explorer failures behind the still when WebGL works', () => {
		const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
		expect(() => mountExplorerOrStill(stage, () => { throw new TypeError('spec.parts is not iterable'); })).toThrow('spec.parts is not iterable');
		getContext.mockRestore();
	});

	it('returns the real explorer whenever it mounts', () => {
		const explorer = { update() {}, dispose() {}, root: stage };
		expect(mountExplorerOrStill(stage, () => explorer)).toBe(explorer);
	});

	it('is how the page mounts its explorer, so Share still unlocks without WebGL', () => {
		const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/anatomy/page.js'), 'utf8');
		const fn = src.slice(src.indexOf('function ensureExplorer'), src.indexOf('function narrateStep'));
		expect(fn).toMatch(/mountExplorerOrStill\(\s*stage,/);
	});
});
