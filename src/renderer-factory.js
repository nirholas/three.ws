// Renderer factory: WebGPU when the browser supports it AND the page opted in,
// the classic WebGL2 renderer otherwise.
//
// WebGPU is strictly opt-in. A surface asks for it with `?renderer=webgpu` in
// the page URL or a `renderer="webgpu"` attribute on <agent-3d>. Anything else
// (no opt-in, no `navigator.gpu`, no adapter, the WebGPU renderer failing to
// initialise) resolves to the existing guarded WebGL path in webgl-support.js,
// so a default visit is byte-for-byte what shipped before and a failed opt-in
// degrades silently to the same picture instead of a blank canvas.
//
// The backend that was actually chosen is returned (and stamped on the canvas as
// `data-renderer`) so callers branch on what they got, never on what was asked.

import { createRenderer as createWebGLRenderer } from './webgl-support.js';

export const BACKEND_WEBGPU = 'webgpu';
export const BACKEND_WEBGL = 'webgl';

/**
 * Pure opt-in parser. The attribute wins over the query string so an embedder
 * can pin a backend regardless of the host page URL. Only the exact value
 * "webgpu" opts in; "webgl" (or anything else) forces the classic path.
 *
 * @param {{ search?: string, attr?: string | null }} [src]
 * @returns {'webgpu' | 'webgl'}
 */
export function resolveRendererPreference({ search = '', attr = null } = {}) {
	const pick = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
	const fromAttr = pick(attr);
	if (fromAttr) return fromAttr === 'webgpu' ? BACKEND_WEBGPU : BACKEND_WEBGL;
	const fromQuery = pick(new URLSearchParams(search).get('renderer'));
	return fromQuery === 'webgpu' ? BACKEND_WEBGPU : BACKEND_WEBGL;
}

/** The preference of the current page, optionally overridden by an element attribute. */
export function pagePreference(el) {
	const search = typeof location !== 'undefined' ? location.search : '';
	return resolveRendererPreference({ search, attr: el?.getAttribute?.('renderer') ?? null });
}

/**
 * True when a WebGPU adapter can actually be acquired. `navigator.gpu` alone is
 * not enough: Chromium on a blocklisted GPU exposes the object but resolves
 * `requestAdapter()` to null.
 */
export async function isWebGPUAvailable() {
	try {
		if (typeof navigator === 'undefined' || !navigator.gpu) return false;
		const adapter = await navigator.gpu.requestAdapter();
		return !!adapter;
	} catch {
		return false;
	}
}

/**
 * Build a renderer for `prefer`, falling back to WebGL2 whenever WebGPU is not
 * both requested and working.
 *
 * @param {object} [options]   Passed to the renderer constructor (antialias, alpha, ...).
 * @param {{ prefer?: 'webgpu' | 'webgl', fallback?: Element }} [guard]
 * @returns {Promise<{ renderer: any, backend: 'webgpu' | 'webgl', reason: string }>}
 * @throws {import('./webgl-support.js').WebGLUnavailableError} when neither backend starts.
 */
export async function createAutoRenderer(options = {}, { prefer = BACKEND_WEBGL, fallback } = {}) {
	let reason = 'webgl default';
	if (prefer === BACKEND_WEBGPU) {
		if (!(await isWebGPUAvailable())) {
			reason = 'webgpu requested but no adapter, using webgl';
		} else {
			try {
				const { WebGPURenderer } = await import('three/webgpu');
				// forceWebGL stays false: a WebGPU opt-in that cannot get a GPU device
				// must land on the CLASSIC renderer below, not on the node renderer's
				// own GL2 backend, so the fallback is exactly the shipped picture.
				const renderer = new WebGPURenderer({ ...options, forceWebGL: false });
				await renderer.init();
				const usedBackend = renderer.backend?.isWebGPUBackend ? BACKEND_WEBGPU : null;
				if (usedBackend) {
					renderer.domElement.dataset.renderer = BACKEND_WEBGPU;
					return { renderer, backend: BACKEND_WEBGPU, reason: 'webgpu' };
				}
				renderer.dispose?.();
				reason = 'webgpu renderer fell back internally, using webgl';
			} catch (err) {
				reason = `webgpu init failed (${err?.message || err}), using webgl`;
			}
		}
	}
	const renderer = createWebGLRenderer(options, { fallback });
	renderer.domElement.dataset.renderer = BACKEND_WEBGL;
	return { renderer, backend: BACKEND_WEBGL, reason };
}
