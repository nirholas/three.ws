/**
 * Avatar Creator — embeds the self-hosted CharacterStudio builder in a modal,
 * or an Avaturn edit session when `open(sessionUrl)` is called with a URL.
 *
 * CharacterStudio runs in an iframe and communicates via postMessage. When the
 * user clicks "Save Avatar", CharacterStudio posts a `characterstudio:export`
 * message carrying the GLB as a transferred ArrayBuffer, which we convert to a
 * Blob and hand to `onExport`.
 *
 * Avaturn is also loaded in an iframe. It posts an export event with a URL to
 * the GLB rather than transferring bytes directly; we fetch it then hand the
 * resulting Blob to `onExport`.
 *
 * The class API is identical to the previous RPM implementation so callers
 * (src/app.js, src/account.js) don't need to change.
 */

function getStudioUrl() {
	try {
		if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CHARACTER_STUDIO_URL) {
			return String(import.meta.env.VITE_CHARACTER_STUDIO_URL)
				.trim()
				.replace(/\/$/, '');
		}
	} catch (_) {}
	return 'http://localhost:5173';
}

function getAvaturnEditorUrl() {
	let base = 'https://editor.avaturn.me/';
	let devId = '';
	try {
		if (typeof import.meta !== 'undefined' && import.meta.env) {
			if (import.meta.env.VITE_AVATURN_EDITOR_URL) {
				base = String(import.meta.env.VITE_AVATURN_EDITOR_URL).trim();
			}
			if (import.meta.env.VITE_AVATURN_DEVELOPER_ID) {
				devId = String(import.meta.env.VITE_AVATURN_DEVELOPER_ID).trim();
			}
		}
	} catch (_) {}
	if (!devId) return base;
	const sep = base.includes('?') ? '&' : '?';
	return base + sep + 'developer=' + encodeURIComponent(devId);
}

export class AvatarCreator {
	/**
	 * @param {Element} containerEl - Parent element to mount the modal into
	 * @param {function(Blob): void} onExport - Called with the exported GLB Blob
	 * @param {object} [opts]
	 * @param {string} [opts.studioUrl] - Override the CharacterStudio URL
	 */
	constructor(containerEl, onExport, opts = {}) {
		this.container = containerEl;
		this.onExport = onExport;
		this.studioUrl = opts.studioUrl || getStudioUrl();

		this.modal = null;
		this.iframe = null;
		this._onMessage = null;
		this._onKeyDown = null;
		this._avaturnMode = false;
		this._avaturnOrigin = null;
	}

	/**
	 * Opens the avatar creator modal.
	 * @param {string} [sessionUrl] - When provided, opens Avaturn in edit mode instead of CharacterStudio.
	 */
	async open(sessionUrl) {
		if (this.modal) return;
		this._avaturnMode = !!sessionUrl;
		this._buildModal();
		this._onMessage = (event) => this._handleMessage(event);
		window.addEventListener('message', this._onMessage);
		if (sessionUrl) {
			// @avaturn/sdk is not installed — use raw iframe.
			// If you install @avaturn/sdk, replace this with: new AvaturnSDK({ ... })
			console.info(
				'[AvatarCreator] opening Avaturn session (raw iframe — no SDK):',
				sessionUrl,
			);
			try {
				this._avaturnOrigin = new URL(sessionUrl).origin;
			} catch (_) {}
			this.iframe.src = sessionUrl;
		} else {
			this.iframe.src = this.studioUrl;
		}
	}

	/**
	 * Opens the Avaturn default hosted editor — no session API, no selfies required.
	 * User edits a ready-made avatar and exports a GLB. Export event is handled by
	 * the same `_handleAvaturnMessage` pipeline as the session-based flow.
	 */
	async openDefaultEditor() {
		if (this.modal) return;
		const editorUrl = getAvaturnEditorUrl();
		this._avaturnMode = true;
		try {
			this._avaturnOrigin = new URL(editorUrl).origin;
		} catch (_) {
			this._avaturnOrigin = null;
		}
		this._buildModal();
		this._onMessage = (event) => this._handleMessage(event);
		window.addEventListener('message', this._onMessage);
		console.info('[AvatarCreator] opening Avaturn default editor:', editorUrl);
		this.iframe.src = editorUrl;
	}

