// @vitest-environment jsdom
//
// avatar-page.js and marketplace.js each wire a <model-viewer> `error`
// listener to this shared helper. Neither module is importable in isolation
// under jsdom (avatar-page.js resolves a real entity via network on import;
// marketplace.js's init() queries full-page markup that doesn't exist in a
// bare DOM), so this tests the helper directly rather than importing either
// page controller, per the work order's "minimal harness" guidance.
import { describe, it, expect, vi } from 'vitest';
import { wireModelViewerFallback, DEFAULT_AVATAR_GLB } from '../../src/shared/model-viewer-fallback.js';

function makeViewer(src) {
	const mv = document.createElement('model-viewer');
	mv.setAttribute('src', src);
	document.body.appendChild(mv);
	return mv;
}

describe('wireModelViewerFallback', () => {
	it('swaps src to the default avatar and calls onFallback on the first error', () => {
		const mv = makeViewer('https://three.ws/api/avatars/abc/glb');
		const onFallback = vi.fn();
		const onFinalError = vi.fn();
		wireModelViewerFallback(mv, { onFallback, onFinalError });

		mv.dispatchEvent(new Event('error'));

		expect(mv.getAttribute('src')).toBe(DEFAULT_AVATAR_GLB);
		expect(onFallback).toHaveBeenCalledTimes(1);
		expect(onFinalError).not.toHaveBeenCalled();
	});

	it('calls onFinalError and stops swapping src when the fallback also errors', () => {
		const mv = makeViewer('https://three.ws/api/avatars/abc/glb');
		const onFallback = vi.fn();
		const onFinalError = vi.fn();
		wireModelViewerFallback(mv, { onFallback, onFinalError });

		mv.dispatchEvent(new Event('error'));
		mv.dispatchEvent(new Event('error'));

		expect(mv.getAttribute('src')).toBe(DEFAULT_AVATAR_GLB);
		expect(onFallback).toHaveBeenCalledTimes(1);
		expect(onFinalError).toHaveBeenCalledTimes(1);
	});

	it('goes straight to onFinalError when the src is already the default avatar', () => {
		const mv = makeViewer(DEFAULT_AVATAR_GLB);
		const onFallback = vi.fn();
		const onFinalError = vi.fn();
		wireModelViewerFallback(mv, { onFallback, onFinalError });

		mv.dispatchEvent(new Event('error'));

		expect(onFallback).not.toHaveBeenCalled();
		expect(onFinalError).toHaveBeenCalledTimes(1);
	});

	it('does nothing when no viewer is passed', () => {
		expect(() => wireModelViewerFallback(null, {})).not.toThrow();
	});
});
