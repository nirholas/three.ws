// Agent commerce console (pages/commerce.html, routes /commerce and /invoices).
//
// One place for the owner to run their agents' commerce:
//   Invoices        create, filter, cancel, and open the public pay page
//   Offers          list what an agent sells, pause, reactivate or close it
//   Purchases       what the owner's agents bought, with receipts
//   Limit requests  spending-limit changes an agent proposed for itself
//
// Approving a limit change is the one decision here an agent must never make
// for itself, so it needs a browser session, CSRF, the exact payload hash the
// owner reviewed, and a fresh step-up: the account password, a Google
// re-authentication (the round trip comes back to this tab and resumes), or a
// signature from a Solana wallet linked to the account over a challenge that
// names this request. API: api/_lib/agent-commerce/routes.js.
// Doc: docs/agent-commerce.md.

import './agent-commerce.css';
import { apiFetch } from './api.js';
import { esc, relTime } from './agent-commerce-format.js';

const API = '/api/agent-commerce';
const PAGE = 25;
const TABS = ['invoices', 'offers', 'purchases', 'requests'];

const STATUS_LABEL = {
	open: 'Open', underpaid: 'Partly paid', paid: 'Paid', expired: 'Past due', cancelled: 'Cancelled',
	active: 'Active', paused: 'Paused', closed: 'Closed',
	pending: 'Pending', submitted: 'Confirming', delivered: 'Delivered', failed: 'Failed',
	approved: 'Approved', executed: 'Applied', denied: 'Denied',
};
const PILL_CLASS = { executed: 'paid', submitted: 'quoted' };
const VIA_LABEL = { web: 'on the web', password: 'with your password', wallet: 'with a wallet signature' };

const $ = (id) => document.getElementById(id);
const els = {};
const state = {
	tab: 'invoices',
	agents: [],
	invoices: [], invBefore: null, invFilter: '', invTotals: null,
	offers: [], purchases: [], requests: [],
	loaded: new Set(),
	stepUp: new Map(), // request id -> challenge
};

// ── helpers ──────────────────────────────────────────────────────────────────


async function call(path, { method = 'GET', body, idempotent = false } = {}) {
	const headers = { accept: 'application/json' };
	if (body) headers['content-type'] = 'application/json';
	if (idempotent) headers['idempotency-key'] = crypto.randomUUID();
	let res;
	try {
		res = await apiFetch(path.startsWith('/api/') ? path : `${API}${path}`, {
			method,
			allowAnonymous: true,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});
	} catch (err) {
		if (err?.redirected) return { ok: false, status: 401, data: null, message: 'Your session expired.' };
		return { ok: false, status: 0, data: null, message: 'Network error. Check your connection and try again.' };
	}
	const json = await res.json().catch(() => ({}));
	const code = json?.error?.code || null;
	// A 401 from a step-up check is a wrong proof the row should explain; any
	// other 401 means the session ended, so put the sign-in wall up.
	if (res.status === 401 && method !== 'GET' && !String(code).startsWith('step_up')) showAuthWall();
	return {
		ok: res.ok,
		status: res.status,
		data: json?.data ?? json,
		code,
		message: json?.error?.message || json?.error_description || (typeof json?.error === 'string' ? json.error : null) || `Request failed (${res.status})`,
	};
}

function announce(msg) {
	els.live.textContent = '';
	requestAnimationFrame(() => { els.live.textContent = msg; });
}

function flash(msg) {
	els.flash.textContent = msg;
	els.flash.hidden = false;
	announce(msg);
	clearTimeout(flash.t);
	flash.t = setTimeout(() => { els.flash.hidden = true; }, 6000);
}

function showError(msg, retry) {
	els.error.innerHTML = `<strong>${esc(msg)}</strong>${retry ? '<br><button type="button" class="ac-btn ac-btn-sm" data-retry>Try again</button>' : ''}`;
	els.error.hidden = false;
	els.error._retry = retry || null;
}

function fmtAmount(value) {
	if (value == null) return '';
	const [whole, frac] = String(value).split('.');
	return `${Number(whole).toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}

function fmtUsd(n) {
	return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
	return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function pill(status) {
	return `<span class="ac-pill ac-pill-${esc(PILL_CLASS[status] || status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function devnet(network) {
	return network && network !== 'mainnet' ? `<span class="ac-badge-devnet">${esc(network)}</span>` : '';
}

function agentName(agent) {
	return agent?.name || 'Unnamed agent';
}

function setCount(tab, n, hot = false) {
	const c = els.main.querySelector(`[data-count="${tab}"]`);
	if (!c) return;
	c.textContent = String(n);
	c.hidden = false;
	c.classList.toggle('is-hot', hot && n > 0);
}

function skeleton(list, n = 3) {
	list.setAttribute('aria-busy', 'true');
	list.innerHTML = Array.from({ length: n }, () => '<div class="ac-skel" aria-hidden="true"></div>').join('');
}

function empty(list, icon, title, body, action = '') {
	list.setAttribute('aria-busy', 'false');
	list.innerHTML = `<div class="ac-empty"><div class="ac-empty-icon" aria-hidden="true">${icon}</div><h3>${esc(title)}</h3><p>${body}</p>${action}</div>`;
}

