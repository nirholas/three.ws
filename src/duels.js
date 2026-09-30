// /duels: the trader-duels board. Call which of two traders books more
// realized P&L over a fixed UTC window, with free daily points.
//
// Reads GET /api/duels (the board, per tab), GET /api/duels/me (points, level,
// season standing, recent calls, badges; credits today's free allowance) and
// GET /api/duels/leaderboard (the season's predictors). Points have no cash
// value; nothing on this page can move a token.

import { apiFetch } from './api.js';
import { esc, toast, errorMessage, hydrateAvatars } from './syndicate-shared.js';
import { duelCard, pts, until, fmtUtc, FREE_LINE } from './duels-shared.js';

const listEl = document.getElementById('dxList');
const meEl = document.getElementById('dxMe');
const tabsEl = document.getElementById('dxTabs');
const lbEl = document.getElementById('dxLb');
const callsEl = document.getElementById('dxCalls');
const filterEl = document.getElementById('dxFilter');
const rulesEl = document.getElementById('dxRules');

const DUEL_BADGES = [
	{ code: 'duel_first', label: 'First Call', icon: '🎲', how: 'Make your first call on a trader duel.' },
	{ code: 'duel_hit', label: 'Called It', icon: '📣', how: 'Call a trader duel correctly.' },
	{ code: 'duel_streak_3', label: 'Hot Hand', icon: '🔥', how: 'Call three decided duels in a row correctly.' },
	{ code: 'duel_sharp', label: 'Sharp Caller', icon: '🧠', how: 'Be right on at least 70% of ten or more decided duels.' },
];
const TABS = [
	{ key: 'open', label: 'Open for calls' },
	{ key: 'live', label: 'Live' },
	{ key: 'settled', label: 'Settled' },
];

const params = new URLSearchParams(location.search);
const agentFilter = /^[0-9a-f-]{36}$/i.test(params.get('agent') || '') ? params.get('agent') : null;
let phase = TABS.some((t) => t.key === params.get('phase')) ? params.get('phase') : null;
let board = null;
let me = null;
let loadSeq = 0;

function setUrl() {
	const q = new URLSearchParams();
	if (phase && phase !== 'open') q.set('phase', phase);
	if (agentFilter) q.set('agent', agentFilter);
	const s = q.toString();
	history.replaceState(null, '', `/duels${s ? `?${s}` : ''}`);
}

async function getJson(path) {
	const r = await apiFetch(path, { allowAnonymous: true, headers: { accept: 'application/json' } });
	if (!r.ok) {
		const { message } = await errorMessage(r, `The server answered ${r.status}.`);
		throw new Error(message);
	}
	return r.json();
}

// ── the board ───────────────────────────────────────────────

async function loadBoard() {
	const seq = ++loadSeq;
	listEl.setAttribute('aria-busy', 'true');
	listEl.innerHTML = `<ul class="dx-grid" aria-hidden="true">${'<li><div class="sy-skel" style="height:196px"></div></li>'.repeat(3)}</ul>`;
	try {
		const want = phase || 'open';
		const q = new URLSearchParams({ phase: want });
		if (agentFilter) q.set('agent', agentFilter);
		let data = await getJson(`/api/duels?${q}`);
		// First visit with nothing open: land on whichever tab has something to show.
		if (!phase && !data.duels.length) {
			const fallback = data.counts.live ? 'live' : data.counts.settled ? 'settled' : null;
			if (fallback) {
				q.set('phase', fallback);
				data = await getJson(`/api/duels?${q}`);
				phase = fallback;
			}
		}
		if (seq !== loadSeq) return;
		phase = phase || 'open';
		board = data;
		setUrl();
		renderTabs();
		renderBoard();
		renderRules(data.rules);
	} catch (err) {
		if (seq !== loadSeq) return;
		listEl.innerHTML = `
			<div class="sy-state" role="alert">
				<h2>Duels did not load</h2>
				<p>${esc(err instanceof TypeError ? 'Could not reach three.ws. Check your connection.' : err.message)} Calls you already made are safe: they are stored with the duel and settle on schedule.</p>
				<button type="button" class="sy-btn primary" id="dxRetry">Try again</button>
			</div>`;
		document.getElementById('dxRetry').addEventListener('click', loadBoard);
	} finally {
		if (seq === loadSeq) listEl.setAttribute('aria-busy', 'false');
	}
}

