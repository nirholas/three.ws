import vhtml from 'vhtml';
/** @jsx vhtml */

import { isUserRejection } from '../onchain/adapters/index.js';

/**
 * Show a blocking modal asking the caller to pay before a priced skill executes.
 *
 * @param {{
 *   skill: string,
 *   amount: string,
 *   currencySymbol: string,
 *   chain: string,
 *   onPay: (opts: { setStatus: (msg: string) => void }) => Promise<string>,
 *   onCancel?: () => void,
 * }} opts
 * @returns {Promise<string>} Resolves with intentId. Rejects with code=PAYMENT_CANCELLED on cancel.
 */
export function showPaymentGateModal({ skill, amount, currencySymbol, chain, onPay, onCancel }) {
	return new Promise((resolve, reject) => {
		const overlay = document.createElement('div');
		overlay.className = 'pgm-overlay';
		overlay.innerHTML = (
			<div class="pgm-modal" role="dialog" aria-modal="true" aria-label="Skill payment required">
				<h3>This skill requires payment</h3>
				<p class="pgm-price">
					<strong>{skill}</strong> costs{' '}
					<strong>
						{amount} {currencySymbol}
					</strong>
					{chain && <span class="pgm-chain"> on {chain}</span>}
				</p>
				<p class="pgm-status" role="status" aria-live="polite"></p>
				<div class="pgm-actions">
					<button class="pgm-cancel" type="button">
						Cancel
					</button>
					<button class="pgm-pay" type="button">
						Pay
					</button>
				</div>
			</div>
		);
		document.body.appendChild(overlay);

		const cancelBtn = overlay.querySelector('.pgm-cancel');
		const payBtn = overlay.querySelector('.pgm-pay');
		const statusEl = overlay.querySelector('.pgm-status');

		function close() {
			overlay.remove();
		}

		cancelBtn.addEventListener('click', () => {
			close();
			onCancel?.();
			reject(Object.assign(new Error('Payment cancelled'), { code: 'PAYMENT_CANCELLED' }));
		});

		payBtn.addEventListener('click', async () => {
			payBtn.disabled = true;
			cancelBtn.disabled = true;
			statusEl.textContent = 'Processing…';
			try {
				const intentId = await onPay({ setStatus: (msg) => { statusEl.textContent = msg; } });
				close();
				resolve(intentId);
			} catch (err) {
				if (isUserRejection(err)) {
					statusEl.textContent = 'Payment declined in wallet. You can try again.';
				} else {
					statusEl.textContent = err.message || 'Payment failed.';
				}
				payBtn.disabled = false;
				cancelBtn.disabled = false;
			}
		});
	});
}
