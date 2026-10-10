// Public invoice and receipt (pages/agent-invoice.html, route /invoices/:id).
//
// Anyone holding the link sees what is owed, to whom, and how to pay it: a
// Solana Pay QR code and "Open in wallet" link for the amount still due, plus
// every field a manual transfer needs. The page never signs or moves anything;
// the payer's own wallet does. While the invoice is open the page polls the
// public view and asks the server to read the chain (the same check the
// minute watcher runs), so the receipt replaces the pay panel within seconds
// of the payment confirming. API: api/_lib/agent-commerce/routes.js.
// Doc: docs/agent-commerce.md.

import './agent-commerce.css';
import { esc, relTime } from './agent-commerce-format.js';

const API = '/api/agent-commerce';
const POLL_MS = 10_000;
const VERIFY_EVERY = 3; // ask for a chain read on every third poll (30 s)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABEL = { open: 'Open', underpaid: 'Partly paid', paid: 'Paid', expired: 'Past due', cancelled: 'Cancelled' };
const REJECT_LABEL = {
	transaction_failed: 'the transaction failed on-chain',
	no_transfer_to_recipient: 'it did not send this asset to the invoice address',
	memo_mismatch: 'its memo names a different invoice',
};
const EVENT_TEXT = {
	created: (d, inv) => [`Issued for ${d.amount || inv.amount} ${inv.symbol}`, ''],
	payment: (d, inv) => [`Payment of ${d.amount} ${inv.symbol} received`, 'is-good'],
	payment_ignored: (d, inv) => [`A transfer of ${d.amount} ${inv.symbol} was seen but not counted: ${REJECT_LABEL[d.reason] || d.reason}`, 'is-warn'],
	underpaid: (d, inv) => [`Partly paid. ${d.remaining} ${inv.symbol} still due`, 'is-warn'],
	paid: (d) => [d.paid_late ? 'Paid in full, after the due date' : 'Paid in full', 'is-good'],
	expired: (d, inv) => [Number(d.remaining) > 0 ? `Due date passed with ${d.remaining} ${inv.symbol} unpaid` : 'Due date passed', 'is-bad'],
	cancelled: (d) => [d.reason ? `Cancelled by the issuer: ${d.reason}` : 'Cancelled by the issuer', 'is-bad'],
};

const root = document.getElementById('ac-root');
const live = document.getElementById('ac-live');

const state = { id: null, inv: null, timer: null, polls: 0, checking: false, lastStatus: null, countdown: null };

function invoiceIdFromUrl() {
	const m = location.pathname.match(/\/invoices\/([^/]+)\/?$/);
	const raw = m ? decodeURIComponent(m[1]) : new URLSearchParams(location.search).get('id');
	return raw && UUID.test(raw) ? raw.toLowerCase() : null;
}

function announce(msg) {
	live.textContent = '';
	requestAnimationFrame(() => { live.textContent = msg; });
}

async function api(path, { method = 'GET' } = {}) {
	const res = await fetch(`${API}${path}`, { method, credentials: 'omit', headers: { accept: 'application/json' } });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(body?.error?.message || `Request failed (${res.status})`);
		err.status = res.status;
		err.code = body?.error?.code || null;
		throw err;
	}
	return body.data;
}

/** Base units to a decimal string, in string space so nothing rounds. */
function fromAtomics(atomics, decimals) {
	const s = String(atomics ?? '0').replace(/^-/, '').padStart(decimals + 1, '0');
	const whole = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, '');
	const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
	return frac ? `${whole}.${frac}` : whole;
}

function fmtAmount(value) {
	const [whole, frac] = String(value).split('.');
	return `${Number(whole).toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}

function shortAddr(a) {
	return a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a || '';
}

function fmtDate(iso) {
	return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function dueIn(iso) {
	const ms = new Date(iso).getTime() - Date.now();
	if (ms <= 0) return 'past due';
	const m = Math.floor(ms / 60_000);
	if (m < 1) return 'due in under a minute';
	if (m < 60) return `due in ${m} min`;
	const h = Math.floor(m / 60);
	if (h < 48) return `due in ${h} h ${m % 60} min`;
	return `due in ${Math.floor(h / 24)} days`;
}

function addressLink(addr, network) {
	const q = network && network !== 'mainnet' ? `?cluster=${encodeURIComponent(network)}` : '';
	return `https://solscan.io/account/${encodeURIComponent(addr)}${q}`;
}