function listError(list, msg, tab) {
	list.setAttribute('aria-busy', 'false');
	list.innerHTML = `<div class="ac-notice ac-notice-error" role="alert"><strong>${esc(msg)}</strong><br><button type="button" class="ac-btn ac-btn-sm" data-reload="${esc(tab)}">Try again</button></div>`;
}

function rowMsg(row, text, kind) {
	let m = row.querySelector('.ac-row-msg');
	if (!m) {
		m = document.createElement('p');
		m.className = 'ac-row-msg';
		m.setAttribute('role', 'status');
		row.appendChild(m);
	}
	m.className = `ac-row-msg${kind ? ` is-${kind}` : ''}`;
	m.textContent = text;
}

function fillAgentSelects() {
	const opts = state.agents.map((a) => `<option value="${esc(a.id)}">${esc(agentName(a))}</option>`).join('');
	for (const sel of [els.invAgent, els.offAgent]) sel.innerHTML = opts;
	const none = !state.agents.length;
	for (const id of ['inv-submit', 'off-submit']) $(id).disabled = none;
	if (none) {
		$('inv-msg').innerHTML = 'You need an agent first. <a href="/create-agent">Create one</a>.';
		$('off-msg').innerHTML = 'You need an agent first. <a href="/create-agent">Create one</a>.';
	}
}

// ── tabs ─────────────────────────────────────────────────────────────────────

function selectTab(tab, { focus = false, push = true } = {}) {
	if (!TABS.includes(tab)) tab = 'invoices';
	state.tab = tab;
	for (const btn of els.main.querySelectorAll('.ac-tab')) {
		const on = btn.dataset.tab === tab;
		btn.setAttribute('aria-selected', String(on));
		btn.tabIndex = on ? 0 : -1;
		if (on && focus) btn.focus();
	}
	for (const t of TABS) $(`panel-${t}`).hidden = t !== tab;
	if (push) {
		const url = new URL(location.href);
		if (tab === 'invoices') url.searchParams.delete('tab');
		else url.searchParams.set('tab', tab);
		history.replaceState(null, '', url.pathname + url.search + url.hash);
	}
	if (!state.loaded.has(tab)) loadTab(tab);
}

function loadTab(tab) {
	if (tab === 'invoices') return loadInvoices();
	if (tab === 'offers') return loadOffers();
	if (tab === 'purchases') return loadPurchases();
	return loadRequests();
}

// ── invoices ─────────────────────────────────────────────────────────────────

async function loadInvoices({ more = false } = {}) {
	if (!more) {
		state.invoices = [];
		state.invBefore = null;
		skeleton(els.invList);
	}
	const q = new URLSearchParams({ limit: String(PAGE) });
	if (state.invFilter) q.set('status', state.invFilter);
	if (more && state.invBefore) q.set('before', state.invBefore);
	els.invMoreBtn.disabled = true;
	const r = await call(`/invoices?${q}`);
	els.invMoreBtn.disabled = false;
	if (r.status === 401) return showAuthWall();
	if (!r.ok) return listError(els.invList, r.message, 'invoices');
	state.loaded.add('invoices');
	state.invoices = more ? state.invoices.concat(r.data.invoices) : r.data.invoices;
	state.invBefore = r.data.next_before || null;
	state.invTotals = r.data.totals || null;
	renderInvoiceStats();
	renderInvoices();
}

function renderInvoiceStats() {
	const t = state.invTotals || {};
	const outstanding = Number(t.outstanding || 0);
	setCount('invoices', outstanding, true);
	els.invStats.innerHTML = `
		<div class="ac-stat"><dt>Outstanding</dt><dd>${outstanding.toLocaleString('en-US')}</dd></div>
		<div class="ac-stat"><dt>Paid</dt><dd>${Number(t.paid || 0).toLocaleString('en-US')}</dd></div>
		<div class="ac-stat"><dt>Past due</dt><dd>${Number(t.expired || 0).toLocaleString('en-US')}</dd></div>
		<div class="ac-stat"><dt>Income (mainnet)</dt><dd>${fmtUsd(t.paid_usd)}</dd></div>`;
}

function renderInvoices() {
	els.invMore.hidden = !state.invBefore;
	if (!state.invoices.length) {
		if (state.invFilter) {
			return empty(els.invList, '🔎', `No ${STATUS_LABEL[state.invFilter]?.toLowerCase() || state.invFilter} invoices`, 'Nothing matches this filter. Choose "All invoices" to see everything.');
		}
		return empty(
			els.invList, '🧾', 'No invoices yet',
			'Bill a client or another agent from one of your agents\' wallets. They pay with any Solana wallet by scanning a QR code, and you get a receipt and a notification once it is verified on-chain. Your agents can issue invoices too, through the invoice_create tool.',
			state.agents.length ? '<button type="button" class="ac-btn ac-btn-primary" data-open="ac-inv-new">Create your first invoice</button>' : '<a class="ac-btn ac-btn-primary" href="/create-agent">Create an agent first</a>',
		);
	}
	els.invList.setAttribute('aria-busy', 'false');
	els.invList.innerHTML = state.invoices.map(invoiceRow).join('');
}

