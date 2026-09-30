// /duels/:id: one trader duel. Both traders' live records, the in-window race,
// the crowd, how it resolves, and the call form.
//
// Reads GET /api/duels/:id and GET /api/duels/me (points balance; credits the
// free daily allowance). A call is POST /api/duels/:id { side, stake }. Points
// have no cash value; nothing here can move a token.

import { apiFetch } from './api.js';
import { esc, fmtSol, fmtPct, tone, toast, errorMessage, hydrateAvatars, relTime } from './syndicate-shared.js';
import { ava, crowdBar, phaseChip, windowLabel, pts, until, fmtUtc, VOID_TEXT, FREE_LINE } from './duels-shared.js';

const rootEl = document.getElementById('dxRoot');
const contentEl = document.getElementById('dxContent');
const id = (location.pathname.match(/^\/duels\/([0-9a-f-]{36})\/?$/i) || [])[1] || null;

let duel = null;
let rules = null;
let me = null;
let stake = null;
let side = null;
let busy = false;
let lastPhase = null;

async function getJson(path) {
	const r = await apiFetch(path, { allowAnonymous: true, headers: { accept: 'application/json' } });
	if (!r.ok) {
		const { message } = await errorMessage(r, `The server answered ${r.status}.`);
		const err = new Error(message);
		err.status = r.status;
		throw err;
	}
	return r.json();
}

async function load({ quiet = false } = {}) {
	if (!id) return renderMissing('That duel link is incomplete.');
	if (!quiet) rootEl.setAttribute('aria-busy', 'true');
	try {
		const [d, m] = await Promise.all([
			getJson(`/api/duels/${id}`),
			getJson('/api/duels/me').catch(() => null),
		]);
		duel = d.duel;
		rules = d.rules;
		me = m;
		lastPhase = duel.phase;
		if (stake == null) stake = Math.min(25, Math.max(rules.min_stake, me?.wallet?.balance ?? 25));
		render();
		if (me?.wallet?.granted_now && !quiet) toast(`+${me.wallet.daily_allowance} free points for today`);
	} catch (err) {
		if (err.status === 404) return renderMissing(err.message);
		if (quiet) return;
		contentEl.innerHTML = `
			<div class="sy-state" role="alert">
				<h2>This duel did not load</h2>
				<p>${esc(err instanceof TypeError ? 'Could not reach three.ws. Check your connection.' : err.message)} If you already made a call it is safe: calls are stored with the duel and settle on schedule.</p>
				<button type="button" class="sy-btn primary" id="dxRetry">Try again</button>
			</div>`;
		document.getElementById('dxRetry').addEventListener('click', () => load());
	} finally {
		rootEl.setAttribute('aria-busy', 'false');
	}
}

function renderMissing(message) {
	document.title = 'Duel not found · three.ws';
	contentEl.innerHTML = `
		<div class="sy-state">
			<h2>Duel not found</h2>
			<p>${esc(message)} Browse the duels that are open for calls right now.</p>
			<a class="sy-btn primary" href="/duels">All duels</a>
		</div>`;
	rootEl.setAttribute('aria-busy', 'false');
}

// ── render ──────────────────────────────────────────────────

function render() {
	const d = duel;
	document.title = `${d.a.name} vs ${d.b.name} · Trader Duels · three.ws`;
	const lead = d.phase === 'resolved' ? d.winner : d.standing?.leading || null;
	contentEl.innerHTML = `
		<header class="dx-hero">
			<div class="dx-hero-meta">${phaseChip(d)}<span>${esc(windowLabel(d))}</span></div>
			<h1><span class="a">${esc(d.a.name)}</span> <span class="sy-faint" style="font-size:.6em">vs</span> <span class="b">${esc(d.b.name)}</span></h1>
			<p class="dx-question">Who books more realized profit between <b>${esc(fmtUtc(d.window_start))}</b> and <b>${esc(fmtUtc(d.window_end))}</b>?</p>
			${d.headline ? `<p class="dx-headline">When this duel opened: ${esc(d.headline)}</p>` : ''}
		</header>

		<div class="sy-grid">
			<div style="display:grid;gap:16px;min-width:0">
				<div class="dx-traders">${traderCard('a', lead)}${traderCard('b', lead)}</div>
				<section class="sy-panel" aria-labelledby="dxCrowdTitle">
					<h2 class="sy-h2" id="dxCrowdTitle">The crowd <small>${esc(crowdBar(d).text)}</small></h2>
					${crowdBar(d).html}
					<div style="display:flex;justify-content:space-between;gap:10px;margin-top:8px;font-size:12.5px" class="sy-faint">
						<span>${esc(d.a.name)}: ${esc(d.crowd.a.calls)} ${d.crowd.a.calls === 1 ? 'call' : 'calls'}, ${esc(pts(d.crowd.a.points))}</span>
						<span style="text-align:right">${esc(d.b.name)}: ${esc(d.crowd.b.calls)} ${d.crowd.b.calls === 1 ? 'call' : 'calls'}, ${esc(pts(d.crowd.b.points))}</span>
					</div>
				</section>
				${howItResolves()}
			</div>
			<aside class="sy-side" style="display:grid;gap:16px;align-content:start">
				${callPanel()}
				<p class="sy-fine">${esc(FREE_LINE)}</p>
			</aside>
		</div>`;
	hydrateAvatars(contentEl);
	wireCall();
}