function copyBtn(value, label) {
	return `<button type="button" class="ac-copy" data-copy="${esc(value)}" aria-label="Copy ${esc(label)}">Copy</button>`;
}

function pill(status) {
	return `<span class="ac-pill ac-pill-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

// ── render ───────────────────────────────────────────────────────────────────

function render() {
	const inv = state.inv;
	const payable = inv.status === 'open' || inv.status === 'underpaid' || inv.status === 'expired';
	document.title = `Invoice ${inv.number} · three.ws`;
	root.setAttribute('aria-busy', 'false');
	root.innerHTML = `
		<article class="ac-card" aria-labelledby="ac-inv-title">
			${headMarkup(inv)}
			${amountMarkup(inv)}
			${detailsMarkup(inv)}
		</article>
		${inv.status === 'paid' ? receiptMarkup(inv) : ''}
		${inv.status === 'cancelled' ? cancelledMarkup(inv) : ''}
		${payable ? payMarkup(inv) : ''}
		${paymentsMarkup(inv)}
		${timelineMarkup(inv)}
		<p class="ac-foot-note">
			Issued through three.ws by an agent's wallet. The payment is a plain Solana transfer to the address above; three.ws never holds it and never asks for your keys.
			Questions about this invoice go to whoever sent you the link.
		</p>
	`;
	tickCountdown();
}

function headMarkup(inv) {
	const agent = inv.agent?.name
		? `<a href="/agents/${esc(inv.agent.id)}">${esc(inv.agent.name)}</a>`
		: 'a three.ws agent';
	return `
		<div class="ac-inv-head">
			<div>
				<p class="ac-inv-from">Invoice from ${agent}</p>
				<h1 class="ac-h1" id="ac-inv-title">${esc(inv.memo)}</h1>
				<p class="ac-inv-number">${esc(inv.number)}${copyBtn(inv.number, 'invoice number')}</p>
			</div>
			<div class="ac-inv-tags">
				${inv.network !== 'mainnet' ? `<span class="ac-badge-devnet" title="Test network: these tokens have no value">${esc(inv.network)}</span>` : ''}
				${pill(inv.status)}
			</div>
		</div>`;
}

function amountMarkup(inv) {
	const partial = inv.status === 'underpaid' || (inv.status === 'expired' && Number(inv.paid) > 0);
	const paid = inv.status === 'paid';
	const pct = Math.min(100, Math.round((Number(inv.paid) / Number(inv.amount)) * 100)) || 0;
	const progress = partial || paid
		? `<div class="ac-progress${paid ? ' is-paid' : ''}" role="progressbar" aria-label="Paid so far" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
		   <div class="ac-progress-label"><span>${fmtAmount(inv.paid)} ${esc(inv.symbol)} paid</span><span>${paid ? 'Settled' : `${fmtAmount(inv.remaining)} ${esc(inv.symbol)} still due`}</span></div>`
		: '';
	return `
		<p class="ac-inv-amount">${fmtAmount(inv.amount)}<small>${esc(inv.symbol)}</small></p>
		${inv.description ? `<p class="ac-inv-desc">${esc(inv.description)}</p>` : ''}
		${progress}`;
}

function detailsMarkup(inv) {
	const rows = [];
	rows.push(['Status', `${esc(STATUS_LABEL[inv.status] || inv.status)}${inv.status === 'open' || inv.status === 'underpaid' ? ` · <span id="ac-due">${esc(dueIn(inv.due_at))}</span>` : ''}`]);
	rows.push(['Due', esc(fmtDate(inv.due_at))]);
	if (inv.payer) {
		rows.push(['Billed to', `${inv.payer.label ? `${esc(inv.payer.label)} · ` : ''}<a class="ac-mono" href="${esc(addressLink(inv.payer.address, inv.network))}" target="_blank" rel="noopener" title="${esc(inv.payer.address)}">${esc(shortAddr(inv.payer.address))}</a>`]);
	} else {
		rows.push(['Billed to', 'Anyone with this link']);
	}
	rows.push(['Pay to', `<a class="ac-mono" href="${esc(addressLink(inv.recipient, inv.network))}" target="_blank" rel="noopener" title="${esc(inv.recipient)}">${esc(shortAddr(inv.recipient))}</a>${copyBtn(inv.recipient, 'recipient address')}`]);
	rows.push(['Asset', `${esc(inv.symbol)} on Solana${inv.network !== 'mainnet' ? ` ${esc(inv.network)}` : ''}`]);
	rows.push(['Issued', esc(fmtDate(inv.created_at))]);
	return `<table class="ac-kv" style="margin-top:var(--space-lg)"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
}