function invoiceRow(inv) {
	const live = inv.status === 'open' || inv.status === 'underpaid';
	const due = live
		? `<span title="${esc(fmtDate(inv.due_at))}">Due ${esc(relTime(inv.due_at))}</span>`
		: '';
	const progress = inv.status === 'underpaid' ? `<span>${esc(fmtAmount(inv.paid))} of ${esc(fmtAmount(inv.amount))} paid</span>` : '';
	const paid = inv.status === 'paid'
		? `<span>Paid ${esc(relTime(inv.paid_at))}${inv.paid_late ? ' (late)' : ''}${inv.paid_usd != null ? ` · ${esc(fmtUsd(inv.paid_usd))}` : ''}</span>`
		: '';
	const payer = inv.payer ? `<span>To ${esc(inv.payer.label || `${inv.payer.address.slice(0, 4)}…${inv.payer.address.slice(-4)}`)}</span>` : '<span>Open to anyone</span>';
	return `
		<article class="ac-row" data-invoice="${esc(inv.id)}">
			<div>
				<div class="ac-row-title"><a href="/invoices/${esc(inv.id)}">${esc(inv.memo)}</a></div>
			</div>
			<div class="ac-row-side">
				<span class="ac-row-amt">${esc(fmtAmount(inv.amount))} ${esc(inv.symbol)}</span>
				<div class="ac-row-actions">
					${devnet(inv.network)}${pill(inv.status)}
				</div>
			</div>
			<div class="ac-row-meta">
				<span class="ac-mono">${esc(inv.number)}</span>
				<span>${esc(agentName(inv.agent))}</span>
				${payer}${due}${progress}${paid}
				<span title="${esc(fmtDate(inv.created_at))}">Issued ${esc(relTime(inv.created_at))}${inv.created_by === 'agent' ? ' by the agent' : ''}</span>
			</div>
			<div class="ac-row-extra ac-row-actions" style="justify-content:flex-start">
				<a class="ac-btn ac-btn-sm" href="/invoices/${esc(inv.id)}">${inv.status === 'paid' ? 'Receipt' : 'Pay page'}</a>
				<button type="button" class="ac-btn ac-btn-sm" data-copy="${esc(location.origin)}/invoices/${esc(inv.id)}">Copy link</button>
				${live || inv.status === 'expired' ? `<button type="button" class="ac-btn ac-btn-sm" data-verify="${esc(inv.id)}">Check payment</button>` : ''}
				${live || inv.status === 'expired' ? `<button type="button" class="ac-btn ac-btn-sm ac-btn-danger" data-cancel="${esc(inv.id)}">Cancel</button>` : ''}
			</div>
		</article>`;
}

async function onCreateInvoice(e) {
	e.preventDefault();
	const form = els.invForm;
	const f = form.elements;
	const msg = $('inv-msg');
	const amount = f.amount.value.trim();
	const memo = f.memo.value.trim();
	f.amount.setAttribute('aria-invalid', String(!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0));
	f.memo.setAttribute('aria-invalid', String(!memo));
	if (f.amount.getAttribute('aria-invalid') === 'true') { msg.className = 'ac-form-msg is-err'; msg.textContent = 'Enter an amount above zero, like 25 or 0.5.'; return f.amount.focus(); }
	if (!memo) { msg.className = 'ac-form-msg is-err'; msg.textContent = 'Say what the invoice is for.'; return f.memo.focus(); }
	const body = {
		agent_id: f.agent_id.value,
		amount,
		asset: f.asset.value,
		network: f.network.value,
		memo,
		description: f.description.value.trim() || undefined,
		payer: f.payer.value.trim() || undefined,
		payer_label: f.payer_label.value.trim() || undefined,
		due_in_hours: Number(f.due_in_hours.value),
	};
	const btn = $('inv-submit');
	btn.disabled = true;
	btn.textContent = 'Creating…';
	msg.className = 'ac-form-msg';
	msg.textContent = '';
	const r = await call('/invoices', { method: 'POST', body, idempotent: true });
	btn.disabled = false;
	btn.textContent = 'Create invoice';
	if (!r.ok) {
		msg.className = 'ac-form-msg is-err';
		msg.textContent = r.message;
		return;
	}
	const inv = r.data.invoice;
	form.reset();
	els.invNew.open = false;
	flash(`Invoice ${inv.number} created. Share the pay link: ${location.origin}/invoices/${inv.id}`);
	state.invFilter = '';
	els.invFilter.value = '';
	await loadInvoices();
	const row = els.invList.querySelector(`[data-invoice="${CSS.escape(inv.id)}"]`);
	row?.classList.add('is-focus');
}

async function onVerify(btn) {
	const id = btn.dataset.verify;
	const row = btn.closest('.ac-row');
	btn.disabled = true;
	btn.textContent = 'Checking…';
	const r = await call(`/invoices/${id}/verify`, { method: 'POST' });
	if (!r.ok) {
		btn.disabled = false;
		btn.textContent = 'Check payment';
		return rowMsg(row, r.status === 429 ? 'Checked too often. Wait a minute; the watcher also checks every minute.' : r.message, 'err');
	}
	const before = state.invoices.find((i) => i.id === id);
	const fresh = await call(`/invoices/${id}`);
	if (fresh.ok) {
		const idx = state.invoices.findIndex((i) => i.id === id);
		if (idx >= 0) state.invoices[idx] = fresh.data;
		renderInvoices();
		const newRow = els.invList.querySelector(`[data-invoice="${CSS.escape(id)}"]`);
		const changed = before && (before.status !== fresh.data.status || before.paid !== fresh.data.paid);
		if (newRow) rowMsg(newRow, changed ? `Updated: ${STATUS_LABEL[fresh.data.status] || fresh.data.status}.` : 'No new payment on-chain yet.', changed ? 'ok' : '');
	}
}

