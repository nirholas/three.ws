import { AvaturnSDK } from '@avaturn/sdk';

/**
 * Avatar Creator — embeds the avatar customization iframe.
 * Currently uses Avaturn's hosted engine under the hood; swap the provider
 * here if you replace it with a self-hosted creator.
 * When the user exports an avatar, the GLB is loaded into the 3D viewer.
 */
export class AvatarCreator {
	/**
	 * @param {Element} containerEl - Parent element to mount the modal into
	 * @param {function(string): void} onExport - Called with the exported GLB URL
	 */
	constructor(containerEl, onExport) {
		this.container = containerEl;
		this.onExport = onExport;
		this.sdk = null;
		this.modal = null;
		this.iframeContainer = null;
	}

	/**
	 * Opens the avatar creator modal and initializes the creator SDK.
	 * @param {string} [sessionUrl] - Optional session URL from your backend (POST /sessions/new).
	 *                                 If omitted, uses the provider's default public editor.
	 */
	async open(sessionUrl) {
		if (this.modal) return;

		this._buildModal();

		try {
			this.sdk = new AvaturnSDK();

			const initOptions = {
				iframeClassName: 'avatar-creator-iframe',
			};

			if (sessionUrl) {
				initOptions.url = sessionUrl;
			}

			await this.sdk.init(this.iframeContainer, initOptions);

			this.sdk.on('export', (data) => {
				const glbUrl = typeof data === 'string' ? data : data?.url || data?.avatarUrl;
				if (glbUrl && this.onExport) {
					this.onExport(glbUrl);
				}
				this.close();
			});
		} catch (err) {
			console.error('[AvatarCreator] Failed to initialize creator SDK:', err);
			this._showError('Failed to load avatar creator. Please try again.');
		}
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
					<div class="avatar-creator-container"></div>
					<div class="avatar-creator-loading">
						<div class="spinner"></div>
						<span>Loading avatar creator...</span>
					</div>
				</div>
			</div>
		`;

		this.container.appendChild(this.modal);
		this.iframeContainer = this.modal.querySelector('.avatar-creator-container');

		this.modal.querySelector('.avatar-creator-close').addEventListener('click', () => this.close());

		this.modal.addEventListener('click', (e) => {
			if (e.target === this.modal) this.close();
		});

		document.addEventListener('keydown', this._onKeyDown = (e) => {
			if (e.key === 'Escape') this.close();
		});
	}

	_showError(message) {
		const loading = this.modal?.querySelector('.avatar-creator-loading');
		if (loading) {
			loading.innerHTML = `<span class="avatar-creator-error">${message}</span>`;
		}
	}

	close() {
		if (this.sdk) {
			try {
				this.sdk.destroy();
			} catch (_) {
				// SDK may already be disposed
			}
			this.sdk = null;
		}

		if (this._onKeyDown) {
			document.removeEventListener('keydown', this._onKeyDown);
			this._onKeyDown = null;
		}

		if (this.modal) {
			this.modal.remove();
			this.modal = null;
			this.iframeContainer = null;
		}
	}

	dispose() {
		this.close();
	}
}