function payMarkup(inv) {
	const expired = inv.status === 'expired';
	const amountDue = inv.remaining;
	const qrSrc = `${API}/pay/${encodeURIComponent(inv.id)}/qr.svg?d=${encodeURIComponent(inv.paid_atomics || '0')}`;
	return `
		<section class="ac-card" aria-labelledby="ac-pay-h">
			<h2 class="ac-h2" id="ac-pay-h">Pay ${fmtAmount(amountDue)} ${esc(inv.symbol)}</h2>
			${expired ? `<div class="ac-notice ac-notice-warn" style="margin-top:var(--space-sm)"><strong>This invoice is past due.</strong> A payment still settles it and is marked as paid late. Check with the issuer before paying if you are unsure it is still wanted.</div>` : ''}
			${inv.network !== 'mainnet' ? `<div class="ac-notice ac-notice-info" style="margin-top:var(--space-sm)">This is a <strong>${esc(inv.network)}</strong> test invoice. Switch your wallet to ${esc(inv.network)} before paying; mainnet funds sent here are not counted.</div>` : ''}
			<div class="ac-pay" style="margin-top:var(--space-md)">
				<div class="ac-qr"><img src="${esc(qrSrc)}" width="200" height="200" alt="Solana Pay QR code for ${esc(fmtAmount(amountDue))} ${esc(inv.symbol)} to ${esc(shortAddr(inv.recipient))}" /></div>
				<div class="ac-pay-body">
					<p class="ac-hint" style="margin:0">Scan with a Solana wallet app, or open the link in a wallet on this device. The amount, recipient, reference and memo are filled in for you.</p>
					<div class="ac-pay-actions">
						<a class="ac-btn ac-btn-primary ac-btn-lg" href="${esc(inv.pay_url)}" id="ac-open-wallet">Open in wallet</a>
						<button type="button" class="ac-btn ac-btn-lg" id="ac-check">I've paid, check now</button>
					</div>
					<p class="ac-hint" id="ac-check-msg" role="status"></p>
					<details>
						<summary class="ac-hint" style="cursor:pointer">Paying by hand? Every field you need</summary>
						<table class="ac-kv" style="margin-top:8px"><tbody>
							<tr><th scope="row">Send</th><td class="ac-num">${esc(amountDue)} ${esc(inv.symbol)}${copyBtn(amountDue, 'amount')}</td></tr>
							<tr><th scope="row">To</th><td class="ac-mono">${esc(inv.recipient)}${copyBtn(inv.recipient, 'recipient address')}</td></tr>
							${inv.asset !== 'SOL' ? `<tr><th scope="row">Token mint</th><td class="ac-mono">${esc(inv.mint)}${copyBtn(inv.mint, 'token mint')}</td></tr>` : ''}
							<tr><th scope="row">Memo</th><td>${esc(inv.chain_memo)}${copyBtn(inv.chain_memo, 'memo')}</td></tr>
							<tr><th scope="row">Pay link</th><td class="ac-mono" style="font-size:var(--text-xs)">${esc(inv.pay_url)}${copyBtn(inv.pay_url, 'Solana Pay link')}</td></tr>
						</tbody></table>
						<p class="ac-hint">A hand-typed transfer must carry the memo above so it is matched to this invoice. Transfers made through the QR code or pay link are matched by their reference key and need nothing extra.</p>
					</details>
				</div>
			</div>
		</section>`;
}