function spark(series, key) {
	if (!Array.isArray(series) || series.length < 2) return '';
	const w = 300;
	const h = 48;
	const min = Math.min(0, ...series);
	const max = Math.max(0, ...series);
	const span = max - min || 1;
	const x = (i) => (i * w) / (series.length - 1);
	const y = (v) => 4 + ((max - v) * (h - 8)) / span;
	const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
	const last = series[series.length - 1];
	return `
		<svg class="dx-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="30-day realized equity curve ending at ${esc(fmtSol(last))}">
			<line x1="0" x2="${w}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--sy-line)" stroke-dasharray="3 3" />
			<path d="${line}" fill="none" stroke="var(--dx-${key})" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
		</svg>`;
}

function traderCard(key, lead) {
	const d = duel;
	const s = d[key];
	const r = s.record;
	const st = d.standing?.[key] || null;
	const isLead = lead === key;
	const links = s.links
		? `<div class="sy-actions"><a class="sy-btn sm" href="${esc(s.links.trade_room)}">Trade room</a><a class="sy-btn sm" href="${esc(s.links.trader)}">Trader profile</a></div>`
		: '';
	if (!s.available) {
		return `
			<section class="sy-panel dx-trader ${key}" aria-label="${esc(s.name)}">
				<div class="dx-trader-head">${ava(s.name, s.image, 'dx-ava lg')}<div><h2>${esc(s.name)}</h2><small>No longer public</small></div></div>
				<p class="sy-muted" style="font-size:14px;line-height:1.55;margin:0">This trader went private or was removed, so the duel is void and every call is refunded.</p>
			</section>`;
	}
	const board = s.board.rank != null ? `#${esc(s.board.rank)} on the ${esc(rules.board_window)} board when the duel opened` : 'On the trader board';
	const record = r
		? `
			<dl class="sy-tiles">
				<div class="sy-tile"><dt>Realized · 30d</dt><dd class="${tone(r.realized_pnl_sol)}">${esc(fmtSol(r.realized_pnl_sol))}</dd>${r.realized_pnl_usd != null ? `<small>$${esc(Math.abs(r.realized_pnl_usd).toLocaleString('en-US', { maximumFractionDigits: 0 }))}</small>` : ''}</div>
				<div class="sy-tile"><dt>Win rate · 30d</dt><dd>${r.closed ? esc(fmtPct(r.win_rate * 100, { sign: false })) : 'None yet'}</dd><small>${esc(r.wins)} of ${esc(r.closed)} closed</small></div>
				<div class="sy-tile"><dt>Score</dt><dd>${esc(r.score)}</dd><small>${r.verified ? 'Verified record' : 'Building a record'}</small></div>
			</dl>
			${spark(r.pnl_series, key)}
			<p class="sy-fine" style="margin-top:8px">${r.last_active_at ? `Last closed a trade ${esc(relTime(r.last_active_at))}` : 'No closed trade in 30 days'}${r.open_positions ? ` · ${esc(r.open_positions)} open now` : ''}</p>`
		: '<p class="sy-muted" style="font-size:14px">Record unavailable.</p>';
	return `
		<section class="sy-panel dx-trader ${key}${isLead ? ' lead' : ''}" aria-label="${esc(s.name)}">
			<div class="dx-trader-head">${ava(s.name, s.image, 'dx-ava lg')}<div><h2>${esc(s.name)}${isLead ? ` <span class="sy-badge good">${d.phase === 'resolved' ? 'Winner' : 'Leading'}</span>` : ''}</h2><small>${board}</small></div></div>
			${record}
			${st ? windowBox(st) : ''}
			${links}
		</section>`;
}

