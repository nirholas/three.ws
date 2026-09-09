// Arm your agent: standalone automation setup (the trading-bot config surface).
// Reuses the Oracle watch API: /api/agents, /api/oracle/watch, /api/oracle/test-alert.
// Self-contained: no imports from oracle.js so this page stands on its own.

import { ensureRiskAck } from './shared/risk-ack.js';
import { proxiedImageURL } from './ipfs.js';

const NETWORK = 'mainnet';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const CATEGORIES = ['meme', 'tech', 'ai', 'culture', 'community', 'political', 'news', 'animal', 'celebrity', 'utility', 'unknown'];

// The stat strip's "no value yet" glyph, matching every other placeholder on
// the page. Written as an escape because the repo bans the literal character.
const NO_VALUE = '\u2014';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSol = (n) => (n == null ? '—' : `${Number(n) < 0.01 && Number(n) > 0 ? Number(n).toFixed(4) : Number(n).toFixed(2)}◎`);
const tierPill = (t) => `tp-${t || 'avoid'}`;
function ago(ts) {
	if (!ts) return '—';
	const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
	if (s < 60) return `${Math.floor(s)}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

const state = { agents: [], agentId: null, watch: null, minScore: 72, wallet: null, feed: [], feedAt: null, feedError: false, edge: null };
let feedTimer = null;

async function api(path, opts = {}) {
	const ctrl = new AbortController();
	const to = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
	try {
		const res = await fetch(path, { credentials: 'include', signal: ctrl.signal, ...opts });
		const data = await res.json().catch(() => null);
		return { ok: res.ok, status: res.status, data };
	} catch {
		return { ok: false, status: 0, data: null };
	} finally {
		clearTimeout(to);
	}
}

// Live values written by this script into elements the static markup annotates
// for translation. Without the `data-i18n-owned` stamp, the locale catalog pass
// (which lands after an async /api/locale fetch) reverts them to their English
// placeholder: an agent showing "Armed - Live" flipped back to "Disarmed", and
// "9 clearing your bar" back to "Reading the conviction stream...". See the
// scriptOwns() contract in src/i18n.js.
function setLive(sel, text) {
	const el = typeof sel === 'string' ? $(sel) : sel;
	if (!el) return;
	el.dataset.i18nOwned = '1';
	el.textContent = text;
}

// The page has four shapes, and exactly one is on screen at a time.
// `config` is the real surface; the other three keep the public conviction
// stream visible so a visitor who cannot configure anything still sees the
// product working.
const PANELS = { noAgent: 'emptyState', signedOut: 'signedOutState', error: 'errorState' };
function showState(kind) {
	for (const id of Object.values(PANELS)) $('#' + id).style.display = 'none';
	const config = kind === 'config';
	$('#setup').style.display = config ? '' : 'none';
	$('#statsStrip').style.display = config ? '' : 'none';
	$('.layout').classList.toggle('preview-only', !config);
	if (!config && PANELS[kind]) $('#' + PANELS[kind]).style.display = 'block';
}

// ── boot ──────────────────────────────────────────────────────────────────────
async function boot() {
	wireStaticControls();
	showSkeletons();
	// Both of these are public endpoints, so they run for every visitor. A
	// signed-out page still shows what is clearing a Strong+ bar right now
	// rather than being a bare sign-in wall.
	loadEdge();        // 30-day proof-of-edge for the conviction bar (global)
	startFeedLoop();   // live "clearing your bar" preview (global, polls)
	$('#retryBtn').addEventListener('click', loadAgents);
	await loadAgents();
}

// Three outcomes, three different things to tell the visitor. The old code
// collapsed all of them into "Create a 3D agent to arm it", so a signed-out
// visitor was told to create an agent they could not create, and an agents API
// that was down looked like an empty account with no way to retry.
async function loadAgents() {
	const me = await api('/api/auth/me');
	if (!me.ok || !me.data || !me.data.user) {
		// A signed-out visitor never triggers the /api/agents 401 in the first
		// place, which is what put an unhandled 401 in the console on every load.
		showState(me.ok ? 'signedOut' : 'error');
		if (!me.ok) setLive('#errorDetail', 'The session check did not answer.');
		return;
	}

	const { ok, status, data } = await api('/api/agents');
	if (!ok) {
		setLive('#errorDetail', status
			? `The agents API answered ${status}.`
			: 'The agents API could not be reached.');
		showState('error');
		return;
	}
	const agents = data ? (data.agents || data.items || []) : [];
	state.agents = Array.isArray(agents) ? agents : [];

	if (!state.agents.length) { showState('noAgent'); return; }

	const sel = $('#agentSel');
	sel.innerHTML = state.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`).join('');
	if (sel.dataset.wired !== '1') {
		sel.dataset.wired = '1';
		sel.addEventListener('change', () => loadWatch(sel.value));
	}
	state.agentId = state.agents[0].id;
	showState('config');
	loadWatch(state.agentId);
}