function receiptMarkup(inv) {
	return `
		<section class="ac-card" aria-labelledby="ac-receipt-h">
			<div class="ac-receipt">
				<div class="ac-receipt-mark" aria-hidden="true">✓</div>
				<h2 id="ac-receipt-h">Paid ${fmtAmount(inv.paid)} ${esc(inv.symbol)}</h2>
				<p>Verified on Solana${inv.network !== 'mainnet' ? ` ${esc(inv.network)}` : ''} ${esc(fmtDate(inv.paid_at))}${inv.paid_by ? ` from <a class="ac-mono" href="${esc(addressLink(inv.paid_by, inv.network))}" target="_blank" rel="noopener">${esc(shortAddr(inv.paid_by))}</a>` : ''}.${inv.paid_late ? ' The payment landed after the due date.' : ''}</p>
				<div class="ac-pay-actions" style="justify-content:center;margin-top:var(--space-md)">
					<button type="button" class="ac-btn" id="ac-print">Print or save receipt</button>
					<button type="button" class="ac-btn" data-copy="${esc(location.origin + location.pathname)}">Copy receipt link</button>
				</div>
			</div>
		</section>`;
}

function cancelledMarkup(inv) {
	return `
		<section class="ac-card">
			<div class="ac-receipt">
				<div class="ac-receipt-mark is-bad" aria-hidden="true">✕</div>
				<h2>This invoice was cancelled</h2>
				<p>The issuer withdrew it ${esc(relTime(inv.cancelled_at))}. Do not send a payment for it.${Number(inv.paid) > 0 ? ` ${fmtAmount(inv.paid)} ${esc(inv.symbol)} had already been paid; contact the issuer about it.` : ''}</p>
			</div>
		</section>`;
}

function paymentsMarkup(inv) {
	const list = inv.payments || [];
	if (!list.length) return '';
	const items = list.map((p) => {
		const amt = fromAtomics(p.amount_atomics, inv.decimals);
		const why = p.counted ? '' : `<span>Not counted: ${esc(REJECT_LABEL[p.reject_reason] || p.reject_reason || 'unknown')}</span>`;
		return `<li>
			<span>${p.payer ? `From <span class="ac-mono" title="${esc(p.payer)}">${esc(shortAddr(p.payer))}</span>` : 'Transfer'}</span>
			<span class="amt${p.counted ? '' : ' is-ignored'}">${fmtAmount(amt)} ${esc(inv.symbol)}</span>
			<span class="meta">
				${p.block_time ? `<time datetime="${esc(p.block_time)}">${esc(fmtDate(p.block_time))}</time>` : ''}
				${p.explorer_url ? `<a href="${esc(p.explorer_url)}" target="_blank" rel="noopener">View transaction</a>` : ''}
				${why}
			</span>
		</li>`;
	}).join('');
	return `<section class="ac-card" aria-labelledby="ac-payments-h"><h2 class="ac-section-title" id="ac-payments-h">Payments</h2><ul class="ac-payments">${items}</ul></section>`;
}

function timelineMarkup(inv) {
	const events = (inv.timeline || []).slice();
	if (!events.length) return '';
	const items = events.map((e) => {
		const fn = EVENT_TEXT[e.type];
		const [text, cls] = fn ? fn(e.data || {}, inv) : [e.type.replace(/_/g, ' '), ''];
		return `<li class="${cls}">${esc(text)}<time datetime="${esc(e.at)}" title="${esc(fmtDate(e.at))}">${esc(relTime(e.at))}</time></li>`;
	}).join('');
	return `<section class="ac-card" aria-labelledby="ac-timeline-h"><h2 class="ac-section-title" id="ac-timeline-h">History</h2><ol class="ac-timeline">${items}</ol></section>`;
}

function renderError(err) {
	root.setAttribute('aria-busy', 'false');
	const missing = err?.status === 404;
	root.innerHTML = `
		<div class="ac-empty" role="${missing ? 'status' : 'alert'}">
			<div class="ac-empty-icon" aria-hidden="true">${missing ? '🧾' : '⚠️'}</div>
			<h3>${missing ? 'No invoice at this address' : 'This invoice could not be loaded'}</h3>
			<p>${missing
				? 'The link may be mistyped or cut short. Ask whoever sent it for a fresh copy; invoice links look like three.ws/invoices/ followed by a long id.'
				: `${esc(err?.message || 'The network request failed.')} Your payment, if you sent one, is safe on-chain and will be matched once the page loads.`}</p>
			${missing ? '<a class="ac-btn" href="/">Go to three.ws</a>' : '<button type="button" class="ac-btn" data-retry>Try again</button>'}
		</div>`;
}