function windowBox(st) {
	const d = duel;
	const label = d.phase === 'live' ? 'In this window so far' : d.phase === 'resolving' ? 'In the window (awaiting resolution)' : 'Final, in the window';
	return `
		<div class="dx-window">
			<small style="margin:0 0 4px">${label}</small>
			<b class="${tone(st.pnl_sol)}">${st.closed ? esc(fmtSol(st.pnl_sol)) : 'No closed trades'}</b>
			<small>${esc(st.closed)} closed · ${esc(st.wins)} in profit${st.self_dealing_count ? ` · ${esc(st.self_dealing_count)} on own coins not counted` : ''}</small>
		</div>`;
}

function howItResolves() {
	const d = duel;
	return `
		<section class="sy-panel" aria-labelledby="dxHowTitle">
			<h2 class="sy-h2" id="dxHowTitle">How this duel resolves</h2>
			<ol class="dx-rules">
				<li><b>Window:</b> ${esc(fmtUtc(d.window_start))} to ${esc(fmtUtc(d.window_end))}. Calls lock at the start.</li>
				<li><b>Measured about ${esc(fmtUtc(d.resolves_at))}</b> from each trader's round-trips that closed inside the window, on both their sniper and strategy ledgers, using the same math as their <a href="${esc(d.a.links?.trader || '/leaderboard')}">trader profile</a>. Profit on a trader's own coins does not count.</li>
				<li><b>More realized SOL wins.</b> A trader with no closed trade counts as flat, which beats a loss and loses to a profit.</li>
				<li><b>Void and refunded</b> if the two are exactly level, if neither closes a trade, or if either trader goes private or is removed.</li>
				<li><b>A correct call pays ${esc(rules.win_multiplier)}x its stake and ${esc(rules.xp_per_win)} XP.</b> A wrong call keeps nothing.</li>
			</ol>
		</section>`;
}

