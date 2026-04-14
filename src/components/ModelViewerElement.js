import { Viewer } from '../viewer.js';
import { LinearToneMapping, ACESFilmicToneMapping } from 'three';

const STYLE_ID = 'mv-viewer-style';
const DEFAULT_ENVIRONMENT = 'Neutral';

const TONE_MAPPING = {
	aces: ACESFilmicToneMapping,
	linear: LinearToneMapping,
};

function injectStylesOnce() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
		mv-viewer { display: block; position: relative; width: 100%; height: 480px; background: #191919; overflow: hidden; }
		mv-viewer .mv-viewer__stage { position: absolute; inset: 0; }
		mv-viewer .mv-viewer__poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity .3s ease; cursor: pointer; }
		mv-viewer .mv-viewer__poster[data-hidden] { opacity: 0; pointer-events: none; }
	`;
	document.head.appendChild(style);
}

export class ModelViewerElement extends HTMLElement {
	static get observedAttributes() {
		return [
			'src',
			'environment',
			'exposure',
			'tone-mapping',
			'background-color',
			'auto-rotate',
			'camera-controls',
			'reveal',
			'poster',
			'disable-zoom',
			'disable-pan',
		];
	}

	constructor() {
		super();
		this._viewer = null;
		this._stageEl = null;
		this._posterEl = null;
		this._pendingSrc = null;
		this._loadedSrc = null;
		this._revealed = false;
		this._onControlsChange = null;
	}

	connectedCallback() {
		if (this._viewer) return;
		injectStylesOnce();

		this._stageEl = document.createElement('div');
		this._stageEl.className = 'mv-viewer__stage';
		this.appendChild(this._stageEl);

		const reveal = this.getAttribute('reveal') || 'auto';
		const posterSrc = this.getAttribute('poster');
		if (posterSrc) {
			this._posterEl = document.createElement('img');
			this._posterEl.className = 'mv-viewer__poster';
			this._posterEl.src = posterSrc;
			this._posterEl.alt = this.getAttribute('alt') || '';
			this.appendChild(this._posterEl);
		}

		const envName = this.getAttribute('environment') || DEFAULT_ENVIRONMENT;
		const options = {
			kiosk: false,
			preset: '',
			cameraPosition: null,
			// The Viewer reads options.preset/cameraPosition/kiosk in the constructor;
			// everything else flows through state and methods after construction.
		};

		this._viewer = new Viewer(this._stageEl, options);
		this._viewer.state.environment = envName;

		// Initial attribute sync (before first load, invalidate for the env + lighting updates).
		this._applyAttribute('exposure');
		this._applyAttribute('tone-mapping');
		this._applyAttribute('background-color');
		this._applyAttribute('auto-rotate');
		this._applyAttribute('camera-controls');
		this._applyAttribute('disable-zoom');
		this._applyAttribute('disable-pan');
		this._viewer.updateEnvironment();
		this._viewer.updateLights();
		this._viewer.updateBackground();

		this._onControlsChange = () => {
			this.dispatchEvent(new CustomEvent('camera-change', { bubbles: true, composed: true }));
		};
		this._viewer.controls.addEventListener('change', this._onControlsChange);

		const src = this.getAttribute('src');
		if (src) {
			if (reveal === 'interaction') {
				this._pendingSrc = src;
				const trigger = () => {
					this.removeEventListener('click', trigger);
					this.removeEventListener('pointerenter', trigger);
					this._loadSrc(this._pendingSrc);
				};
				this.addEventListener('click', trigger, { once: true });
				this.addEventListener('pointerenter', trigger, { once: true });
			} else {
				this._loadSrc(src);
			}
		}
	}

	disconnectedCallback() {
		if (!this._viewer) return;
		if (this._onControlsChange && this._viewer.controls) {
			this._viewer.controls.removeEventListener('change', this._onControlsChange);
		}
		if (typeof this._viewer.dispose === 'function') {
			this._viewer.dispose();
		} else {
			console.warn('[mv-viewer] Viewer.dispose() not available — disconnect will leak resources.');
		}
		this._viewer = null;
		this._stageEl = null;
		this._posterEl = null;
		this._onControlsChange = null;
		this.replaceChildren();
	}

	attributeChangedCallback(name, oldVal, newVal) {
		if (!this._viewer) return; // Applied at connectedCallback.
		if (oldVal === newVal) return;
		this._applyAttribute(name, newVal);
	}

	_applyAttribute(name, newVal) {
		const viewer = this._viewer;
		if (!viewer) return;
		if (newVal === undefined) newVal = this.getAttribute(name);

		switch (name) {
			case 'src': {
				if (this._pendingSrc !== null) {
					this._pendingSrc = newVal;
					return;
				}
				if (newVal) this._loadSrc(newVal);
				return;
			}
			case 'environment': {
				viewer.state.environment = newVal || DEFAULT_ENVIRONMENT;
				viewer.updateEnvironment();
				return;
			}
			case 'exposure': {
				const v = Number(newVal);
				if (!Number.isFinite(v)) return;
				// viewer.state.exposure is an EV offset (see updateLights); accept either a multiplier or an EV value.
				// For attribute sugar, treat as a linear multiplier and convert to log2 EV.
				viewer.state.exposure = v > 0 ? Math.log2(v) : 0;
				viewer.updateLights();
				return;
			}
			case 'tone-mapping': {
				const mapped = TONE_MAPPING[(newVal || 'aces').toLowerCase()];
				if (mapped === undefined) return;
				viewer.state.toneMapping = mapped;
				viewer.updateLights();
				return;
			}
			case 'background-color': {
				if (!newVal) return;
				viewer.state.bgColor = newVal;
				viewer.updateBackground();
				return;
			}
			case 'auto-rotate': {
				viewer.state.autoRotate = this.hasAttribute('auto-rotate');
				viewer.updateDisplay();
				return;
			}
			case 'camera-controls': {
				// Default on; only off when explicitly set to "false".
				const enabled = newVal === null || newVal === '' || newVal === 'true';
				viewer.controls.enabled = enabled;
				viewer.invalidate();
				return;
			}
			case 'disable-zoom': {
				viewer.controls.enableZoom = !this.hasAttribute('disable-zoom');
				viewer.invalidate();
				return;
			}
			case 'disable-pan': {
				viewer.controls.enablePan = !this.hasAttribute('disable-pan');
				viewer.invalidate();
				return;
			}
			case 'reveal':
			case 'poster':
				// Only applied at connect time.
				return;
		}
	}

	_loadSrc(src) {
		const viewer = this._viewer;
		if (!viewer) return;
		this._pendingSrc = null;

		if (this._loadedSrc) viewer.clear();
		this._loadedSrc = src;

		viewer
			.load(src, '', new Map())
			.then(() => {
				this._hidePoster();
				this.dispatchEvent(
					new CustomEvent('load', { bubbles: true, composed: true, detail: { src } }),
				);
			})
			.catch((error) => {
				this.dispatchEvent(
					new CustomEvent('error', {
						bubbles: true,
						composed: true,
						detail: { error, src },
					}),
				);
			});
	}

	_hidePoster() {
		if (!this._posterEl) return;
		this._posterEl.setAttribute('data-hidden', '');
		// Remove from DOM after fade so it stops capturing pointer events.
		setTimeout(() => this._posterEl?.remove(), 400);
	}

	get viewer() {
		return this._viewer;
	}
}

if (typeof customElements !== 'undefined' && !customElements.get('mv-viewer')) {
	customElements.define('mv-viewer', ModelViewerElement);
}
