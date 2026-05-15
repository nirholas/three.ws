import { AvaturnSDK } from '@avaturn/sdk';

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

function getReadyPlayerMeSubdomain() {
	try {
		if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RPM_SUBDOMAIN) {
			return String(import.meta.env.VITE_RPM_SUBDOMAIN)
				.trim()
				.replace(/^https?:\/\//, '')
				.replace(/\.readyplayer\.me.*$/, '');
		}
	} catch (_) {}
	return 'demo';
}

// RPM iframe posts JSON-stringified payloads; older builds and some hosts have
// posted raw objects too. Accept both shapes.
function parseRpmEvent(data) {
	if (typeof data === 'string') {
		try { return JSON.parse(data); } catch { return null; }
	}
	if (data && typeof data === 'object') return data;
	return null;
}

export class AvatarCreator {
	/**
	 * @param {Element} containerEl - Parent element to mount the modal into
	 * @param {function(Blob, {provider:string, sourceUrl?:string|null}): void} onExport - Called with the exported GLB Blob and provenance
	 * @param {object} [opts]
	 * @param {string} [opts.studioUrl] - Override the CharacterStudio URL
	 * @param {string} [opts.rpmSubdomain] - Override the Ready Player Me subdomain
	 */
	constructor(containerEl, onExport, opts = {}) {
		this.container = containerEl;
		this.onExport = onExport;
		this.studioUrl = opts.studioUrl || getStudioUrl();
		this.rpmSubdomain = opts.rpmSubdomain || getReadyPlayerMeSubdomain();

		this.modal = null;
		this.iframe = null;
		this.sdk = null;
		this._onMessage = null;
		this._onKeyDown = null;
		this._provider = null;
	}

	/**
	 * Opens the avatar creator modal.
	 * @param {string} [sessionUrl] - When provided, opens Avaturn SDK in edit mode.
	 *                                When omitted, opens CharacterStudio.
	 */
	async open(sessionUrl) {
		if (this.modal) return;
		if (sessionUrl) {
			this._provider = 'avaturn';
			await this._openAvaturn(sessionUrl);
		} else {
			this._provider = 'characterstudio';
			this._buildModal(true);
			this._onMessage = (e) => this._handleCharacterStudioMessage(e);
			window.addEventListener('message', this._onMessage);
			this.iframe.src = this.studioUrl;
		}
	}

	/**
	 * Opens the Avaturn default hosted editor via the Avaturn SDK.
	 * No URL passed → SDK uses its own default public editor (no developer ID needed).
	 */
	async openDefaultEditor() {
		if (this.modal) return;
		this._provider = 'avaturn';
		await this._openAvaturn();
	}

	/**
	 * Opens the Ready Player Me avatar creator in an iframe.
	 * Uses the Frame API: subscribes to v1 events and captures the GLB URL on export.
	 * Subdomain comes from VITE_RPM_SUBDOMAIN, defaulting to "demo".
	 *
	 * @param {object} [opts]
	 * @param {('halfbody'|'fullbody')} [opts.bodyType] - 'fullbody' (default) or 'halfbody'
	 * @param {boolean} [opts.clearCache] - clear stored RPM session (default true)
	 * @param {boolean} [opts.quickStart] - skip account creation prompts (default false)
	 */
	async openReadyPlayerMe(opts = {}) {
		if (this.modal) return;
		this._provider = 'readyplayer';
		this._buildModal(true);

		const bodyType = opts.bodyType || 'fullbody';
		const clearCache = opts.clearCache !== false;
		const quickStart = !!opts.quickStart;
		const params = new URLSearchParams({
			frameApi: '',
			bodyType,
			...(clearCache && { clearCache: 'true' }),
			...(quickStart && { quickStart: 'true' }),
		});
		const url = `https://${this.rpmSubdomain}.readyplayer.me/avatar?${params.toString()}`;

		this._onMessage = (e) => this._handleReadyPlayerMessage(e);
		window.addEventListener('message', this._onMessage);
		this.iframe.src = url;
	}