function callPanel() {
	const d = duel;
	const v = d.viewer;
	const c = d.my_call;
	const name = (k) => (k === 'a' ? d.a.name : d.b.name);

	if (d.phase === 'resolved' || d.phase === 'void') return resultPanel();

	if (c) {
		return `
			<section class="sy-panel" aria-labelledby="dxCallTitle">
				<h2 class="sy-h2" id="dxCallTitle">Your call</h2>
				<p style="font-size:18px;font-weight:800;margin:0 0 6px"><span style="color:var(--dx-${c.side})">${esc(name(c.side))}</span> · ${esc(pts(c.stake))}</p>
				<p class="dx-payoff">If ${esc(name(c.side))} books more, you get <b>${esc(pts(c.stake * rules.win_multiplier))}</b> back and <b>${esc(rules.xp_per_win)} XP</b>. ${d.phase === 'open' ? `Calls lock in ${esc(until(d.window_start))}.` : 'The window is running; calls are locked.'}</p>
				<div class="sy-actions" style="margin-top:12px"><a class="sy-btn sm" href="/duels">More duels</a></div>
			</section>`;
	}

	if (d.phase !== 'open') {
		return `
			<section class="sy-panel" aria-labelledby="dxCallTitle">
				<h2 class="sy-h2" id="dxCallTitle">Calls are locked</h2>
				<p class="sy-muted" style="font-size:14px;line-height:1.55;margin:0 0 12px">Calls closed when the window started at ${esc(fmtUtc(d.window_start))}. ${d.phase === 'live' ? `The window ends in ${esc(until(d.window_end))}.` : 'The result lands in a few minutes.'}</p>
				<a class="sy-btn primary" href="/duels">Find an open duel</a>
			</section>`;
	}

	if (!v.signed_in) {
		const next = encodeURIComponent(location.pathname);
		return `
			<section class="sy-panel" aria-labelledby="dxCallTitle">
				<h2 class="sy-h2" id="dxCallTitle">Make your call</h2>
				<p class="sy-muted" style="font-size:14px;line-height:1.55;margin:0 0 12px">Sign in to call this duel. You get ${esc(pts(rules.daily_allowance))} free every day, and it locks in ${esc(until(d.window_start))}.</p>
				<div class="sy-actions"><a class="sy-btn primary" href="/login?next=${next}">Sign in</a><a class="sy-btn" href="/register?next=${next}">Create an account</a></div>
			</section>`;
	}

	if (v.owns_a_trader) {
		return `
			<section class="sy-panel" aria-labelledby="dxCallTitle">
				<h2 class="sy-h2" id="dxCallTitle">This one is yours</h2>
				<p class="sy-muted" style="font-size:14px;line-height:1.55;margin:0 0 12px">You own one of these traders, so you cannot call this duel. Everyone else can; share it and let them back you.</p>
				<div class="sy-actions"><button type="button" class="sy-btn" id="dxShare">Copy duel link</button><a class="sy-btn" href="/duels">Other duels</a></div>
			</section>`;
	}

	if (!d.a.available || !d.b.available) {
		return `
			<section class="sy-panel" aria-labelledby="dxCallTitle">
				<h2 class="sy-h2" id="dxCallTitle">This duel is being voided</h2>
				<p class="sy-muted" style="font-size:14px;line-height:1.55;margin:0">A trader went private, so this duel no longer takes calls and every call is refunded.</p>
			</section>`;
	}

	const balance = me?.wallet?.balance ?? 0;
	const maxStake = Math.min(rules.max_stake, balance);
	if (maxStake < rules.min_stake) {
		return `
			<section class="sy-panel" aria-labelledby="dxCallTitle">
				<h2 class="sy-h2" id="dxCallTitle">Out of points for today</h2>
				<p class="sy-muted" style="font-size:14px;line-height:1.55;margin:0 0 12px">You have ${esc(pts(balance))}; a call needs at least ${esc(rules.min_stake)}. Your free ${esc(pts(rules.daily_allowance))} arrive in ${esc(until(me?.wallet?.next_grant_at || d.window_start))}${new Date(me?.wallet?.next_grant_at || 0) < new Date(d.window_start) ? ', before this duel locks' : ''}.</p>
				<a class="sy-btn" href="/duels">Watch the other duels</a>
			</section>`;
	}

	stake = Math.min(Math.max(stake, rules.min_stake), maxStake);
	const chips = [10, 25, 50, 100].filter((n) => n >= rules.min_stake && n <= rules.max_stake);
	return `
		<section class="sy-panel dx-call" aria-labelledby="dxCallTitle">
			<h2 class="sy-h2" id="dxCallTitle">Make your call <small>locks in ${esc(until(d.window_start))}</small></h2>
			<form id="dxForm" novalidate>
				<fieldset>
					<legend>Who books more realized profit?</legend>
					<div class="dx-pickers">
						${['a', 'b'].map((k) => `
							<label class="dx-pick ${k}">
								<input type="radio" name="side" value="${k}" ${side === k ? 'checked' : ''} required />
								${ava(d[k].name, d[k].image)}<b>${esc(d[k].name)}</b>
							</label>`).join('')}
					</div>
				</fieldset>
				<div class="dx-stake">
					<label class="sy-label" for="dxStakeNum">Stake <span class="sy-faint" style="font-weight:500">${esc(rules.min_stake)} to ${esc(maxStake)} points · you have ${esc(balance)}</span></label>
					<div class="dx-stake-row">
						<input type="range" id="dxStakeRange" min="${rules.min_stake}" max="${maxStake}" step="1" value="${stake}" aria-label="Stake in points" />
						<input type="number" class="sy-input" id="dxStakeNum" min="${rules.min_stake}" max="${maxStake}" step="1" value="${stake}" inputmode="numeric" />
					</div>
					<div class="dx-chips" role="group" aria-label="Quick stake">
						${chips.map((n) => `<button type="button" data-stake="${n}" aria-pressed="${n === stake}" ${n > maxStake ? 'disabled' : ''}>${n}</button>`).join('')}
					</div>
					<p class="dx-payoff" id="dxPayoff"></p>
				</div>
				<div class="sy-err" id="dxErr" role="alert" hidden style="margin-top:12px"></div>
				<button type="submit" class="sy-btn primary" id="dxSubmit" style="width:100%;margin-top:14px">Lock in my call</button>
			</form>
		</section>`;
}

function resultPanel() {
	const d = duel;
	const c = d.my_call;
	const name = (k) => (k === 'a' ? d.a.name : d.b.name);
	let mine = '<p style="margin-top:10px">You did not call this one.</p>';
	if (c?.status === 'won') mine = `<p style="margin-top:10px" class="pos"><b>You called it.</b> ${esc(pts(c.payout))} back (${esc(pts(c.payout - c.stake, { sign: true }))}) and ${esc(rules.xp_per_win)} XP.</p>`;
	else if (c?.status === 'lost') mine = `<p style="margin-top:10px" class="neg">You called ${esc(name(c.side))}. ${esc(pts(-c.stake, { sign: true }))}.</p>`;
	else if (c?.status === 'refunded') mine = `<p style="margin-top:10px">Your ${esc(pts(c.stake))} were refunded.</p>`;
	else if (c) mine = '<p style="margin-top:10px">Your call is settling.</p>';
	const body = d.phase === 'void'
		? `<h2>Void</h2><p>${esc(VOID_TEXT[d.void_reason] || 'Every call was refunded.')}</p>`
		: `<h2><span style="color:var(--dx-${d.winner})">${esc(name(d.winner))}</span> won</h2><p>${esc(name(d.winner))} finished ahead on realized P&L in the window. Final numbers are on each trader card, measured ${esc(fmtUtc(d.resolved_at || d.resolves_at))}.</p>`;
	return `
		<section class="sy-panel dx-result" aria-live="polite">
			${body}
			${mine}
			<div class="sy-actions" style="justify-content:center;margin-top:14px"><a class="sy-btn primary" href="/duels">Next duel</a></div>
		</section>`;
}

