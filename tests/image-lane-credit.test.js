// @vitest-environment jsdom
// Pollinations attribution: providerLabel names the lane correctly, and the
// "Powered by Pollinations" credit renders only for results that lane produced.

import { describe, it, expect } from 'vitest';
import { providerLabel } from '../api/_lib/ai-image-lanes.js';
import { laneCredit, appendLaneCredit } from '../src/shared/image-lane-credit.js';

describe('providerLabel', () => {
	it('labels the keyless Pollinations lane as pollinations, not nvidia-nim', () => {
		expect(providerLabel({ imageUrl: 'https://x/y.png', model: 'pollinations/flux' })).toBe('pollinations');
	});
	it('keeps the other lanes unchanged', () => {
		expect(providerLabel({ model: 'vertex-ai/imagen-4' })).toBe('vertex');
		expect(providerLabel({ model: 'black-forest-labs/flux-schnell', predictionId: 'p1' })).toBe('replicate');
		expect(providerLabel({ model: 'black-forest-labs/flux.1-schnell' })).toBe('nvidia-nim');
		expect(providerLabel({})).toBe('unknown');
	});
});

describe('Pollinations credit', () => {
	it('renders a link to pollinations.ai for the pollinations lane', () => {
		const a = laneCredit('pollinations');
		expect(a.tagName).toBe('A');
		expect(a.textContent).toBe('Powered by Pollinations');
		expect(a.href).toBe('https://pollinations.ai/');
		expect(a.rel).toContain('noopener');
		expect(a.className).toContain('lane-credit');
	});
	it('renders nothing for any other lane', () => {
		for (const p of ['nvidia-nim', 'vertex', 'replicate', 'unknown', '', null, undefined]) {
			expect(laneCredit(p)).toBeNull();
		}
	});
	it('appendLaneCredit adds exactly one credit, only for pollinations, and replaces a stale one', () => {
		const note = document.createElement('div');
		appendLaneCredit(note, 'pollinations');
		appendLaneCredit(note, 'pollinations');
		expect(note.querySelectorAll('.lane-credit')).toHaveLength(1);
		appendLaneCredit(note, 'vertex');
		expect(note.querySelectorAll('.lane-credit')).toHaveLength(0);
	});
});
