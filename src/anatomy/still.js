// The anatomy explorer for a browser without WebGL. mountAnatomy's renderer
// throws when no WebGL context can be created (blocked by policy, a GPU
// blocklist, an old device), and the design view used to turn that into an
// error screen with Share locked. Instead the machine is shown as the still
// isometric line drawing its share card uses (src/anatomy/plot.js), with the
// reason underneath, and the rest of the page carries on.
//
// The drawing is an <img> with an SVG data URI, never inline markup, so no
// text in a spec (a streaming partial included) can become DOM.

import { plotDesignSvg } from './plot.js';

export const STILL_NOTE =
	'This browser could not start 3D (WebGL), so the machine is shown as a still drawing. Open this link on a device with WebGL to rotate it, cut it open and take the tour.';

const WEBGL_ERROR = /webgl/i;

function webglAvailable() {
	try {
		const canvas = document.createElement('canvas');
		return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
	} catch {
		return false;
	}
}

/** A still drawing with the explorer's update/spec/root/dispose surface. */
export function mountStill(el) {
	const root = document.createElement('figure');
	root.className = 'anp-still';
	root.tabIndex = 0;
	root.setAttribute('aria-label', 'Machine drawing');
	const img = document.createElement('img');
	img.className = 'anp-still__img';
	img.decoding = 'async';
	img.alt = 'Line drawing of the machine';
	img.hidden = true;
	const note = document.createElement('figcaption');
	note.className = 'anp-still__note';
	note.textContent = STILL_NOTE;
	root.append(img, note);
	el.append(root);

	let spec = null;
	return {
		still: true,
		root,
		get spec() {
			return spec;
		},
		update(next) {
			spec = next;
			const svg = next?.parts?.length ? plotDesignSvg(next, { width: 1200, height: 800, pad: 32, stroke: 1.6 }) : null;
			img.hidden = !svg;
			if (svg) img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
			img.alt = next?.title ? `Line drawing of ${next.title}` : 'Line drawing of the machine';
		},
		dispose() {
			root.remove();
		},
	};
}

/**
 * Mount the interactive explorer; when WebGL is what failed, clear what it
 * left in `el` and mount the still drawing instead. Any other failure is a
 * real bug and is rethrown.
 */
export function mountExplorerOrStill(el, mount) {
	try {
		return mount();
	} catch (err) {
		if (!WEBGL_ERROR.test(String(err?.message || '')) && webglAvailable()) throw err;
		for (const node of el.querySelectorAll(':scope > .anx')) node.remove();
		return mountStill(el);
	}
}
