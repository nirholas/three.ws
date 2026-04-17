/**
 * RegeneratePanel — UI for avatar mesh/texture/rig regeneration.
 *
 * Usage:
 *   import { mountRegeneratePanel } from './regenerate-panel.js';
 *   const container = document.getElementById('regen-container');
 *   mountRegeneratePanel(container, {
 *     avatarId: 'uuid-...',
 *     onResult: (newAvatarId) => { ... }
 *   });
 *
 * Do NOT auto-mount. Caller controls where and when the panel appears.
 */

/**
 * Mount the regenerate panel into a DOM container.
 * @param {HTMLElement} container - Target container element
 * @param {Object} options
 * @param {string} options.avatarId - Avatar UUID to regenerate
 * @param {(resultId: string) => void} options.onResult - Callback on successful regen
 * @returns {Object} Control object with methods like .unmount()
 */
export function mountRegeneratePanel(container, { avatarId, onResult }) {
	const panel = new RegeneratePanel(container, { avatarId, onResult });
	panel.render();
	return panel;
}

class RegeneratePanel {
	constructor(container, { avatarId, onResult }) {
		this.container = container;
		this.avatarId = avatarId;
		this.onResult = onResult;
		this.state = {
			mode: 'remesh',
			params: '{}',
			inFlight: false,
			unconfigured: false,
			jobId: null,
			status: null,
			error: null,
		};
		this.pollTimer = null;
	}

	render() {
		this.container.innerHTML = '';
		this.container.style.padding = '16px';
		this.container.style.borderTop = '1px solid #ccc';
		this.container.style.marginTop = '16px';

		const wrapper = document.createElement('div');
		wrapper.innerHTML = `
			<h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600;">
				Regenerate Avatar
			</h3>
		`;
		this.container.appendChild(wrapper);

		// Render unconfigured banner if needed
		if (this.state.unconfigured) {
			this._renderUnconfiguredBanner();
			return;
		}

		// Mode select
		const modeLabel = document.createElement('label');
		modeLabel.style.display = 'block';
		modeLabel.style.marginBottom = '8px';
		modeLabel.style.fontSize = '12px';
		modeLabel.style.fontWeight = '500';
		modeLabel.textContent = 'Mode';
		this.container.appendChild(modeLabel);

		const modeSelect = document.createElement('select');
		modeSelect.value = this.state.mode;
		modeSelect.style.width = '100%';
		modeSelect.style.padding = '6px';
		modeSelect.style.marginBottom = '12px';
		modeSelect.style.borderRadius = '4px';
		modeSelect.style.border = '1px solid #ccc';
		modeSelect.innerHTML = `
			<option value="remesh">Re-mesh (regenerate topology)</option>
			<option value="retex">Re-texture (materials + textures)</option>
			<option value="rerig">Re-rig (skeleton binding)</option>
			<option value="restyle">Re-style (appearance from description)</option>
		`;
		modeSelect.addEventListener('change', (e) => {
			this.state.mode = e.target.value;
		});
		this.container.appendChild(modeSelect);

		// Params textarea
		const paramsLabel = document.createElement('label');
		paramsLabel.style.display = 'block';
		paramsLabel.style.marginBottom = '8px';
		paramsLabel.style.fontSize = '12px';
		paramsLabel.style.fontWeight = '500';
		paramsLabel.textContent = 'Parameters (JSON)';
		this.container.appendChild(paramsLabel);

		const paramsTextarea = document.createElement('textarea');
		paramsTextarea.value = this.state.params;
		paramsTextarea.style.width = '100%';
		paramsTextarea.style.height = '100px';
		paramsTextarea.style.padding = '6px';
		paramsTextarea.style.marginBottom = '12px';
		paramsTextarea.style.borderRadius = '4px';
		paramsTextarea.style.border = '1px solid #ccc';
		paramsTextarea.style.fontFamily = 'monospace';
		paramsTextarea.style.fontSize = '11px';
		paramsTextarea.addEventListener('change', (e) => {
			this.state.params = e.target.value;
		});
		this.container.appendChild(paramsTextarea);

		// Submit button
		const submitBtn = document.createElement('button');
		submitBtn.textContent = 'Start Regeneration';
		submitBtn.style.padding = '8px 16px';
		submitBtn.style.borderRadius = '4px';
		submitBtn.style.border = 'none';
		submitBtn.style.background = '#0066ff';
		submitBtn.style.color = 'white';
		submitBtn.style.cursor = this.state.inFlight ? 'not-allowed' : 'pointer';
		submitBtn.style.opacity = this.state.inFlight ? '0.6' : '1';
		submitBtn.disabled = this.state.inFlight;
		submitBtn.addEventListener('click', () => this._submit());
		this.container.appendChild(submitBtn);

		// Status / error display
		if (this.state.error) {
			const errorDiv = document.createElement('div');
			errorDiv.style.marginTop = '12px';
			errorDiv.style.padding = '8px';
			errorDiv.style.backgroundColor = '#fee';
			errorDiv.style.color = '#c00';
			errorDiv.style.borderRadius = '4px';
			errorDiv.style.fontSize = '12px';
			errorDiv.textContent = this.state.error;
			this.container.appendChild(errorDiv);
		}

		if (this.state.jobId) {
			const statusDiv = document.createElement('div');
			statusDiv.style.marginTop = '12px';
			statusDiv.style.padding = '8px';
			statusDiv.style.backgroundColor = '#eef';
			statusDiv.style.color = '#006';
			statusDiv.style.borderRadius = '4px';
			statusDiv.style.fontSize = '12px';
			statusDiv.innerHTML = `
				<strong>Job:</strong> ${this.state.jobId}<br/>
				<strong>Status:</strong> ${this.state.status || 'pending'}
			`;
			this.container.appendChild(statusDiv);
		}
	}