	_handleMessage(event) {
		if (this._avaturnMode) {
			this._handleAvaturnMessage(event);
		} else {
			this._handleCharacterStudioMessage(event);
		}
	}

	_handleCharacterStudioMessage(event) {
		try {
			const csOrigin = new URL(this.studioUrl).origin;
			if (event.origin !== csOrigin) return;
		} catch (_) {
			return;
		}

		const msg = event.data;
		if (!msg || msg.source !== 'characterstudio' || msg.type !== 'export') return;
		if (!(msg.glb instanceof ArrayBuffer)) return;

		const blob = new Blob([msg.glb], { type: 'model/gltf-binary' });
		this._fireExport(blob);
	}

	async _handleAvaturnMessage(event) {
		if (!this._avaturnOrigin || event.origin !== this._avaturnOrigin) return;

		const msg = event.data;
		if (!msg) return;

		// Avaturn may post: { type:'export', detail:{url} } or { avaturnEvent:'export', data:{url} }
		let glbUrl = null;
		if (msg.type === 'export') {
			glbUrl = msg.detail?.url || msg.data?.url || null;
		} else if (msg.avaturnEvent === 'export') {
			glbUrl = msg.data?.url || null;
		}
		if (!glbUrl) return;

		try {
			const resp = await fetch(glbUrl);
			if (!resp.ok) throw new Error(`GLB fetch failed: ${resp.status}`);
			const blob = await resp.blob();
			const glbBlob = blob.type
				? blob
				: new Blob([await blob.arrayBuffer()], { type: 'model/gltf-binary' });
			this._fireExport(glbBlob);
		} catch (err) {
			console.error('[AvatarCreator] failed to fetch Avaturn GLB:', err);
		}
	}

	_fireExport(blob) {
		if (this.onExport) {
			try {
				this.onExport(blob);
			} catch (err) {
				console.error('[AvatarCreator] onExport handler threw:', err);
			}
		}
		this.close();
	}

	_buildModal() {
		const title = this._avaturnMode ? 'Edit Your Avatar' : 'Create Your Avatar';
		this.modal = document.createElement('div');
		this.modal.className = 'avatar-creator-overlay';

		this.modal.innerHTML = `
			<div class="avatar-creator-modal">
				<div class="avatar-creator-header">
					<span class="avatar-creator-title">${title}</span>
					<button class="avatar-creator-close" aria-label="Close">&times;</button>
				</div>
				<div class="avatar-creator-body">
					<div class="avatar-creator-container">
						<iframe
							class="avatar-creator-iframe"
							title="Avatar Creator"
							allow="camera *; microphone *; clipboard-write"
							sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
						></iframe>
					</div>
					<div class="avatar-creator-loading">
						<div class="spinner"></div>
						<span>Loading avatar creator...</span>
					</div>
				</div>
			</div>
		`;

		this.container.appendChild(this.modal);
		this.iframe = this.modal.querySelector('.avatar-creator-iframe');

		// Hide the loading spinner once the iframe fires its load event.
		this.iframe.addEventListener('load', () => {
			const loading = this.modal?.querySelector('.avatar-creator-loading');
			if (loading) loading.style.display = 'none';
		});

		this.modal
			.querySelector('.avatar-creator-close')
			.addEventListener('click', () => this.close());
		this.modal.addEventListener('click', (e) => {
			if (e.target === this.modal) this.close();
		});

		this._onKeyDown = (e) => {
			if (e.key === 'Escape') this.close();
		};
		document.addEventListener('keydown', this._onKeyDown);
	}

	close() {
		if (this._onMessage) {
			window.removeEventListener('message', this._onMessage);
			this._onMessage = null;
		}
		if (this._onKeyDown) {
			document.removeEventListener('keydown', this._onKeyDown);
			this._onKeyDown = null;
		}
		if (this.modal) {
			this.modal.remove();
			this.modal = null;
			this.iframe = null;
		}
		this._avaturnMode = false;
		this._avaturnOrigin = null;
	}

	dispose() {
		this.close();
	}
}
