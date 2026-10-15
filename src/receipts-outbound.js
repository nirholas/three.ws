/**
 * /receipts, Outbound tab: what the signed-in account's agents spent at OTHER,
 * external x402 merchants while executing an Agent Payment Session, enriched
 * with what the Solana chain itself says settled.
 *
 * Counterpart to receipts.js (the buyer side: what three.ws billed a wallet).
 * This tab uses the account session cookie, not a wallet signature, since
 * Payment Sessions are account-scoped. Also owns the tab bar that switches
 * between the two panels.
 */
import { formatOutboundAmount, outboundReceiptsToCsv } from './receipts-lib.js';
import { timeAgo } from './shared/pulse-format.js';

const API_URL = '/api/x402/outbound-receipts';
const FETCH_LIMIT = 50;

const $ = (id) => document.getElementById(id);

const state = {
	signedIn: null, // null = unknown yet, true/false once checked
	rows: [],
	summary: null,
	nextCursor: null,
	network: '',
	query: '',
	loading: false,
	loadingMore: false,
};

function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function shortSig(s) {
	if (!s || s.length <= 14) return s || '';
	return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function solscanTxUrl(sig) {
	return sig ? `https://solscan.io/tx/${sig}` : null;
}

async function api(path, opts = {}) {
	const res = await fetch(path, {
		credentials: 'include',
		headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
		...opts,
	});
	const d = await res.json().catch(() => ({}));
	if (!res.ok) {
		const code = d.code || d.error || null;
		const message = d.error_description || d.message || `HTTP ${res.status}`;
		throw Object.assign(new Error(message), { status: res.status, code });
	}
	return d;
}

// ── data ─────────────────────────────────────────────────────────────────────

function buildQuery(cursor) {
	const params = new URLSearchParams({ limit: String(FETCH_LIMIT) });
	if (state.network) params.set('network', state.network);
	if (cursor) params.set('cursor', cursor);
	return params;
}

async function refresh() {
	if (state.loading) return;
	state.loading = true;
	renderSkeleton();
	try {
		const body = await api(`${API_URL}?${buildQuery()}`);
		state.signedIn = true;
		state.rows = body.receipts || [];
		state.summary = body.summary || null;
		state.nextCursor = body.nextCursor || null;
		showVault();
		renderVault();
	} catch (err) {
		if (err.status === 401) {
			state.signedIn = false;
			showSignin();
		} else {
			showVault();
			renderLoadError(err.message || 'Could not load your outbound receipts.');
		}
	} finally {
		state.loading = false;
	}
}

async function loadMore() {
	if (!state.nextCursor || state.loading || state.loadingMore) return;
	state.loadingMore = true;
	setMoreBusy(true);
	try {
		const body = await api(`${API_URL}?${buildQuery(state.nextCursor)}`);
		state.rows = state.rows.concat(body.receipts || []);
		state.nextCursor = body.nextCursor || null;
		renderVault();
	} catch (err) {
		showMoreError(err.message || 'Could not load more receipts.');
	} finally {
		state.loadingMore = false;
		setMoreBusy(false);
	}
}

// ── rendering ────────────────────────────────────────────────────────────────

function showSignin() {
	$('ob-signin').hidden = false;
	$('ob-vault').hidden = true;
}

function showVault() {
	$('ob-signin').hidden = true;
	$('ob-vault').hidden = false;
}

function renderSkeleton() {
	if ($('ob-vault').hidden) return;
	$('ob-list').innerHTML = Array.from({ length: 3 })
		.map(() => '<div class="rc-row rc-skeleton" aria-hidden="true"></div>')
		.join('');
	$('ob-empty').hidden = true;
	$('ob-load-error').hidden = true;
	$('ob-more-wrap').hidden = true;
}

function renderLoadError(message) {
	$('ob-list').innerHTML = '';
	$('ob-empty').hidden = true;
	$('ob-more-wrap').hidden = true;
	const el = $('ob-load-error');
	el.hidden = false;
	$('ob-load-error-msg').textContent = message;
}

function showMoreError(message) {
	const el = $('ob-load-error');
	el.hidden = false;
	$('ob-load-error-msg').textContent = message;
}

function setMoreBusy(busy) {
	const btn = $('ob-more');
	btn.disabled = busy;
	btn.querySelector('.rc-btn-label').textContent = busy ? 'Loading…' : 'Load more';
}

function filteredRows() {
	const q = state.query.trim().toLowerCase();
	if (!q) return state.rows;
	return state.rows.filter(
		(r) =>
			String(r.endpointHost || '').toLowerCase().includes(q) ||
			String(r.txHash || '').toLowerCase().includes(q),
	);
}

function renderPager(shown) {
	const wrap = $('ob-more-wrap');
	if (!state.nextCursor) {
		wrap.hidden = true;
		return;
	}
	wrap.hidden = false;
	$('ob-shown').textContent = `Showing the newest ${shown} outbound payment${shown === 1 ? '' : 's'}.`;
}

function statusBadge(r) {
	if (r.resolved) return '<span class="rc-net" data-net="Solana" title="Verified against the settlement transaction itself">verified</span>';
	if (r.resolveError) return '<span class="rc-net" title="The chain lookup for this signature failed permanently">unverified</span>';
	if (r.resolvePending) return '<span class="rc-net" title="Chain verification is still resolving; refresh to check again">pending</span>';
	return '';
}

function renderVault() {
	$('ob-k-spend').textContent = state.summary ? `$${Number(state.summary.totalSpendUsd || 0).toFixed(2)}` : '·';
	$('ob-k-total').textContent = state.summary ? String(state.summary.total) : '·';
	$('ob-k-verified').textContent = state.summary ? String(state.summary.verified) : '·';
	$('ob-k-merchants').textContent = state.summary ? String(state.summary.uniqueMerchants) : '·';
	$('ob-load-error').hidden = true;

	const rows = filteredRows();
	const list = $('ob-list');

	if (!state.rows.length) {
		list.innerHTML = '';
		$('ob-more-wrap').hidden = true;
		$('ob-empty').hidden = false;
		$('ob-empty-title').textContent = 'No outbound spend yet';
		$('ob-empty-body').innerHTML =
			'Nothing here until an agent spends through an Agent Payment Session at another x402 merchant. ' +
			'Fund a session from the <a href="/payments">Payment Sessions dashboard</a> and hand its token to an ' +
			'agent, or read the <a href="/docs/tutorials/agent-spending-envelope">spending envelope guide</a>.';
		return;
	}
	if (!rows.length) {
		list.innerHTML = '';
		$('ob-more-wrap').hidden = true;
		$('ob-empty').hidden = false;
		$('ob-empty-title').textContent = 'No outbound payments match your filter';
		$('ob-empty-body').textContent = 'Try a different merchant host, network, or transaction hash.';
		return;
	}
	$('ob-empty').hidden = true;
	renderPager(state.rows.length);

	list.innerHTML = rows
		.map((r, i) => {
			const url = r.network === 'solana' ? solscanTxUrl(r.txHash) : null;
			const txCell = r.txHash
				? url
					? `<a class="rc-tx" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(shortSig(r.txHash))} ↗</a>`
					: `<span class="rc-tx" title="${esc(r.txHash)}">${esc(shortSig(r.txHash))}</span>`
				: '<span class="rc-tx rc-tx-none">no tx</span>';
			const when = r.createdAt
				? `<time datetime="${esc(r.createdAt)}" title="${esc(new Date(r.createdAt).toLocaleString())}">${esc(timeAgo(r.createdAt))}</time>`
				: '·';
			const amount = formatOutboundAmount(r);
			const netLabel = r.network === 'solana' ? 'Solana' : 'Base';
			return `
			<div class="rc-row" data-idx="${i}">
				<div class="rc-row-main">
					<span class="rc-resource" title="${esc(r.endpointUrl || r.endpointHost)}">${esc(r.endpointHost || r.endpointUrl)}</span>
					<span class="rc-meta">
						<span class="rc-amount" title="${esc(amount.label)}">${esc(amount.label)}</span>
						<span class="rc-net" data-net="${esc(netLabel)}">${esc(netLabel)}</span>
						${statusBadge(r)}
						${when}
						${txCell}
					</span>
				</div>
			</div>`;
		})
		.join('');
}

// ── CSV export ───────────────────────────────────────────────────────────────

function downloadBlob(content, filename, type) {
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function exportCsv() {
	if (!state.rows.length) {
		toast('Nothing to export yet');
		return;
	}
	downloadBlob(outboundReceiptsToCsv(filteredRows()), 'x402-outbound-receipts.csv', 'text/csv');
	toast('CSV exported');
}

let toastTimer = null;
function toast(message) {
	const el = $('rc-toast');
	if (!el) return;
	el.textContent = message;
	el.hidden = false;
	el.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		el.classList.remove('show');
		toastTimer = setTimeout(() => {
			el.hidden = true;
		}, 200);
	}, 1800);
}

