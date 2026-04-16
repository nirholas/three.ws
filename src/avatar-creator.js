/**
 * Avatar Creator — embeds the self-hosted CharacterStudio builder in a modal.
 *
 * CharacterStudio runs in an iframe and communicates via postMessage. When the
 * user clicks "Save Avatar", CharacterStudio posts a `characterstudio:export`
 * message carrying the GLB as a transferred ArrayBuffer, which we convert to a
 * Blob and hand to `onExport`.
 *
 * The class API is identical to the previous RPM implementation so callers
 * (src/app.js, src/account.js) don't need to change.
 */

function getStudioUrl() {
	try {
		if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CHARACTER_STUDIO_URL) {
			return String(import.meta.env.VITE_CHARACTER_STUDIO_URL).trim().replace(/\/$/, '');
		}
	} catch (_) {}
	return 'http://localhost:5173';
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
	}

	/**
	 * Opens the avatar creator modal and mounts the CharacterStudio iframe.
	 */
	async open() {
		if (this.modal) return;
		this._buildModal();
		this._onMessage = (event) => this._handleMessage(event);
		window.addEventListener('message', this._onMessage);
		this.iframe.src = this.studioUrl;
	}

	_handleMessage(event) {
		// Only accept messages from the CharacterStudio origin.
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
		this.modal = document.createElement('div');
		this.modal.className = 'avatar-creator-overlay';

		this.modal.innerHTML = `
			<div class="avatar-creator-modal">
				<div class="avatar-creator-header">
					<span class="avatar-creator-title">Create Your Avatar</span>
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

		this.modal.querySelector('.avatar-creator-close').addEventListener('click', () => this.close());
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
	}

	dispose() {
		this.close();
	}
}
