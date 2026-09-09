// Fade Radar page: the coins proven-losing money is crowding into right now.
//
// Reads /api/pump/fade (calibration once, then the coin board or the wallet
// board) and renders every state: loading, empty, error, populated. View and
// window live in the URL (?view&hours) so a board is deep-linkable, and the
// calibration strip is fetched first because it is the reason to believe any
// number under it.
//
// The page spends nothing and signs nothing. On a bonding curve the only
// tradeable form of a fade is not buying, so every action here is a link out:
// the coin's intel page, its pump.fun listing, a wallet's on-chain history.

const stripEl = document.getElementById('frStrip');
const boardEl = document.getElementById('frBoard');
const viewSeg = document.getElementById('frViewSeg');
const windowSeg = document.getElementById('frWindowSeg');
const windowField = document.getElementById('frWindowField');
const activeSeg = document.getElementById('frActiveSeg');
const activeField = document.getElementById('frActiveField');

const WINDOW_LABEL = { 1: 'the last hour', 6: 'the last 6 hours', 24: 'the last day', 72: 'the last 3 days' };
const BAND_LABEL = { clear: 'Clear', caution: 'Caution', avoid: 'Avoid' };
const BAND_BLURB = {
	clear: 'No reverse indicator in the coin',
	caution: 'Some reverse-indicator money',
	avoid: 'A quarter of the buy side or more',
};

const ACTIVE_LABEL = { 24: 'in the last day', 168: 'in the last week', 0: 'at any point on record' };

const state = { view: 'coins', hours: 6, activeHours: 168 };
let runSeq = 0;

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shortAddr(a) {
	const s = String(a || '');
	return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}
