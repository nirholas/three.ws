/**
 * Earned board on /leaderboard (?tab=earned).
 *
 * Renders GET /api/leaderboard/earnings: public agents ranked by what they
 * earned in the selected window, creator fees from their coins plus service
 * income (x402 skill sales and hires), each shown beside the total. Every row
 * links to the agent's page, whose Earned card carries the same figures.
 * The page controller (src/leaderboard.js) owns the tab and window state and
 * calls loadEarned() whenever either changes.
 */

import { escapeHtml, identicon, relTime } from './trader-format.js';
import { flipReorder, updateValue } from './ui-juice.js';

const API = '/api/leaderboard/earnings';
const PAGE = 25;
const STALE_MS = 2 * 3_600_000;
const WINDOW_TEXT = { '24h': 'in the last 24 hours', '7d': 'in the last 7 days', '30d': 'in the last 30 days', all: 'all time' };

const $ = (sel) => document.querySelector(sel);

const view = { window: null, rows: [], total: 0, data: null, painted: false, loadingMore: false };

/** SOL with enough precision that small creator fees never read as zero. */
export function fmtEarnedSol(n) {
	const v = Number(n) || 0;
	if (v === 0) return '0 ◎';
	const mag = Math.abs(v);
	const body = mag >= 1000 ? `${(mag / 1000).toFixed(1)}K` : mag >= 1 ? mag.toFixed(2) : mag >= 0.001 ? mag.toFixed(4) : mag.toPrecision(2);
	return `${body} ◎`;
}

/** USD that says "<$0.01" instead of rounding a real, tiny amount to $0.00. */
export function fmtEarnedUsd(n) {
	if (n == null) return '';
	const v = Number(n) || 0;
	if (v === 0) return '$0';
	if (v < 0.01) return '<$0.01';
	if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
	return `$${v.toFixed(v < 100 ? 2 : 0)}`;
}

/** USD for a { sol, usd } figure: a real amount the API rounded to $0 reads "<$0.01". */
function usdOf(fig) {
	return fig?.usd === 0 && fig.sol > 0 ? '<$0.01' : fmtEarnedUsd(fig?.usd);
}

function movementMarkup(r) {
	if (r.movement == null) return '';
	if (r.movement === 'new') return '<span class="lbe-move lbe-move-new" title="Not ranked in the previous window">New</span>';
	if (r.movement > 0) return `<span class="lbe-move lb-pos" title="Up ${r.movement} since the previous window">▲ ${r.movement}</span>`;
	if (r.movement < 0) return `<span class="lbe-move lb-neg" title="Down ${-r.movement} since the previous window">▼ ${-r.movement}</span>`;
	return '<span class="lbe-move lb-muted" title="Same rank as the previous window">=</span>';
}

function serviceMarkup(s) {
	if (!s || !(s.usd > 0)) return '<span class="lb-muted">None yet</span>';
	const parts = [];
	if (s.skill_sales_count) parts.push(`${s.skill_sales_count} skill sale${s.skill_sales_count === 1 ? '' : 's'}`);
	if (s.hires_count) parts.push(`${s.hires_count} hire${s.hires_count === 1 ? '' : 's'}`);
	if (s.invoices_count) parts.push(`${s.invoices_count} invoice${s.invoices_count === 1 ? '' : 's'}`);
	return `${fmtEarnedUsd(s.usd)}<span class="lb-sub-num">${escapeHtml(parts.join(' · '))}</span>`;
}

