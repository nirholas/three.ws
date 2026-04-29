/**
 * VanityWalletButton — provisions a custodial Solana wallet for the agent
 * with a user-chosen vanity prefix. Owner-only.
 *
 *   • If the agent already has a custodial wallet → renders an address chip.
 *   • Otherwise renders "Create vanity wallet". Click opens a modal with a
 *     prefix input, live difficulty estimate, and grind progress.
 *   • Reads agent.meta.solana_address (and the existing legacy field paths)
 *     to detect whether a wallet is already provisioned.
 */

import {
	provisionVanityForAgent,
	validatePattern,
	estimateAttempts,
	formatTimeEstimate,
} from './vanity/index.js';

const RATE_PER_CORE = 5000;

function _esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[c]);
}

function _coreCount() {
	if (typeof navigator === 'undefined') return 4;
	return Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
}

export class VanityWalletButton {
	constructor({ agent, container }) {
		this._agent = agent;
		this._container = container;
		this._root = null;
		this._abort = null;
	}

	mount() {
		this._root = document.createElement('div');
		this._root.className = 'vanity-wallet-root';
		this._container.appendChild(this._root);
		this._render();
	}

	unmount() {
		try {
			this._abort?.abort();
		} catch {
			/* ignore */
		}
		this._root?.remove();
		this._root = null;
	}

	_currentAddress() {
		// Prefer the new top-level field; fall back to legacy meta paths.
		return (
			this._agent.solana_address ||
			this._agent.meta?.solana_address ||
			this._agent.meta?.solana?.address ||
			null
		);
	}

	_render() {
		if (!this._root) return;
		const addr = this._currentAddress();
		if (addr) return this._renderChip(addr);
		this._renderCreateButton();
	}

	_renderCreateButton() {
		this._root.innerHTML = `
			<button class="vanity-wallet-btn" title="Create a custodial Solana wallet for this agent with a chosen prefix">
				&#x2728; Create vanity wallet
			</button>
		`;
		this._root.querySelector('.vanity-wallet-btn').addEventListener('click', () => this._openModal());
	}

	_renderChip(addr) {
		const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
		this._root.innerHTML = `
			<a class="vanity-wallet-chip" href="https://solscan.io/account/${_esc(addr)}" target="_blank" rel="noopener noreferrer"
			   aria-label="View agent wallet on Solscan">
				&#x1F4BC; ${_esc(short)} &middot; agent wallet
			</a>
		`;
	}

	_renderProgress({ attempts, rate, eta }) {
		this._root.innerHTML = `
			<div class="vanity-wallet-progress" role="status" aria-live="polite">
				<span>Grinding… ${attempts.toLocaleString()} attempts</span>
				<span>${rate.toLocaleString()} k/s</span>
				<span>~${_esc(eta)} remaining</span>
				<button class="vanity-wallet-cancel">Cancel</button>
			</div>
		`;
		this._root.querySelector('.vanity-wallet-cancel').addEventListener('click', () => {
			try {
				this._abort?.abort();
			} catch {
				/* ignore */
			}
		});
	}

	_renderError(msg) {
		this._root.innerHTML = `
			<div class="vanity-wallet-error" role="alert">
				<span>${_esc(msg)}</span>
				<button class="vanity-wallet-retry">Try again</button>
			</div>
		`;
		this._root.querySelector('.vanity-wallet-retry').addEventListener('click', () => this._render());
	}

	_openModal() {
		const overlay = document.createElement('div');
		overlay.className = 'vanity-wallet-modal-overlay';
		overlay.innerHTML = `
			<div class="vanity-wallet-modal" role="dialog" aria-label="Create vanity wallet">
				<h3>Create vanity wallet for ${_esc(this._agent.name || 'agent')}</h3>
				<p>Generate a Solana keypair whose address starts with a chosen prefix. The secret key is encrypted server-side and never leaves the server after provisioning.</p>
				<form class="vanity-wallet-form">
					<label>Prefix (1–6 base58 chars)
						<input name="prefix" maxlength="6" required value="AGNT" pattern="[1-9A-HJ-NP-Za-km-z]+" />
					</label>
					<label>
						<input type="checkbox" name="ignore_case" />
						Ignore case (faster)
					</label>
					<div class="vanity-wallet-estimate" aria-live="polite"></div>
					<div class="vanity-wallet-modal-actions">
						<button type="button" class="vanity-wallet-cancel-btn">Cancel</button>
						<button type="submit" class="vanity-wallet-grind-btn">Grind &amp; provision</button>
					</div>
				</form>
			</div>
		`;
		document.body.appendChild(overlay);

		const close = () => overlay.remove();
		overlay.querySelector('.vanity-wallet-cancel-btn').addEventListener('click', close);
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) close();
		});

		const prefixInput = overlay.querySelector('input[name="prefix"]');
		const ignoreCaseInput = overlay.querySelector('input[name="ignore_case"]');
		const estEl = overlay.querySelector('.vanity-wallet-estimate');
		const submitBtn = overlay.querySelector('.vanity-wallet-grind-btn');

		const refreshEstimate = () => {
			const prefix = prefixInput.value.trim();
			if (!prefix) {
				estEl.textContent = '';
				submitBtn.disabled = true;
				return;
			}
			const v = validatePattern(prefix);
			if (!v.valid) {
				estEl.textContent = v.errors.join('; ');
				submitBtn.disabled = true;
				return;
			}
			const ignoreCase = ignoreCaseInput.checked;
			const effective = ignoreCase ? prefix.length * 0.85 : prefix.length;
			const expected = estimateAttempts(effective);
			const seconds = expected / (RATE_PER_CORE * _coreCount());
			estEl.innerHTML = `~${expected.toLocaleString()} attempts &middot; <strong>${_esc(formatTimeEstimate(seconds))}</strong> on ${_coreCount()} cores`;
			submitBtn.disabled = false;
		};
		prefixInput.addEventListener('input', refreshEstimate);
		ignoreCaseInput.addEventListener('change', refreshEstimate);
		refreshEstimate();

		overlay.querySelector('.vanity-wallet-form').addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const prefix = prefixInput.value.trim();
			const ignoreCase = ignoreCaseInput.checked;
			close();
			await this._provision({ prefix, ignoreCase });
		});
	}

	async _provision({ prefix, ignoreCase }) {
		this._abort = new AbortController();
		try {
			const result = await provisionVanityForAgent({
				agentId: this._agent.id,
				prefix,
				ignoreCase,
				signal: this._abort.signal,
				onProgress: (p) => this._renderProgress(p),
			});
			this._agent.solana_address = result.address;
			this._renderChip(result.address);
		} catch (err) {
			if (err?.name === 'AbortError') return this._render();
			this._renderError(err.message || 'Provisioning failed.');
		} finally {
			this._abort = null;
		}
	}
}
