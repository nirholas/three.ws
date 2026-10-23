// <ar-studio>: the studio as a custom element.
//
//   <script type="module" src="https://unpkg.com/3d-ar-studio/dist/ar-studio.js"></script>
//   <ar-studio assets="https://your.cdn/models.json" title="Acme AR"></ar-studio>
//
// Every attribute maps onto a config field, so a page with no build step and no
// JavaScript of its own still gets the whole studio. Attributes are read once at
// connect; call `element.studio` for the live instance to change anything after.

import { createArStudio } from './index.js';

const BOOL = (v, fallback) => (v === null || v === undefined ? fallback : v !== 'false' && v !== '0');

export class ArStudioElement extends HTMLElement {
	static get observedAttributes() {
		return ['assets', 'title', 'accent', 'back-href', 'generate', 'rooms', 'room-server', 'origin', 'share-base'];
	}

	connectedCallback() {
		if (this.studio) return;
		// A custom element has no intrinsic size; without this the canvas mounts at
		// zero height and the studio looks like it failed to load.
		if (!this.style.display) this.style.display = 'block';
		if (!this.style.minHeight && !this.hasAttribute('embedded')) this.style.minHeight = '70vh';
		this.studio = createArStudio(this, this.options());
	}

	disconnectedCallback() {
		this.studio?.destroy();
		this.studio = null;
	}

	/** The config this element's attributes describe. */
	options() {
		const attr = (name) => this.getAttribute(name);
		const assets = attr('assets');
		return {
			...(assets ? { assets: assets.includes(',') ? assets.split(',').map((s) => s.trim()) : assets } : {}),
			...(attr('origin') ? { origin: attr('origin') } : {}),
			...(attr('share-base') ? { shareBaseUrl: attr('share-base') } : {}),
			branding: {
				title: attr('title') || 'AR Studio',
				accent: attr('accent') || undefined,
				backHref: attr('back-href') || null,
			},
			generate: { enabled: BOOL(attr('generate'), true) },
			rooms: {
				enabled: BOOL(attr('rooms'), true),
				...(attr('room-server') ? { server: attr('room-server') } : {}),
			},
			fullscreen: false,
		};
	}
}

/** Register `<ar-studio>`. Safe to call more than once. */
export function defineArStudio(tag = 'ar-studio') {
	if (typeof customElements === 'undefined') return;
	if (!customElements.get(tag)) customElements.define(tag, ArStudioElement);
}

export default defineArStudio;
