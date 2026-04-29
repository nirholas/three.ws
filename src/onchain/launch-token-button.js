/**
 * LaunchTokenButton — UI for launching an agent's Pump.fun token.
 *
 * Mounting contract:
 *   const btn = new LaunchTokenButton({ agent, container });
 *   btn.mount();
 *
 * Visibility:
 *   • If agent already has a launched token → renders a chip linking to it.
 *   • If agent isn't deployed on Solana → renders disabled with tooltip.
 *   • Otherwise → renders the launch button.
 */

import { getTokenAdapter } from './tokens/index.js';
import { isUserRejection } from './adapters/index.js';

function _esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export class LaunchTokenButton {
	/**
	 * @param {object} opts
	 * @param {object} opts.agent
	 * @param {HTMLElement} opts.container
	 * @param {string} [opts.provider]   Defaults to 'pumpfun'.
	 */
	constructor({ agent, container, provider = 'pumpfun' }) {
		this._agent = agent;
		this._container = container;
		this._provider = provider;
		this._adapter = getTokenAdapter(provider);
		this._root = null;
	}

	mount() {
		this._root = document.createElement('div');
		this._root.className = 'launch-token-root';
		this._container.appendChild(this._root);
		this._render();
	}

	unmount() {
		this._root?.remove();
		this._root = null;
	}

	_render() {
		if (!this._root) return;
		const token = this._agent.token || this._agent.meta?.token;
		if (token?.mint) return this._renderChip(token);

		const pre = this._adapter.validatePreconditions({ agent: this._agent });
		if (!pre.ok) return this._renderDisabled(pre.reason);

		this._renderLaunchButton();
	}

	_renderLaunchButton() {
		this._root.innerHTML = `
			<button class="launch-token-btn" title="Launch this agent's token on Pump.fun">
				&#x1F680; Launch token
			</button>
		`;
		this._root.querySelector('.launch-token-btn').addEventListener('click', () => this._openModal());
	}

	_renderDisabled(reason) {
		this._root.innerHTML = `
			<button class="launch-token-btn launch-token-btn--disabled" disabled title="${_esc(reason)}">
				&#x1F680; Launch token
			</button>
			<span class="launch-token-tooltip">${_esc(reason)}</span>
		`;
	}

	_renderChip(token) {
		const url = token.pumpfun_url || token.explorer_url || '#';
		this._root.innerHTML = `
			<a class="launch-token-chip" href="${_esc(url)}" target="_blank" rel="noopener noreferrer"
			   aria-label="View ${_esc(token.symbol)} on Pump.fun">
				&#x1F680; $${_esc(token.symbol)} &middot; view on ${_esc(token.cluster === 'devnet' ? 'explorer' : 'pump.fun')}
			</a>
		`;
	}

	_renderProgress(step) {
		const labels = {
			connect: 'Connecting wallet…',
			prep: 'Preparing launch…',
			sign: 'Sign in your wallet…',
			submit: 'Submitting on-chain…',
			confirm: 'Saving…',
		};
		this._root.innerHTML = `
			<div class="launch-token-progress" role="status" aria-live="polite">
				${_esc(labels[step] || step)}
			</div>
		`;
	}

	_renderError(msg) {
		this._root.innerHTML = `
			<div class="launch-token-error" role="alert">
				<span>${_esc(msg)}</span>
				<button class="launch-token-retry">Try again</button>
			</div>
		`;
		this._root.querySelector('.launch-token-retry').addEventListener('click', () => this._render());
	}

	_openModal() {
		// Inline lightweight modal — keeps this component self-contained.
		const overlay = document.createElement('div');
		overlay.className = 'launch-token-modal-overlay';
		overlay.innerHTML = `
			<div class="launch-token-modal" role="dialog" aria-label="Launch agent token">
				<h3>Launch \$${_esc(this._agent.name || 'AGENT')}</h3>
				<p>Mint a token tied to this agent on Pump.fun's bonding curve. The token's metadata will point to your agent.</p>
				<form class="launch-token-form">
					<label>Name <input name="name" maxlength="32" required value="${_esc(this._agent.name || '')}"></label>
					<label>Symbol (ticker) <input name="symbol" maxlength="10" required pattern="[A-Za-z0-9]{2,10}" value="${_esc((this._agent.name || 'AGT').slice(0, 6).toUpperCase())}"></label>
					<label>Description <textarea name="description" maxlength="280">${_esc(this._agent.description || '')}</textarea></label>
					<label>Initial buy (SOL, optional)
						<input name="initial_buy" type="number" min="0" max="50" step="0.01" value="0">
					</label>
					<div class="launch-token-modal-actions">
						<button type="button" class="launch-token-cancel">Cancel</button>
						<button type="submit" class="launch-token-submit">Launch</button>
					</div>
				</form>
			</div>
		`;
		document.body.appendChild(overlay);

		const close = () => overlay.remove();
		overlay.querySelector('.launch-token-cancel').addEventListener('click', close);
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) close();
		});

		overlay.querySelector('.launch-token-form').addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const fd = new FormData(ev.target);
			const params = {
				name: String(fd.get('name') || '').trim(),
				symbol: String(fd.get('symbol') || '')
					.trim()
					.toUpperCase(),
				description: String(fd.get('description') || '').trim(),
				image: this._agent.thumbnailUrl || this._agent.avatar?.thumbnailUrl || '',
				initialBuySol: Number(fd.get('initial_buy') || 0),
			};
			close();
			await this._launch(params);
		});
	}

	async _launch(params) {
		try {
			const result = await this._adapter.launch({
				agent: this._agent,
				params,
				onProgress: (step) => this._renderProgress(step),
			});
			this._agent.token = {
				provider: result.provider,
				mint: result.mint,
				symbol: params.symbol,
				name: params.name,
				cluster: result.cluster,
				pumpfun_url: result.pumpfunUrl,
			};
			this._renderChip(this._agent.token);
		} catch (err) {
			if (isUserRejection(err)) return this._render();
			if (err.code === 'NO_PROVIDER') {
				this._renderError(`${err.message} Install at ${err.installUrl}`);
				return;
			}
			this._renderError(err.message || 'Token launch failed.');
		}
	}
}