// Skeleton placeholders so nothing renders as a dead "—" while real data loads.
function showSkeletons() {
	['#statWin', '#statPnl', '#statOpen', '#statTotal'].forEach((id) => {
		const el = $(id); el.classList.add('sk'); el.textContent = '00%';
	});
	$('#edgeReadout').innerHTML = '<div class="e-note">Loading the 30-day track record for this bar…</div>';
	$('#qualBody').innerHTML = '<div class="qual-empty">Reading the live conviction stream…</div>';
	$('#ledgerBody').innerHTML = skeletonLedger();
}

function skeletonLedger() {
	const row = `<div style="display:flex;gap:10px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
		<span class="sk" style="height:13px;flex:1"></span><span class="sk" style="height:13px;width:42px"></span><span class="sk" style="height:13px;width:50px"></span></div>`;
	return row.repeat(4);
}

// Controls that exist in the static markup (segmented + toggles + chips + buttons).
function wireStaticControls() {
	// narrative chips
	$('#catChips').innerHTML = CATEGORIES.map((c) => `<button type="button" class="cchip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
	$('#catChips').addEventListener('click', (e) => {
		const b = e.target.closest('.cchip');
		if (b) { b.classList.toggle('on'); markDirty(); renderQualifying(); }
	});

	// min-conviction segmented
	$('#convSeg').addEventListener('click', (e) => {
		const b = e.target.closest('button[data-min]');
		if (!b) return;
		$$('#convSeg button').forEach((x) => x.classList.toggle('on', x === b));
		state.minScore = Number(b.dataset.min);
		markDirty();
		renderEdge();
		renderQualifying();
	});

	// mode segmented (simulate / live)
	$('#modeSeg').addEventListener('click', (e) => {
		const b = e.target.closest('button[data-mode]');
		if (!b) return;
		const live = b.dataset.mode === 'live';
		$$('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
		$('#modeSeg').classList.toggle('live-on', live);
		updateArmStatus();
		markDirty();
	});

	wireSwitch('#smartToggle', renderQualifying);
	wireSwitch('#scaleToggle', () => { renderScaleSub(); renderQualifying(); });
	wireSwitch('#armToggle', updateArmStatus);

	['#fSize', '#fDaily', '#fOpen'].forEach((s) => $(s).addEventListener('input', () => {
		renderScaleSub(); renderRisk(); renderWalletRunway(); renderQualifying(); markDirty();
	}));

	$('#saveBtn').addEventListener('click', saveWatch);
	$('#tgTest').addEventListener('click', sendTelegramTest);
	$('#tgInput').addEventListener('input', markDirty);
}

function wireSwitch(sel, cb) {
	const el = $(sel);
	const flip = () => {
		const on = !el.classList.contains('on');
		el.classList.toggle('on', on);
		el.setAttribute('aria-checked', String(on));
		markDirty();
		if (cb) cb(on);
	};
	el.addEventListener('click', flip);
	// role="switch" + tabindex="0" made these focusable but not operable: a
	// keyboard user could tab onto the arm switch and never toggle it. Enter and
	// Space are what the switch role contracts for.
	el.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
		e.preventDefault();
		flip();
	});
}
function setSwitch(sel, on) { const el = $(sel); el.classList.toggle('on', !!on); el.setAttribute('aria-checked', String(!!on)); }
function isOn(sel) { return $(sel).classList.contains('on'); }

function markDirty() {
	const btn = $('#saveBtn');
	if (btn.dataset.dirty === '1') return;
	btn.dataset.dirty = '1';
	btn.classList.add('dirty');
	$('#saveNote').textContent = '';
}

// ── derived UI ────────────────────────────────────────────────────────────────
function modeIsLive() { return $('#modeSeg').classList.contains('live-on'); }

function updateArmStatus() {
	const armed = isOn('#armToggle');
	const live = modeIsLive();
	const dot = $('#armStatusDot');
	const lab = $('#armStatusLab');
	const sub = $('#armStatusSub');
	dot.className = 'arm-dot ' + (armed ? (live ? 'live' : 'sim') : 'off');
	if (!armed) {
		setLive(lab, 'Disarmed');
		sub.textContent = 'Your agent is idle. Flip the switch to start watching the conviction stream.';
	} else if (live) {
		setLive(lab, 'Armed · Live');
		sub.textContent = 'Spending real SOL from the agent wallet when a coin clears your bar, capped by your limits.';
	} else {
		setLive(lab, 'Armed · Simulate');
		sub.textContent = 'Logging every play it would take, risk-free. Outcomes get graded so you can trust it before going live.';
	}
}

function renderScaleSub() {
	const base = Number($('#fSize').value) || 0.05;
	setLive('#scaleSub', isOn('#scaleToggle')
		? `${base.toFixed(3)} SOL at your floor → up to ${(base * 1.5).toFixed(3)} SOL at score 100`
		: 'Off. Every qualifying play uses the same size.');
}

function renderRisk() {
	const el = $('#riskSummary');
	const size = Number($('#fSize').value) || 0;
	const daily = Number($('#fDaily').value) || 0;
	const open = Number($('#fOpen').value) || 0;
	if (!(size > 0 && daily > 0)) {
		el.textContent = 'Set a per-trade size and daily cap to see your exposure.';
		return;
	}
	const trades = Math.floor(daily / size);
	let txt = `≈ ${trades} ${trades === 1 ? 'buy' : 'buys'}/day max · up to ${fmtSol(daily)} deployed · ${open} position${open === 1 ? '' : 's'} open at once`;
	const w = state.wallet;
	if (w && w.sol != null) {
		if (w.sol < size) {
			txt += ` · <b style="color:var(--amber)">wallet holds ${fmtSol(w.sol)}, fund it before going live</b>`;
		} else if (w.sol < daily) {
			txt += ` · wallet covers ≈ ${Math.floor(w.sol / size)} ${Math.floor(w.sol / size) === 1 ? 'trade' : 'trades'} before it's dry`;
		}
	}
	el.innerHTML = txt;
}

