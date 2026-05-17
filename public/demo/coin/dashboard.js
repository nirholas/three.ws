// three.ws coin demo dashboard — vanilla module, no framework.
//
// Lifecycle:
//   1. Parse mint from /demo/coin/<mint>/ URL or ?mint= query, fall back to
//      "first active coin" returned by /api/demo/coin/state.
//   2. Fetch state every 10s; render pots, KPIs, countdown.
//   3. Tabs (winners | holders | claims | reflections) lazy-fetch their
//      data on first open and refresh on the same 10s tick.
//   4. Wallet input (persisted to localStorage) fetches /api/demo/coin/holder
//      and renders per-wallet stats + recent payouts.

const POLL_MS = 10_000;
const LS_KEY = 'threews-coin-demo-wallet';
const API_BASE = '/api/demo/coin';

const $ = (sel) => document.querySelector(sel);

const state = {
	mint: null,
	intervalId: null,
	activeTab: 'winners',
	tabData: { winners: null, holders: null, claims: null, reflections: null },
	wallet: localStorage.getItem(LS_KEY) || '',
};

function pickMintFromUrl() {
	const m = window.location.pathname.match(/^\/demo\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/);
	if (m) return m[1];
	const q = new URLSearchParams(window.location.search);
	return q.get('mint');
}

function lamportsToSol(lamportsStr) {
	if (lamportsStr == null) return '0';
	const big = BigInt(lamportsStr);
	const whole = big / 1_000_000_000n;
	const frac = big % 1_000_000_000n;
	const fracStr = frac.toString().padStart(9, '0');
	// Trim trailing zeros after 6 decimals but keep at least 3 decimals.
	const trimmed = fracStr.slice(0, 6).replace(/0+$/, '') || '000';
	return `${whole.toLocaleString()}.${trimmed}`;
}