	_handleReadyPlayerMessage(event) {
		const json = parseRpmEvent(event.data);
		if (!json || json.source !== 'readyplayerme') return;

		if (json.eventName === 'v1.frame.ready') {
			try {
				this.iframe?.contentWindow?.postMessage(
					JSON.stringify({
						target: 'readyplayerme',
						type: 'subscribe',
						eventName: 'v1.**',
					}),
					'*',
				);
			} catch (err) {
				console.error('[AvatarCreator] RPM subscribe failed:', err);
			}
			const loading = this.modal?.querySelector('.avatar-creator-loading');
			if (loading) loading.style.display = 'none';
			return;
		}

		if (json.eventName === 'v1.avatar.exported') {
			const glbUrl = json.data?.url;
			if (!glbUrl) return;
			(async () => {
				try {
					const res = await fetch(glbUrl);
					if (!res.ok) throw new Error(`RPM GLB fetch failed: ${res.status}`);
					const blob = await res.blob();
					const glbBlob = blob.type
						? blob
						: new Blob([await blob.arrayBuffer()], { type: 'model/gltf-binary' });
					this._fireExport(glbBlob, { sourceUrl: glbUrl });
				} catch (err) {
					console.error('[AvatarCreator] failed to fetch RPM GLB:', err);
					this._showError('Failed to download the avatar. Please try again.');
				}
			})();
		}
	}

	async _openAvaturn(url) {
		this._buildModal(false);
		try {
			this.sdk = new AvaturnSDK();
			await this.sdk.init(this.modal.querySelector('.avatar-creator-container'), {
				iframeClassName: 'avatar-creator-iframe',
				url,
			});

			const loading = this.modal?.querySelector('.avatar-creator-loading');
			if (loading) loading.style.display = 'none';

			this.sdk.on('export', async (data) => {
				const glbUrl = data?.url;
				if (!glbUrl) return;
				try {
					let blob;
					if (data.urlType === 'dataURL') {
						const res = await fetch(glbUrl);
						blob = await res.blob();
					} else {
						const res = await fetch(glbUrl);
						if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);
						blob = await res.blob();
					}
					const glbBlob = blob.type
						? blob
						: new Blob([await blob.arrayBuffer()], { type: 'model/gltf-binary' });
					this._fireExport(glbBlob, { sourceUrl: data.urlType === 'dataURL' ? null : glbUrl });
				} catch (err) {
					console.error('[AvatarCreator] failed to fetch Avaturn GLB:', err);
				}
			});
		} catch (err) {
			console.error('[AvatarCreator] Failed to initialize Avaturn SDK:', err);
			this._showError('Failed to load avatar creator. Please try again.');
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

	_fireExport(blob, meta = {}) {
		if (this.onExport) {
			try {
				this.onExport(blob, { provider: this._provider, ...meta });
			} catch (err) {
				console.error('[AvatarCreator] onExport handler threw:', err);
			}
		}
		this.close();
	}

	_showError(message) {
		const loading = this.modal?.querySelector('.avatar-creator-loading');
		if (loading) {
			loading.innerHTML = `<span class="avatar-creator-error">${message}</span>`;
		}
	}

	/**
	 * @param {boolean} withIframe - true for CharacterStudio/RPM (needs a pre-rendered iframe),
	 *                               false for Avaturn SDK (SDK injects its own iframe).
	 */
	_buildModal(withIframe) {
		const title = withIframe ? 'Create Your Avatar' : 'Edit Your Avatar';
		this.modal = document.createElement('div');
		this.modal.className = 'avatar-creator-overlay';

		this.modal.innerHTML = `
			<div class="avatar-creator-modal">
				<div class="avatar-creator-header">
					<span class="avatar-creator-title">${title}</span>
					<button class="avatar-creator-close" aria-label="Close">&times;</button>
				</div>
				<div class="avatar-creator-body">
					<div class="avatar-creator-container">${
						withIframe
							? `<iframe
						class="avatar-creator-iframe"
						title="Avatar Creator"
						allow="camera *; microphone *; clipboard-write"
						sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
					></iframe>`
							: ''
					}</div>
					<div class="avatar-creator-loading">
						<div class="spinner"></div>
						<span>Loading avatar creator...</span>
					</div>
				</div>
			</div>
		`;

		this.container.appendChild(this.modal);

		if (withIframe) {
			this.iframe = this.modal.querySelector('.avatar-creator-iframe');
			this.iframe.addEventListener('load', () => {
				const loading = this.modal?.querySelector('.avatar-creator-loading');
				if (loading) loading.style.display = 'none';
			});
		}

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
		if (this.sdk) {
			try {
				this.sdk.destroy();
			} catch (_) {}
			this.sdk = null;
		}
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