// ── agent wallet balance + runway ───────────────────────────────────────────────
async function loadWallet(agentId) {
	const pill = $('#walletPill');
	const bal = $('#walletBal');
	// Point the deposit link at this agent before the pill is shown, so the
	// anchor is never on screen aimed at the generic agent list.
	$('#walletFund').href = `/agents/${encodeURIComponent(agentId)}/wallet#deposit`;
	pill.hidden = false;
	pill.classList.remove('low');
	$('#walletRun').textContent = '';
	bal.classList.add('sk'); bal.textContent = '0.00◎';
	state.wallet = null;

	const { ok, data } = await api(`/api/agents/${encodeURIComponent(agentId)}/wallet`);
	bal.classList.remove('sk');
	if (ok && data) {
		const sol = data.solana_balance == null ? null : Number(data.solana_balance);
		state.wallet = { sol, address: data.solana_address || null };
		bal.textContent = sol == null ? '—' : fmtSol(sol);
	} else {
		bal.textContent = '—';
	}
	renderWalletRunway();
	renderRisk();
}

function renderWalletRunway() {
	const run = $('#walletRun');
	const pill = $('#walletPill');
	pill.classList.remove('low');
	const w = state.wallet;
	if (!w || w.sol == null) { run.textContent = ''; return; }
	const size = Number($('#fSize').value) || 0.05;
	const trades = size > 0 ? Math.floor(w.sol / size) : 0;
	run.textContent = `· ${trades} ${trades === 1 ? 'trade' : 'trades'} left`;
	if (w.sol < size) pill.classList.add('low');
}

// ── proof of edge: 30-day backtest for the chosen bar ───────────────────────────
async function loadEdge() {
	const { ok, data } = await api(`/api/oracle/backtest?period=30d&network=${NETWORK}`);
	state.edge = ok && data && Array.isArray(data.by_tier) ? data : null;
	renderEdge();
}