function renderTabs() {
	const counts = board?.counts || {};
	tabsEl.innerHTML = TABS.map((t) => `
		<button type="button" data-tab="${t.key}" aria-pressed="${phase === t.key}">${esc(t.label)}${counts[t.key] ? ` <span class="sy-faint">${esc(counts[t.key])}</span>` : ''}</button>`).join('');
	for (const b of tabsEl.querySelectorAll('[data-tab]')) {
		b.addEventListener('click', () => {
			if (phase === b.dataset.tab) return;
			phase = b.dataset.tab;
			loadBoard();
		});
	}
	if (agentFilter && board.duels[0]) {
		const d = board.duels[0];
		const name = d.a.agent_id === agentFilter ? d.a.name : d.b.name;
		filterEl.innerHTML = `Showing duels featuring <b>${esc(name)}</b> · <a href="/duels">show all</a>`;
		filterEl.hidden = false;
	} else if (agentFilter) {
		filterEl.innerHTML = `Showing duels featuring one trader · <a href="/duels">show all</a>`;
		filterEl.hidden = false;
	}
}

function renderBoard() {
	const now = Date.now();
	const duels = board.duels || [];
	if (!duels.length) {
		listEl.innerHTML = emptyState();
		return;
	}
	listEl.innerHTML = `<ul class="dx-grid" aria-label="${esc(TABS.find((t) => t.key === phase)?.label || 'Duels')}">${duels.map((d) => duelCard(d, now)).join('')}</ul>`;
	hydrateAvatars(listEl);
}

function emptyState() {
	const c = board.counts;
	const total = c.open + c.live + c.settled;
	const rules = board.rules;
	if (agentFilter) {
		return `
			<div class="sy-state">
				<h2>No ${phase === 'open' ? 'open ' : phase === 'live' ? 'live ' : 'settled '}duels for this trader</h2>
				<p>Duels pair each trader with the one directly next to them on the ${esc(rules.board_window)} board. This trader may be in a duel on another tab, or not paired this window.</p>
				<div class="sy-actions" style="justify-content:center"><a class="sy-btn primary" href="/duels">See every duel</a><a class="sy-btn" href="/trader/${esc(agentFilter)}">Trader profile</a></div>
			</div>`;
	}
	if (!total) {
		const need = Math.max(0, 2 - board.eligible_traders);
		return `
			<div class="sy-state">
				<h2>The first duels are warming up</h2>
				<p>A duel needs two public traders who each closed at least ${esc(rules.board_min_closed)} trades in the last ${esc(rules.board_window)}. ${board.eligible_traders === 1 ? 'One trader qualifies right now' : `${esc(board.eligible_traders)} traders qualify right now`}${need ? `, so ${need === 1 ? 'one more is' : `${need} more are`} needed` : ''}. New duels open every UTC day as soon as the board has a pair.</p>
				<div class="sy-actions" style="justify-content:center">
					<a class="sy-btn primary" href="/trade-rooms">Watch live trade rooms</a>
					<a class="sy-btn" href="/leaderboard">Trader leaderboard</a>
					<a class="sy-btn" href="/create-agent">Launch a trader</a>
				</div>
			</div>`;
	}
	if (phase === 'open') {
		return `
			<div class="sy-state">
				<h2>No duels are taking calls right now</h2>
				<p>Tomorrow's 24-hour duels open at 00:00 UTC, in ${esc(until(nextUtcMidnight()))}. Meanwhile, watch the ${c.live ? `${esc(c.live)} live ${c.live === 1 ? 'duel' : 'duels'}` : 'settled duels'}.</p>
				<div class="sy-actions" style="justify-content:center"><button type="button" class="sy-btn primary" data-go="${c.live ? 'live' : 'settled'}">${c.live ? 'See live duels' : 'See settled duels'}</button></div>
			</div>`;
	}
	return `
		<div class="sy-state">
			<h2>${phase === 'live' ? 'No duel windows are running right now' : 'No duels have settled yet'}</h2>
			<p>${phase === 'live' ? 'Duels go live when their window starts and calls lock.' : 'A duel settles a few minutes after its window closes, straight from the trade ledger.'}${c.open ? ` ${esc(c.open)} ${c.open === 1 ? 'duel is' : 'duels are'} open for calls.` : ''}</p>
			${c.open ? `<div class="sy-actions" style="justify-content:center"><button type="button" class="sy-btn primary" data-go="open">Make a call</button></div>` : ''}
		</div>`;
}

listEl.addEventListener('click', (e) => {
	const go = e.target.closest('[data-go]');
	if (!go) return;
	phase = go.dataset.go;
	loadBoard();
});

