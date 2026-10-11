// Pay-per-use for Forge High — the client flow that lets a non-holder pay $THREE
// for one High generation instead of holding. Drives the server-authoritative
// quote → sign → settle rail (src/token-pay.js → /api/token/quote|settle) behind
// a designed status modal, then hands the settled { paymentId, refId } back so the
// caller can retry the generation with the proof attached.
//
// One entry point:
//
//   import { payForHighGeneration } from './forge-pay.js';
//   const r = await payForHighGeneration({ usd: 0.5 });
//   if (r.ok) run({ ...cfg, payment: { paymentId: r.paymentId, refId: r.refId } });
//
// Every state is designed: the confirm step, the live phases (pricing → approve →
// confirming → verifying), and the recoverable errors — no wallet, sign-in needed,
// payment cancelled, not enough $THREE (→ Get $THREE), and settlement failure
// (Retry). The modal never throws; it resolves { ok:false } on cancel/error and
// { ok:true, paymentId, refId } on a verified on-chain payment.

import { payWithToken } from '../token-pay.js';
import { leaveAppForPayment } from '../shared/native-handoff.js';

const ECONOMY_URL = '/three-token';
const SIGN_IN_URL = '/login';
const WALLET_URL = 'https://phantom.app/';

let _stylesInjected = false;

function escapeHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

