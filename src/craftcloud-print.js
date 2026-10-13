// "Get it printed": live prices from Craftcloud's (All3DP) ~186-shop print
// network for a Forge model, with no three.ws checkout in the way.
//
// This is deliberately not Materialize. Materialize is our own print pipeline
// (we take payment in USDC, screen, submit to a fulfillment adapter, ship a
// certificate). This panel uploads the model straight to Craftcloud, shows
// what every shop that can run the job would charge, and the buyer pays
// Craftcloud directly on Craftcloud's own site. three.ws never touches the
// money, which is also why there is no "continue to checkout" button here:
// Craftcloud's public API has no endpoint that hands a server-created cart
// back to a browser for payment (api/_lib/print/adapters/craftcloud.js), so
// the honest next step is the STL this panel already generated plus a link to
// Craftcloud's own upload page, where pasting the file reproduces the same
// prices in the buyer's own, checkout-capable session.

import { slicerModelUrl } from './slicer-handoff.js';

const log = (...args) => {
	if (typeof console !== 'undefined') console.debug('[craftcloud-print]', ...args);
};

function esc(s) {
	return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function money(n, currency) {
	if (!Number.isFinite(n)) return 'n/a';
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(n);
	} catch {
		return `${currency || '$'}${n.toFixed(2)}`;
	}
}

function injectStyles() {
	if (document.getElementById('ccp-styles')) return;
	const style = document.createElement('style');
	style.id = 'ccp-styles';
	style.textContent = `
		.ccp { display: flex; flex-direction: column; gap: var(--space-sm, 0.6rem); }
		.ccp-intro { margin: 0; font-size: var(--text-xs, 0.78rem); color: var(--ink-dim, #999); line-height: 1.5; }
		.ccp-btn {
			align-self: flex-start; display: inline-flex; align-items: center; gap: 0.45rem; cursor: pointer;
			background: var(--accent, #7c6cff); color: var(--bg-0, #0a0a0a); border: 1px solid var(--accent, #7c6cff);
			border-radius: var(--radius-md, 8px); padding: 0.5rem 0.9rem; font: inherit; font-size: var(--text-sm, 0.85rem); font-weight: 600;
			transition: opacity 0.15s ease, transform 0.15s ease;
		}
		.ccp-btn:hover { opacity: 0.9; }
		.ccp-btn:active { transform: translateY(1px); }
		.ccp-btn:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.ccp-btn:disabled { opacity: 0.6; cursor: progress; }
		.ccp-status { margin: 0; font-size: var(--text-xs, 0.78rem); color: var(--ink-dim, #999); display: flex; align-items: center; gap: 0.4rem; }
		.ccp-spinner {
			display: inline-block; width: 0.85em; height: 0.85em; border: 2px solid currentColor;
			border-right-color: transparent; border-radius: 50%; animation: ccp-spin 0.7s linear infinite; flex: none;
		}
		@keyframes ccp-spin { to { transform: rotate(360deg); } }
		.ccp-error { margin: 0; padding: 0.6rem 0.75rem; border-radius: var(--radius-md, 8px); border: 1px solid var(--danger, #ff6b6b); color: var(--danger, #ff6b6b); font-size: var(--text-xs, 0.78rem); }
		.ccp-summary { margin: 0; font-size: var(--text-xs, 0.78rem); color: var(--ink-dim, #999); }
		.ccp-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm, 0.85rem); }
		.ccp-table th { text-align: left; font-size: var(--text-xs, 0.72rem); text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-dim, #999); padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--stroke, rgba(255,255,255,0.12)); }
		.ccp-table td { padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--stroke, rgba(255,255,255,0.08)); vertical-align: top; }
		.ccp-table tr.is-cheapest td { background: var(--surface-2, rgba(124,108,255,0.08)); }
		.ccp-table .ccp-price { font-weight: 700; white-space: nowrap; }
		.ccp-table .ccp-ship { color: var(--ink-dim, #999); font-size: var(--text-xs, 0.78rem); }
		.ccp-wrap { max-height: 320px; overflow: auto; border: 1px solid var(--stroke, rgba(255,255,255,0.12)); border-radius: var(--radius-md, 8px); }
		.ccp-next { margin: 0; padding: 0.7rem 0.85rem; border-radius: var(--radius-md, 8px); border: 1px solid var(--stroke, rgba(255,255,255,0.12)); background: var(--surface-1, #16161d); font-size: var(--text-xs, 0.78rem); line-height: 1.55; color: var(--ink, #eee); }
		.ccp-next a { color: var(--accent, #7c6cff); }
		.ccp-next a:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		@media (prefers-reduced-motion: reduce) { .ccp-spinner { animation-duration: 1.5s; } }
	`;
	document.head.appendChild(style);
}