function includedTiers(minScore) {
	if (minScore >= 86) return ['prime'];
	if (minScore >= 72) return ['prime', 'strong'];
	return ['prime', 'strong', 'lean'];
}

function renderEdge() {
	const el = $('#edgeReadout');
	const e = state.edge;
	if (!e) {
		el.innerHTML = '<div class="e-note">Edge stats are warming up. Historical win rates for this bar show here as soon as enough coins resolve.</div>';
		return;
	}
	const inc = new Set(includedTiers(state.minScore));
	const agg = { wins: 0, losses: 0, threeX: 0, athSum: 0, athN: 0 };
	for (const t of e.by_tier) {
		if (!inc.has(t.tier)) continue;
		agg.wins += t.wins || 0;
		agg.losses += t.losses || 0;
		agg.threeX += t.three_x || 0;
		if (t.avg_ath) { agg.athSum += t.avg_ath * (t.total || 0); agg.athN += t.total || 0; }
	}
	const resolved = agg.wins + agg.losses;
	const label = state.minScore >= 86 ? 'Prime' : state.minScore >= 72 ? 'Strong+' : 'Lean+';
	if (!resolved) {
		el.innerHTML = `<div class="e-note">Not enough resolved coins at the <b>${label}</b> bar in the last 30 days to show a win rate yet. Lower the floor for a larger sample.</div>`;
		return;
	}
	const wr = Math.round((agg.wins / resolved) * 100);
	const avgAth = agg.athN ? agg.athSum / agg.athN : null;
	el.innerHTML = `
		<div class="e-stat"><b>${wr}%</b><span>win rate</span></div>
		${avgAth ? `<div class="e-stat"><b>${avgAth.toFixed(1)}×</b><span>avg peak</span></div>` : ''}
		<div class="e-stat"><b>${agg.threeX}</b><span>hit 3×+</span></div>
		<div class="e-stat"><b>${resolved}</b><span>resolved</span></div>
		<div class="e-note">Last 30 days at your <b>${label}</b> bar. A win = graduated or ≥2× from the score. Past results aren't a promise.</div>`;
}

// ── live "clearing your bar" preview ────────────────────────────────────────────
async function startFeedLoop() {
	await loadFeed();
	feedTimer = setInterval(loadFeed, 20000);
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) { clearInterval(feedTimer); feedTimer = null; }
		else if (!feedTimer) { loadFeed(); feedTimer = setInterval(loadFeed, 20000); }
	});
}

async function loadFeed() {
	const { ok, data } = await api(`/api/oracle/feed?network=${NETWORK}&limit=80`);
	if (ok && data && Array.isArray(data.items)) {
		state.feed = data.items;
		state.feedAt = Date.now();
		state.feedError = false;
	} else {
		// Kept distinct from "the stream answered and had nothing": the two read
		// identically from an empty array and mean opposite things to the user.
		state.feedError = true;
	}
	renderQualifying();
}

function currentRules() {
	return {
		minScore: state.minScore,
		cats: new Set($$('#catChips .cchip.on').map((b) => b.dataset.cat)),
		requireSmart: isOn('#smartToggle'),
		size: Number($('#fSize').value) || 0.05,
		scaling: isOn('#scaleToggle'),
	};
}

function scaledSize(base, score) {
	const floor = state.minScore;
	if (score <= floor) return base;
	const t = Math.min(1, (score - floor) / (100 - floor || 1));
	return base * (1 + 0.5 * t);
}