async function onCancel(btn) {
	const id = btn.dataset.cancel;
	const row = btn.closest('.ac-row');
	if (btn.dataset.armed !== '1') {
		btn.dataset.armed = '1';
		btn.textContent = 'Confirm cancel';
		rowMsg(row, 'Cancelling stops the pay link from working. Payments already received stay where they are.', '');
		setTimeout(() => {
			if (btn.isConnected && btn.dataset.armed === '1') {
				btn.dataset.armed = '';
				btn.textContent = 'Cancel';
			}
		}, 6000);
		return;
	}
	btn.disabled = true;
	btn.textContent = 'Cancelling…';
	const r = await call(`/invoices/${id}/cancel`, { method: 'POST', body: { reason: 'Cancelled from the dashboard' } });
	if (!r.ok) {
		btn.disabled = false;
		btn.dataset.armed = '';
		btn.textContent = 'Cancel';
		return rowMsg(row, r.message, 'err');
	}
	const idx = state.invoices.findIndex((i) => i.id === id);
	if (idx >= 0) state.invoices[idx] = { ...state.invoices[idx], ...r.data, agent: state.invoices[idx].agent };
	renderInvoices();
	announce('Invoice cancelled.');
	loadInvoiceTotals();
}

async function loadInvoiceTotals() {
	const r = await call('/invoices?limit=1');
	if (r.ok) {
		state.invTotals = r.data.totals;
		renderInvoiceStats();
	}
}

// ── offers ───────────────────────────────────────────────────────────────────

async function loadOffers() {
	skeleton(els.offList);
	const r = await call('/offers/mine?limit=200');
	if (r.status === 401) return showAuthWall();
	if (!r.ok) return listError(els.offList, r.message, 'offers');
	state.loaded.add('offers');
	state.offers = r.data.offers;
	renderOffers();
}

function renderOffers() {
	setCount('offers', state.offers.filter((o) => o.status === 'active').length);
	if (!state.offers.length) {
		return empty(
			els.offList, '🏷️', 'Nothing listed yet',
			'List something one of your agents sells. Other agents can find it, take a quote, and buy it; the fulfillment you write is revealed only to a buyer whose payment verified on-chain. Agents can list offers themselves with the agent_sell tool.',
			state.agents.length ? '<button type="button" class="ac-btn ac-btn-primary" data-open="ac-off-new">List your first offer</button>' : '<a class="ac-btn ac-btn-primary" href="/create-agent">Create an agent first</a>',
		);
	}
	els.offList.setAttribute('aria-busy', 'false');
	els.offList.innerHTML = state.offers.map(offerRow).join('');
}

function offerRow(o) {
	const stock = o.stock == null ? 'Unlimited stock' : `${o.available} of ${o.stock} left`;
	const actions = [];
	if (o.status === 'active') actions.push(`<button type="button" class="ac-btn ac-btn-sm" data-offer="${esc(o.id)}" data-to="paused">Pause</button>`);
	if (o.status === 'paused') actions.push(`<button type="button" class="ac-btn ac-btn-sm" data-offer="${esc(o.id)}" data-to="active">Reactivate</button>`);
	if (o.status !== 'closed') actions.push(`<button type="button" class="ac-btn ac-btn-sm ac-btn-danger" data-offer="${esc(o.id)}" data-to="closed">Close</button>`);
	return `
		<article class="ac-row" data-offer-row="${esc(o.id)}">
			<div><div class="ac-row-title">${esc(o.title)}</div></div>
			<div class="ac-row-side">
				<span class="ac-row-amt">${esc(fmtAmount(o.price))} ${esc(o.symbol)}</span>
				<div class="ac-row-actions">${devnet(o.network)}${pill(o.status)}</div>
			</div>
			<div class="ac-row-meta">
				<span>${esc(agentName(o.seller))}</span>
				<span>${esc(String(o.sold))} sold</span>
				<span>${esc(stock)}</span>
				<span title="${esc(fmtDate(o.created_at))}">Listed ${esc(relTime(o.created_at))}</span>
			</div>
			<div class="ac-row-extra">
				${o.description ? `<p class="ac-hint" style="margin:0 0 6px">${esc(o.description)}</p>` : ''}
				<details><summary>Fulfillment (only paid buyers see this)</summary><pre>${esc(o.fulfillment || '')}</pre></details>
			</div>
			${actions.length ? `<div class="ac-row-extra ac-row-actions" style="justify-content:flex-start">${actions.join('')}</div>` : ''}
		</article>`;
}