// ── tab bar ──────────────────────────────────────────────────────────────────

function selectTab(which) {
	const inboundTab = $('rc-tab-inbound');
	const outboundTab = $('rc-tab-outbound');
	const inboundPanel = $('rc-panel-inbound');
	const outboundPanel = $('rc-panel-outbound');
	const toOutbound = which === 'outbound';

	inboundTab.setAttribute('aria-selected', String(!toOutbound));
	outboundTab.setAttribute('aria-selected', String(toOutbound));
	inboundPanel.hidden = toOutbound;
	outboundPanel.hidden = !toOutbound;

	if (toOutbound && state.signedIn === null) refresh();
}

function wireTabs() {
	$('rc-tab-inbound').addEventListener('click', () => selectTab('inbound'));
	$('rc-tab-outbound').addEventListener('click', () => selectTab('outbound'));
}

function wireVault() {
	$('ob-refresh').addEventListener('click', refresh);
	$('ob-retry').addEventListener('click', refresh);
	$('ob-export').addEventListener('click', exportCsv);
	$('ob-more').addEventListener('click', loadMore);
	$('ob-search').addEventListener('input', (e) => {
		state.query = e.target.value;
		renderVault();
	});
	$('ob-filter-network').addEventListener('change', (e) => {
		state.network = e.target.value;
		refresh();
	});

	document.addEventListener('keydown', (e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if ($('rc-panel-outbound').hidden) return;
		if (e.key === '/') {
			e.preventDefault();
			$('ob-search').focus();
		}
		if (e.key === 'e') exportCsv();
	});
}

function boot() {
	wireTabs();
	wireVault();
}

boot();
