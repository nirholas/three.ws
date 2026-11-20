// The model page viewer (src/model-page.js) turns the model on its own only for
// visitors who have not asked their system for reduced motion (WCAG 2.3.3).
import { describe, it, expect } from 'vitest';
import { viewerMotionAttrs } from '../src/model-lib.js';

describe('viewerMotionAttrs', () => {
	it('auto-rotates by default', () => {
		expect(viewerMotionAttrs(false)).toBe('auto-rotate auto-rotate-delay="1500" rotation-per-second="18deg"');
	});

	it('holds still when the visitor prefers reduced motion', () => {
		expect(viewerMotionAttrs(true)).toBe('');
	});
});