async function onCreateOffer(e) {
	e.preventDefault();
	const form = els.offForm;
	const f = form.elements;
	const msg = $('off-msg');
	const price = f.price.value.trim();
	const title = f.title.value.trim();
	const fulfillment = f.fulfillment.value.trim();
	const stockRaw = f.stock.value.trim();
	const bad = (el, text) => { el.setAttribute('aria-invalid', 'true'); msg.className = 'ac-form-msg is-err'; msg.textContent = text; el.focus(); };
	for (const el of [f.price, f.title, f.fulfillment, f.stock]) el.removeAttribute('aria-invalid');
	if (!/^\d+(\.\d+)?$/.test(price) || Number(price) <= 0) return bad(f.price, 'Enter a price above zero.');
	if (!title) return bad(f.title, 'Give the offer a title.');
	if (!fulfillment) return bad(f.fulfillment, 'Write what a paid buyer receives.');
	if (stockRaw && (!Number.isInteger(Number(stockRaw)) || Number(stockRaw) < 1)) return bad(f.stock, 'Stock is a whole number of at least 1, or empty for unlimited.');
	const btn = $('off-submit');
	btn.disabled = true;
	btn.textContent = 'Listing…';
	msg.className = 'ac-form-msg';
	msg.textContent = '';
	const r = await call('/offers/mine', {
		method: 'POST',
		idempotent: true,
		body: {
			agent_id: f.agent_id.value,
			price,
			asset: f.asset.value,
			network: f.network.value,
			title,
			description: f.description.value.trim() || undefined,
			fulfillment,
			stock: stockRaw ? Number(stockRaw) : null,
		},
	});
	btn.disabled = false;
	btn.textContent = 'List offer';
	if (!r.ok) {
		msg.className = 'ac-form-msg is-err';
		msg.textContent = r.message;
		return;
	}
	form.reset();
	els.offNew.open = false;
	state.offers.unshift(r.data.offer);
	renderOffers();
	flash(`"${r.data.offer.title}" is listed. Other agents can find it with offer_list.`);
}

async function onOfferStatus(btn) {
	const id = btn.dataset.offer;
	const to = btn.dataset.to;
	const row = btn.closest('.ac-row');
	if (to === 'closed' && btn.dataset.armed !== '1') {
		btn.dataset.armed = '1';
		btn.textContent = 'Confirm close';
		rowMsg(row, 'A closed offer cannot be reopened. Pause it instead if you may sell it again.', '');
		return;
	}
	btn.disabled = true;
	const r = await call(`/offers/${id}/status`, { method: 'POST', body: { status: to } });
	if (!r.ok) {
		btn.disabled = false;
		return rowMsg(row, r.message, 'err');
	}
	const idx = state.offers.findIndex((o) => o.id === id);
	if (idx >= 0) state.offers[idx] = r.data.offer;
	renderOffers();
	announce(`Offer ${STATUS_LABEL[to].toLowerCase()}.`);
}

// ── purchases ────────────────────────────────────────────────────────────────

async function loadPurchases() {
	skeleton(els.purList);
	const r = await call('/purchases?limit=200');
	if (r.status === 401) return showAuthWall();
	if (!r.ok) return listError(els.purList, r.message, 'purchases');
	state.loaded.add('purchases');
	state.purchases = r.data.purchases;
	renderPurchases();
}

function renderPurchases() {
	setCount('purchases', state.purchases.length);
	if (!state.purchases.length) {
		return empty(
			els.purList, '🛍️', 'Your agents have not bought anything',
			'When an agent buys from another agent\'s offer (agent_buy for a quote, then agent_buy_confirm to pay), the order and its receipt land here. Every purchase stays inside the spending limits you set.',
			'<a class="ac-btn" href="/docs/agent-commerce">How agents buy</a>',
		);
	}
	els.purList.setAttribute('aria-busy', 'false');
	els.purList.innerHTML = state.purchases.map((p) => `
		<article class="ac-row">
			<div><div class="ac-row-title">${esc(p.title)}</div></div>
			<div class="ac-row-side">
				<span class="ac-row-amt">${esc(fmtAmount(p.amount))} ${esc(p.symbol)}</span>
				<div class="ac-row-actions">${devnet(p.network)}${pill(p.status)}</div>
			</div>
			<div class="ac-row-meta">
				<span>Bought by ${esc(agentName(p.buyer))}</span>
				${p.seller ? `<span>from ${esc(p.seller)}</span>` : ''}
				<span title="${esc(fmtDate(p.created_at))}">${esc(relTime(p.created_at))}</span>
				${p.delivered_at ? `<span>Delivered ${esc(relTime(p.delivered_at))}</span>` : ''}
			</div>
			<div class="ac-row-extra ac-row-actions" style="justify-content:flex-start">
				${p.receipt_url ? `<a class="ac-btn ac-btn-sm" href="${esc(p.receipt_url)}">Receipt</a>` : ''}
				${p.explorer_url ? `<a class="ac-btn ac-btn-sm" href="${esc(p.explorer_url)}" target="_blank" rel="noopener">Transaction</a>` : ''}
			</div>
			${p.fulfillment ? `<div class="ac-row-extra"><details><summary>What was delivered</summary><pre>${esc(p.fulfillment)}</pre></details></div>` : ''}
		</article>`).join('');
}

// ── limit requests ───────────────────────────────────────────────────────────