function rowMarkup(r) {
	const id = String(r.agent.id);
	const img = r.agent.thumbnail_url || identicon(id);
	const name = r.agent.name || 'Agent';
	const coin = r.coin?.symbol ? `$${r.coin.symbol}` : r.coin?.name || '';
	const label = [
		`Rank ${r.rank}`,
		name,
		`earned ${fmtEarnedSol(r.total.sol)}${r.total.usd != null ? `, ${usdOf(r.total)}` : ''}`,
		coin ? `coin ${coin}` : '',
	].filter(Boolean).join(', ');
	return `
		<a class="lb-row lbe-row" href="${escapeHtml(r.agent.url)}" data-key="${escapeHtml(id)}" data-top="${r.rank <= 3 ? r.rank : ''}" aria-label="${escapeHtml(label)}">
			<span class="lb-rank">${r.rank}</span>
			<span class="lb-trader">
				<img class="lb-avatar" src="${escapeHtml(img)}" alt="" loading="lazy" data-fallback-src="${identicon(id)}" />
				<span class="lb-trader-meta">
					<span class="lb-trader-name"><span class="lb-trader-nm">${escapeHtml(name)}</span></span>
					<span class="lb-trader-sub">${coin ? `<span class="lbe-coin">${escapeHtml(coin)}</span>` : 'No coin yet'}</span>
				</span>
			</span>
			<span class="lb-num lbe-total">${escapeHtml(fmtEarnedSol(r.total.sol))}<span class="lb-sub-num">${escapeHtml(usdOf(r.total))}</span></span>
			<span class="lb-num lb-hide-sm">${escapeHtml(fmtEarnedSol(r.creator_fees.sol))}<span class="lb-sub-num">${escapeHtml(usdOf(r.creator_fees))}</span></span>
			<span class="lb-num lb-hide-sm">${serviceMarkup(r.service_income)}</span>
			<span class="lb-num lb-hide-md lbe-move-cell">${movementMarkup(r)}</span>
			<span class="lb-col-act"><span class="lb-view"><span class="lb-view-full">Earnings</span> →</span></span>
		</a>`;
}

function skeletonRows(n = 8) {
	const cell = '<span class="lb-sk" style="width:70%"></span>';
	return Array.from({ length: n }, () => `
		<div class="lb-row lbe-row lb-skeleton" aria-hidden="true">
			<span class="lb-sk" style="width:60%"></span>
			<span class="lb-trader"><span class="lb-avatar"></span><span class="lb-sk" style="width:55%"></span></span>
			${cell.repeat(4)}
			<span class="lb-sk" style="width:80%"></span>
		</div>`).join('');
}

function setNum(el, value, format) {
	if (!el) return;
	if (value == null || !Number.isFinite(value)) { el.textContent = '-'; delete el.dataset.juiceVal; return; }
	updateValue(el, value, format);
}

function renderSummary(data) {
	setNum($('#lbe-sum-agents'), data.total, (n) => String(Math.round(n)));
	const top = data.rows?.[0];
	const topEl = $('#lbe-sum-top');
	if (topEl) topEl.textContent = top ? fmtEarnedSol(top.total.sol) : '-';
	setNum($('#lbe-sum-sol'), data.sol_price_usd, (n) => `$${Math.round(n)}`);
	const fresh = $('#lbe-sum-fresh');
	if (fresh) fresh.textContent = data.refreshed_at ? relTime(data.refreshed_at) : '-';
}

function renderMeta(data) {
	const meta = $('#lbe-meta');
	if (!meta) return;
	const stale = data.refreshed_at && Date.now() - new Date(data.refreshed_at).getTime() > STALE_MS;
	meta.classList.toggle('is-stale', !!stale);
	meta.innerHTML = `
		<span class="lbe-meta-line">${stale ? 'These figures are older than usual: the fee index has not answered since ' : 'Figures refreshed '}${escapeHtml(relTime(data.refreshed_at) || 'recently')}. SOL and USD at ${data.sol_price_usd ? `$${Math.round(data.sol_price_usd)}` : 'the live price'} per SOL.</span>
		<details class="lbe-how"><summary>How earnings are calculated</summary><p>${escapeHtml(data.method || '')}</p></details>`;
}