// ── the call form ───────────────────────────────────────────

function payoffText() {
	const el = document.getElementById('dxPayoff');
	if (!el) return;
	const who = side ? (side === 'a' ? duel.a.name : duel.b.name) : 'your pick';
	el.innerHTML = `If ${esc(who)} books more: <b>${esc(pts(stake * rules.win_multiplier))}</b> back (${esc(pts(stake * (rules.win_multiplier - 1), { sign: true }))}) and <b>${esc(rules.xp_per_win)} XP</b>. If not, the ${esc(pts(stake))} are gone. Void duels refund.`;
}

function setStake(v, { from } = {}) {
	const form = document.getElementById('dxForm');
	if (!form) return;
	const range = document.getElementById('dxStakeRange');
	const num = document.getElementById('dxStakeNum');
	const max = Number(range.max);
	const n = Math.round(Number(v));
	if (!Number.isFinite(n)) return;
	stake = Math.min(Math.max(n, rules.min_stake), max);
	if (from !== 'range') range.value = String(stake);
	if (from !== 'num') num.value = String(stake);
	for (const b of form.querySelectorAll('[data-stake]')) b.setAttribute('aria-pressed', String(Number(b.dataset.stake) === stake));
	payoffText();
}

function wireCall() {
	document.getElementById('dxShare')?.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(location.href);
			toast('Duel link copied');
		} catch {
			toast('Copy the address bar to share this duel');
		}
	});
	const form = document.getElementById('dxForm');
	if (!form) return;
	payoffText();
	for (const r of form.querySelectorAll('input[name="side"]')) {
		r.addEventListener('change', () => {
			side = r.value;
			document.getElementById('dxErr').hidden = true;
			payoffText();
		});
	}
	document.getElementById('dxStakeRange').addEventListener('input', (e) => setStake(e.target.value, { from: 'range' }));
	const num = document.getElementById('dxStakeNum');
	num.addEventListener('change', (e) => setStake(e.target.value));
	for (const b of form.querySelectorAll('[data-stake]')) b.addEventListener('click', () => setStake(b.dataset.stake));
	form.addEventListener('submit', submitCall);
}

async function submitCall(e) {
	e.preventDefault();
	if (busy) return;
	const errEl = document.getElementById('dxErr');
	const btn = document.getElementById('dxSubmit');
	errEl.hidden = true;
	if (side !== 'a' && side !== 'b') {
		errEl.textContent = 'Pick the trader you think books more.';
		errEl.hidden = false;
		document.querySelector('input[name="side"]')?.focus();
		return;
	}
	busy = true;
	btn.disabled = true;
	btn.textContent = 'Locking in…';
	try {
		const r = await apiFetch(`/api/duels/${id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ side, stake }),
		});
		if (!r.ok) {
			const { message } = await errorMessage(r, 'Your call did not go through.');
			errEl.textContent = message;
			errEl.hidden = false;
			if (r.status === 409 || r.status === 403) load({ quiet: true });
			return;
		}
		const out = await r.json();
		toast(`Call locked: ${side === 'a' ? duel.a.name : duel.b.name}, ${out.call.stake} points. ${out.balance} left.`);
		await load({ quiet: true });
	} catch {
		errEl.textContent = 'Network error. Your call was not placed; try again.';
		errEl.hidden = false;
	} finally {
		busy = false;
		const b = document.getElementById('dxSubmit');
		if (b) {
			b.disabled = false;
			b.textContent = 'Lock in my call';
		}
	}
}

// Countdowns and the live race stay current: re-render the clock every 30
// seconds and refetch while the window runs, or when the duel changes phase.
setInterval(() => {
	if (!duel || busy) return;
	const phaseNow = duel.status !== 'open' ? duel.phase
		: Date.now() < Date.parse(duel.window_start) ? 'open'
		: Date.now() < Date.parse(duel.window_end) ? 'live' : 'resolving';
	if (phaseNow !== lastPhase || phaseNow === 'live' || phaseNow === 'resolving') {
		load({ quiet: true });
		return;
	}
	const chip = contentEl.querySelector('.dx-hero-meta');
	if (chip) chip.firstElementChild.outerHTML = phaseChip(duel);
}, 30_000);

load();