async function loadRequests() {
	skeleton(els.reqList, 2);
	const r = await call('/requests?limit=100');
	if (r.status === 401) return showAuthWall();
	if (!r.ok) return listError(els.reqList, r.message, 'requests');
	state.loaded.add('requests');
	state.requests = r.data.requests;
	renderRequests();
	resumeFromHash();
}

function renderRequests() {
	const pending = state.requests.filter((q) => q.status === 'pending');
	setCount('requests', pending.length, true);
	if (!state.requests.length) {
		return empty(
			els.reqList, '🛂', 'No limit requests',
			'If one of your agents needs a higher per-payment or daily cap, it proposes the change with spending_setup and it waits here. Nothing changes until you approve it and confirm it is you.',
		);
	}
	els.reqList.setAttribute('aria-busy', 'false');
	els.reqList.innerHTML = state.requests.map(requestRow).join('');
}

function requestRow(q) {
	const rows = (q.changes || []).map((c) => `
		<tr class="${c.loosens ? 'is-loosen' : 'is-tighten'}">
			<th scope="row">${esc(c.label || c.key)}</th>
			<td>${esc(c.from)}</td>
			<td>${esc(c.to)}<span class="tag">${c.loosens ? 'raises risk' : 'tightens'}</span></td>
		</tr>`).join('');
	const pending = q.status === 'pending';
	const decided = q.decided_at ? `<span>Decided ${esc(relTime(q.decided_at))}${q.decided_via ? ` ${esc(VIA_LABEL[q.decided_via] || (q.decided_via.startsWith('reauth') ? 'after re-authenticating' : q.decided_via))}` : ''}</span>` : '';
	const failed = q.status === 'failed' && q.result?.error ? `<p class="ac-row-msg is-err">Could not apply: ${esc(q.result.error)}</p>` : '';
	return `
		<article class="ac-row" id="request-${esc(q.id)}" data-request="${esc(q.id)}">
			<div><div class="ac-row-title">${esc(q.summary || 'Spending limit change')}</div></div>
			<div class="ac-row-side"><div class="ac-row-actions">${pill(q.status)}</div></div>
			<div class="ac-row-meta">
				<span>${esc(agentName(q.agent))}</span>
				<span title="${esc(fmtDate(q.created_at))}">Proposed ${esc(relTime(q.created_at))}</span>
				${pending ? `<span title="${esc(fmtDate(q.expires_at))}">Expires ${esc(fmtDate(q.expires_at))}</span>` : decided}
			</div>
			<div class="ac-row-extra">
				${q.reason ? `<p class="ac-hint" style="margin:0">Agent's reason: <q>${esc(q.reason)}</q></p>` : ''}
				<table class="ac-diff"><thead><tr><th scope="col">Limit</th><th scope="col">Now</th><th scope="col">Proposed</th></tr></thead><tbody>${rows}</tbody></table>
				<p class="ac-hint ac-mono">Change fingerprint ${esc(q.payload_hash)}</p>
			</div>
			${failed}
			${pending ? `<div class="ac-row-extra ac-row-actions" style="justify-content:flex-start">
				<button type="button" class="ac-btn ac-btn-sm ac-btn-primary" data-approve="${esc(q.id)}">Approve…</button>
				<button type="button" class="ac-btn ac-btn-sm ac-btn-danger" data-deny="${esc(q.id)}">Deny</button>
			</div>` : ''}
		</article>`;
}

async function onDeny(btn) {
	const id = btn.dataset.deny;
	const row = btn.closest('.ac-row');
	btn.disabled = true;
	const r = await call(`/requests/${id}`, { method: 'POST', body: { decision: 'deny' } });
	if (!r.ok) {
		btn.disabled = false;
		return rowMsg(row, r.message, 'err');
	}
	replaceRequest(r.data.request);
	announce('Request denied. The limits stay as they were.');
}

function replaceRequest(next) {
	const idx = state.requests.findIndex((q) => q.id === next.id);
	if (idx >= 0) state.requests[idx] = { ...state.requests[idx], ...next };
	state.stepUp.delete(next.id);
	renderRequests();
}

async function onApprove(btn) {
	const id = btn.dataset.approve;
	const row = btn.closest('.ac-row');
	btn.disabled = true;
	btn.textContent = 'Preparing…';
	const r = await call(`/requests/${id}/challenge`, { method: 'POST' });
	btn.disabled = false;
	btn.textContent = 'Approve…';
	if (!r.ok) return rowMsg(row, r.message, 'err');
	state.stepUp.set(id, r.data);
	renderStepUp(row, id, r.data);
}

function renderStepUp(row, id, ch) {
	row.querySelector('.ac-stepup')?.remove();
	const m = ch.methods || {};
	const wallet = window.phantom?.solana || window.solana || window.backpack || window.solflare || null;
	const parts = [];
	if (m.password) {
		parts.push(`<form class="ac-stepup-method" data-stepup-password="${esc(id)}">
			<div class="ac-field"><label for="pw-${esc(id)}">Account password</label><input type="password" id="pw-${esc(id)}" autocomplete="current-password" required /></div>
			<button type="submit" class="ac-btn ac-btn-primary">Approve with password</button>
		</form>`);
	}
	if (m.reauth) {
		parts.push(`<div class="ac-stepup-method"><button type="button" class="ac-btn" data-stepup-reauth="${esc(id)}">Re-authenticate with Google, then approve</button></div>`);
	}
	if (m.wallet) {
		parts.push(wallet
			? `<div class="ac-stepup-method"><button type="button" class="ac-btn" data-stepup-wallet="${esc(id)}">Sign with your wallet</button><span class="ac-hint" style="margin:0">Linked: ${ch.wallets.map((w) => `<span class="ac-mono">${esc(w.slice(0, 4))}…${esc(w.slice(-4))}</span>`).join(', ')}</span></div>`
			: `<p>A Solana wallet is linked to your account, but no wallet extension is available in this browser. Install or unlock it to sign.</p>`);
	}
	const body = parts.length
		? parts.join('')
		: '<p>This account has no password, Google sign-in or linked Solana wallet to confirm with. <a href="/dashboard/settings">Add one in settings</a>, then approve.</p>';
	const box = document.createElement('div');
	box.className = 'ac-stepup';
	box.innerHTML = `
		<h3>Confirm it is you</h3>
		<p>You are approving exactly the change above (fingerprint <span class="ac-mono">${esc(String(ch.message || '').match(/Change: (\S+)/)?.[1]?.slice(0, 16) || '')}…</span>). The confirmation is valid for five minutes.</p>
		<div class="ac-stepup-methods">${body}</div>
		<div><button type="button" class="ac-btn ac-btn-sm" data-stepup-close="${esc(id)}">Not now</button></div>`;
	row.appendChild(box);
	box.querySelector('input, button')?.focus();
}

async function decideApprove(id, stepUp, row) {
	const q = state.requests.find((x) => x.id === id);
	if (!q) return;
	rowMsg(row, 'Applying the change…', '');
	const r = await call(`/requests/${id}`, { method: 'POST', body: { decision: 'approve', payload_hash: q.payload_hash, step_up: stepUp } });
	if (!r.ok) {
		if (r.code === 'payload_mismatch' || r.code === 'not_pending' || r.code === 'expired') {
			await loadRequests();
			const fresh = $(`request-${id}`);
			if (fresh) rowMsg(fresh, r.message, 'err');
			return;
		}
		return rowMsg(row, r.message, 'err');
	}
	replaceRequest(r.data.request);
	const done = r.data.request.status === 'executed';
	const after = $(`request-${id}`);
	if (after) rowMsg(after, done ? 'Approved and applied. The agent\'s new limits are live.' : `Approved, but it could not be applied: ${r.data.request.result?.error || 'unknown error'}`, done ? 'ok' : 'err');
	announce(done ? 'Limit change approved and applied.' : 'Limit change could not be applied.');
}

async function onStepUpPassword(form) {
	const id = form.dataset.stepupPassword;
	const input = form.querySelector('input');
	if (!input.value) return input.focus();
	const btn = form.querySelector('button');
	btn.disabled = true;
	await decideApprove(id, { method: 'password', password: input.value }, form.closest('.ac-row'));
	input.value = '';
	btn.disabled = false;
}

function onStepUpReauth(btn) {
	const id = btn.dataset.stepupReauth;
	const next = `/commerce?tab=requests#request-${id}`;
	location.href = `/api/auth/google/start?intent=reauth&next=${encodeURIComponent(next)}`;
}

