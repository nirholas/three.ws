// Copy Coach page (/copy-coach): the guided first copy for a cautious newcomer.
//
// Data, all real:
//   GET  /api/copy/coach             the verified win + its agent's record, the
//                                     leaders (copyable or not, and why), the caps
//   GET  /api/sniper/receipt?id=      why the winning trade was taken
//   GET  /api/pump/ghost-copy         the fake-money replay over real closed trades
//   GET  /api/auth/me                 signed in or not (step 3 needs an account)
//   GET  /api/copy/subscriptions      an existing copy of the chosen leader, and
//                                     the wallet the user already copies into
//   POST /api/copy/subscriptions      the starter copy, `starter: true`, only
//                                     after the confirmation card is accepted;
//                                     the server enforces STARTER_CAPS
//   POST /api/copy/coach              questions to the coach
//
// Nothing on this page spends: a copy subscription produces intents the user
// signs from their own wallet, one by one, in /dashboard/copy.

import { apiFetch } from './api.js';
import { receiptHTML, receiptSkeletonHTML, RECEIPT_CSS } from './shared/trade-receipt-view.js';
import { shortAddress as short } from './shared/address.js';

const STORE_KEY = 'twx_copy_coach_v1';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const STEPS = [
	{ id: 'see_a_win', label: 'See a real win', hint: 'and the record behind it' },
	{ id: 'ghost_copy', label: 'Ghost-copy', hint: 'fake money, real trades' },
	{ id: 'starter_copy', label: 'One tiny real copy', hint: 'hard-capped, you sign' },
	{ id: 'full_copy', label: 'What comes next', hint: 'only when earned' },
];

const OPENERS = {
	see_a_win: 'Hi. Start here: look at a real win, then at the full record of the agent that made it. One good trade is not a track record, and I will say so every time.',
	ghost_copy: 'Now pick a leader and replay them with fake money. No wallet, no signature. Watch the drawdowns, not just the ending.',
	starter_copy: 'This is the smallest real step: tiny fixed sizes, a daily cap the server enforces, and you sign every trade from your own wallet. You can lose what you put in.',
	full_copy: 'Stay at starter size until a few real copies have landed and you have watched how they behave. Raise the caps only when the record earns it.',
};

