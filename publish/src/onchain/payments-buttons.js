/**
 * Payments UI components.
 *
 *  • EnablePaymentsButton — owner-only. Becomes enabled once the agent has a
 *    launched token. One click registers the agent for payments. Then
 *    rehydrates as a "Payments enabled" chip on subsequent renders.
 *
 *  • PayAgentButton — anyone signed in. Visible only when the agent has
 *    payments configured. Opens an inline modal for amount + currency mint,
 *    then walks the user through their wallet to pay.
 */

import { getPaymentsAdapter } from './payments/index.js';
import { isUserRejection } from './adapters/index.js';

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function _esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ── Owner-side: enable payments ─────────────────────────────────────────────

export class EnablePaymentsButton {
	constructor({ agent, container }) {
		this._agent = agent;
		this._container = container;
		this._adapter = getPaymentsAdapter('pumpfun');
		this._root = null;
	}

	mount() {
		this._root = document.createElement('div');
		this._root.className = 'enable-payments-root';
		this._container.appendChild(this._root);
		this._render();
	}

	unmount() {
		this._root?.remove();
		this._root = null;
	}

	_render() {
		if (!this._root) return;
		const payments = this._agent.payments || this._agent.meta?.payments;
		if (payments?.configured) return this._renderChip(payments);

		if (!(this._agent.token?.mint || this._agent.meta?.token?.mint)) {
			return this._renderDisabled('Launch the agent token before enabling payments.');
		}

		this._renderEnableButton();
	}

	_renderEnableButton() {
		this._root.innerHTML = `
			<button class="enable-payments-btn" title="Register this agent to accept payments">
				&#x1F4B3; Enable payments
			</button>
		`;
		this._root.querySelector('.enable-payments-btn').addEventListener('click', () => this._enable());
	}

	_renderDisabled(reason) {
		this._root.innerHTML = `
			<button class="enable-payments-btn enable-payments-btn--disabled" disabled title="${_esc(reason)}">
				&#x1F4B3; Enable payments
			</button>
			<span class="enable-payments-tooltip">${_esc(reason)}</span>
		`;
	}

	_renderChip(_payments) {
		this._root.innerHTML = `
			<span class="enable-payments-chip">
				&#x2705; Payments enabled
			</span>
		`;
	}

	_renderProgress(step) {
		const labels = {
			connect: 'Connecting wallet…',
			prep: 'Preparing…',
			sign: 'Sign in your wallet…',
			submit: 'Submitting…',
			confirm: 'Saving…',
		};
		this._root.innerHTML = `
			<div class="enable-payments-progress" role="status" aria-live="polite">
				${_esc(labels[step] || step)}
			</div>
		`;
	}

	_renderError(msg) {
		this._root.innerHTML = `
			<div class="enable-payments-error" role="alert">
				<span>${_esc(msg)}</span>
				<button class="enable-payments-retry">Try again</button>
			</div>
		`;
		this._root.querySelector('.enable-payments-retry').addEventListener('click', () => this._render());
	}

	async _enable() {
		try {
			const result = await this._adapter.enableForAgent({
				agent: this._agent,
				onProgress: (step) => this._renderProgress(step),
			});
			this._agent.payments = result.payments;
			this._renderChip(result.payments);
		} catch (err) {
			if (isUserRejection(err)) return this._render();
			this._renderError(err.message || 'Could not enable payments.');
		}
	}
}

// ── Payer-side: pay an agent ────────────────────────────────────────────────

export class PayAgentButton {
	constructor({ agent, container }) {
		this._agent = agent;
		this._container = container;
		this._adapter = getPaymentsAdapter('pumpfun');
		this._root = null;
	}

	mount() {
		this._root = document.createElement('div');
		this._root.className = 'pay-agent-root';
		this._container.appendChild(this._root);
		this._render();
	}

	unmount() {
		this._root?.remove();
		this._root = null;
	}

	_render() {
		if (!this._root) return;
		const payments = this._agent.payments || this._agent.meta?.payments;
		if (!payments?.configured) {
			this._root.innerHTML = '';
			return;
		}
		this._root.innerHTML = `
			<button class="pay-agent-btn" title="Pay this agent">
				&#x1F4B0; Pay agent
			</button>
		`;
		this._root.querySelector('.pay-agent-btn').addEventListener('click', () => this._openModal());
	}

	_renderProgress(step) {
		const labels = {
			connect: 'Connecting wallet…',
			prep: 'Building payment…',
			sign: 'Sign in your wallet…',
			submit: 'Submitting payment…',
			confirm: 'Verifying…',
		};
		this._root.innerHTML = `
			<div class="pay-agent-progress" role="status" aria-live="polite">
				${_esc(labels[step] || step)}
			</div>
		`;
	}

	_renderSuccess(intent) {
		this._root.innerHTML = `
			<span class="pay-agent-success">&#x2705; Paid &middot; <a href="https://solscan.io/tx/${_esc(intent.txSignature)}" target="_blank" rel="noopener noreferrer">view tx</a></span>
		`;
	}

	_renderError(msg) {
		this._root.innerHTML = `
			<div class="pay-agent-error" role="alert">
				<span>${_esc(msg)}</span>
				<button class="pay-agent-retry">Try again</button>
			</div>
		`;
		this._root.querySelector('.pay-agent-retry').addEventListener('click', () => this._render());
	}

	_openModal() {
		const cluster =
			this._agent.payments?.cluster || this._agent.meta?.payments?.cluster || 'mainnet';
		const defaultUsdc = cluster === 'devnet' ? USDC_DEVNET : USDC_MAINNET;

		const overlay = document.createElement('div');
		overlay.className = 'pay-agent-modal-overlay';
		overlay.innerHTML = `
			<div class="pay-agent-modal" role="dialog" aria-label="Pay agent">
				<h3>Pay ${_esc(this._agent.name || 'agent')}</h3>
				<p>Send a payment to this agent's Pump.fun payment account. The agent will be able to acknowledge and use the funds.</p>
				<form class="pay-agent-form">
					<label>Currency mint
						<input name="currency_mint" required value="${_esc(defaultUsdc)}" />
						<small>Default: USDC ${_esc(cluster)}</small>
					</label>
					<label>Amount (raw token units)
						<input name="amount" type="text" required pattern="[0-9]+" value="1000000" />
						<small>1 USDC = 1000000 (6 decimals)</small>
					</label>
					<div class="pay-agent-modal-actions">
						<button type="button" class="pay-agent-cancel">Cancel</button>
						<button type="submit" class="pay-agent-submit">Pay</button>
					</div>
				</form>
			</div>
		`;
		document.body.appendChild(overlay);

		const close = () => overlay.remove();
		overlay.querySelector('.pay-agent-cancel').addEventListener('click', close);
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) close();
		});

		overlay.querySelector('.pay-agent-form').addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const fd = new FormData(ev.target);
			const params = {
				currencyMint: String(fd.get('currency_mint') || '').trim(),
				amount: String(fd.get('amount') || '').trim(),
			};
			close();
			await this._pay(params);
		});
	}

	async _pay({ currencyMint, amount }) {
		try {
			const result = await this._adapter.payAgent({
				agent: this._agent,
				currencyMint,
				amount,
				onProgress: (step) => this._renderProgress(step),
			});
			this._renderSuccess(result);
		} catch (err) {
			if (isUserRejection(err)) return this._render();
			this._renderError(err.message || 'Payment failed.');
		}
	}
}