async function onStepUpWallet(btn) {
	const id = btn.dataset.stepupWallet;
	const row = btn.closest('.ac-row');
	const ch = state.stepUp.get(id);
	const provider = window.phantom?.solana || window.solana || window.backpack || window.solflare;
	if (!ch || !provider) return rowMsg(row, 'No Solana wallet found in this browser.', 'err');
	btn.disabled = true;
	btn.textContent = 'Waiting for your wallet…';
	try {
		const conn = await provider.connect();
		const address = (conn?.publicKey || provider.publicKey)?.toString?.();
		if (!address) throw new Error('The wallet did not share an address.');
		if (!ch.wallets.includes(address)) {
			throw new Error(`The connected wallet ${address.slice(0, 4)}…${address.slice(-4)} is not linked to your account. Switch to a linked wallet.`);
		}
		if (Date.parse(ch.expires_at) <= Date.now()) throw new Error('The challenge expired. Choose Approve again.');
		const signed = await provider.signMessage(new TextEncoder().encode(ch.message), 'utf8');
		const bytes = signed?.signature ?? signed;
		const bs58 = (await import('bs58')).default;
		await decideApprove(id, { method: 'wallet', address, signature: bs58.encode(bytes), expires_at: ch.expires_at }, row);
	} catch (err) {
		const declined = /reject|declin|cancel/i.test(err?.message || '');
		rowMsg(row, declined ? 'You declined the signature. Nothing changed.' : err?.message || 'The wallet could not sign.', 'err');
	} finally {
		if (btn.isConnected) {
			btn.disabled = false;
			btn.textContent = 'Sign with your wallet';
		}
	}
}

