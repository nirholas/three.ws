// three.ws Persona Hub — embeddable sign-in widget.
//
// Usage on any tenant page:
//
//   <script src="https://three.ws/persona/widget.js" defer></script>
//   <three-ws-signin
//       client-origin="https://coolgame.three.ws"
//       label="Sign in with three.ws">
//   </three-ws-signin>
//
//   document.querySelector('three-ws-signin').addEventListener('three-ws:authorized', (e) => {
//       const { token, avatar } = e.detail;
//       // token is a 24h JWT — verify server-side via /api/auth/persona/verify
//       // avatar is { id, url, thumbnail_url, name }
//   });
//
// The widget renders a three.ws-branded button. On click it opens a popup to
// /persona/authorize, listens for postMessage from the popup, and dispatches
// the result as a CustomEvent the embedder can subscribe to.

(function () {
	if (typeof window === 'undefined' || window.customElements?.get('three-ws-signin')) return;

	const PERSONA_ORIGIN_ATTR = 'persona-origin';
	const CLIENT_ORIGIN_ATTR = 'client-origin';
	const LABEL_ATTR = 'label';
	const DEFAULT_PERSONA_ORIGIN = 'https://three.ws';
	const POPUP_W = 460;
	const POPUP_H = 640;

	function randomState() {
		const arr = new Uint8Array(16);
		(globalThis.crypto || window.crypto).getRandomValues(arr);
		return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
	}

	class ThreeWsSignin extends HTMLElement {
		static get observedAttributes() {
			return [LABEL_ATTR];
		}

		constructor() {
			super();
			this._popup = null;
			this._state = null;
			this._onMessage = null;
			this._pollTimer = null;
		}

		connectedCallback() {
			const shadow = this.attachShadow({ mode: 'open' });
			const label = this.getAttribute(LABEL_ATTR) || 'Sign in with three.ws';
			shadow.innerHTML = `
				<style>
					:host { display: inline-block; font-family: inherit; }
					button {
						display: inline-flex;
						align-items: center;
						gap: 8px;
						padding: 9px 16px;
						background: #15171c;
						color: #f2f3f5;
						border: 1px solid #26282f;
						border-radius: 8px;
						font: 600 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
						cursor: pointer;
						transition: border-color 120ms, background 120ms;
					}
					button:hover { border-color: #6aa6ff; background: #1a1d23; }
					button:focus-visible { outline: 2px solid #6aa6ff; outline-offset: 2px; }
					button:disabled { opacity: 0.6; cursor: progress; }
					.dot {
						width: 7px; height: 7px;
						border-radius: 50%;
						background: linear-gradient(135deg, #6aa6ff, #b06aff);
						box-shadow: 0 0 8px rgba(106, 166, 255, 0.6);
					}
				</style>
				<button type="button" part="button">
					<span class="dot" aria-hidden="true"></span>
					<span class="label">${label}</span>
				</button>
			`;
			shadow.querySelector('button').addEventListener('click', () => this.open());
		}

		attributeChangedCallback(name, _old, value) {
			if (name === LABEL_ATTR && this.shadowRoot) {
				const span = this.shadowRoot.querySelector('.label');
				if (span) span.textContent = value || 'Sign in with three.ws';
			}
		}

		disconnectedCallback() {
			this._teardown();
		}

		open() {
			if (this._popup && !this._popup.closed) {
				this._popup.focus();
				return;
			}

			const personaOrigin = (this.getAttribute(PERSONA_ORIGIN_ATTR) || DEFAULT_PERSONA_ORIGIN).replace(/\/$/, '');
			const clientOrigin = this.getAttribute(CLIENT_ORIGIN_ATTR) || location.origin;
			this._state = randomState();

			const url = `${personaOrigin}/persona/authorize.html?tenant=${encodeURIComponent(clientOrigin)}&state=${encodeURIComponent(this._state)}`;

			const left = Math.round((window.outerWidth - POPUP_W) / 2 + (window.screenX || 0));
			const top = Math.round((window.outerHeight - POPUP_H) / 2 + (window.screenY || 0));
			this._popup = window.open(
				url,
				'three-ws-persona',
				`width=${POPUP_W},height=${POPUP_H},left=${left},top=${top},resizable=yes,scrollbars=yes`,
			);
			if (!this._popup) {
				this._emit('error', { code: 'popup_blocked', message: 'popup window was blocked by the browser' });
				return;
			}

			const button = this.shadowRoot.querySelector('button');
			if (button) button.disabled = true;

			this._onMessage = (event) => {
				if (event.origin !== personaOrigin) return;
				const data = event.data;
				if (!data || data.source !== 'three-ws-persona' || data.state !== this._state) return;

				if (data.event === 'authorized') {
					this._emit('authorized', { token: data.token, avatar: data.avatar, expires_in: data.expires_in });
				} else if (data.event === 'cancelled') {
					this._emit('cancelled', {});
				}
				this._teardown();
			};

			window.addEventListener('message', this._onMessage);

			this._pollTimer = setInterval(() => {
				if (this._popup && this._popup.closed) {
					this._emit('cancelled', { code: 'popup_closed' });
					this._teardown();
				}
			}, 500);
		}

		_emit(name, detail) {
			this.dispatchEvent(new CustomEvent(`three-ws:${name}`, { detail, bubbles: true, composed: true }));
		}

		_teardown() {
			if (this._onMessage) {
				window.removeEventListener('message', this._onMessage);
				this._onMessage = null;
			}
			if (this._pollTimer) {
				clearInterval(this._pollTimer);
				this._pollTimer = null;
			}
			this._popup = null;
			const button = this.shadowRoot?.querySelector('button');
			if (button) button.disabled = false;
		}
	}

	window.customElements.define('three-ws-signin', ThreeWsSignin);

	// Programmatic API for callers that don't want a custom element.
	window.ThreeWsPersona = {
		signIn({ clientOrigin = location.origin, personaOrigin = DEFAULT_PERSONA_ORIGIN } = {}) {
			return new Promise((resolve, reject) => {
				const tmp = document.createElement('three-ws-signin');
				tmp.style.display = 'none';
				if (personaOrigin) tmp.setAttribute(PERSONA_ORIGIN_ATTR, personaOrigin);
				tmp.setAttribute(CLIENT_ORIGIN_ATTR, clientOrigin);
				document.body.appendChild(tmp);
				tmp.addEventListener('three-ws:authorized', (e) => {
					tmp.remove();
					resolve(e.detail);
				});
				tmp.addEventListener('three-ws:cancelled', (e) => {
					tmp.remove();
					reject(Object.assign(new Error('cancelled'), { detail: e.detail }));
				});
				tmp.addEventListener('three-ws:error', (e) => {
					tmp.remove();
					reject(Object.assign(new Error(e.detail.message || 'persona error'), { detail: e.detail }));
				});
				tmp.open();
			});
		},
	};
})();