function renderQualifying() {
	const body = $('#qualBody');
	const countEl = $('#qualCount');
	const metaEl = $('#qualMeta');
	if (!Array.isArray(state.feed)) return;
	const r = currentRules();
	const matches = state.feed
		.filter((it) =>
			Number(it.score) >= r.minScore &&
			(r.cats.size === 0 || r.cats.has(it.category)) &&
			(!r.requireSmart || (it.smart_wallet_count || 0) >= 1))
		.sort((a, b) => b.score - a.score);

	metaEl.textContent = state.feed.length ? `live · ${state.feed.length} scored / 12h` : '';
	$('#liveDot').classList.toggle('stale', !!state.feedError);

	if (!state.feed.length) {
		// Three different silences, three different things to say. Before the
		// first answer this is still the loading state, not an empty one.
		if (state.feedError) {
			setLive(countEl, 'Conviction stream unavailable');
			body.innerHTML = `<div class="qual-empty">The stream is not answering right now. It retries every 20 seconds, and any rules you have already saved keep running server-side either way.</div>`;
		} else if (state.feedAt) {
			setLive(countEl, 'Nothing scored in the last 12 hours');
			body.innerHTML = `<div class="qual-empty">The Oracle has not graded a launch in the last 12 hours. New coins land here the moment they are scored.</div>`;
		} else {
			countEl.textContent = 'Reading the conviction stream…';
			body.innerHTML = `<div class="qual-empty">Reading the live conviction stream…</div>`;
		}
		return;
	}

	setLive(countEl, matches.length
		? `${matches.length} clearing your bar`
		: 'Nothing clears your bar right now');
	if (!matches.length) {
		body.innerHTML = `<div class="qual-empty">No live coin meets every rule this moment, which is normal for a tight bar. Loosen the conviction floor or widen narratives to see more flow, or keep it strict and let your agent wait for the real ones.</div>`;
		return;
	}
	body.innerHTML = matches.slice(0, 8).map((it) => qualRow(it, r)).join('');
}

function qualRow(it, r) {
	const sym = esc(it.symbol || (it.mint || '').slice(0, 6));
	// Coin art is creator-supplied and lives on IPFS gateways that answer without
	// the CORS/content-type headers a browser trusts, so a direct <img> is
	// ORB-blocked and every icon fails. /api/img refetches server-side across a
	// gateway list and always returns a valid image. Same pattern as oracle.js.
	const art = proxiedImageURL(it.image_uri, it.mint || it.symbol || 'coin', { width: 36 });
	const img = art
		? `<img class="coinimg" src="${esc(art)}" alt="" loading="lazy" data-fallback="remove">`
		: '';
	const smart = (it.smart_wallet_count || 0) >= 1
		? `<span class="q-smart">${it.smart_wallet_count} smart in</span>`
		: 'no smart money';
	const cat = it.category ? esc(it.category) : '—';
	const size = r.scaling ? scaledSize(r.size, Number(it.score)) : r.size;
	return `<div class="qrow">
		<div class="q-main">
			<div class="q-sym">${img}<a href="https://pump.fun/coin/${esc(it.mint)}" target="_blank" rel="noopener">${sym}</a><span class="tierpill ${tierPill(it.tier)}">${esc(it.tier || '—')}</span></div>
			<div class="q-sub"><span>${cat}</span><span>${smart}</span><span>${ago(it.scored_at)} ago</span></div>
		</div>
		<div class="q-score ${Number(it.score) >= 86 ? 'hi' : ''}">${esc(it.score)}</div>
		<div class="q-size"><span>would buy</span>${fmtSol(size)}</div>
	</div>`;
}