/**
 * Render the "Get it printed" panel into `host`: a button that fetches live
 * Craftcloud prices, then the results table with the cheapest option on top
 * and a link to finish the purchase on Craftcloud's own site.
 *
 * @param {HTMLElement} host
 * @param {{ creationId?: string|null, glbUrl?: string|null }} opts
 */
export function renderCraftcloudPrint(host, { creationId = null, glbUrl = null } = {}) {
	injectStyles();
	if (!creationId && !glbUrl) {
		host.innerHTML = '<p class="ccp-intro">Save this model first; Craftcloud needs a stored file to upload.</p>';
		return;
	}
	host.innerHTML = `
		<div class="ccp">
			<p class="ccp-intro">Craftcloud compares about 186 print shops worldwide. Upload this model to see real prices by material and shop, then finish the order on Craftcloud. three.ws never takes payment for this.</p>
			<button class="ccp-btn" type="button">Get live Craftcloud prices</button>
			<div class="ccp-result" aria-live="polite"></div>
		</div>`;
	const btn = host.querySelector('.ccp-btn');
	const result = host.querySelector('.ccp-result');

	async function run() {
		btn.disabled = true;
		result.innerHTML = '<p class="ccp-status"><span class="ccp-spinner" aria-hidden="true"></span> Uploading to Craftcloud and pricing across its network. This checks dozens of shops, so it can take up to a minute.</p>';
		try {
			const res = await fetch('/api/print/craftcloud-quote', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(creationId ? { creationId } : { glbUrl }),
			});
			const body = await res.json().catch(() => null);
			if (!res.ok || !body) {
				throw new Error(body?.error?.message || body?.message || `Craftcloud quote failed (${res.status})`);
			}
			renderResult(body);
		} catch (err) {
			log('quote failed', err);
			result.innerHTML = `<p class="ccp-error">${esc(err.message || 'Could not reach Craftcloud right now.')}</p><button class="ccp-btn" type="button" id="ccp-retry">Try again</button>`;
			result.querySelector('#ccp-retry')?.addEventListener('click', run);
		} finally {
			btn.disabled = false;
		}
	}

	function renderResult(data) {
		const rows = Array.isArray(data.quotes) ? data.quotes : [];
		if (rows.length === 0) {
			result.innerHTML = '<p class="ccp-summary">Craftcloud priced this model but no shop in its network can run it as-is. Try a different size or material on <a href="/materialize">Materialize</a> instead.</p>';
			return;
		}
		const cheapestTotal = (q) => q.price + (q.shipping?.price || 0);
		const sorted = [...rows].sort((a, b) => cheapestTotal(a) - cheapestTotal(b));
		const tableRows = sorted
			.slice(0, 25)
			.map(
				(q, i) => `
			<tr class="${i === 0 ? 'is-cheapest' : ''}">
				<td>${esc(q.vendorId)}</td>
				<td>${esc(q.materialLabel)}</td>
				<td class="ccp-price">${money(q.price, q.currency)}</td>
				<td class="ccp-ship">${q.shipping ? `+ ${money(q.shipping.price, q.shipping.currency)} shipping, ${esc(q.shipping.deliveryTime || '?')} days` : 'shipping not quoted'}</td>
			</tr>`,
			)
			.join('');
		// The STL this quote used lives only on Craftcloud's upload now (we never
		// stored it); for a saved creation, the existing slicer STL endpoint
		// regenerates the same print-ready file on demand, so link to that
		// instead of a path nothing serves. A raw glbUrl has no such endpoint, so
		// it gets the plain filename with no link.
		let fileRef = esc(data.stlFileName || 'the STL');
		if (creationId) {
			try {
				fileRef = `<a href="${esc(slicerModelUrl(location.origin, creationId))}" rel="noopener">${esc(data.stlFileName || 'model.stl')}</a>`;
			} catch {
				/* not a UUID; fall back to the plain filename above */
			}
		}
		result.innerHTML = `
			<p class="ccp-summary">${data.vendorCount} shop${data.vendorCount === 1 ? '' : 's'} quoted ${data.quoteCount} material option${data.quoteCount === 1 ? '' : 's'}${data.allComplete ? '' : ' so far'}.</p>
			<div class="ccp-wrap">
				<table class="ccp-table">
					<thead><tr><th>Shop</th><th>Material</th><th>Price</th><th>Shipping</th></tr></thead>
					<tbody>${tableRows}</tbody>
				</table>
			</div>
			<p class="ccp-next">
				three.ws does not take payment for this: Craftcloud has no checkout link it can hand back to another site, so
				<a href="${esc(data.uploadPageUrl)}" target="_blank" rel="noopener">open Craftcloud's upload page</a>
				and drop in ${fileRef}
				to see these same prices in your own account and pay there directly.
				${data.voucherApplied ? ' Our referral voucher applies automatically once you sign in.' : ''}
			</p>`;
	}

	btn.addEventListener('click', run);
}

