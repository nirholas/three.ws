// /agent-identities "View in 3D" spun forever because the page loaded only the
// meshopt decoder shim (/model-viewer-meshopt.js), never the model-viewer
// library, so the element never upgraded. The page must use the shared loader
// (CDN chain + meshopt registration) and surface a timeout/retry state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/agent-identities.js', import.meta.url), 'utf8');

describe('agent-identities View in 3D', () => {
	it('loads the real model-viewer library through the shared loader', () => {
		expect(src).toMatch(/from '\.\/shared\/model-viewer-loader\.js'/);
		expect(src).not.toContain("'/model-viewer-meshopt.js'");
	});

	it('bounds the wait with a timeout and offers a retry', () => {
		expect(src).toMatch(/LOAD_TIMEOUT_MS/);
		expect(src).toMatch(/Try again/);
	});
});