// A fresh client nonce per payment — recorded as token_payments.ref_id at quote
// time and presented again (with the payment_id) when the action redeems it, so
// possession of the payment_id alone can't unlock a dispatch. The prefix names the
// action (e.g. `forge-high`, `forge-gameready`) for readable ledger/audit rows.
function clientNonce(prefix = 'forge') {
	const id =
		(typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
		`${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return `${prefix}-${id}`;
}

function usdLabel(usd) {
	return `$${(Number(usd) || 0).toFixed(2)}`;
}

// Map a payWithToken phase to holder-readable status copy.
const PHASE_COPY = {
	quoting: 'Pricing in $THREE…',
	awaiting_signature: 'Approve the payment in your wallet…',
	confirming: 'Confirming on Solana…',
	settling: 'Verifying your payment…',
};

// Classify a thrown error into a designed, recoverable state. Returns
// { title, detail, cta } where cta is { label, href } | { label, retry:true } | null.
function classifyError(err) {
	const code = err?.code || '';
	const msg = String(err?.message || '');

	if (code === 'no_wallet' || code === 'not_connected' || code === 'no_pubkey') {
		return {
			title: 'No Solana wallet',
			detail: 'Connect a Solana wallet (Phantom) to pay in $THREE, then try again.',
			cta: { label: 'Get Phantom', href: WALLET_URL, external: true },
		};
	}
	if (code === 'unauthorized') {
		return {
			title: 'Sign in to pay',
			detail: 'Sign in to three.ws first so we can issue your $THREE payment quote.',
			cta: { label: 'Sign in', href: SIGN_IN_URL },
		};
	}
	if (/reject|denied|cancel|declin|user.*reject/i.test(msg)) {
		return {
			title: 'Payment cancelled',
			detail: 'You dismissed the wallet request — no $THREE was spent.',
			cta: { label: 'Try again', retry: true },
		};
	}
	if (
		code === 'insufficient_funds' ||
		/insufficient|0x1\b|not enough|debit|exceeds.*balance/i.test(msg)
	) {
		return {
			title: 'Not enough $THREE',
			detail: "Your wallet doesn't hold enough $THREE for this generation.",
			cta: { label: 'Get $THREE', href: ECONOMY_URL },
		};
	}
	if (code === 'price_unavailable') {
		return {
			title: 'Price feed unavailable',
			detail: 'We couldn’t price $THREE just now. Try again in a moment.',
			cta: { label: 'Try again', retry: true },
		};
	}
	if (code === 'already_settled') {
		return {
			title: 'Already paid',
			detail: 'This payment already settled — retry your generation.',
			cta: { label: 'Try again', retry: true },
		};
	}
	if (code === 'quote_expired') {
		return {
			title: 'Quote expired',
			detail: 'That price quote timed out before the payment confirmed. Try again — no $THREE was spent.',
			cta: { label: 'Try again', retry: true },
		};
	}
	// The server fails closed on a transient back-end gap (treasury/rewards routing
	// not ready, generation lane down) with a typed, safe-to-show code. Recognize
	// that family so the user sees an honest, reassuring retry state. A genuinely
	// unexpected fault (code 'internal_error') falls through to the generic branch
	// below, which keeps the support ref the user can quote.
	if (
		code === 'service_unavailable' ||
		code === 'treasury_unavailable' ||
		code === 'rewards_unavailable' ||
		code === 'allowance_unavailable' ||
		code === 'generation_unavailable'
	) {
		return {
			title: 'Payments briefly unavailable',
			detail: 'The $THREE payment rail is catching its breath. Try again in a moment — no $THREE was spent.',
			cta: { label: 'Try again', retry: true },
		};
	}
	// Settlement / verification or any other transient failure.
	return {
		title: 'Payment didn’t go through',
		detail:
			msg && msg.length < 160
				? msg
				: 'Something interrupted the payment. Try again — no $THREE is spent unless it settles.',
		cta: { label: 'Try again', retry: true },
	};
}

/**
 * Run the pay-per-use flow for one Forge consumption action (High generation,
 * Game-Ready export, …). Drives the same server-authoritative quote → sign →
 * settle rail behind the designed status modal, then hands back the settled
 * { paymentId, refId } so the caller can retry the action with the proof attached.
 * @param {object} params
 * @param {number} params.usd            price in USD (settled in $THREE)
 * @param {string} [params.unit]         short unit shown under the price ("one export")
 * @param {string} [params.confirm]      one-line confirm-step description
 * @param {string} [params.footnote]     trusted footnote markup under the actions
 * @param {string} [params.successText]  copy shown on a verified payment
 * @param {string} [params.refPrefix]    client-nonce prefix (action name)
 * @returns {Promise<{ ok: true, paymentId: string, refId: string } | { ok: false, cancelled?: boolean }>}
 */
export function payForConsumption({
	usd,
	unit = 'one generation',
	confirm = 'One generation, paid in $THREE.',
	footnote = '$THREE is the only coin on three.ws.',
	successText = 'Payment confirmed — continuing…',
	refPrefix = 'forge',
} = {}) {
	if (leaveAppForPayment()) return Promise.resolve({ ok: false, cancelled: true });
	injectStyles();
	return new Promise((resolve) => {
		const refId = clientNonce(refPrefix);
		let settled = false;

		const overlay = document.createElement('div');
		overlay.className = 'fpay-overlay';
		overlay.innerHTML = renderShell(usd, { unit, footnote });
		document.body.appendChild(overlay);

		const modal = overlay.querySelector('.fpay-modal');
		const statusEl = overlay.querySelector('.fpay-status');
		const actionsEl = overlay.querySelector('.fpay-actions');

		const cleanup = () => {
			if (overlay._onKey) document.removeEventListener('keydown', overlay._onKey);
			overlay.classList.remove('fpay-in');
			const remove = () => overlay.remove();
			overlay.addEventListener('transitionend', remove, { once: true });
			setTimeout(remove, 260);
		};
		const finish = (result) => {
			if (overlay._done) return;
			overlay._done = true;
			cleanup();
			resolve(result);
		};
		const close = () => finish({ ok: false, cancelled: true });

		// ── State renderers ────────────────────────────────────────────────────
		function showStatus(text, { busy = false } = {}) {
			statusEl.className = 'fpay-status' + (busy ? ' fpay-status--busy' : '');
			statusEl.innerHTML = busy
				? `<span class="fpay-spinner" aria-hidden="true"></span><span>${escapeHtml(text)}</span>`
				: escapeHtml(text);
		}

		function showConfirm() {
			showStatus(confirm);
			actionsEl.innerHTML =
				`<button type="button" class="fpay-btn fpay-btn--primary" data-fpay-pay>Pay ${usdLabel(usd)}</button>` +
				`<button type="button" class="fpay-btn fpay-btn--ghost" data-fpay-cancel>Cancel</button>`;
			actionsEl.querySelector('[data-fpay-pay]').addEventListener('click', startPayment);
			actionsEl.querySelector('[data-fpay-cancel]').addEventListener('click', close);
			actionsEl.querySelector('[data-fpay-pay]').focus();
		}

		function showError(err) {
			const info = classifyError(err);
			statusEl.className = 'fpay-status fpay-status--err';
			statusEl.innerHTML =
				`<strong class="fpay-err-title">${escapeHtml(info.title)}</strong>` +
				`<span class="fpay-err-detail">${escapeHtml(info.detail)}</span>`;
			const buttons = [];
			if (info.cta?.href) {
				const ext = info.cta.external ? ' target="_blank" rel="noopener"' : '';
				buttons.push(
					`<a class="fpay-btn fpay-btn--primary" href="${escapeHtml(info.cta.href)}"${ext}>${escapeHtml(info.cta.label)}</a>`,
				);
			}
			if (info.cta?.retry) {
				buttons.push(
					`<button type="button" class="fpay-btn fpay-btn--primary" data-fpay-retry>${escapeHtml(info.cta.label)}</button>`,
				);
			}
			buttons.push(
				`<button type="button" class="fpay-btn fpay-btn--ghost" data-fpay-cancel>Close</button>`,
			);
			actionsEl.innerHTML = buttons.join('');
			actionsEl.querySelector('[data-fpay-retry]')?.addEventListener('click', startPayment);
			actionsEl.querySelector('[data-fpay-cancel]').addEventListener('click', close);
		}

		async function startPayment() {
			actionsEl.innerHTML = '';
			showStatus(PHASE_COPY.quoting, { busy: true });
			try {
				const result = await payWithToken({
					purpose: 'consumption',
					usd,
					refType: 'forge',
					refId,
					onStatus: (phase) =>
						showStatus(PHASE_COPY[phase] || 'Working…', { busy: true }),
				});
				if (!result?.ok || !result.payment_id) {
					throw Object.assign(new Error('Payment could not be verified.'), {
						code: 'verification_failed',
					});
				}
				settled = true;
				statusEl.className = 'fpay-status fpay-status--ok';
				statusEl.innerHTML = `<span class="fpay-check" aria-hidden="true">✓</span> ${escapeHtml(successText)}`;
				actionsEl.innerHTML = '';
				setTimeout(() => finish({ ok: true, paymentId: result.payment_id, refId }), 850);
			} catch (err) {
				if (settled) return; // already resolved
				showError(err);
			}
		}

		// ── Mount ────────────────────────────────────────────────────────────────
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) close();
		});
		overlay.querySelector('[data-fpay-x]').addEventListener('click', close);
		const onKey = (e) => {
			if (e.key === 'Escape') close();
		};
		overlay._onKey = onKey;
		document.addEventListener('keydown', onKey);
		requestAnimationFrame(() => {
			overlay.classList.add('fpay-in');
			(modal || overlay).focus?.();
		});
		showConfirm();
	});
}

/**
 * Pay-per-use for one Forge High generation — the original entry point, preserved
 * exactly. A thin wrapper over payForConsumption with the High copy/nonce.
 * @param {{ usd: number }} params
 * @returns {Promise<{ ok: true, paymentId: string, refId: string } | { ok: false, cancelled?: boolean }>}
 */
export function payForHighGeneration({ usd }) {
	return payForConsumption({
		usd,
		unit: 'one High generation',
		confirm: 'One High-quality generation (200k poly + PBR), paid in $THREE.',
		footnote: '$THREE is the only coin on three.ws. Draft &amp; Standard generation stay free.',
		successText: 'Payment confirmed — starting your generation…',
		refPrefix: 'forge-high',
	});
}

function renderShell(usd, { unit = 'one generation', footnote = '$THREE is the only coin on three.ws.' } = {}) {
	return (
		`<div class="fpay-modal" role="dialog" aria-modal="true" aria-labelledby="fpay-title">` +
		`<button class="fpay-x" data-fpay-x type="button" aria-label="Close">✕</button>` +
		`<div class="fpay-badge" aria-hidden="true">◆</div>` +
		`<h2 class="fpay-title" id="fpay-title">Pay ${usdLabel(usd)} in $THREE</h2>` +
		`<div class="fpay-price"><span class="fpay-price-amt">${usdLabel(usd)}</span><span class="fpay-price-unit">in $THREE · ${escapeHtml(unit)}</span></div>` +
		`<div class="fpay-status" role="status" aria-live="polite"></div>` +
		`<div class="fpay-actions"></div>` +
		`<p class="fpay-foot">${footnote}</p>` +
		`</div>`
	);
}

function injectStyles() {
	if (_stylesInjected || typeof document === 'undefined') return;
	_stylesInjected = true;
	const css = `
	.fpay-overlay{position:fixed;inset:0;z-index:2147483100;display:flex;align-items:center;justify-content:center;
		padding:20px;background:rgba(4,4,7,.66);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);
		opacity:0;transition:opacity .2s ease;font-family:Inter,system-ui,sans-serif;}
	.fpay-overlay.fpay-in{opacity:1;}
	.fpay-modal{position:relative;width:min(420px,100%);background:linear-gradient(180deg,#0e0e13,#0a0a0e);
		border:1px solid #23232c;border-radius:20px;padding:30px 28px 22px;text-align:center;color:#f6f6f8;
		box-shadow:0 30px 80px -30px rgba(0,0,0,.8);transform:translateY(10px) scale(.985);
		transition:transform .24s cubic-bezier(.22,1,.36,1);}
	.fpay-overlay.fpay-in .fpay-modal{transform:none;}
	.fpay-x{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:9px;border:1px solid #23232c;
		background:transparent;color:#9a9aa4;cursor:pointer;font-size:13px;transition:.15s;}
	.fpay-x:hover{color:#f6f6f8;border-color:#34343f;}
	.fpay-badge{font-size:30px;color:#6ee7a8;filter:drop-shadow(0 0 14px rgba(110,231,168,.5));margin-bottom:6px;}
	.fpay-title{font-size:20px;font-weight:820;letter-spacing:-.02em;margin:2px 0 12px;}
	.fpay-price{display:flex;flex-direction:column;align-items:center;gap:2px;margin:0 0 16px;padding:13px;
		background:rgba(110,231,168,.07);border:1px solid rgba(110,231,168,.2);border-radius:12px;}
	.fpay-price-amt{font-size:26px;font-weight:800;color:#6ee7a8;line-height:1;}
	.fpay-price-unit{font-size:12px;color:#9a9aa4;}
	.fpay-status{font-size:13.5px;color:#b6b6c0;line-height:1.5;min-height:20px;margin:0 0 16px;
		display:flex;align-items:center;justify-content:center;gap:9px;flex-wrap:wrap;}
	.fpay-status--busy{color:#d6d6de;}
	.fpay-status--ok{color:#6ee7a8;font-weight:600;}
	.fpay-status--err{flex-direction:column;gap:3px;}
	.fpay-err-title{font-size:14px;font-weight:700;color:#f0c2c2;}
	.fpay-err-detail{font-size:12.5px;color:#a6a6b0;}
	.fpay-check{color:#6ee7a8;font-weight:800;}
	.fpay-spinner{width:15px;height:15px;border-radius:50%;border:2px solid rgba(110,231,168,.25);
		border-top-color:#6ee7a8;animation:fpay-spin .7s linear infinite;flex-shrink:0;}
	.fpay-actions{display:flex;flex-direction:column;gap:9px;min-height:1px;}
	.fpay-btn{display:inline-flex;align-items:center;justify-content:center;font:700 14px/1 Inter,system-ui,sans-serif;
		padding:12px 18px;border-radius:12px;text-decoration:none;cursor:pointer;border:1px solid #2a2a33;
		background:#13131a;color:#f1f1f4;transition:transform .15s cubic-bezier(.22,1,.36,1),background .15s ease,border-color .15s ease;}
	.fpay-btn--primary{background:#6ee7a8;color:#06120c;border-color:#6ee7a8;}
	.fpay-btn--primary:hover{background:#8af0c0;transform:translateY(-1px);}
	.fpay-btn--ghost:hover{border-color:#3a3a44;background:#181820;transform:translateY(-1px);}
	.fpay-foot{font-size:11px;color:#6a6a74;margin:16px 0 0;line-height:1.5;}
	.fpay-btn:focus-visible,.fpay-x:focus-visible{outline:2px solid #6ee7a8;outline-offset:2px;}
	@keyframes fpay-spin{to{transform:rotate(360deg)}}
	@media (prefers-reduced-motion: reduce){
		.fpay-overlay,.fpay-modal,.fpay-btn{transition:none;}
		.fpay-modal{transform:none;}
		.fpay-spinner{animation-duration:1.4s;}
	}`;
	const el = document.createElement('style');
	el.id = 'fpay-styles';
	el.textContent = css;
	document.head.appendChild(el);
}