function injectModalStyles() {
	if (document.getElementById('ccp-modal-styles')) return;
	const style = document.createElement('style');
	style.id = 'ccp-modal-styles';
	style.textContent = `
		.ccp-overlay {
			position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000;
			display: flex; align-items: center; justify-content: center; padding: 1rem;
		}
		.ccp-modal {
			background: var(--surface-0, #0e0e14); border: 1px solid var(--stroke, rgba(255,255,255,0.14));
			border-radius: var(--radius-lg, 12px); padding: 1.1rem; max-width: 560px; width: 100%;
			max-height: 85vh; overflow: auto; position: relative;
		}
		.ccp-modal h2 { margin: 0 0 0.6rem; font-size: var(--text-md, 1rem); }
		.ccp-modal-close {
			position: absolute; top: 0.7rem; right: 0.7rem; background: none; border: none; color: var(--ink-dim, #999);
			font-size: 1.1rem; line-height: 1; cursor: pointer; padding: 0.3rem;
		}
		.ccp-modal-close:hover, .ccp-modal-close:focus-visible { color: var(--ink, #eee); }
		.ccp-modal-close:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
	`;
	document.head.appendChild(style);
}

function openCraftcloudModal({ creationId, glbUrl }) {
	injectModalStyles();
	const overlay = document.createElement('div');
	overlay.className = 'ccp-overlay';
	overlay.innerHTML = `
		<div class="ccp-modal" role="dialog" aria-modal="true" aria-label="Get it printed">
			<button class="ccp-modal-close" type="button" aria-label="Close">✕</button>
			<h2>Get it printed</h2>
			<div class="ccp-modal-body"></div>
		</div>`;
	document.body.appendChild(overlay);
	renderCraftcloudPrint(overlay.querySelector('.ccp-modal-body'), { creationId, glbUrl });

	const close = () => {
		overlay.remove();
		document.removeEventListener('keydown', onKey);
	};
	const onKey = (e) => {
		if (e.key === 'Escape') close();
	};
	overlay.querySelector('.ccp-modal-close').addEventListener('click', close);
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});
	document.addEventListener('keydown', onKey);
	overlay.querySelector('.ccp-modal-close').focus();
}

/**
 * Add a "Get it printed" row to a Forge export dropdown (the same `.export-menu`
 * the format and slicer rows live in). Mirrors `mountSlicerMenuItems`'s shape:
 * hidden until a creation id or GLB URL is known, then opens the live-price
 * modal on click.
 *
 * @param {HTMLElement} menu
 */
export function mountCraftcloudMenuItem(menu) {
	let source = { creationId: null, glbUrl: null };
	const item = document.createElement('button');
	item.type = 'button';
	item.className = 'export-item';
	item.setAttribute('role', 'menuitem');
	item.dataset.craftcloud = 'print';
	item.hidden = true;
	item.innerHTML = `
		<span class="fmt">🖨</span>
		<span class="blurb">Get it printed: live Craftcloud prices across ~186 shops, buy direct.</span>
		<span class="status" aria-live="polite"></span>`;
	item.addEventListener('click', () => {
		if (!source.creationId && !source.glbUrl) return;
		openCraftcloudModal(source);
	});
	menu.appendChild(item);
	return {
		setCreation(creationId, glbUrl = null) {
			source = { creationId: creationId || null, glbUrl: glbUrl || null };
			item.hidden = !source.creationId && !source.glbUrl;
		},
	};
}