function shortDate(iso) {
	if (!iso) return 'unknown';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function ago(iso) {
	if (!iso) return 'unknown';
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return 'unknown';
	const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
	if (mins < 60) return `${mins}m ago`;
	if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
	return `${Math.round(mins / 1440)}d ago`;
}
function pctText(share) {
	return `${Math.round(Number(share || 0) * 100)}%`;
}

// ── the calibration strip: why any of this is worth reading ─────────────────

function stripSkeleton() {
	stripEl.innerHTML = `<div class="fr-skel-block short" aria-hidden="true"></div>`;
}

function renderStrip(cal) {
	if (!cal || !cal.computed || !Array.isArray(cal.bands) || !cal.bands.length) {
		stripEl.innerHTML = `
			<div class="fr-strip-note">
				<p>The measured odds behind these bands are still being computed. The board below is live either way: it reports what is in each coin, not what will happen to it.</p>
			</div>`;
		return;
	}
	const total = Number(cal.sample_coins || 0).toLocaleString();
	const cards = cal.bands
		.map((b) => {
			const coins = Number(b.coins || 0).toLocaleString();
			const lift = b.lift == null ? '' : `<small>${b.band === 'clear' ? 'the baseline' : `${b.lift}x the baseline`}</small>`;
			return `
				<div class="fr-band fr-band-${esc(b.band)}">
					<dt>${esc(BAND_LABEL[b.band] || b.band)}</dt>
					<dd>${Number(b.win_pct || 0).toFixed(1)}%</dd>
					<p>${esc(BAND_BLURB[b.band] || '')}</p>
					<small>${coins} coins</small>
					${lift}
				</div>`;
		})
		.join('');
	stripEl.innerHTML = `
		<h2 class="fr-strip-title">How often a coin in each band went on to win</h2>
		<dl class="fr-bands">${cards}</dl>
		<p class="fr-strip-foot">
			A win is a coin that graduated to an AMM or peaked at 3x or better. Measured on
			${total} labelled coins, out of sample: the reverse-indicator cohort is built only
			from coins whose outcome was known before the coins it is graded on existed.
			Recomputed from live history, last on ${esc(shortDate(cal.computed_at))}.
		</p>`;
}

// ── the boards ──────────────────────────────────────────────────────────────

function boardSkeleton() {
	boardEl.innerHTML = `
		<div class="fr-skel" aria-busy="true" aria-label="Loading the board">
			<div class="fr-skel-block tall"></div>
		</div>`;
}

function boardError(message, retry) {
	boardEl.innerHTML = `
		<div class="fr-error" role="alert">
			<h3>The board could not be loaded</h3>
			<p>${esc(message)}</p>
			<button type="button" id="frRetry">Try again</button>
		</div>`;
	document.getElementById('frRetry').addEventListener('click', retry);
}

function coinsEmpty() {
	boardEl.innerHTML = `
		<div class="fr-empty">
			<h3>Nothing to fade in ${esc(WINDOW_LABEL[state.hours] || 'this window')}</h3>
			<p>
				No coin launched in this window has a proven reverse indicator on its buy side yet.
				That is the good outcome, and it changes minute to minute. Widen the window, or watch
				what the proven winners are buying instead.
			</p>
			<a href="/smart-money">Open the Smart Money Radar</a>
		</div>`;
}

function walletsEmpty() {
	const active = state.activeHours
		? `No reverse indicator has traded ${ACTIVE_LABEL[state.activeHours]}`
		: 'No reverse indicator has met the bar yet';
	boardEl.innerHTML = `
		<div class="fr-empty">
			<h3>${esc(active)}</h3>
			<p>
				A wallet joins this board only after five coins it bought have a known outcome and not
				one of them won. Until the graph has watched that many, every wallet here is simply new.
				${state.activeHours ? 'Widen the window to see the ones that have gone quiet.' : ''}
			</p>
			<a href="/smart-money">Open the Smart Money Radar</a>
		</div>`;
}

function coinRow(c) {
	const symbol = c.symbol ? `$${esc(c.symbol)}` : `${esc(String(c.mint).slice(0, 6))}…`;
	const name = c.name ? `<small>${esc(c.name)}</small>` : '';
	return `
		<tr>
			<td class="fr-coin">
				<a href="/oracle/coin/${encodeURIComponent(c.mint)}">${symbol}</a>${name}
			</td>
			<td>
				<div class="fr-score" title="${esc(c.summary || '')}">
					<div class="fr-score-bar"><span style="width:${Math.max(2, Number(c.score) || 0)}%"></span></div>
					<b>${Number(c.score) || 0}</b>
				</div>
			</td>
			<td><span class="fr-pill fr-pill-${esc(c.verdict)}">${esc(BAND_LABEL[c.verdict] || c.verdict)}</span></td>
			<td class="num">${Number(c.ri_buyers) || 0} / ${Number(c.buyers) || 0}</td>
			<td class="num">${pctText(c.ri_volume_share)}</td>
			<td class="num">${Number(c.total_buy_sol || 0).toFixed(2)}</td>
			<td>${esc(ago(c.first_seen_at))}</td>
			<td><a href="https://pump.fun/${esc(c.mint)}" target="_blank" rel="noopener noreferrer">pump.fun</a></td>
		</tr>`;
}

function walletRow(w) {
	const labels = (w.labels || []).slice(0, 2).map((l) => `<span class="fr-tag">${esc(l)}</span>`).join('');
	return `
		<tr>
			<td class="fr-addr">
				<a href="https://solscan.io/account/${esc(w.wallet)}" target="_blank" rel="noopener noreferrer">${esc(shortAddr(w.wallet))}</a>
				${labels}
			</td>
			<td class="num">${Number(w.judged_buys) || 0}</td>
			<td class="num">0</td>
			<td class="num">${Number(w.losers) || 0}</td>
			<td>${esc(ago(w.last_seen))}</td>
			<td><a href="/smart-money?wallet=${encodeURIComponent(w.wallet)}">Track record</a></td>
		</tr>`;
}

function renderCoins(data) {
	if (!data.coins.length) return coinsEmpty();
	boardEl.innerHTML = `
		<p class="fr-caption">
			${data.coins.length} coin${data.coins.length === 1 ? '' : 's'} launched in
			${esc(WINDOW_LABEL[state.hours] || 'this window')} with proven-losing money on the buy side,
			heaviest share first.
		</p>
		<div class="fr-tablewrap">
			<table class="fr-table">
				<thead>
					<tr>
						<th scope="col">Coin</th>
						<th scope="col">Fade score</th>
						<th scope="col">Verdict</th>
						<th scope="col">Reverse / buyers</th>
						<th scope="col">Reverse share of SOL</th>
						<th scope="col">Observed buys</th>
						<th scope="col">Launched</th>
						<th scope="col"><span class="sr-only">Listing</span></th>
					</tr>
				</thead>
				<tbody>${data.coins.map(coinRow).join('')}</tbody>
			</table>
		</div>`;
}

function renderWallets(data) {
	if (!data.wallets.length) return walletsEmpty();
	boardEl.innerHTML = `
		<p class="fr-caption">
			${data.wallets.length} wallet${data.wallets.length === 1 ? '' : 's'} with a judged record and
			not one winner in it, seen ${esc(ACTIVE_LABEL[state.activeHours] || 'at any point on record')},
			most-watched first.
		</p>
		<div class="fr-tablewrap">
			<table class="fr-table">
				<thead>
					<tr>
						<th scope="col">Wallet</th>
						<th scope="col">Judged buys</th>
						<th scope="col">Winners</th>
						<th scope="col">Losers</th>
						<th scope="col">Last seen</th>
						<th scope="col"><span class="sr-only">Record</span></th>
					</tr>
				</thead>
				<tbody>${data.wallets.map(walletRow).join('')}</tbody>
			</table>
		</div>`;
}

// ── loading ─────────────────────────────────────────────────────────────────

async function getJson(url) {
	const res = await fetch(url, { headers: { accept: 'application/json' } });
	if (!res.ok) {
		let detail = `the server answered ${res.status}`;
		try {
			const body = await res.json();
			if (body && (body.error_description || body.error)) detail = body.error_description || body.error;
		} catch {
			detail = `the server answered ${res.status}`;
		}
		throw new Error(detail);
	}
	return res.json();
}

async function loadStrip() {
	stripSkeleton();
	try {
		renderStrip(await getJson('/api/pump/fade?calibration=1'));
	} catch {
		renderStrip(null);
	}
}

async function loadBoard() {
	const seq = ++runSeq;
	boardSkeleton();
	const url =
		state.view === 'wallets'
			? `/api/pump/fade?wallets=1&limit=40&min_judged=8&active_hours=${state.activeHours}`
			: `/api/pump/fade?hours=${state.hours}&limit=40`;
	try {
		const data = await getJson(url);
		if (seq !== runSeq) return;
		if (state.view === 'wallets') renderWallets(data);
		else renderCoins(data);
	} catch (err) {
		if (seq !== runSeq) return;
		boardError(err.message || 'the request failed', loadBoard);
	}
}

// ── state in the URL ────────────────────────────────────────────────────────

function syncControls() {
	for (const b of viewSeg.querySelectorAll('button')) {
		b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
	}
	for (const b of windowSeg.querySelectorAll('button')) {
		b.setAttribute('aria-pressed', String(Number(b.dataset.hours) === state.hours));
	}
	for (const b of activeSeg.querySelectorAll('button')) {
		b.setAttribute('aria-pressed', String(Number(b.dataset.active) === state.activeHours));
	}
	windowField.hidden = state.view !== 'coins';
	activeField.hidden = state.view !== 'wallets';
}

function writeUrl() {
	const url = new URL(window.location.href);
	url.searchParams.set('view', state.view);
	if (state.view === 'coins') {
		url.searchParams.set('hours', String(state.hours));
		url.searchParams.delete('active');
	} else {
		url.searchParams.delete('hours');
		url.searchParams.set('active', String(state.activeHours));
	}
	window.history.replaceState(null, '', url);
}

function readUrl() {
	const params = new URLSearchParams(window.location.search);
	const view = params.get('view');
	if (view === 'wallets' || view === 'coins') state.view = view;
	const hours = Number(params.get('hours'));
	if ([1, 6, 24, 72].includes(hours)) state.hours = hours;
	const active = params.get('active');
	if (active != null && [24, 168, 0].includes(Number(active))) state.activeHours = Number(active);
}

viewSeg.addEventListener('click', (e) => {
	const btn = e.target.closest('button[data-view]');
	if (!btn || btn.dataset.view === state.view) return;
	state.view = btn.dataset.view;
	syncControls();
	writeUrl();
	loadBoard();
});

windowSeg.addEventListener('click', (e) => {
	const btn = e.target.closest('button[data-hours]');
	if (!btn) return;
	const hours = Number(btn.dataset.hours);
	if (hours === state.hours) return;
	state.hours = hours;
	syncControls();
	writeUrl();
	loadBoard();
});

activeSeg.addEventListener('click', (e) => {
	const btn = e.target.closest('button[data-active]');
	if (!btn) return;
	const hours = Number(btn.dataset.active);
	if (hours === state.activeHours) return;
	state.activeHours = hours;
	syncControls();
	writeUrl();
	loadBoard();
});

readUrl();
syncControls();
loadStrip();
loadBoard();