/** Coming back from Google re-authentication: approve the request it was for. */
async function resumeFromHash() {
	const params = new URLSearchParams(location.search);
	const m = location.hash.match(/^#request-([0-9a-f-]{36})$/i);
	if (!m) return;
	const row = $(`request-${m[1]}`);
	if (!row) return;
	row.classList.add('is-focus');
	row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
	if (params.get('google') !== 'reauthenticated') return;
	const url = new URL(location.href);
	url.searchParams.delete('google');
	history.replaceState(null, '', url.pathname + url.search + url.hash);
	const q = state.requests.find((x) => x.id === m[1]);
	if (q?.status !== 'pending') return;
	await decideApprove(q.id, { method: 'reauth' }, row);
}

// ── auth / boot ──────────────────────────────────────────────────────────────

function showAuthWall() {
	els.main.hidden = true;
	els.auth.hidden = false;
	els.login.href = `/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
}

function bind() {
	els.main.querySelector('.ac-tabs').addEventListener('click', (e) => {
		const t = e.target.closest('.ac-tab');
		if (t) selectTab(t.dataset.tab);
	});
	els.main.querySelector('.ac-tabs').addEventListener('keydown', (e) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
		e.preventDefault();
		const i = TABS.indexOf(state.tab);
		const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
		selectTab(TABS[next], { focus: true });
	});
	els.invForm.addEventListener('submit', onCreateInvoice);
	els.offForm.addEventListener('submit', onCreateOffer);
	els.invFilter.addEventListener('change', () => { state.invFilter = els.invFilter.value; loadInvoices(); });
	els.invMoreBtn.addEventListener('click', () => loadInvoices({ more: true }));
	els.invAsset.addEventListener('change', syncDevnetChoices);
	els.offAsset.addEventListener('change', syncDevnetChoices);

	els.main.addEventListener('submit', (e) => {
		const f = e.target.closest('[data-stepup-password]');
		if (f) { e.preventDefault(); onStepUpPassword(f); }
	});
	els.main.addEventListener('click', (e) => {
		const t = e.target;
		const copy = t.closest('[data-copy]');
		if (copy) {
			const prev = copy.textContent;
			navigator.clipboard?.writeText(copy.dataset.copy).then(
				() => { copy.textContent = 'Copied'; announce('Link copied.'); setTimeout(() => { copy.textContent = prev; }, 1500); },
				() => { copy.textContent = 'Select to copy'; },
			);
			return;
		}
		const open = t.closest('[data-open]');
		if (open) { const d = $(open.dataset.open); d.open = true; d.querySelector('select, input')?.focus(); return; }
		const reload = t.closest('[data-reload]');
		if (reload) return void loadTab(reload.dataset.reload);
		const map = [
			['[data-verify]', onVerify], ['[data-cancel]', onCancel], ['[data-offer]', onOfferStatus],
			['[data-approve]', onApprove], ['[data-deny]', onDeny],
			['[data-stepup-reauth]', onStepUpReauth], ['[data-stepup-wallet]', onStepUpWallet],
		];
		for (const [sel, fn] of map) {
			const el = t.closest(sel);
			if (el) return void fn(el);
		}
		const close = t.closest('[data-stepup-close]');
		if (close) close.closest('.ac-stepup')?.remove();
	});
	els.error.addEventListener('click', (e) => {
		if (e.target.closest('[data-retry]') && els.error._retry) {
			els.error.hidden = true;
			els.error._retry();
		}
	});
}

/** $THREE lives on mainnet only: steer the network select when it is picked. */
function syncDevnetChoices() {
	for (const [asset, network] of [[els.invAsset, els.invNetwork], [els.offAsset, els.offNetwork]]) {
		const three = asset.value === 'THREE';
		const dev = network.querySelector('option[value="devnet"]');
		dev.disabled = three;
		if (three) network.value = 'mainnet';
	}
}

async function boot() {
	Object.assign(els, {
		main: $('ac-main'), auth: $('ac-auth'), login: $('ac-login'), error: $('ac-error'), flash: $('ac-flash'), live: $('ac-live'),
		invStats: $('ac-inv-stats'), invList: $('ac-inv-list'), invMore: $('ac-inv-more'), invMoreBtn: $('ac-inv-more-btn'),
		invForm: $('ac-inv-form'), invNew: $('ac-inv-new'), invFilter: $('inv-filter'), invAgent: $('inv-agent'),
		invAsset: $('inv-asset'), invNetwork: $('inv-network'),
		offForm: $('ac-off-form'), offNew: $('ac-off-new'), offList: $('ac-off-list'), offAgent: $('off-agent'),
		offAsset: $('off-asset'), offNetwork: $('off-network'),
		purList: $('ac-pur-list'), reqList: $('ac-req-list'),
	});
	bind();

	const agents = await call('/api/agents');
	if (agents.status === 401) return showAuthWall();
	if (!agents.ok) {
		return showError(`Could not load your agents: ${agents.message}`, () => boot());
	}
	state.agents = agents.data?.agents || [];
	els.main.hidden = false;
	fillAgentSelects();

	const params = new URLSearchParams(location.search);
	const tab = params.get('tab') || (location.hash.startsWith('#request-') ? 'requests' : 'invoices');
	const status = params.get('status');
	if (status && els.invFilter.querySelector(`option[value="${CSS.escape(status)}"]`)) {
		state.invFilter = status;
		els.invFilter.value = status;
	}
	selectTab(tab, { push: false });
	// The pending-request badge matters from any tab, so fetch it up front.
	if (tab !== 'requests') loadRequests();
	if (tab !== 'invoices') loadInvoiceTotals();
}

boot();
