// The MCP census (api/_lib/mcp-census.js) counts each studio endpoint through two
// helpers on the studio dispatcher. When they went missing the census, the
// published catalog and the count checks all crashed with "is not a function".
import { describe, it, expect } from 'vitest';
import { resourcesForSurface, surfaceServesPrompts, SURFACE_NAMES } from '../api/_mcp-studio/dispatch.js';

describe('studio dispatcher census helpers', () => {
	it('lists the model viewer and persona widgets on the full surface without their HTML bodies', () => {
		const resources = resourcesForSurface('full');
		expect(resources).toHaveLength(2);
		for (const r of resources) {
			expect(r.uri).toMatch(/^ui:\/\//);
			expect(r).not.toHaveProperty('text');
		}
	});

	it('lists only the model viewer on the ChatGPT surface and nothing on Grok', () => {
		expect(resourcesForSurface('chatgpt')).toHaveLength(1);
		expect(resourcesForSurface('grok')).toEqual([]);
	});

	it('reports which surfaces serve the guided prompts', () => {
		expect(surfaceServesPrompts('full')).toBe(true);
		expect(surfaceServesPrompts('grok')).toBe(true);
		expect(surfaceServesPrompts('chatgpt')).toBe(false);
	});

	it('answers every named surface', () => {
		for (const name of SURFACE_NAMES) {
			expect(Array.isArray(resourcesForSurface(name))).toBe(true);
			expect(typeof surfaceServesPrompts(name)).toBe('boolean');
		}
	});
});