// ── load current config ───────────────────────────────────────────────────────
async function loadWatch(agentId) {
	state.agentId = agentId;
	$('#saveNote').textContent = '';
	$('#ledgerBody').innerHTML = skeletonLedger();
	const { ok, data } = await api(`/api/oracle/watch?agent_id=${encodeURIComponent(agentId)}&network=${NETWORK}`);
	// This one payload carries the config, the action ledger and the summary, so
	// nothing here refetches it.
	const w = ok && data ? data.watch : null;
	state.watch = w;

	const min = w ? (w.min_score >= 86 ? 86 : w.min_score >= 72 ? 72 : 56) : 72;
	state.minScore = min;
	$$('#convSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.min) === min));

	$('#fSize').value = w?.per_trade_sol ?? 0.05;
	$('#fDaily').value = w?.max_daily_sol ?? 0.5;
	$('#fOpen').value = w?.max_open ?? 5;

	setSwitch('#smartToggle', w ? w.require_smart_money !== false : true);
	setSwitch('#scaleToggle', !!w?.size_scaling);
	setSwitch('#armToggle', !!w?.armed);

	const live = w?.mode === 'live';
	$$('#modeSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'live') === live));
	$('#modeSeg').classList.toggle('live-on', live);

	const cats = new Set(w?.categories || []);
	$$('#catChips .cchip').forEach((b) => b.classList.toggle('on', cats.has(b.dataset.cat)));
	$('#tgInput').value = w?.telegram_chat_id || '';

	renderScaleSub();
	renderRisk();
	updateArmStatus();
	renderEdge();
	renderQualifying();
	$('#saveBtn').dataset.dirty = '0';
	$('#saveBtn').classList.remove('dirty');

	loadWallet(agentId);
	renderActions(ok ? data : null);
}

async function saveWatch() {
	// Arming in live mode commits the agent's real SOL — gate on the risk ack.
	if (modeIsLive() && isOn('#armToggle') && !(await ensureRiskAck({ context: 'oracle-arm' }))) return;
	const btn = $('#saveBtn');
	btn.disabled = true; setLive(btn, 'Saving…');
	const cats = $$('#catChips .cchip.on').map((b) => b.dataset.cat);
	const min = state.minScore;
	const payload = {
		agent_id: state.agentId, network: NETWORK,
		armed: isOn('#armToggle'),
		mode: modeIsLive() ? 'live' : 'simulate',
		min_score: min, min_tier: min >= 86 ? 'prime' : min >= 72 ? 'strong' : 'lean',
		categories: cats,
		per_trade_sol: Number($('#fSize').value) || 0.05,
		max_daily_sol: Number($('#fDaily').value) || 0.5,
		max_open: Number($('#fOpen').value) || 5,
		require_smart_money: isOn('#smartToggle'),
		size_scaling: isOn('#scaleToggle'),
		telegram_chat_id: ($('#tgInput').value || '').trim() || null,
	};
	const { ok, data } = await api('/api/oracle/watch', {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
	});
	btn.disabled = false; setLive(btn, 'Save configuration');
	const note = $('#saveNote');
	if (ok && data?.watch) {
		state.watch = data.watch;
		btn.dataset.dirty = '0'; btn.classList.remove('dirty');
		const tg = data.watch.telegram_chat_id ? ' Telegram alerts active.' : '';
		note.className = 'save-note ok';
		note.textContent = data.watch.armed
			? `✓ Armed in ${data.watch.mode} mode. Your agent is watching the stream.${tg}`
			: `✓ Saved. Flip “Armed” when you’re ready to start watching.${tg}`;
		// reflect any server-side clamping
		$('#fSize').value = data.watch.per_trade_sol;
		$('#fDaily').value = data.watch.max_daily_sol;
		$('#fOpen').value = data.watch.max_open;
		renderRisk();
		refreshLedger(state.agentId);
	} else {
		note.className = 'save-note warn';
		// The API answers `{error: "<code>", error_description: "<sentence>"}`, so
		// the old `data.error.message` lookup was always undefined and every
		// failure rendered the same generic line. A caller who was told
		// "per_trade_sol must be at least 0.001 SOL to arm a live agent" or "you do
		// not own this agent" now sees exactly that.
		note.textContent = data?.error_description || data?.error || 'Could not save. Sign in and make sure you own this agent.';
	}
}

async function sendTelegramTest() {
	const chatId = ($('#tgInput').value || '').trim();
	const note = $('#tgNote');
	note.style.display = 'block';
	if (!chatId) {
		note.className = 'tg-note warn';
		note.textContent = 'Enter your Telegram chat ID or @channel first.';
		return;
	}
	const btn = $('#tgTest');
	btn.disabled = true; setLive(btn, 'Sending…');
	const { ok, data } = await api('/api/oracle/test-alert', {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ agent_id: state.agentId, chat_id: chatId }),
	});
	btn.disabled = false; setLive(btn, 'Send test');
	if (ok && data?.ok) {
		note.className = 'tg-note ok';
		note.textContent = '✓ Test message delivered. Check Telegram.';
	} else {
		note.className = 'tg-note warn';
		// A 200 with `ok:false` carries the reason in `error`; a 4xx/503 carries it
		// in `error_description` and leaves `error` as the machine code, which used
		// to surface to the user as the bare string "not_configured".
		note.textContent = (data?.error_description || data?.error || 'Delivery failed.') + (data?.hint ? ' ' + data.hint : '');
	}
}

// ── activity ledger ───────────────────────────────────────────────────────────
// A save answers with the new config only, so the graded ledger is refetched.
async function refreshLedger(agentId) {
	const { ok, data } = await api(`/api/oracle/watch?agent_id=${encodeURIComponent(agentId)}&network=${NETWORK}`);
	renderActions(ok ? data : null);
}