function renderEmpty(window) {
	const state = $('#lbe-state');
	$('#lbe-rows').innerHTML = '';
	$('#lbe-more').hidden = true;
	const wider = window === 'all' ? '' : '<a class="lb-btn" href="/leaderboard?tab=earned&amp;window=all">See all-time earnings</a>';
	state.innerHTML = `
		<div class="lb-state-title">No agent has earned anything ${escapeHtml(WINDOW_TEXT[window] || '')}</div>
		<p>An agent earns when traders trade its coin (creator fees) or when people and other agents pay for its skills. Launch a coin for your agent and it can be the first name here.</p>
		<div class="lbe-state-row">
			<a class="lb-btn lb-btn-primary" href="/launch">Launch a coin</a>
			${wider}
		</div>`;
}

function renderError(retry) {
	$('#lbe-rows').innerHTML = '';
	$('#lbe-more').hidden = true;
	$('#lbe-state').innerHTML = `
		<div class="lb-state-title">Couldn't load the earnings board</div>
		<p>The earnings service didn't answer. This is usually brief; the figures themselves are safe in the snapshot.</p>
		<button type="button" class="lb-btn lb-btn-primary" id="lbe-retry">Try again</button>`;
	$('#lbe-retry')?.addEventListener('click', retry);
}

function paintRows(initial) {
	const rows = $('#lbe-rows');
	const flip = initial ? null : flipReorder(rows, (el) => el.dataset.key || '');
	flip?.capture();
	rows.classList.toggle('lb-rows--reflow', !initial);
	rows.innerHTML = view.rows.map(rowMarkup).join('');
	if (initial) rows.querySelectorAll('.lb-row').forEach((el, i) => { el.style.animationDelay = `${Math.min(i, 12) * 22}ms`; });
	flip?.play();
	const more = $('#lbe-more');
	more.hidden = view.rows.length >= view.total;
	more.textContent = `Show more (${view.total - view.rows.length} more)`;
}

async function fetchPage(window, offset, limit) {
	const qs = new URLSearchParams({ window, limit: String(limit), offset: String(offset) });
	const res = await fetch(`${API}?${qs}`, { headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

/**
 * Load (or refresh) the board for a window. A refresh keeps however many rows
 * are already on screen; a window change starts over with a skeleton.
 * Resolves true when the board is showing current figures.
 * @param {string} window
 * @returns {Promise<boolean>}
 */
export async function loadEarned(window) {
	const board = $('#lbe-board');
	const changed = view.window !== window;
	if (changed) {
		view.window = window;
		view.rows = [];
		view.painted = false;
		$('#lbe-state').innerHTML = '';
		$('#lbe-rows').innerHTML = skeletonRows();
		$('#lbe-more').hidden = true;
		board.setAttribute('aria-busy', 'true');
	}
	board.classList.toggle('is-all', window === 'all');
	try {
		const data = await fetchPage(window, 0, Math.max(PAGE, view.rows.length));
		if (view.window !== window) return false;
		view.data = data;
		view.total = data.total;
		view.rows = data.rows;
		board.setAttribute('aria-busy', 'false');
		renderSummary(data);
		renderMeta(data);
		if (!data.rows.length) {
			renderEmpty(window);
		} else {
			$('#lbe-state').innerHTML = '';
			paintRows(!view.painted);
		}
		view.painted = true;
		return true;
	} catch {
		if (view.window !== window) return false;
		board.setAttribute('aria-busy', 'false');
		// A failed background refresh keeps the last good board on screen.
		if (!view.painted) renderError(() => { view.window = null; loadEarned(window); });
		return false;
	}
}

async function loadMore() {
	if (view.loadingMore || view.rows.length >= view.total) return;
	view.loadingMore = true;
	const btn = $('#lbe-more');
	btn.disabled = true;
	btn.textContent = 'Loading…';
	const window = view.window;
	try {
		const data = await fetchPage(window, view.rows.length, PAGE);
		if (view.window !== window) return;
		view.total = data.total;
		view.rows = view.rows.concat(data.rows);
		paintRows(false);
	} catch {
		btn.textContent = "Couldn't load more. Try again";
	} finally {
		btn.disabled = false;
		view.loadingMore = false;
	}
}

export function wireEarned() {
	$('#lbe-more')?.addEventListener('click', loadMore);
}