// ── data ─────────────────────────────────────────────────────────────────────

async function load({ verify = false } = {}) {
	const inv = verify
		? await api(`/invoices/${state.id}/verify`, { method: 'POST' })
		: await api(`/invoices/${state.id}/public`);
	const prev = state.lastStatus;
	state.inv = inv;
	state.lastStatus = inv.status;
	render();
	if (prev && prev !== inv.status) {
		if (inv.status === 'paid') announce(`Payment verified. Invoice ${inv.number} is paid.`);
		else if (inv.status === 'underpaid') announce(`Partial payment received. ${inv.remaining} ${inv.symbol} still due.`);
		else announce(`Invoice is now ${STATUS_LABEL[inv.status] || inv.status}.`);
	}
	return inv;
}

function watching() {
	const s = state.inv?.status;
	return s === 'open' || s === 'underpaid' || s === 'expired';
}

function schedule() {
	clearTimeout(state.timer);
	if (!watching()) return;
	state.timer = setTimeout(async () => {
		if (document.visibilityState === 'visible') {
			state.polls += 1;
			try {
				await load({ verify: state.polls % VERIFY_EVERY === 0 });
			} catch {
				// A missed poll is retried on the next tick; the page keeps the last good view.
			}
		}
		schedule();
	}, POLL_MS);
}

async function checkNow(btn) {
	if (state.checking) return;
	state.checking = true;
	btn.disabled = true;
	btn.textContent = 'Checking the chain…';
	const before = state.inv.paid_atomics;
	try {
		const inv = await load({ verify: true });
		const msg = document.getElementById('ac-check-msg');
		if (msg && inv.status !== 'paid') {
			msg.textContent = inv.paid_atomics !== before
				? `Payment found. ${inv.remaining} ${inv.symbol} is still due.`
				: 'No payment found yet. Transfers usually confirm within a few seconds; this page keeps checking on its own.';
		}
	} catch (err) {
		const msg = document.getElementById('ac-check-msg');
		if (msg) msg.textContent = err.status === 429 ? 'Checked too often. Wait a moment; the page keeps checking on its own.' : `Could not check right now: ${err.message}`;
		btn.disabled = false;
		btn.textContent = "I've paid, check now";
	} finally {
		state.checking = false;
	}
	schedule();
}

function tickCountdown() {
	clearInterval(state.countdown);
	const el = document.getElementById('ac-due');
	if (!el) return;
	state.countdown = setInterval(() => {
		const node = document.getElementById('ac-due');
		if (!node) return clearInterval(state.countdown);
		node.textContent = dueIn(state.inv.due_at);
	}, 30_000);
}

root.addEventListener('click', (e) => {
	const t = e.target;
	const copy = t.closest('[data-copy]');
	if (copy) {
		const prev = copy.textContent;
		navigator.clipboard?.writeText(copy.dataset.copy).then(
			() => { copy.textContent = 'Copied'; announce('Copied.'); setTimeout(() => { copy.textContent = prev; }, 1500); },
			() => { copy.textContent = 'Select to copy'; },
		);
		return;
	}
	if (t.closest('#ac-check')) return void checkNow(t.closest('#ac-check'));
	if (t.closest('#ac-print')) return void window.print();
	if (t.closest('[data-retry]')) {
		root.setAttribute('aria-busy', 'true');
		root.innerHTML = '<div class="ac-skel is-tall" aria-hidden="true"></div>';
		return void boot();
	}
});

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible' && watching()) {
		load().catch(() => {}).finally(schedule);
	}
});

async function boot() {
	state.id = invoiceIdFromUrl();
	if (!state.id) return renderError({ status: 404 });
	try {
		await load();
		schedule();
	} catch (err) {
		renderError(err);
	}
}

boot();
