// Who a Forge $THREE payment goes to, shown on the pay sheet's confirm step.
//
// The consumption split pays fixed platform wallets (the treasury and the holder
// rewards pool, per split_policies.consumption in /api/token/config). The quote
// the server signs carries exactly these legs, and verifyOnChain checks each one
// was credited, so the addresses shown here are the addresses paid. Listing them
// before the wallet opens means the user sees recipient, share, amount and token
// on our page, not only inside the wallet prompt.

const ROLE_LABEL = {
	treasury: 'three.ws treasury',
	rewards: 'Holder rewards pool',
	burn: 'Burned (supply reduction)',
};

const ADDRESS_FIELD = { treasury: 'treasury', rewards: 'rewards_wallet', burn: 'burn_address' };

const escapeHtml = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const shortAddress = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');

/** The consumption recipients from a token config: [{ role, label, pct, address }]. */
export function paymentRecipients(cfg) {
	const legs = Array.isArray(cfg?.split_policies?.consumption) ? cfg.split_policies.consumption : [];
	return legs
		.filter((leg) => leg && Number(leg.bps) > 0)
		.map((leg) => ({
			role: leg.role,
			label: ROLE_LABEL[leg.role] || leg.role,
			pct: Math.round(Number(leg.bps) / 100),
			address: typeof cfg?.[ADDRESS_FIELD[leg.role]] === 'string' ? cfg[ADDRESS_FIELD[leg.role]] : '',
		}));
}

/** The "Paid to" block for the confirm step, or '' when the split is unknown. */
export function recipientsHtml(recipients) {
	if (!recipients?.length) return '';
	injectStyles();
	const rows = recipients
		.map((r) => {
			const addr = r.address
				? `<a class="fpay-to-addr" href="https://solscan.io/account/${encodeURIComponent(r.address)}" target="_blank" rel="noopener" title="${escapeHtml(r.address)}">${escapeHtml(shortAddress(r.address))}</a>`
				: '';
			return `<li><span class="fpay-to-role">${escapeHtml(r.label)} <b>${r.pct}%</b></span>${addr}</li>`;
		})
		.join('');
	return `<div class="fpay-to"><span class="fpay-to-head">Paid to</span><ul>${rows}</ul></div>`;
}

let styled = false;
function injectStyles() {
	if (styled || typeof document === 'undefined') return;
	styled = true;
	const el = document.createElement('style');
	el.textContent = `
	.fpay-to{text-align:left;margin:0 0 6px;padding:10px 12px;border:1px solid #23232c;border-radius:12px;background:#0c0c11;}
	.fpay-to-head{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6a6a74;margin-bottom:6px;}
	.fpay-to ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;}
	.fpay-to li{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12.5px;color:#c6c6ce;}
	.fpay-to-role b{color:#f1f1f4;font-weight:700;}
	.fpay-to-addr{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9a9aa4;text-decoration:none;border-radius:6px;padding:1px 4px;}
	.fpay-to-addr:hover{color:#6ee7a8;}
	.fpay-to-addr:focus-visible{outline:2px solid #6ee7a8;outline-offset:2px;}`;
	document.head.appendChild(el);
}
