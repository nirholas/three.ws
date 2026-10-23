/**
 * Agent Wallet hub — shared, dependency-free UI utilities used by the shell and
 * every tab. No DOM framework, no third-party deps.
 */

import { shortAddress } from '../shared/address.js';

/** Escape a string for safe interpolation into innerHTML. */
export function escapeHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

/** Compact a base58 address: "AbCd…WxYz". */
export { shortAddress };

/**
 * Copy text to the clipboard. Uses the async Clipboard API with a synchronous
 * execCommand fallback for older / non-secure contexts. Resolves true on success.
 */
export async function copyToClipboard(text) {
	if (!text) return false;
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* fall through to legacy path */
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

let _toastEl = null;
let _toastTimer = null;
/** Show a transient toast message anchored to the bottom-center of the viewport. */
export function toast(message, ms = 2200) {
	if (typeof document === 'undefined') return;
	if (!_toastEl) {
		_toastEl = document.createElement('div');
		_toastEl.className = 'awh-toast';
		_toastEl.setAttribute('role', 'status');
		_toastEl.setAttribute('aria-live', 'polite');
		document.body.appendChild(_toastEl);
	}
	_toastEl.textContent = message;
	_toastEl.dataset.show = 'true';
	clearTimeout(_toastTimer);
	_toastTimer = setTimeout(() => {
		if (_toastEl) _toastEl.dataset.show = 'false';
	}, ms);
}

/** Format a SOL number for display. Returns "—" for nullish/non-finite input. */
export function formatSol(sol) {
	if (sol == null) return '—';
	const n = Number(sol);
	// Coerce first so non-numeric strings, NaN, and ±Infinity all degrade to "—"
	// instead of rendering the literal "NaN".
	if (!Number.isFinite(n)) return '—';
	// Trim to 4 dp but drop trailing zeros so "1.2000" reads "1.2".
	const fixed = n.toFixed(4);
	return fixed.replace(/\.?0+$/, '') || '0';
}

/** Format a USD estimate. Returns null when no price/balance is available. */
export function formatUsd(amount) {
	if (amount == null) return null;
	const n = Number(amount);
	// A non-finite estimate is "no estimate" — return null so callers hide it
	// rather than printing "$NaN".
	if (!Number.isFinite(n)) return null;
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2,
	}).format(n);
}

/** Human "x ago" from a unix-seconds timestamp. */
export function timeAgo(unixSeconds) {
	if (!unixSeconds) return '';
	const sec = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
	if (sec < 60) return `${sec}s ago`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
	if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
	return `${Math.floor(sec / 86400)}d ago`;
}

/** Explorer URL for a Solana address on the given network. */
export function explorerAddressUrl(address, network) {
	return network === 'devnet'
		? `https://explorer.solana.com/address/${address}?cluster=devnet`
		: `https://solscan.io/account/${address}`;
}

/** Explorer URL for a Solana transaction signature on the given network. */
export function explorerTxUrl(sig, network) {
	return network === 'devnet'
		? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
		: `https://solscan.io/tx/${sig}`;
}

// Plain-language explanation for a wallet whose stored key production cannot open
// (`signable: false` on GET /api/agents/:id/solana). Shared so the Portfolio and
// Withdraw tabs never tell the owner two different stories about the same balance.
// `key_retired` wallets were sealed by a non-production server under a key the
// production signer does not hold; docs/ops/stranded-wallets.md has the recovery path.
export function unsignableWalletCopy(reason) {
	if (reason === 'key_retired') {
		return 'Its signing key was sealed under an encryption key our production signer does not hold, so withdrawals and trades cannot be authorised yet. Your balance has not moved and is still on chain at this address. We are recovering access; do not create a replacement wallet, since a new wallet gets a new address.';
	}
	return 'The stored key for this address could not be read, so withdrawals and trades are paused. Nothing is attempted against a wallet we cannot authorise, and your balance has not moved.';
}