function nextUtcMidnight() {
	const d = new Date();
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

function renderRules(r) {
	if (!r || rulesEl.dataset.filled) return;
	rulesEl.dataset.filled = '1';
	rulesEl.innerHTML = `
		<li><b>Every day you get ${esc(pts(r.daily_allowance))}, free.</b> They top up at 00:00 UTC. ${esc(FREE_LINE)}</li>
		<li><b>Pick the trader who books more realized P&L</b> over the duel's window: a 24-hour UTC day, or a Monday-to-Monday week. Stake ${esc(r.min_stake)} to ${esc(r.max_stake)} points, one call per duel.</li>
		<li><b>Calls lock when the window starts.</b> You cannot call a duel featuring an agent you own.</li>
		<li><b>Resolved from the trade ledger</b> about ${esc(r.resolve_grace_minutes)} minutes after the window closes: closed round-trips only, the same math as the trader's profile, and profit on a trader's own coins does not count.</li>
		<li><b>A correct call pays ${esc(r.win_multiplier)}x your stake and ${esc(r.xp_per_win)} XP</b> toward your level on <a href="/quests">Quests</a>. A wrong call keeps nothing.</li>
		<li><b>Ties, a window where neither trader trades, or a trader who goes private void the duel</b> and refund every call. A trader who sits out while the other trades counts as flat: that beats a loss and loses to a profit.</li>`;
}

// ── the predictor ───────────────────────────────────────────

async function loadMe() {
	try {
		me = await getJson('/api/duels/me');
	} catch {
		meEl.innerHTML = `<div class="sy-note" role="status">Your points did not load. The board still works; <button type="button" class="sy-btn sm" id="dxMeRetry">retry</button></div>`;
		document.getElementById('dxMeRetry').addEventListener('click', loadMe);
		callsEl.innerHTML = '';
		return;
	}
	renderMe();
	renderCalls();
	if (me.wallet?.granted_now) toast(`+${me.wallet.daily_allowance} free points for today`);
	for (const code of me.newly_unlocked || []) {
		const b = DUEL_BADGES.find((x) => x.code === code);
		if (b) toast(`Badge unlocked: ${b.label}`);
	}
}

function renderMe() {
	if (!me.signed_in) {
		const next = encodeURIComponent(location.pathname + location.search);
		meEl.innerHTML = `
			<div class="sy-panel" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;margin-bottom:22px">
				<div style="min-width:0;max-width:62ch">
					<b style="font-size:16px">Sign in to make calls</b>
					<p class="sy-muted" style="margin:4px 0 0;line-height:1.5">You get ${esc(pts(me.rules.daily_allowance))} free every day. Correct calls earn points, XP and badges.</p>
				</div>
				<div class="sy-actions"><a class="sy-btn primary" href="/login?next=${next}">Sign in</a><a class="sy-btn" href="/register?next=${next}">Create an account</a></div>
			</div>`;
		return;
	}
	const s = me.season.standing;
	meEl.innerHTML = `
		<div class="dx-me">
			<section class="sy-panel dx-stat" aria-label="Your points">
				<span class="dx-coin" aria-hidden="true">pts</span>
				<div style="min-width:0">
					<div class="dx-stat-lbl">Your points</div>
					<div class="dx-stat-num">${esc(me.wallet.balance.toLocaleString('en-US'))}</div>
					<small>+${esc(me.wallet.daily_allowance)} free in <span data-until="${esc(me.wallet.next_grant_at)}">${esc(until(me.wallet.next_grant_at))}</span></small>
				</div>
			</section>
			<section class="sy-panel dx-stat" aria-label="Your level">
				<span class="qx-level-num" style="width:48px;height:48px;font-size:20px;border-radius:14px" aria-hidden="true">${esc(me.xp.level)}</span>
				<div style="min-width:0">
					<div class="dx-stat-lbl">Level ${esc(me.xp.level)}</div>
					<div class="qx-bar" role="progressbar" aria-label="Progress to level ${esc(me.xp.level + 1)}" aria-valuemin="0" aria-valuemax="${esc(me.xp.level_span)}" aria-valuenow="${esc(me.xp.into_level)}"><i style="--p:${me.xp.level_span ? Math.round((me.xp.into_level / me.xp.level_span) * 100) : 0}%"></i></div>
					<small>${esc(me.xp.total)} XP, ${esc(me.xp.from_duels)} from correct calls · <a href="/quests">Quests</a></small>
				</div>
			</section>
			<section class="sy-panel dx-stat" aria-label="Your season">
				<div style="min-width:0">
					<div class="dx-stat-lbl">${esc(me.season.label)} season</div>
					<div class="dx-stat-num">${s ? `#${esc(s.rank)}` : 'Unranked'}</div>
					<small>${s ? `${esc(pts(s.net, { sign: true }))} · ${esc(s.wins)} of ${esc(s.decided)} calls right` : 'Your first decided call puts you on the board.'}</small>
				</div>
			</section>
		</div>`;
}

function renderCalls() {
	const earned = new Set((me.badges || []).map((b) => b.code));
	const badges = `
		<h2 class="sy-h2" id="dxBadgesTitle" style="margin-top:18px">Duel badges <small>earned once, kept forever</small></h2>
		<div class="qx-badges" aria-labelledby="dxBadgesTitle">
			${DUEL_BADGES.map((b) => `<span class="qx-badge${earned.has(b.code) ? '' : ' locked'}" title="${esc(b.how)}"><span aria-hidden="true">${b.icon}</span>${esc(b.label)}${earned.has(b.code) ? '' : `<span class="sr-only"> (locked: ${esc(b.how)})</span>`}</span>`).join('')}
		</div>`;
	if (!me.signed_in) {
		callsEl.innerHTML = `<h2 class="sy-h2">Your calls</h2><p class="sy-muted" style="font-size:14px;line-height:1.55;margin:0">Sign in and your calls, results and points history show up here.</p>${badges}`;
		return;
	}
	const calls = me.calls || [];
	const statusText = (c) => {
		if (c.status === 'won') return `<span class="pos">${esc(pts(c.net, { sign: true }))}</span>`;
		if (c.status === 'lost') return `<span class="neg">${esc(pts(c.net, { sign: true }))}</span>`;
		if (c.status === 'refunded') return '<span class="flat">Refunded</span>';
		return c.phase === 'open' ? `<span class="sy-faint">Locks ${esc(until(c.window_start))}</span>` : '<span class="sy-faint">In play</span>';
	};
	callsEl.innerHTML = `
		<h2 class="sy-h2">Your calls <small>${calls.length ? `last ${calls.length}` : ''}</small></h2>
		${calls.length
			? `<ul class="dx-calls">${calls.map((c) => `<li><a href="${esc(c.url)}"><span><b>${esc(c.picked)}</b> <span class="sy-faint">in ${esc(c.label)} · ${esc(pts(c.stake))}</span></span>${statusText(c)}</a></li>`).join('')}</ul>`
			: '<p class="sy-muted" style="font-size:14px;line-height:1.55;margin:0">No calls yet. Pick a duel above and back the trader you think books more.</p>'}
		${badges}`;
}

// ── season leaderboard ──────────────────────────────────────

async function loadLeaderboard() {
	try {
		const data = await getJson('/api/duels/leaderboard?limit=15');
		const rows = data.leaders || [];
		const mine = data.me && !rows.some((r) => r.is_me) ? data.me : null;
		const row = (r) => `
			<li class="${r.is_me ? 'me' : ''}">
				<span class="rk">#${esc(r.rank)}</span>
				${r.avatar ? `<img class="sy-ava" style="width:30px;height:30px" src="${esc(r.avatar)}" alt="" loading="lazy" data-initial="${esc((r.name[0] || '?').toUpperCase())}" />` : `<span class="sy-ava" style="width:30px;height:30px" aria-hidden="true">${esc((r.name[0] || '?').toUpperCase())}</span>`}
				${r.profile ? `<a href="${esc(r.profile)}"><b>${esc(r.name)}${r.is_me ? ' (you)' : ''}</b><small>${esc(r.wins)} of ${esc(r.decided)} right</small></a>` : `<span style="min-width:0"><b>${esc(r.name)}${r.is_me ? ' (you)' : ''}</b><small>${esc(r.wins)} of ${esc(r.decided)} right</small></span>`}
				<span class="net ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : 'flat'}">${esc(pts(r.net, { sign: true }))}</span>
			</li>`;
		lbEl.innerHTML = `
			<h2 class="sy-h2">${esc(data.season.label)} predictors <small>net points from decided calls; resets ${esc(fmtUtc(data.season.end))}</small></h2>
			${rows.length
				? `<ol class="dx-lb">${rows.map(row).join('')}${mine ? row(mine) : ''}</ol>`
				: '<div class="sy-chart-empty">No duel has settled this season yet. The first correct call takes the top spot.</div>'}`;
		hydrateAvatars(lbEl);
	} catch (err) {
		lbEl.innerHTML = `<h2 class="sy-h2">Season predictors</h2><div class="sy-err" role="alert">${esc(err instanceof TypeError ? 'Could not reach three.ws.' : err.message)} <button type="button" class="sy-btn sm" id="dxLbRetry">Retry</button></div>`;
		document.getElementById('dxLbRetry').addEventListener('click', loadLeaderboard);
	}
}

// Countdowns stay honest without refetching: re-render from the data we have.
setInterval(() => {
	if (board) renderBoard();
	for (const el of document.querySelectorAll('[data-until]')) el.textContent = until(el.dataset.until);
}, 30_000);

loadBoard();
loadMe();
loadLeaderboard();
