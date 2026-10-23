// Public earnings page for one agent (pages/agent-earnings.html, route
// /agents/:id/earnings). Only renders when the owner switched the page on; the
// API answers 404 not_public otherwise. Same numbers and chart as the owner
// console, with counterparty addresses withheld by the server.
// API: GET /api/revenue/public/:agentId. Doc: docs/revenue-ledger.md.

import './agent-commerce.css';
import './earnings.css';
import { esc, relTime } from './agent-commerce-format.js';
import { renderEarningsChart, slotOf, usd } from './earnings-chart.js';

const $ = (id) => document.getElementById(id);
const agentId = (location.pathname.match(/\/agents\/([^/]+)\/earnings/) || [])[1];
let view = null;
let drawerReturn = null;

const signedUsd = (n) => `${Number(n) < 0 ? '-' : ''}${usd(Math.abs(Number(n)))}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const short = (sig) => (sig ? `${sig.slice(0, 6)}…${sig.slice(-6)}` : '');
const sourceOf = (key) => view?.sources?.find((s) => s.key === key);

function showError(msg, retry) {
	const el = $('er-error');
	el.innerHTML = `<strong>${esc(msg)}</strong>${retry ? '<br><button type="button" class="ac-btn ac-btn-sm" data-retry>Try again</button>' : ''}`;
	el.hidden = false;
	el._retry = retry || null;
}

async function load() {
	$('er-error').hidden = true;
	$('er-skel').hidden = false;
	let res;
	try {
		res = await fetch(`/api/revenue/public/${encodeURIComponent(agentId)}?period=${$('er-period').value}`, { headers: { accept: 'application/json' } });
	} catch {
		$('er-skel').hidden = true;
		return showError('Network error. Check your connection and try again.', load);
	}
	const json = await res.json().catch(() => ({}));
	$('er-skel').hidden = true;
	if (res.status === 404 || res.status === 400) {
		$('er-main').hidden = true;
		$('ae-private').hidden = false;
		return;
	}
	if (!res.ok) return showError(json?.error?.message || `Could not load these earnings (${res.status}).`, load);
	view = json?.data ?? json;
	$('ae-private').hidden = true;
	$('er-main').hidden = false;
	render();
}

function render() {
	const { agent, summary, projection: p, sources } = view;
	document.title = `${agent.name || 'Agent'} earnings · three.ws`;
	$('ae-title').textContent = `${agent.name || 'Agent'} earnings`;
	$('ae-crumb').textContent = 'Earnings';
	$('ae-agents-link').href = `/agent/${agent.id}`;
	$('ae-agents-link').textContent = agent.name || 'Agent';
	$('ae-since').textContent = view.public_since ? `Public since ${fmtDate(view.public_since)}` : '';

	const pnl = summary.trading_pnl_usd;
	const un = view.unclaimed_creator_fees;
	const tiles = [
		{ k: 'Revenue', v: usd(summary.revenue_usd), s: 'Creator fees, sales, hires, royalties and invoices.' },
		{ k: 'Realised trading PnL', v: `<span class="${pnl < 0 ? 'er-neg' : ''}">${signedUsd(pnl)}</span>`, s: 'Closed positions only. Not revenue.' },
		{ k: 'Net', v: `<span class="${summary.net_usd < 0 ? 'er-neg' : ''}">${signedUsd(summary.net_usd)}</span>`, s: 'Revenue plus realised PnL.' },
	];
	if (un && Number(un.sol) > 0) tiles.push({ k: 'Unclaimed creator fees', v: un.usd != null ? usd(un.usd) : `${un.sol} SOL`, s: `${un.sol} SOL not yet claimed. Counted once claimed.` });
	$('er-stats').innerHTML = tiles.map((t) => `<div class="er-stat"><dt>${esc(t.k)}</dt><dd>${t.v}</dd><small>${t.s}</small></div>`).join('');

	renderEarningsChart($('er-chart'), { summary, sources });

	$('er-sources').innerHTML = sources.map((s) => {
		const v = summary.by_source[s.key];
		const sub = v.count ? `${v.count} ${v.count === 1 ? 'event' : 'events'}` : 'Nothing yet';
		return `<li><span class="er-swatch" style="background:var(--er-s${slotOf(sources, s.key)})" aria-hidden="true"></span><span>${esc(s.label)}${s.kind === 'pnl' ? ' <span class="er-chip">not revenue</span>' : ''}</span><span class="er-amt ${s.kind === 'pnl' && v.usd < 0 ? 'er-neg' : ''}">${s.kind === 'pnl' ? signedUsd(v.usd) : usd(v.usd)}</span><span class="er-sub">${esc(sub)}</span></li>`;
	}).join('');

	$('er-proj').innerHTML = p.available
		? `<p><span class="ac-num" style="font-size:var(--text-xl);color:var(--ink-bright)">${usd(p.projected_usd)}</span></p><p class="ac-hint">Expected over the next ${p.horizon_days} days. ${esc(p.method)}</p><p class="ac-hint">Window: ${esc(fmtDate(p.window_start))} to ${esc(fmtDate(p.window_end))}, ${p.entries_in_window} income ${p.entries_in_window === 1 ? 'event' : 'events'}. A projection, not income.</p>`
		: `<p class="ac-hint">No projection yet. ${esc(p.reason)}</p>`;

	const c = view.chain_verification;
	$('er-rec').innerHTML = `<p class="ac-hint">${c.verified} ${c.verified === 1 ? 'transaction' : 'transactions'} verified on-chain${c.issues ? `, <strong class="er-neg">${c.issues} under review</strong>` : ''}${c.unchecked ? `, ${c.unchecked} not yet checked` : ''}.</p>${view.synced_at ? `<p class="ac-hint">Ledger synced ${esc(relTime(view.synced_at))}.</p>` : ''}`;

	renderLedger();
}

function renderLedger() {
	if (!view.entries.length) {
		$('er-ledger').innerHTML = '<div class="ac-empty"><h3>No income recorded yet</h3><p>Rows appear here as this agent earns.</p></div>';
		return;
	}
	const rows = view.entries.map((e) => {
		const src = sourceOf(e.source);
		const tx = e.explorer_url ? `<a href="${esc(e.explorer_url)}" target="_blank" rel="noopener" class="ac-mono">${esc(short(e.tx_signature))}</a>` : '<span class="er-dim">no transaction</span>';
		const chain = e.chain_status === 'verified' ? '<span class="er-chip er-chip-ok">verified</span>' : '';
		const net = e.network !== 'mainnet' || e.chain !== 'solana' ? `<span class="er-chip" title="${esc(e.exclusion_reason || '')}">${esc(e.chain === 'solana' ? e.network : e.chain)}</span>` : '';
		return `<tr class="${e.counted ? '' : 'is-excluded'}"><td>${esc(fmtDate(e.occurred_at))}</td><td><span class="er-swatch" style="background:var(--er-s${slotOf(view.sources, e.source)})" aria-hidden="true"></span> ${esc(src?.label || e.source)} ${net}</td><td class="er-label">${esc(e.label || '')}</td><td class="er-r">${esc(e.amount)} ${esc(e.asset)}</td><td class="er-r">${e.usd == null ? '<span class="er-dim">unvalued</span>' : `<span class="${e.usd < 0 ? 'er-neg' : ''}">${signedUsd(e.usd)}</span>`}</td><td>${tx} ${chain}</td></tr>`;
	}).join('');
	$('er-ledger').innerHTML = `<table><caption class="ac-sr">Earnings ledger</caption><thead><tr><th scope="col">When</th><th scope="col">Source</th><th scope="col">Detail</th><th scope="col" class="er-r">Amount</th><th scope="col" class="er-r">USD</th><th scope="col">Transaction</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function openDrawer() {
	const sources = view?.sources || [];
	const drawer = $('er-drawer');
	drawer.innerHTML = `
		<button type="button" class="ac-btn ac-btn-sm er-drawer-close" data-close>Close</button>
		<h2 class="ac-h2" id="er-drawer-h">How this is calculated</h2>
		<p class="ac-hint">The ledger is a copy of income events from the tables that own them, re-checked against them and against the chain every hour.</p>
		<dl>${sources.map((s) => `<dt><span class="er-swatch" style="background:var(--er-s${slotOf(sources, s.key)})" aria-hidden="true"></span>${esc(s.label)}</dt><dd>${esc(s.how)}</dd>`).join('')}</dl>
		<h3 class="ac-section-title" style="margin-top:20px">Not included</h3>
		<ul>${(view?.not_included || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
		<h3 class="ac-section-title" style="margin-top:20px">Projection</h3>
		<ul><li>Trailing real revenue divided by the days it covers, held flat for 30 days. It needs 7 days of history and 3 income events. No growth is assumed.</li></ul>`;
	drawerReturn = document.activeElement;
	$('er-backdrop').hidden = false;
	drawer.hidden = false;
	drawer.querySelector('[data-close]').focus();
}
function closeDrawer() {
	$('er-drawer').hidden = true;
	$('er-backdrop').hidden = true;
	drawerReturn?.focus?.();
}

if (!agentId) {
	$('er-skel').hidden = true;
	$('ae-private').hidden = false;
} else {
	$('er-period').addEventListener('change', load);
	$('er-how').addEventListener('click', openDrawer);
	$('er-backdrop').addEventListener('click', closeDrawer);
	$('er-drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('er-drawer').hidden) closeDrawer(); });
	$('er-error').addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) $('er-error')._retry?.(); });
	load();
}