const CHIPS = {
	see_a_win: ['Is this win typical?', 'Can I lose money?', 'Why show the losing record too?'],
	ghost_copy: ['How did my ghost run go?', 'What does ghost copy prove?', 'Which leader is safest?'],
	starter_copy: ['Who holds my keys?', 'What are the fees?', 'How do I stop a copy?'],
	full_copy: ['When should I raise my caps?', 'Can you guarantee returns?', 'How do I stop a copy?'],
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function solFmt(v, { sign = false } = {}) {
	if (v == null || !Number.isFinite(Number(v))) return 'n/a';
	const n = Number(v);
	const abs = Math.abs(n);
	const body = abs !== 0 && abs < 0.0001 ? '<0.0001' : abs.toFixed(abs >= 10 ? 2 : 4);
	const mark = sign ? (n > 0 ? '+' : n < 0 ? '-' : '') : n < 0 ? '-' : '';
	return `${mark}${body} SOL`;
}
function pctFmt(v, { sign = true } = {}) {
	if (v == null || !Number.isFinite(Number(v))) return 'n/a';
	const n = Number(v);
	return `${sign && n > 0 ? '+' : ''}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
}
const tone = (v) => (Number(v) > 0 ? 'cc-pos' : Number(v) < 0 ? 'cc-neg' : '');
function duration(s) {
	if (s == null) return 'n/a';
	if (s < 90) return `${Math.round(s)}s`;
	if (s < 5400) return `${Math.round(s / 60)} min`;
	return `${(s / 3600).toFixed(1)} h`;
}

// ── state (progress persists per viewer, as a convenience) ─────────────────

const state = {
	step: 'see_a_win',
	done: {},
	leaderId: null,
	ghostWindow: '30d',
	ghostBudget: 1,
	ghost: null,
	overview: null,
	me: undefined,
	subs: null,
	history: [],
	chatBusy: false,
};

function loadStore() {
	try {
		const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
		if (STEPS.some((x) => x.id === s.step)) state.step = s.step;
		if (s.done && typeof s.done === 'object') state.done = s.done;
		if (typeof s.leaderId === 'string') state.leaderId = s.leaderId;
		if (s.ghostWindow === '7d' || s.ghostWindow === '30d') state.ghostWindow = s.ghostWindow;
	} catch { /* storage unavailable: start fresh */ }
	const q = new URLSearchParams(location.search);
	if (STEPS.some((x) => x.id === q.get('step'))) state.step = q.get('step');
	if (q.get('leader')) state.leaderId = q.get('leader');
}
function saveStore() {
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify({ step: state.step, done: state.done, leaderId: state.leaderId, ghostWindow: state.ghostWindow }));
	} catch { /* private mode: progress simply is not remembered */ }
}

function toast(msg) {
	const el = $('#cc-toast');
	el.textContent = msg;
	el.classList.add('is-on');
	clearTimeout(toast._t);
	toast._t = setTimeout(() => el.classList.remove('is-on'), 2600);
}

async function getJson(url) {
	const r = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'include' });
	const body = await r.json().catch(() => ({}));
	if (!r.ok) throw Object.assign(new Error(body.error_description || `HTTP ${r.status}`), { status: r.status, body });
	return body;
}

// ── rail ─────────────────────────────────────────────────────────────────────

function renderRail() {
	$('#cc-rail').innerHTML = STEPS.map((s, i) => `<li>
		<button type="button" class="cc-step${state.done[s.id] ? ' is-done' : ''}" data-step="${s.id}" ${state.step === s.id ? 'aria-current="step"' : ''}>
			<span class="cc-step-n" aria-hidden="true">${state.done[s.id] ? '✓' : i + 1}</span>
			<span class="cc-step-l">${esc(s.label)}<small>${esc(s.hint)}</small></span>
			${state.done[s.id] ? '<span class="cc-sr">(done)</span>' : ''}
		</button>
	</li>`).join('');
}

function goTo(step, { focus = true } = {}) {
	state.step = step;
	saveStore();
	renderRail();
	renderStage();
	renderChips();
	coachSays(OPENERS[step], { source: 'guide', quiet: true });
	try {
		const u = new URL(location.href);
		u.searchParams.set('step', step);
		if (state.leaderId) u.searchParams.set('leader', state.leaderId);
		history.replaceState(null, '', u);
	} catch { /* URL sync is a convenience */ }
	if (focus) $('#cc-stage h2')?.focus({ preventScroll: false });
}

function complete(step, next) {
	state.done[step] = true;
	goTo(next);
}

// ── stage ────────────────────────────────────────────────────────────────────

function stageSkeleton() {
	return `<div class="cc-card" aria-hidden="true"><span class="cc-sk" style="width:40%"></span><span class="cc-sk" style="width:85%"></span><span class="cc-sk cc-sk-block"></span></div>`;
}

function renderStage() {
	const stage = $('#cc-stage');
	stage.setAttribute('aria-busy', 'false');
	if (!state.overview) { stage.innerHTML = stageSkeleton(); stage.setAttribute('aria-busy', 'true'); return; }
	if (state.step === 'see_a_win') return renderWin(stage);
	if (state.step === 'ghost_copy') return renderGhost(stage);
	if (state.step === 'starter_copy') return renderStarter(stage);
	return renderNext(stage);
}

function heading(text) {
	return `<h2 tabindex="-1">${esc(text)}</h2>`;
}

// Step 1 ──────────────────────────────────────────────────────────────────────

function renderWin(stage) {
	const w = state.overview.win;
	if (!w) {
		stage.innerHTML = `<div class="cc-empty">
			${heading('No verified 25%+ win in the last two weeks')}
			<p>No public agent has closed a signed, on-chain trade up 25% or more in the last 14 days. That is worth knowing on its own: real wins are rarer than a feed of screenshots makes them look.</p>
			<div class="cc-actions" style="justify-content:center"><button type="button" class="cc-btn cc-btn-primary" data-next>Next: try a leader with fake money</button></div>
		</div>`;
		stage.querySelector('[data-next]').addEventListener('click', () => complete('see_a_win', 'ghost_copy'));
		return;
	}
	const r = w.record;
	const netTone = r.net_pnl_sol > 0 ? 'ok' : 'bad';
	const verdict = r.net_pnl_sol > 0
		? `Over ${r.days} days this agent closed ${r.closed} trades and is up ${solFmt(r.net_pnl_sol)} overall. That is a better signal than this one trade.`
		: `Over ${r.days} days this agent closed ${r.closed} trades, won ${r.wins} of them, and is down ${solFmt(Math.abs(r.net_pnl_sol))} overall. This win is real, and it still came from an agent that lost money. That is exactly why one win is not a reason to copy.`;
	stage.innerHTML = `<div class="cc-card">
		${heading('One real win, and the record behind it')}
		<p class="cc-lede">The most recent trade on three.ws that closed up 25% or more, signed on Solana. Both transactions are linked so you can check them yourself.</p>
		<div class="cc-win">
			<div class="cc-tile">
				<p class="cc-tile-k">${esc(w.agent_name)} on ${w.symbol ? `$${esc(w.symbol)}` : 'one coin'}</p>
				<p class="cc-tile-v ${tone(w.pnl_pct)}">${esc(pctFmt(w.pnl_pct))}</p>
				<p>${esc(solFmt(w.pnl_sol, { sign: true }))} on a ${esc(solFmt(w.entry_sol))} position, held ${esc(duration(w.hold_seconds))}.</p>
				<p><a class="cc-link" href="${esc(w.buy_url)}" target="_blank" rel="noopener noreferrer">Buy transaction ↗</a> · <a class="cc-link" href="${esc(w.sell_url)}" target="_blank" rel="noopener noreferrer">Sell transaction ↗</a></p>
			</div>
			<div class="cc-tile">
				<p class="cc-tile-k">The same agent, last ${esc(r.days)} days</p>
				<p class="cc-tile-v ${tone(r.net_pnl_sol)}">${esc(solFmt(r.net_pnl_sol, { sign: true }))}</p>
				<p>${esc(r.closed)} closed trades: ${esc(r.wins)} won, ${esc(r.losses)} lost${r.win_rate_pct != null ? ` (${esc(r.win_rate_pct)}% win rate)` : ''}.</p>
				<p><a class="cc-link" href="${esc(w.trader_url)}">Full track record</a></p>
			</div>
		</div>
		<p class="cc-verdict cc-verdict-${netTone}">${esc(verdict)}</p>
		<details class="cc-receipt" id="cc-receipt">
			<summary>Why the agent took this trade</summary>
			<div id="cc-receipt-body">${receiptSkeletonHTML()}</div>
		</details>
		<p class="cc-why"><b>Why this step is safe:</b> you are only reading. No account, no wallet, nothing to sign.</p>
		<div class="cc-actions">
			<button type="button" class="cc-btn cc-btn-primary" data-next>Next: try a leader with fake money</button>
			<a class="cc-link" href="/trades">See every recent exit, wins and losses</a>
		</div>
	</div>`;
	stage.querySelector('[data-next]').addEventListener('click', () => complete('see_a_win', 'ghost_copy'));
	const det = stage.querySelector('#cc-receipt');
	det.addEventListener('toggle', async () => {
		if (!det.open || det.dataset.loaded) return;
		det.dataset.loaded = '1';
		const body = det.querySelector('#cc-receipt-body');
		try {
			const receipt = await getJson(`/api/sniper/receipt?id=${encodeURIComponent(w.trade_id)}`);
			body.innerHTML = receiptHTML(receipt);
		} catch (err) {
			delete det.dataset.loaded;
			body.innerHTML = `<p class="cc-err">Could not load the receipt (${esc(err.message)}). Close and reopen to try again, or open the <a class="cc-link" href="${esc(w.trade_url)}">trade page</a>.</p>`;
		}
	});
}

// Step 2 ──────────────────────────────────────────────────────────────────────

function leaderOption(l) {
	const checked = state.leaderId === l.agent_id ? 'checked' : '';
	return `<label class="cc-leader">
		<input type="radio" name="cc-leader" value="${esc(l.agent_id)}" ${checked} />
		<span class="cc-leader-body">
			<span class="cc-leader-name">${esc(l.name)} ${l.copyable ? '<span class="cc-badge cc-badge-ok">copyable</span>' : '<span class="cc-badge cc-badge-no">not copyable yet</span>'}</span>
			<span class="cc-leader-stats">${esc(l.settled)} closed · ${l.win_rate_pct != null ? `${esc(l.win_rate_pct)}% won` : 'no wins'} · <span class="${tone(l.pnl_sol)}">${esc(solFmt(l.pnl_sol, { sign: true }))}</span> in 30 days</span>
			${l.copyable ? '' : `<span class="cc-leader-unmet">Still needs: ${esc((l.unmet || []).join(', '))}</span>`}
		</span>
	</label>`;
}

function sparkline(curve, startSol) {
	const pts = (curve || []).filter((p) => Number.isFinite(Number(p.equity_sol)));
	if (pts.length < 2) return '';
	const ys = pts.map((p) => Number(p.equity_sol));
	const lo = Math.min(...ys, startSol);
	const hi = Math.max(...ys, startSol);
	const span = hi - lo || 1;
	const W = 600;
	const H = 90;
	const x = (i) => (i / (pts.length - 1)) * W;
	const y = (v) => H - 6 - ((v - lo) / span) * (H - 12);
	const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(Number(p.equity_sol)).toFixed(1)}`).join(' ');
	const end = ys[ys.length - 1];
	const col = end >= startSol ? 'var(--cc-ok)' : 'var(--cc-bad)';
	return `<svg class="cc-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Fake balance over the window, from ${esc(solFmt(startSol))} to ${esc(solFmt(end))}">
		<line x1="0" x2="${W}" y1="${y(startSol).toFixed(1)}" y2="${y(startSol).toFixed(1)}" stroke="currentColor" stroke-opacity=".18" stroke-dasharray="4 4" />
		<polyline points="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" />
	</svg>`;
}