function shortWallet(w) {
	if (!w) return '—';
	return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function fmtTime(iso) {
	if (!iso) return '—';
	const d = new Date(iso);
	const diff = Math.floor((Date.now() - d.getTime()) / 1000);
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return d.toLocaleDateString();
}

function fmtCountdown(targetIso) {
	if (!targetIso) return '—';
	const target = new Date(targetIso).getTime();
	const left = Math.max(0, Math.floor((target - Date.now()) / 1000));
	if (left === 0) return 'drawing now…';
	const m = Math.floor(left / 60);
	const s = left % 60;
	if (m >= 60) {
		const h = Math.floor(m / 60);
		return `${h}h ${m % 60}m ${s.toString().padStart(2, '0')}s`;
	}
	return `${m}m ${s.toString().padStart(2, '0')}s`;
}

async function fetchJson(url) {
	const r = await fetch(url, { credentials: 'omit' });
	if (!r.ok) {
		const text = await r.text().catch(() => '');
		throw new Error(`${r.status}: ${text || r.statusText}`);
	}
	return r.json();
}

function apiUrl(action, params = {}) {
	const q = new URLSearchParams(params);
	if (state.mint) q.set('mint', state.mint);
	return `${API_BASE}/${action}?${q.toString()}`;
}

async function refreshState() {
	const data = await fetchJson(apiUrl('state'));
	state.mint = data.mint;
	$('#coin-name').textContent = data.name || 'Coin';
	const sym = $('#coin-symbol');
	sym.textContent = `$${data.symbol}`;
	sym.hidden = false;
	const live = $('#coin-live');
	const liveText = $('#coin-live-text');
	live.hidden = false;
	live.dataset.live = data.is_live ? 'true' : 'false';
	liveText.textContent = data.is_live ? 'LIVE' : 'DRY-RUN';

	$('#address-row').hidden = false;
	$('#coin-mint').textContent = data.mint;

	$('#pot-lottery').textContent = lamportsToSol(data.pots.lottery_lamports);
	$('#pot-reflection').textContent = lamportsToSol(data.pots.reflection_lamports);
	$('#next-draw').dataset.target = data.cadence.next_draw_at || '';
	$('#next-draw').textContent = fmtCountdown(data.cadence.next_draw_at);

	$('#kpi-claimed').textContent = `${lamportsToSol(data.pots.total_claimed_lamports)} SOL`;
	$('#kpi-holders').textContent = `${data.holders.eligible.toLocaleString()} / ${data.holders.total.toLocaleString()}`;
	$('#kpi-reflection-paid').textContent = `${lamportsToSol(data.paid_total.reflection_lamports)} SOL`;
	$('#kpi-lottery-paid').textContent = `${lamportsToSol(data.paid_total.lottery_lamports)} SOL`;
	$('#kpi-allocation').textContent = `${(data.allocation_bps.lottery / 100).toFixed(0)}/${(data.allocation_bps.reflection / 100).toFixed(0)}/${(data.allocation_bps.ops / 100).toFixed(0)}`;

	return data;
}

async function refreshActiveTab() {
	const tab = state.activeTab;
	const container = $('#tab-content');
	try {
		if (tab === 'winners') {
			const data = await fetchJson(apiUrl('winners', { limit: 25 }));
			state.tabData.winners = data;
			renderWinners(container, data);
		} else if (tab === 'holders') {
			const data = await fetchJson(apiUrl('holders', { limit: 50 }));
			state.tabData.holders = data;
			renderHolders(container, data);
		} else if (tab === 'claims') {
			const data = await fetchJson(apiUrl('history', { limit: 25 }));
			state.tabData.claims = data;
			renderClaims(container, data);
		} else if (tab === 'reflections') {
			const data = state.tabData.claims || (await fetchJson(apiUrl('history', { limit: 25 })));
			state.tabData.reflections = data;
			renderReflections(container, data);
		}
	} catch (err) {
		container.innerHTML = `<div class="error">Failed to load: ${err.message}</div>`;
	}
}

function renderWinners(container, data) {
	if (!data?.winners?.length) {
		container.innerHTML = `<div class="empty">No draws yet — the first one will appear here once the pot has anything in it.</div>`;
		return;
	}
	const me = state.wallet;
	const rows = data.winners
		.map((w) => {
			const isMe = me && w.wallet === me ? 'you' : '';
			const explorer = w.tx_signature
				? `<a href="https://solscan.io/tx/${w.tx_signature}" target="_blank" rel="noopener" title="View transaction on Solana">view tx ↗</a>`
				: w.status === 'resolved'
					? '<span style="color:var(--muted)">pending payout</span>'
					: '<span style="color:var(--muted)">—</span>';
			return `<tr class="${isMe}"><td>${fmtTime(w.created_at)}</td>
				<td class="wallet" title="${w.wallet || ''}">${shortWallet(w.wallet)}</td>
				<td>${lamportsToSol(w.amount_lamports)} SOL</td>
				<td>${explorer}</td>
				<td><span title="Verifiable randomness round ${w.drand_round}; randomness ${w.drand_randomness?.slice(0, 16) || '—'}…">#${w.drand_round}</span></td></tr>`;
		})
		.join('');
	container.innerHTML = `<table><thead><tr>
		<th>When</th><th>Winner</th><th>Amount</th><th>Tx</th><th>Audit</th>
	</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderHolders(container, data) {
	if (!data?.holders?.length) {
		container.innerHTML = `<div class="empty">No holders yet.</div>`;
		return;
	}
	const me = state.wallet;
	const rows = data.holders
		.map((h) => {
			const isMe = me && h.wallet === me ? 'you' : '';
			return `<tr class="${isMe}"><td>#${h.rank}</td>
				<td class="wallet" title="${h.wallet}">${shortWallet(h.wallet)}</td>
				<td>${BigInt(h.balance).toLocaleString()}</td>
				<td>${lamportsToSol(h.total_reflection_paid_lamports)} SOL</td>
				<td>${lamportsToSol(h.total_lottery_won_lamports)} SOL</td></tr>`;
		})
		.join('');
	container.innerHTML = `<table><thead><tr>
		<th>Rank</th><th>Wallet</th><th>Balance</th><th>Reflection paid</th><th>Lottery won</th>
	</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderClaims(container, data) {
	if (!data?.fee_claims?.length) {
		container.innerHTML = `<div class="empty">No creator-fee claims yet. The next cycle will sweep any pending fees.</div>`;
		return;
	}
	const rows = data.fee_claims
		.map((c) => {
			const tx = c.tx_signature
				? `<a href="https://solscan.io/tx/${c.tx_signature}" target="_blank" rel="noopener">tx</a>`
				: '<span style="color:var(--muted)">empty</span>';
			return `<tr><td>${fmtTime(c.created_at)}</td>
				<td>${c.claimed_lamports ? lamportsToSol(c.claimed_lamports) + ' SOL' : '0 SOL'}</td>
				<td>${c.lottery_lamports ? lamportsToSol(c.lottery_lamports) + ' SOL' : '—'}</td>
				<td>${c.reflection_lamports ? lamportsToSol(c.reflection_lamports) + ' SOL' : '—'}</td>
				<td>${tx}</td></tr>`;
		})
		.join('');
	container.innerHTML = `<table><thead><tr>
		<th>When</th><th>Claimed</th><th>→ Lottery</th><th>→ Reflection</th><th>Tx</th>
	</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderReflections(container, data) {
	if (!data?.reflection_batches?.length) {
		container.innerHTML = `<div class="empty">No reflection batches yet. Each cycle pays accrued SOL to every eligible holder pro-rata.</div>`;
		return;
	}
	const rows = data.reflection_batches
		.map((b) => {
			return `<tr><td>${fmtTime(b.created_at)}</td>
				<td>${b.batch_id?.split('-').slice(-1)[0] || '—'}</td>
				<td>${b.queued || 0}</td>
				<td>${lamportsToSol(b.allocated_lamports || '0')} SOL</td></tr>`;
		})
		.join('');
	container.innerHTML = `<table><thead><tr>
		<th>When</th><th>Batch</th><th>Holders paid</th><th>Total distributed</th>
	</tr></thead><tbody>${rows}</tbody></table>`;
}

async function refreshWallet() {
	const wallet = state.wallet;
	if (!wallet) {
		$('#wallet-stats').hidden = true;
		$('#wallet-payouts').hidden = true;
		return;
	}
	try {
		const data = await fetchJson(apiUrl('holder', { wallet }));
		$('#wallet-balance').innerHTML = `${BigInt(data.balance || '0').toLocaleString()}<span class="unit">tokens</span>`;
		$('#wallet-reflection-paid').innerHTML = `${lamportsToSol(data.total_reflection_paid_lamports || '0')}<span class="unit">SOL</span>`;
		$('#wallet-accrued').innerHTML = `${lamportsToSol(data.accrued_reflection_lamports || '0')}<span class="unit">SOL</span>`;
		$('#wallet-lottery').innerHTML = `${lamportsToSol(data.total_lottery_won_lamports || '0')}<span class="unit">SOL</span>`;
		$('#wallet-stats').hidden = false;

		// Recent payouts inline list.
		const list = $('#wallet-payouts');
		if (data.recent_payouts?.length) {
			const rows = data.recent_payouts
				.slice(0, 8)
				.map((p) => {
					const sym = p.kind === 'lottery' ? '🎟' : '⟳';
					const tx = p.tx_signature
						? `<a href="https://solscan.io/tx/${p.tx_signature}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">${p.status}</a>`
						: p.status;
					return `<tr><td style="width:24px">${sym}</td><td>${p.kind}</td><td>${lamportsToSol(p.amount_lamports)} SOL</td><td style="text-align:right;color:var(--muted)">${fmtTime(p.created_at)} · ${tx}</td></tr>`;
				})
				.join('');
			list.innerHTML = `<table>${rows}</table>`;
			list.hidden = false;
		} else {
			list.hidden = true;
		}
	} catch (err) {
		console.error('[coin-dashboard] wallet fetch failed', err);
	}
}

function bindTabs() {
	for (const btn of document.querySelectorAll('.tabs button')) {
		btn.addEventListener('click', () => {
			for (const b of document.querySelectorAll('.tabs button')) {
				b.setAttribute('aria-selected', String(b === btn));
			}
			state.activeTab = btn.dataset.tab;
			refreshActiveTab();
		});
	}
}

function bindWallet() {
	const input = $('#wallet-input');
	input.value = state.wallet || '';
	$('#wallet-check').addEventListener('click', () => {
		const v = input.value.trim();
		state.wallet = v;
		if (v) localStorage.setItem(LS_KEY, v);
		else localStorage.removeItem(LS_KEY);
		refreshWallet();
		refreshActiveTab(); // re-highlight "you" rows
	});
	$('#wallet-clear').addEventListener('click', () => {
		state.wallet = '';
		input.value = '';
		localStorage.removeItem(LS_KEY);
		refreshWallet();
		refreshActiveTab();
	});
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') $('#wallet-check').click();
	});
}

function bindCopy() {
	$('#copy-mint').addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(state.mint || '');
			$('#copy-mint').textContent = 'copied';
			setTimeout(() => ($('#copy-mint').textContent = 'copy'), 1500);
		} catch {
			/* ignore */
		}
	});
}

function tickCountdown() {
	const el = $('#next-draw');
	if (!el) return;
	el.textContent = fmtCountdown(el.dataset.target || '');
}

async function tick() {
	try {
		await refreshState();
		await refreshActiveTab();
		await refreshWallet();
	} catch (err) {
		console.error('[coin-dashboard] tick failed', err);
		if (!state.mint) {
			$('#coin-name').textContent = 'No active coin';
			$('#header').innerHTML += `<div style="color:var(--err);font-size:13px;margin-left:10px">${err.message}</div>`;
		}
	}
}

(async function main() {
	state.mint = pickMintFromUrl();
	bindTabs();
	bindWallet();
	bindCopy();
	await tick();
	setInterval(tick, POLL_MS);
	setInterval(tickCountdown, 1000);
})();
