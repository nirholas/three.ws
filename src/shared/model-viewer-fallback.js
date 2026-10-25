/**
 * Shared GLB-load-failure recovery for `<model-viewer>` elements.
 *
 * When a body GLB fails to load (an R2 outage, a missing object, a corrupt
 * upload), the local default avatar (`public/avatars/default.glb`, same
 * origin, no object-storage dependency) stands in once rather than leaving a
 * dead viewer. Only if the default avatar itself also fails does the final
 * unrecoverable state apply.
 */

export const DEFAULT_AVATAR_GLB = 'https://three.ws/avatars/default.glb';

/**
 * Wires the fallback onto a `<model-viewer>`-like element.
 *
 * @param {EventTarget & { getAttribute(name: string): string | null, setAttribute(name: string, value: string): void }} viewer
 * @param {{ onFallback?: () => void, onFinalError?: () => void }} [handlers]
 */
export function wireModelViewerFallback(viewer, { onFallback, onFinalError } = {}) {
	if (!viewer) return;
	viewer.addEventListener(
		'error',
		() => {
			if (viewer.getAttribute('src') === DEFAULT_AVATAR_GLB) {
				onFinalError?.();
				return;
			}
			viewer.setAttribute('src', DEFAULT_AVATAR_GLB);
			onFallback?.();
			viewer.addEventListener('error', () => onFinalError?.(), { once: true });
		},
		{ once: true },
	);
}