// Rendered from the payload loadWatch() already fetched.
function renderActions(payload) {
	const body = $('#ledgerBody');
	const actions = payload ? (payload.actions || []) : [];
	const s = payload ? payload.summary : null;

	// top stat strip
	const setStat = (id, val, cls) => { const el = $(id); el.textContent = val; el.className = 'stat-val' + (cls ? ' ' + cls : ''); };
	if (s && s.total) {
		setStat('#statWin', s.win_rate == null ? '—' : s.win_rate + '%');
		setStat('#statPnl', `${s.realized_pnl_sol >= 0 ? '+' : ''}${fmtSol(s.realized_pnl_sol)}`, s.realized_pnl_sol >= 0 ? 'up' : 'dn');
		setStat('#statOpen', String(s.open ?? 0));
		setStat('#statTotal', String(s.total));
	} else if (s) {
		// A real answer that says "this agent has never acted" is a zero, not an
		// unknown. Four dashes read as a failed load.
		setStat('#statWin', NO_VALUE);
		setStat('#statPnl', fmtSol(0));
		setStat('#statOpen', '0');
		setStat('#statTotal', '0');
	} else {
		['#statWin', '#statPnl', '#statOpen', '#statTotal'].forEach((id) => setStat(id, '—'));
	}

	if (!payload) {
		body.innerHTML = `<div class="ledger-empty">Could not read this agent's ledger. Pick the agent again, or reload the page.</div>`;
		return;
	}
	if (!actions.length) {
		body.innerHTML = `<div class="ledger-empty">No actions yet. Once armed, every buy lands here and gets graded against the outcome in real time.</div>`;
		return;
	}
	const rows = actions.map(actionRow).join('');
	body.innerHTML = `
		<div class="act-wrap">
			<table class="act-table">
				<thead><tr>
					<th scope="col">Coin</th><th scope="col">Tier</th><th scope="col">Conv.</th>
					<th scope="col">Size</th><th scope="col">Outcome</th><th scope="col">PnL</th><th scope="col">When</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
}

function actionRow(a) {
	const outcome = a.outcome || 'open';
	const outCls = outcome === 'win' ? 'up' : outcome === 'loss' ? 'dn' : '';
	const outLabel = outcome === 'win' ? `✓ Win${a.peak_multiple ? ` · ${Number(a.peak_multiple).toFixed(1)}×` : ''}` : outcome === 'loss' ? '✗ Loss' : 'Open';
	const pnl = a.realized_pnl_sol != null ? `${Number(a.realized_pnl_sol) >= 0 ? '+' : ''}${fmtSol(a.realized_pnl_sol)}` : '—';
	const pnlCls = a.realized_pnl_sol != null ? (Number(a.realized_pnl_sol) >= 0 ? 'up' : 'dn') : '';
	const modeBadge = a.mode === 'live' ? '<span class="act-live">live</span>' : '<span class="act-sim">sim</span>';

	let convCell;
	if (outcome === 'open' && a.current_score != null) {
		const entry = Number(a.conviction) || 0;
		const cur = Number(a.current_score);
		const delta = cur - entry;
		const deltaCls = delta > 0 ? 'up' : delta < 0 ? 'dn' : '';
		const deltaStr = delta !== 0 ? `<span class="act-delta ${deltaCls}">${delta > 0 ? '+' : ''}${delta}</span>` : '';
		convCell = `<span class="${tierPill(a.current_tier)}" style="padding:1px 4px;font-size:11px">${cur}</span>${deltaStr}`;
	} else {
		convCell = a.conviction ?? '—';
	}

	return `<tr class="act-row" data-outcome="${esc(outcome)}">
		<td class="act-coin"><a href="https://pump.fun/coin/${esc(a.mint)}" target="_blank" rel="noopener">${esc(a.symbol || (a.mint || '').slice(0, 6))}</a> ${modeBadge}</td>
		<td><span class="tierpill ${tierPill(a.tier)}">${esc(a.tier || '—')}</span></td>
		<td class="act-mono">${convCell}</td>
		<td class="act-mono">${fmtSol(a.size_sol)}</td>
		<td class="act-mono ${outCls}">${outLabel}</td>
		<td class="act-mono ${pnlCls}">${pnl}</td>
		<td class="act-when" title="${esc(a.acted_at || '')}">${ago(a.acted_at)} ago</td>
	</tr>`;
}

document.addEventListener('DOMContentLoaded', boot);
