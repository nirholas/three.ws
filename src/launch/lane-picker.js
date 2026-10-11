// Launch lane picker: compares every way to launch a coin on three.ws.
//
// Data: GET /api/launches/lanes, which reads each lane's live config (fees from
// the launchers, supply, graduation, lock options). Nothing on screen is
// hard-coded, so a fee change on a launcher shows up here without a deploy.
//
// mountLanePicker(host, { current }) paints the cards. `current` is the lane id
// of the page the picker sits on; that card is marked and its button inert.
// Every other card links to its lane's own wizard.

import './lane-picker.css';

const esc = (v) =>
	String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** One fee amount as a person reads it. */
export function feeAmount(amount) {
	if (!amount) return '';
	if (amount.kind === 'bps') return `${Number((amount.value / 100).toFixed(2))}%`;
	if (amount.kind === 'eth') return `${amount.value} ETH`;
	return String(amount.value ?? '');
}

/** The cost a creator pays to launch, in one line. */
export function launchCostLine(lane) {
	if (!lane.fees.length) return 'Shown once the lane opens';
	const own = lane.fees.filter((f) => f.when === 'launch' || f.when === 'launch and trade');
	if (!own.length) return 'No fee to launch';
	return own.map((f) => `${f.label}: ${feeAmount(f.amount)}`).join(' · ');
}

/** What traders pay, in one line. */
export function tradeCostLine(lane) {
	if (!lane.fees.length) return 'Shown once the lane opens';
	const trade = lane.fees.filter((f) => /trade/.test(f.when) && f.payer !== 'taken from the position\'s fees');
	if (!trade.length) return 'Set by the venue';
	return trade.map((f) => `${f.label}: ${feeAmount(f.amount)}`).join(' · ');
}

function creatorShare(lane) {
	const s = lane.creator_share;
	if (!s) return '';
	return s.bps != null ? `${Number((s.bps / 100).toFixed(2))}% · ${esc(s.paid_in)}` : esc(s.label);
}

function lockLine(lane) {
	const opts = lane.liquidity?.lock_options || [];
	if (!opts.length) return esc(lane.liquidity?.custody || '');
	return `${esc(lane.liquidity?.custody || '')}<br /><span class="lp-lock">${opts.map((o) => esc(o.label)).join(' · ')}</span>`;
}

function card(lane, current) {
	const here = lane.id === current;
	const action = !lane.available
		? `<button type="button" class="lp-btn" disabled>Not open yet</button>`
		: here
			? `<span class="lp-here">You are here</span>`
			: `<a class="lp-btn lp-btn-primary" href="${esc(lane.cta.href)}">${esc(lane.cta.label)}</a>`;
	return `
	<li class="lp-card${here ? ' is-current' : ''}${lane.available ? '' : ' is-off'}" data-lane="${esc(lane.id)}">
		<div class="lp-head">
			<h3>${esc(lane.label)}</h3>
			<span class="lp-chip">${esc(lane.chain.name)}</span>
			${lane.default ? '<span class="lp-chip lp-chip-default">Default</span>' : ''}
		</div>
		${lane.available ? '' : `<p class="lp-off" role="note">${esc(lane.unavailable_reason || 'This lane is not available right now.')}</p>`}
		<dl class="lp-rows">
			<dt>Supply</dt><dd>${esc(lane.supply)}</dd>
			<dt>To launch</dt><dd>${esc(launchCostLine(lane))}</dd>
			<dt>Traders pay</dt><dd>${esc(tradeCostLine(lane))}</dd>
			<dt>Creator share</dt><dd>${creatorShare(lane)}</dd>
			<dt>Graduation</dt><dd>${esc(lane.graduation)}</dd>
			<dt>Liquidity</dt><dd>${lockLine(lane)}</dd>
			<dt>Signed by</dt><dd>${esc(lane.signer)}</dd>
		</dl>
		<div class="lp-action">${action}</div>
	</li>`;
}

function skeleton() {
	return `<ul class="lp-grid" aria-hidden="true">${'<li class="lp-card"><div class="lp-skel" style="height:18px;width:55%"></div><div class="lp-skel" style="height:120px"></div></li>'.repeat(4)}</ul>`;
}

/** Fetch and paint the picker into `host`. Resolves to the lanes, or null on failure. */
export async function mountLanePicker(host, { current = null } = {}) {
	if (!host) return null;
	host.classList.add('lp');
	host.innerHTML = `<h2 class="lp-title">Choose a launch lane</h2><p class="lp-sub">Every lane launches a fixed-supply coin. They differ in chain, fees and what happens to the liquidity. Figures below are read live.</p><div id="lp-body">${skeleton()}</div>`;
	const body = host.querySelector('#lp-body');
	try {
		const res = await fetch('/api/launches/lanes', { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const { data } = await res.json();
		body.innerHTML = `<ul class="lp-grid">${data.lanes.map((l) => card(l, current)).join('')}</ul>`;
		return data.lanes;
	} catch {
		body.innerHTML = `<p class="lp-error" role="alert">The lane comparison could not be loaded. <button type="button" class="lp-btn" id="lp-retry">Try again</button></p>`;
		body.querySelector('#lp-retry').addEventListener('click', () => mountLanePicker(host, { current }));
		return null;
	}
}