	_renderUnconfiguredBanner() {
		const banner = document.createElement('div');
		banner.style.padding = '12px';
		banner.style.backgroundColor = '#fef3cd';
		banner.style.border = '1px solid #ffeaa7';
		banner.style.borderRadius = '4px';
		banner.style.fontSize = '13px';
		banner.style.color = '#856404';
		banner.innerHTML = `
			<strong>Avatar regeneration is not yet live.</strong>
			Join the waitlist: <a href="mailto:hello@3dagent.ai" style="color: #0066ff;">hello@3dagent.ai</a><br/>
			<small style="display: block; margin-top: 6px;">
				ML backend integration is in progress. We'll notify you when it's ready.
			</small>
		`;
		this.container.appendChild(banner);
	}

	async _submit() {
		if (this.state.inFlight) return;

		// Validate JSON
		let params;
		try {
			params = JSON.parse(this.state.params);
		} catch (e) {
			this.state.error = `Invalid JSON in params: ${e.message}`;
			this.render();
			return;
		}

		this.state.inFlight = true;
		this.state.error = null;
		this.render();

		try {
			const resp = await fetch('/api/avatars/regenerate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					sourceAvatarId: this.avatarId,
					mode: this.state.mode,
					params,
				}),
			});

			if (!resp.ok) {
				const body = await resp.json();

				// Handle 501 unconfigured case
				if (resp.status === 501 && body.error === 'regen_unconfigured') {
					this.state.unconfigured = true;
					this.state.inFlight = false;
					this.render();
					return;
				}

				throw new Error(body.error_description || `HTTP ${resp.status}`);
			}

			const body = await resp.json();
			this.state.jobId = body.jobId;
			this.state.status = body.status;
			this.state.inFlight = false;
			this.render();

			// Start polling for completion
			this._startPolling();
		} catch (err) {
			this.state.error = err.message;
			this.state.inFlight = false;
			this.render();
		}
	}

	_startPolling() {
		this.pollTimer = setInterval(async () => {
			try {
				const resp = await fetch(
					`/api/avatars/regenerate-status?jobId=${this.state.jobId}`,
					{
						credentials: 'include',
					},
				);

				if (!resp.ok) {
					throw new Error(`HTTP ${resp.status}`);
				}

				const body = await resp.json();
				this.state.status = body.status;

				if (body.error) {
					this.state.error = body.error;
				}

				this.render();

				// Terminal state — stop polling
				if (body.status === 'done' || body.status === 'failed') {
					clearInterval(this.pollTimer);
					this.pollTimer = null;

					if (body.status === 'done' && body.resultAvatarId && this.onResult) {
						this.onResult(body.resultAvatarId);
					}
				}
			} catch (err) {
				this.state.error = err.message;
				this.render();
				clearInterval(this.pollTimer);
				this.pollTimer = null;
			}
		}, 3000);
	}

	unmount() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.container.innerHTML = '';
	}
}
