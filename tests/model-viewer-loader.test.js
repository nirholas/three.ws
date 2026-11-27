// @vitest-environment jsdom
//
// src/shared/model-viewer-loader.js tries three CDNs in turn and moves on from
// one that has not answered in 12 s, but a removed <script> still runs if its
// fetch lands later. The late copy then defines model-viewer's elements a
// second time. Reproduced on /forge (2026-11-27, a loaded machine): the guard
// caught the duplicate `model-viewer` but not `extra-model`, which model-viewer
// 4.x defines too, so the page logged an uncaught NotSupportedError ("the name
// extra-model has already been used with this registry").

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ensureModelViewer } from '../src/shared/model-viewer-loader.js';

describe('model-viewer loader duplicate define guard', () => {
	beforeAll(() => {
		// Keep the CDN chain parked: no source ever loads in jsdom, and the
		// per-source timeout must not fire during the test.
		vi.useFakeTimers();
		ensureModelViewer().catch(() => {});
	});

	it('ignores a late second copy of every element model-viewer defines', () => {
		const First = class extends HTMLElement {};
		const FirstExtra = class extends HTMLElement {};
		customElements.define('model-viewer', First);
		customElements.define('extra-model', FirstExtra);
		expect(() => customElements.define('model-viewer', class extends HTMLElement {})).not.toThrow();
		expect(() => customElements.define('extra-model', class extends HTMLElement {})).not.toThrow();
		expect(customElements.get('model-viewer')).toBe(First);
		expect(customElements.get('extra-model')).toBe(FirstExtra);
	});

	it('still throws for a genuine double define of any other element', () => {
		customElements.define('some-other-element', class extends HTMLElement {});
		expect(() => customElements.define('some-other-element', class extends HTMLElement {})).toThrow();
	});
});