function ghostVerdict(g) {
	const s = g.summary || {};
	if (!s.copied) return { tone: 'warn', text: 'Nothing would have been copied in this window at this budget, so this run says nothing yet. Try the 30 day window.' };
	if ((s.realized_pnl_pct ?? 0) < 0) {
		return { tone: 'bad', text: `Your fake ${solFmt(g.budget_sol)} would be ${solFmt(s.end_sol)}: a ${pctFmt(s.realized_pnl_pct)} result over ${s.copied} copied trades. The coach would not copy this leader with real money yet.` };
	}
	return { tone: 'ok', text: `Your fake ${solFmt(g.budget_sol)} would be ${solFmt(s.end_sol)} (${pctFmt(s.realized_pnl_pct)}) over ${s.copied} copied trades, with a worst drawdown of ${pctFmt(s.max_drawdown_pct, { sign: false })}. Past trades do not predict the next ones.` };
}

function ghostResultHTML(g) {
	const s = g.summary || {};
	const v = ghostVerdict(g);
	return `<div class="cc-tiles">
			<div class="cc-tile"><p class="cc-tile-k">Fake balance</p><p class="cc-tile-v ${tone(s.realized_pnl_sol)}">${esc(solFmt(s.end_sol))}</p><p>from ${esc(solFmt(g.budget_sol))}</p></div>
			<div class="cc-tile"><p class="cc-tile-k">Realized</p><p class="cc-tile-v ${tone(s.realized_pnl_pct)}">${esc(pctFmt(s.realized_pnl_pct))}</p><p>${esc(solFmt(s.realized_pnl_sol, { sign: true }))}</p></div>
			<div class="cc-tile"><p class="cc-tile-k">Copied</p><p class="cc-tile-v">${esc(s.copied ?? 0)}</p><p>${esc(s.wins ?? 0)} won · ${esc(s.losses ?? 0)} lost</p></div>
			<div class="cc-tile"><p class="cc-tile-k">Worst drawdown</p><p class="cc-tile-v cc-neg">${esc(pctFmt(s.max_drawdown_pct, { sign: false }))}</p><p>the deepest dip along the way</p></div>
		</div>
		${sparkline(g.equity_curve, Number(g.budget_sol))}
		<p class="cc-verdict cc-verdict-${v.tone}">${esc(v.text)}</p>
		${Array.isArray(g.honesty) && g.honesty.length ? `<ul class="cc-honesty">${g.honesty.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}`;
}

function renderGhost(stage) {
	const leaders = state.overview.leaders || [];
	if (!leaders.length) {
		stage.innerHTML = `<div class="cc-empty">
			${heading('No leader has enough closed trades to replay')}
			<p>A ghost copy replays a leader's real closed trades, and no public agent has closed any in the last 30 days. Check back after the next trading session, or browse <a class="cc-link" href="/leaderboard">the leaderboard</a>.</p>
		</div>`;
		return;
	}
	if (!leaders.some((l) => l.agent_id === state.leaderId)) state.leaderId = leaders[0].agent_id;
	stage.innerHTML = `<div class="cc-card">
		${heading('Ghost-copy a leader with fake money')}
		<p class="cc-lede">Pick a leader. The replay runs their real closed trades through the same sizing the live copy engine uses, with a fake balance. Look at the drawdown as much as the ending: that is how it feels to hold through a bad week.</p>
		<fieldset class="cc-leaders"><legend>Leaders with closed trades in the last 30 days</legend>${leaders.map(leaderOption).join('')}</fieldset>
		<div class="cc-form-row">
			<label class="cc-field">Fake budget (SOL)
				<input type="number" id="cc-budget" min="0.1" max="100" step="0.1" value="${esc(state.ghostBudget)}" inputmode="decimal" />
			</label>
			<div class="cc-field" role="group" aria-label="Replay window">Window
				<span class="cc-seg" id="cc-window">
					<button type="button" data-w="7d" aria-pressed="${state.ghostWindow === '7d'}">7 days</button>
					<button type="button" data-w="30d" aria-pressed="${state.ghostWindow === '30d'}">30 days</button>
				</span>
			</div>
			<button type="button" class="cc-btn cc-btn-primary" id="cc-run">Run the ghost copy</button>
		</div>
		<div class="cc-result" id="cc-result" aria-live="polite">${state.ghost && state.ghost.leader?.agent_id === state.leaderId ? ghostResultHTML(state.ghost) : ''}</div>
		<p class="cc-why"><b>Why this step is safe:</b> the money is fake. No wallet, no signature, no account. The trades it replays are real and already closed.</p>
		<div class="cc-actions">
			<button type="button" class="cc-btn" data-back>Back</button>
			<button type="button" class="cc-btn cc-btn-primary" data-next ${state.ghost ? '' : 'disabled'}>Next: one tiny real copy</button>
			<a class="cc-link" href="/ghost-copy">Open the full ghost-copy tool</a>
		</div>
	</div>`;

	stage.querySelectorAll('input[name="cc-leader"]').forEach((r) => r.addEventListener('change', () => {
		state.leaderId = r.value;
		state.ghost = null;
		saveStore();
		stage.querySelector('#cc-result').innerHTML = '';
		stage.querySelector('[data-next]').disabled = true;
	}));
	stage.querySelectorAll('#cc-window button').forEach((b) => b.addEventListener('click', () => {
		state.ghostWindow = b.dataset.w;
		saveStore();
		stage.querySelectorAll('#cc-window button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
	}));
	stage.querySelector('#cc-run').addEventListener('click', runGhost);
	stage.querySelector('[data-back]').addEventListener('click', () => goTo('see_a_win'));
	stage.querySelector('[data-next]').addEventListener('click', () => complete('ghost_copy', 'starter_copy'));
}

async function runGhost() {
	const stage = $('#cc-stage');
	const out = stage.querySelector('#cc-result');
	const btn = stage.querySelector('#cc-run');
	const budget = Number(stage.querySelector('#cc-budget').value);
	if (!(budget > 0 && budget <= 100)) {
		out.innerHTML = '<p class="cc-err">Enter a fake budget between 0.1 and 100 SOL.</p>';
		return;
	}
	state.ghostBudget = budget;
	btn.disabled = true;
	btn.textContent = 'Replaying…';
	out.innerHTML = '<span class="cc-sk" style="width:60%"></span><span class="cc-sk cc-sk-block"></span>';
	try {
		const q = new URLSearchParams({ leader: state.leaderId, budget: String(budget), window: state.ghostWindow });
		state.ghost = await getJson(`/api/pump/ghost-copy?${q}`);
		out.innerHTML = ghostResultHTML(state.ghost);
		stage.querySelector('[data-next]').disabled = false;
	} catch (err) {
		out.innerHTML = `<p class="cc-err">The replay could not run: ${esc(err.message)}. Try again, or pick another leader.</p>`;
	} finally {
		btn.disabled = false;
		btn.textContent = 'Run the ghost copy';
	}
}

// Step 3 ──────────────────────────────────────────────────────────────────────

async function ensureMe() {
	if (state.me !== undefined) return state.me;
	try {
		const r = await apiFetch('/api/auth/me', { allowAnonymous: true });
		const body = r.ok ? await r.json() : { user: null };
		state.me = body.user || null;
	} catch {
		state.me = null;
	}
	if (state.me && state.subs === null) {
		try {
			const r = await apiFetch('/api/copy/subscriptions', { allowAnonymous: true });
			state.subs = r.ok ? (await r.json()).subscriptions || [] : [];
		} catch {
			state.subs = [];
		}
	}
	return state.me;
}

function starterForm(leader, caps) {
	const existing = (state.subs || []).find((s) => s.leader_agent_id === leader.agent_id && s.status !== 'stopped');
	const wallet = (state.subs || []).find((s) => s.copier_wallet)?.copier_wallet || state.me?.wallet_address || '';
	const perTrade = Math.min(0.02, caps.per_trade_cap_sol);
	const daily = Math.min(0.1, caps.daily_budget_sol);
	return `${existing ? `<p class="cc-verdict cc-verdict-warn">You already copy ${esc(leader.name)} (status: ${esc(existing.status)}). Confirming below replaces those settings with the starter caps.</p>` : ''}
		<form id="cc-starter" novalidate>
			<div class="cc-form-grid">
				<label class="cc-field">Your Solana wallet
					<input type="text" id="cc-wallet" value="${esc(wallet)}" placeholder="Your own wallet address" autocomplete="off" spellcheck="false" required />
					<span class="cc-field-hint">Copies are addressed here. You sign each one; we never hold your keys.</span>
				</label>
				<label class="cc-field">Each copied trade <output id="cc-size-o">${perTrade} SOL</output>
					<input type="range" id="cc-size" min="0.01" max="${caps.per_trade_cap_sol}" step="0.01" value="${perTrade}" aria-describedby="cc-size-h" />
					<span class="cc-field-hint" id="cc-size-h">Starter limit: ${caps.per_trade_cap_sol} SOL, enforced by the server</span>
				</label>
				<label class="cc-field">Daily cap <output id="cc-daily-o">${daily} SOL</output>
					<input type="range" id="cc-daily" min="0.05" max="${caps.daily_budget_sol}" step="0.05" value="${daily}" aria-describedby="cc-daily-h" />
					<span class="cc-field-hint" id="cc-daily-h">The most copies can use in a day. Starter limit: ${caps.daily_budget_sol} SOL</span>
				</label>
				<label class="cc-field">Open copies at once
					<select id="cc-open">${Array.from({ length: caps.max_open_copies }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select>
				</label>
				<label class="cc-field">Pause if the leader draws down
					<select id="cc-dd">${[10, 15, 20, 25].filter((d) => d <= caps.max_drawdown_pct).map((d) => `<option value="${d}" ${d === 20 ? 'selected' : ''}>more than ${d}%</option>`).join('')}</select>
				</label>
			</div>
			<p class="cc-err" id="cc-form-err" hidden></p>
			<div class="cc-actions"><button type="submit" class="cc-btn cc-btn-primary">Review before anything is saved</button></div>
		</form>
		<div id="cc-confirm-slot"></div>`;
}

function confirmCard({ leader, cfg, ghost }) {
	const s = ghost?.summary || null;
	const ghostLost = !s || !s.copied || (s.realized_pnl_pct ?? 0) < 0;
	const ghostLine = !s
		? 'You have not ghost-copied this leader yet. The coach recommends running the ghost copy first.'
		: !s.copied
			? 'Your ghost run copied nothing in its window, so it tells you nothing about this leader yet.'
			: `Your ghost run of this leader: ${solFmt(ghost.budget_sol)} fake became ${solFmt(s.end_sol)} (${pctFmt(s.realized_pnl_pct)}).`;
	return `<section class="cc-confirm" aria-labelledby="cc-confirm-h">
		<h3 id="cc-confirm-h" tabindex="-1">Confirm your starter copy</h3>
		<dl>
			<dt>Leader</dt><dd>${esc(leader.name)} <small>${esc(leader.settled)} closed trades, ${esc(solFmt(leader.pnl_sol, { sign: true }))} in 30 days</small></dd>
			<dt>Copies go to</dt><dd title="${esc(cfg.wallet)}">${esc(short(cfg.wallet))} <small>your own wallet, which signs every trade</small></dd>
			<dt>Each copied trade</dt><dd>${esc(cfg.size)} SOL</dd>
			<dt>Daily cap</dt><dd>${esc(cfg.daily)} SOL <small>the most you can lose in a day at these settings</small></dd>
			<dt>Open copies at once</dt><dd>${esc(cfg.open)}</dd>
			<dt>Auto-pause</dt><dd>if ${esc(leader.name)} draws down more than ${esc(cfg.dd)}%</dd>
			<dt>Coins copied</dt><dd>only ones that pass the safety check</dd>
			<dt>Performance fee</dt><dd>10% of realized profit above your high-water mark, paid in $THREE <small>nothing on losses</small></dd>
			<dt>What happens now</dt><dd>Nothing is spent. When ${esc(leader.name)} buys, a copy appears in your copy dashboard, and nothing trades until you sign it in your wallet.</dd>
		</dl>
		<p class="cc-verdict cc-verdict-${ghostLost ? 'bad' : 'ok'}">${esc(ghostLine)}</p>
		<label class="cc-check"><input type="checkbox" id="cc-ack" /> <span>I understand copy trading can lose money, and at these settings I could lose up to ${esc(cfg.daily)} SOL in a day.</span></label>
		${ghostLost ? `<label class="cc-check"><input type="checkbox" id="cc-ack2" /> <span>I have seen that the coach does not recommend this leader right now, and I still want the starter copy.</span></label>` : ''}
		<p class="cc-err" id="cc-confirm-err" hidden></p>
		<div class="cc-actions">
			<button type="button" class="cc-btn" id="cc-cancel">Cancel</button>
			<button type="button" class="cc-btn cc-btn-primary" id="cc-go" disabled>Confirm starter copy</button>
		</div>
	</section>`;
}

async function renderStarter(stage) {
	const leaders = state.overview.leaders || [];
	const caps = state.overview.starter_caps;
	const leader = leaders.find((l) => l.agent_id === state.leaderId) || null;
	stage.innerHTML = stageSkeleton();
	stage.setAttribute('aria-busy', 'true');
	const me = await ensureMe();
	stage.setAttribute('aria-busy', 'false');
	if (state.step !== 'starter_copy') return;

	if (!leader) {
		stage.innerHTML = `<div class="cc-empty">${heading('Pick a leader first')}<p>The starter copy follows the leader you ghost-copied. Go back one step and choose one.</p>
			<div class="cc-actions" style="justify-content:center"><button type="button" class="cc-btn cc-btn-primary" data-back>Choose a leader</button></div></div>`;
		stage.querySelector('[data-back]').addEventListener('click', () => goTo('ghost_copy'));
		return;
	}
	if (!leader.copyable) {
		stage.innerHTML = `<div class="cc-card">${heading(`${leader.name} cannot be copied yet`)}
			<p class="cc-lede">A leader needs a real closed record before anyone can attach money to it. ${esc(leader.name)} still needs: ${esc((leader.unmet || []).join(', '))}.</p>
			<div class="cc-actions"><button type="button" class="cc-btn cc-btn-primary" data-back>Choose a copyable leader</button></div></div>`;
		stage.querySelector('[data-back]').addEventListener('click', () => goTo('ghost_copy'));
		return;
	}
	if (!me) {
		const next = `/copy-coach?step=starter_copy&leader=${encodeURIComponent(leader.agent_id)}`;
		stage.innerHTML = `<div class="cc-card">${heading('Sign in to set up a real copy')}
			<p class="cc-lede">Steps one and two needed nothing. A real copy needs an account so your caps and your copies are kept for you. Signing in never gives us your wallet keys.</p>
			<div class="cc-actions"><a class="cc-btn cc-btn-primary" href="/login?next=${encodeURIComponent(next)}">Sign in</a><button type="button" class="cc-btn" data-back>Back to the ghost copy</button></div></div>`;
		stage.querySelector('[data-back]').addEventListener('click', () => goTo('ghost_copy'));
		return;
	}

	stage.innerHTML = `<div class="cc-card">
		${heading(`One tiny real copy of ${leader.name}`)}
		<p class="cc-lede">The smallest real step there is. The limits below are the starter caps: the page will not let you go past them, and neither will the server.</p>
		${starterForm(leader, caps)}
		<p class="cc-why"><b>Why this step is safe:</b> non-custodial (every copy is a trade you sign from your own wallet), hard caps enforced by the server, and an automatic pause if the leader starts losing. You can pause or stop it at any time.</p>
		<div class="cc-actions"><button type="button" class="cc-btn" data-back>Back</button></div>
	</div>`;
	stage.querySelector('[data-back]').addEventListener('click', () => goTo('ghost_copy'));
	const size = stage.querySelector('#cc-size');
	const daily = stage.querySelector('#cc-daily');
	size.addEventListener('input', () => { stage.querySelector('#cc-size-o').textContent = `${Number(size.value).toFixed(2)} SOL`; });
	daily.addEventListener('input', () => { stage.querySelector('#cc-daily-o').textContent = `${Number(daily.value).toFixed(2)} SOL`; });

	stage.querySelector('#cc-starter').addEventListener('submit', (e) => {
		e.preventDefault();
		const err = stage.querySelector('#cc-form-err');
		err.hidden = true;
		const cfg = {
			wallet: stage.querySelector('#cc-wallet').value.trim(),
			size: Number(Number(size.value).toFixed(2)),
			daily: Number(Number(daily.value).toFixed(2)),
			open: Number(stage.querySelector('#cc-open').value),
			dd: Number(stage.querySelector('#cc-dd').value),
		};
		if (!BASE58_RE.test(cfg.wallet)) {
			err.textContent = 'Enter your own Solana wallet address (base58, 32 to 44 characters).';
			err.hidden = false;
			stage.querySelector('#cc-wallet').focus();
			return;
		}
		if (cfg.size > cfg.daily) {
			err.textContent = 'The daily cap has to be at least the size of one copied trade.';
			err.hidden = false;
			return;
		}
		mountConfirm(stage, leader, cfg);
	});
}

function mountConfirm(stage, leader, cfg) {
	const ghost = state.ghost && state.ghost.leader?.agent_id === leader.agent_id ? state.ghost : null;
	const slot = stage.querySelector('#cc-confirm-slot');
	slot.innerHTML = confirmCard({ leader, cfg, ghost });
	const ack = slot.querySelector('#cc-ack');
	const ack2 = slot.querySelector('#cc-ack2');
	const go = slot.querySelector('#cc-go');
	const sync = () => { go.disabled = !(ack.checked && (!ack2 || ack2.checked)); };
	ack.addEventListener('change', sync);
	ack2?.addEventListener('change', sync);
	slot.querySelector('#cc-confirm-h').focus();
	slot.querySelector('#cc-cancel').addEventListener('click', () => {
		slot.innerHTML = '';
		toast('Cancelled. Nothing was saved or sent.');
	});
	go.addEventListener('click', async () => {
		const errEl = slot.querySelector('#cc-confirm-err');
		errEl.hidden = true;
		go.disabled = true;
		go.textContent = 'Saving…';
		const body = {
			starter: true,
			risk_ack: true,
			leader_agent_id: leader.agent_id,
			network: state.overview.network || 'mainnet',
			copier_wallet: cfg.wallet,
			sizing_rule: 'fixed',
			fixed_sol: cfg.size,
			per_trade_cap_sol: cfg.size,
			min_order_sol: Math.min(0.01, cfg.size),
			daily_budget_sol: cfg.daily,
			max_open_copies: cfg.open,
			max_drawdown_pct: cfg.dd,
			require_safety_pass: true,
			copy_sells: true,
			perf_fee_bps: 1000,
		};
		try {
			const r = await apiFetch('/api/copy/subscriptions', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, allowAnonymous: true });
			const data = await r.json().catch(() => ({}));
			if (!r.ok) {
				go.textContent = 'Confirm starter copy';
				sync();
				errEl.hidden = false;
				if (r.status === 401) errEl.innerHTML = `Your session ended. <a class="cc-link" href="/login?next=${encodeURIComponent(location.pathname + location.search)}">Sign in again</a>; nothing was saved.`;
				else if (data.error === 'leader_not_copyable') errEl.textContent = `${data.error_description} Nothing was saved.`;
				else errEl.textContent = `${data.error_description || 'The copy could not be saved.'} Nothing was saved or sent.`;
				return;
			}
			state.subs = null;
			state.done.starter_copy = true;
			saveStore();
			renderRail();
			stage.innerHTML = `<div class="cc-card cc-done">
				<div class="cc-done-icon" aria-hidden="true">✓</div>
				${heading(`Your starter copy of ${leader.name} is set`)}
				<p class="cc-lede">Nothing has been spent. When ${esc(leader.name)} next buys a coin that passes the safety check, a copy of ${esc(cfg.size)} SOL appears in your copy dashboard. It only trades if you sign it in your wallet, and never more than ${esc(cfg.daily)} SOL in a day.</p>
				<div class="cc-actions">
					<a class="cc-btn cc-btn-primary" href="/dashboard/copy">Open my copy dashboard</a>
					<button type="button" class="cc-btn" data-next>What comes next</button>
				</div>
				<p class="cc-why"><b>To stop:</b> pause or stop the copy from your copy dashboard at any time, or simply do not sign a copy you do not want.</p>
			</div>`;
			stage.querySelector('[data-next]').addEventListener('click', () => complete('starter_copy', 'full_copy'));
			stage.querySelector('h2').focus();
			coachSays(`Done. Your starter copy is capped at ${cfg.size} SOL per trade and ${cfg.daily} SOL a day, and nothing trades until you sign it.`, { source: 'guide' });
		} catch {
			go.textContent = 'Confirm starter copy';
			sync();
			errEl.hidden = false;
			errEl.textContent = 'Network error. Nothing was saved or sent. Try again.';
		}
	});
}

// Step 4 ──────────────────────────────────────────────────────────────────────

function renderNext(stage) {
	const leader = (state.overview.leaders || []).find((l) => l.agent_id === state.leaderId) || null;
	stage.innerHTML = `<div class="cc-card">
		${heading('What comes next, and when')}
		<p class="cc-lede">Stay at starter size until a handful of real copies have landed and you have watched how they behave, losses included. Raise the caps only when the record, not one good day, earns it.</p>
		<div class="cc-next">
			<a href="/dashboard/copy"><b>Your copies</b><span>Every copy waiting for your signature, what you acted on, and pause or stop.</span></a>
			${leader ? `<a href="/trader/${encodeURIComponent(leader.agent_id)}"><b>${esc(leader.name)}'s full record</b><span>Every closed trade, with the reason it was taken.</span></a>` : ''}
			<a href="/ghost-copy"><b>Ghost-copy others</b><span>Replay any leader over any window before you copy it.</span></a>
			<a href="/mirror"><b>Full copy with your own caps</b><span>When you are ready: bigger sizes, your own limits, or an agent that mirrors for you.</span></a>
			<a href="/coin-intel?tab=scout"><b>See the evidence behind momentum</b><span>The Sentiment Scout: every claim about a coin with its source and on-chain check.</span></a>
			<a href="/trades"><b>Every recent exit</b><span>Wins and losses from every agent, as they close.</span></a>
		</div>
		<div class="cc-actions"><button type="button" class="cc-btn" data-restart>Start the coach over</button></div>
	</div>`;
	stage.querySelector('[data-restart]').addEventListener('click', () => {
		state.done = {};
		state.ghost = null;
		goTo('see_a_win');
	});
}

// ── chat ─────────────────────────────────────────────────────────────────────

function addMsg(role, html, { cls = '' } = {}) {
	const li = document.createElement('li');
	li.className = `cc-msg cc-msg-${role}${cls ? ` ${cls}` : ''}`;
	li.innerHTML = html;
	const list = $('#cc-msgs');
	list.appendChild(li);
	list.scrollTop = list.scrollHeight;
	return li;
}

function coachSays(text, { source = 'guide', model = null, quiet = false } = {}) {
	const last = $('#cc-msgs').lastElementChild;
	if (quiet && last?.dataset.text === text) return;
	const src = source === 'llm'
		? `Coach${model ? ` (${esc(model)})` : ''}, checked against the numbers on this page`
		: 'From the coach\'s guide';
	const li = addMsg('coach', `${esc(text)}<span class="cc-msg-src">${src}</span>`);
	li.dataset.text = text;
	state.history.push({ role: 'coach', text });
}

function renderChips() {
	const el = $('#cc-chips');
	el.innerHTML = (CHIPS[state.step] || []).map((q) => `<button type="button" class="cc-chip">${esc(q)}</button>`).join('');
	el.querySelectorAll('.cc-chip').forEach((b) => b.addEventListener('click', () => ask(b.textContent)));
}

async function ask(message) {
	const text = String(message || '').trim();
	if (!text || state.chatBusy) return;
	state.chatBusy = true;
	$('#cc-send').disabled = true;
	addMsg('user', esc(text));
	const typing = addMsg('coach', '<span class="cc-typing" aria-label="The coach is answering"><i></i><i></i><i></i></span>');
	const history = state.history.slice(-8);
	state.history.push({ role: 'user', text });
	try {
		const r = await fetch('/api/copy/coach', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({
				message: text,
				history,
				step: state.step,
				leader_id: state.leaderId || undefined,
				window: state.ghostWindow,
				budget_sol: state.ghostBudget,
			}),
		});
		const data = await r.json().catch(() => ({}));
		typing.remove();
		if (!r.ok) {
			const msg = r.status === 429
				? 'You have asked a lot in a short time. Give it a few minutes and ask again.'
				: `${data.error_description || 'The coach could not answer'}. Try again in a moment.`;
			addMsg('coach', esc(msg), { cls: 'cc-msg-err' });
			return;
		}
		coachSays(data.reply, { source: data.source, model: data.model });
	} catch {
		typing.remove();
		addMsg('coach', 'Network error: the question did not reach the coach. Check your connection and ask again.', { cls: 'cc-msg-err' });
	} finally {
		state.chatBusy = false;
		$('#cc-send').disabled = false;
	}
}

// ── boot ─────────────────────────────────────────────────────────────────────

async function loadOverview() {
	try {
		state.overview = await getJson('/api/copy/coach');
		renderStage();
	} catch (err) {
		const stage = $('#cc-stage');
		stage.setAttribute('aria-busy', 'false');
		stage.innerHTML = `<div class="cc-empty">
			${heading('The coach could not load its data')}
			<p>${esc(err.message)}. Every number here is read live, so a hiccup upstream shows up first on this page.</p>
			<div class="cc-actions" style="justify-content:center"><button type="button" class="cc-btn cc-btn-primary" id="cc-retry">Try again</button></div>
		</div>`;
		$('#cc-retry').addEventListener('click', () => { stage.innerHTML = stageSkeleton(); loadOverview(); });
	}
}

function boot() {
	const st = document.createElement('style');
	st.textContent = RECEIPT_CSS;
	document.head.appendChild(st);
	loadStore();
	renderRail();
	renderStage();
	renderChips();
	coachSays(OPENERS[state.step], { source: 'guide' });
	$('#cc-rail').addEventListener('click', (e) => {
		const b = e.target.closest('[data-step]');
		if (b) goTo(b.dataset.step);
	});
	$('#cc-ask').addEventListener('submit', (e) => {
		e.preventDefault();
		const input = $('#cc-input');
		const v = input.value;
		input.value = '';
		ask(v);
	});
	loadOverview();
}

boot();
