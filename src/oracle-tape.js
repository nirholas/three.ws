// Oracle — live trade tape for a single coin.
//
// Mounts a scrollable buy/sell feed inside a container element. Connects via
// SSE to /api/oracle/trades?mint= which proxies PumpPortal's per-mint token
// trade stream and pre-annotates every trade with wallet reputation labels.
// The tape auto-reconnects on 'bye' (server rotates every 45 s).

import { shortAddress } from './shared/address.js';

const ARCH_TITLE = {
	smart_money: 'Smart Money', kol: 'KOL', top_dev: 'Top Dev', sniper: 'Sniper',
	dumper: 'Dumper', rugger: 'Rugger', fresh: 'Fresh', neutral: 'Neutral', unproven: 'Unproven',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shortAddr(a) { return shortAddress(a, 4, 4, { empty: '\u2014' }); }

function fmtSol(n) {
	if (n == null) return '—';
	const v = Number(n);
	return v < 0.001 ? v.toFixed(5) + '◎' : v < 0.1 ? v.toFixed(4) + '◎' : v.toFixed(3) + '◎';
}

const MAX_ROWS = 60;
const RECONNECT_DELAY_MS = 2000;

/**
 * Mount a live trade tape inside `container`.
 *
 * @param {HTMLElement} container  Target element to render into.
 * @param {object}      opts
 * @param {string}      opts.mint     Token mint address.
 * @param {string}      [opts.network='mainnet']
 * @returns {{ destroy(): void }}   Call destroy() to disconnect and clear.
 */
export function mountTradeTape(container, { mint, network = 'mainnet' }) {
	container.innerHTML = `
		<div class="tape-header">
			<span class="tape-dot"></span>
			<span class="tape-status" id="tapeStatus">Connecting…</span>
			<span class="tape-ct" id="tapeCt"></span>
		</div>
		<div class="tape-list" id="tapeList"></div>
	`;

	const statusEl = container.querySelector('#tapeStatus');
	const ctEl     = container.querySelector('#tapeCt');
	const listEl   = container.querySelector('#tapeList');
	let tradeCount = 0;
	let es         = null;
	let active     = true;
	let reconnectTimer = null;

	function setStatus(text, live = false) {
		statusEl.textContent = text;
		container.querySelector('.tape-dot')?.classList.toggle('live', live);
	}

	function addRow(trade) {
		tradeCount++;
		ctEl.textContent = tradeCount;

		const isBuy  = trade.is_buy;
		const label  = trade.label;
		const title  = ARCH_TITLE[label] || null;
		const tag    = trade.tag ? `@${esc(trade.tag)}` : '';

		const row = document.createElement('div');
		row.className = `tape-row ${isBuy ? 'buy' : 'sell'}`;
		row.innerHTML = `
			<span class="tape-type">${isBuy ? '▲ BUY' : '▼ SELL'}</span>
			${title ? `<span class="nlabel lb-${esc(label)}">${esc(title)}</span>` : ''}
			${tag ? `<span class="tape-tag">${tag}</span>` : ''}
			<span class="tape-addr">${esc(shortAddr(trade.wallet))}</span>
			<span class="tape-sol ${isBuy ? 'buy' : 'sell'}">${fmtSol(trade.sol)}</span>
			${trade.mc_sol != null ? `<span class="tape-mc">${trade.mc_sol.toFixed(1)}◎ mc</span>` : ''}
		`;

		listEl.prepend(row);
		// Flash the row for 600 ms so fresh trades pop.
		row.classList.add('flash');
		setTimeout(() => row.classList.remove('flash'), 600);

		// Trim to max rows
		const rows = listEl.querySelectorAll('.tape-row');
		if (rows.length > MAX_ROWS) rows[rows.length - 1].remove();
	}

	function open() {
		if (!active) return;
		es = new EventSource(`/api/oracle/trades?mint=${encodeURIComponent(mint)}&network=${encodeURIComponent(network)}`);

		es.addEventListener('hello', (e) => {
			const d = JSON.parse(e.data || '{}');
			setStatus('Live trades', true);
			if (d.roster_size) statusEl.title = `${d.roster_size} wallets annotated`;
		});

		es.addEventListener('trade', (e) => {
			let trade; try { trade = JSON.parse(e.data); } catch { return; }
			addRow(trade);
		});

		es.addEventListener('ping', () => { /* keep-alive — no UI action */ });

		es.addEventListener('bye', () => {
			es.close();
			if (active) reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS);
		});

		es.onerror = () => {
			setStatus('Reconnecting…', false);
			es.close();
			if (active) reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS * 2);
		};
	}

	open();

	return {
		destroy() {
			active = false;
			clearTimeout(reconnectTimer);
			try { es?.close(); } catch {}
			container.innerHTML = '';
		},
	};
}
