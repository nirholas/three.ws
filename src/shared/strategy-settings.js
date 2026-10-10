// Strategy settings widgets: the live parts of the strategy builder.
//
//   mountLivePreview   how many recent launches the current config would
//                      have bought, with the funnel and the top blocking checks
//                      (POST /api/strategies/preview, public, read-only).
//   mountCompileBox    "describe it in words": compiles plain language into a
//                      Strategy Object, clamped to the agent's guards, and
//                      explains every field it set (POST /api/sniper/compile).
//   mountGatedBacktest replays the config, research gates included, over real
//                      captured launch history (POST /api/sniper/backtest).
//
// All three read the config through a getter so they always see exactly what the
// form controls and the JSON view hold. Used by src/shared/strategy-forms.js.

import { apiFetch } from '../api.js';
import { esc, shortAddr, timeAgo, VIOLET } from './strategy-forms.js';

// Plain-language names for every reason a launch can be filtered out. Entry
// keys come from matchesEntry; research keys mirror RESEARCH_CHECK_LABELS in
// api/_lib/strategy-schema.js.
const BLOCK_LABELS = {
	too_old: 'Older than your launch age',
	quote_not_sol: 'Not quoted in SOL',
	source_excluded: 'Not a three.ws launch',
	mc_below_min: 'Market cap under your floor',
	mc_above_max: 'Market cap over your ceiling',
	liq_below_min: 'Liquidity under your minimum',
	creator_launches: 'Creator launched too many coins',
	creator_graduated_below: 'Creator graduated too few coins',
	no_socials: 'No socials',
	filtered: 'Filtered by entry rules',
	min_holders: 'Too few holders',
	max_top_holder_pct: 'Largest holder too big',
	min_liquidity_sol: 'Liquidity under your minimum',
	security_min_score: 'Firewall score too low',
	require_no_mint_authority: 'Mint authority not renounced',
	require_no_freeze_authority: 'Freeze authority not renounced',
	dev_max_launches: 'Creator launched too many coins',
	dev_min_graduated: 'Creator graduated too few coins',
	dev_block_sold: 'Creator already sold',
	price_impact: 'Price impact over your limit',
};
const blockLabel = (k) => BLOCK_LABELS[k] || String(k).replace(/_/g, ' ');
const nf = new Intl.NumberFormat('en-US');
const fmtN = (n) => nf.format(Number(n) || 0);
const fmtPct = (n, d = 1) => (n == null || !Number.isFinite(Number(n)) ? '-' : `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(d)}%`);

const STYLE_ID = 'sx-settings-styles';
function ensureStyles() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const s = document.createElement('style');
	s.id = STYLE_ID;
	s.textContent = `
.sx-live { margin: 12px 0 0; }
.sx-live-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.sx-live-h { font-size: var(--text-2xs, .64rem); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-dim, #9a9a9a); font-weight: 700; }
.sx-win { display: inline-flex; border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); border-radius: 999px; padding: 2px; }
.sx-win button { font: inherit; font-size: var(--text-2xs, .64rem); padding: 3px 9px; border: 0; border-radius: 999px; background: transparent; color: var(--ink-dim, #9a9a9a); cursor: pointer; transition: background .16s, color .16s; }
.sx-win button:hover { color: var(--ink-bright, #fff); }
.sx-win button[aria-pressed="true"] { background: var(--wallet-accent-soft, rgba(139,92,246,.18)); color: ${VIOLET}; font-weight: 700; }
.sx-win button:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 1px; }
.sx-big { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.sx-big b { font-family: var(--font-display, inherit); font-size: 1.9rem; line-height: 1.1; color: var(--ink-bright, #fff); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.sx-big span { font-size: var(--text-xs, .72rem); color: var(--ink-dim, #9a9a9a); }
.sx-funnel { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 5px; }
.sx-funnel li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; font-size: var(--text-2xs, .66rem); color: var(--ink-dim, #9a9a9a); }
.sx-funnel li b { color: var(--ink, #ddd); font-variant-numeric: tabular-nums; font-weight: 600; }
.sx-bar { grid-column: 1 / -1; height: 4px; border-radius: 4px; background: var(--surface-2, rgba(255,255,255,.06)); overflow: hidden; }
.sx-bar i { display: block; height: 100%; background: ${VIOLET}; border-radius: 4px; transform-origin: left; transition: width .3s ease; }
.sx-sub { font-size: var(--text-2xs, .64rem); text-transform: uppercase; letter-spacing: .07em; color: var(--ink-faint, #777); font-weight: 700; margin: 12px 0 5px; }
.sx-blockers { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.sx-blockers li { display: flex; justify-content: space-between; gap: 8px; font-size: var(--text-2xs, .66rem); color: var(--ink-dim, #a8a8a8); }
.sx-blockers li b { color: var(--danger, #f87171); font-variant-numeric: tabular-nums; font-weight: 600; }
.sx-sample { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 3px; }
.sx-sample a { display: flex; justify-content: space-between; gap: 8px; font-size: var(--text-2xs, .66rem); color: var(--ink, #ddd); text-decoration: none; padding: 4px 6px; margin: 0 -6px; border-radius: 6px; transition: background .16s; }
.sx-sample a:hover { background: var(--surface-2, rgba(255,255,255,.05)); }
.sx-sample a:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); }
.sx-sample code { font-family: var(--font-mono, monospace); color: ${VIOLET}; }
.sx-sample span { color: var(--ink-faint, #777); white-space: nowrap; }
.sx-note { font-size: var(--text-2xs, .64rem); color: var(--ink-faint, #808080); line-height: 1.5; margin: 8px 0 0; }
.sx-det { margin-top: 8px; font-size: var(--text-2xs, .64rem); color: var(--ink-faint, #808080); }
.sx-det summary { cursor: pointer; color: var(--ink-dim, #9a9a9a); }
.sx-det ul { margin: 6px 0 0; padding-left: 16px; line-height: 1.5; }
.sx-skel { display: block; border-radius: 6px; background: linear-gradient(90deg, var(--surface-1, rgba(255,255,255,.04)) 25%, var(--surface-2, rgba(255,255,255,.09)) 50%, var(--surface-1, rgba(255,255,255,.04)) 75%); background-size: 200% 100%; animation: sx-shim 1.2s ease-in-out infinite; }
@keyframes sx-shim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .sx-skel { animation: none; } .sx-bar i { transition: none; } }
.sx-err { font-size: var(--text-2xs, .68rem); color: var(--danger, #f87171); line-height: 1.5; }
.sx-link { font: inherit; font-size: var(--text-2xs, .66rem); background: none; border: 0; padding: 0; color: ${VIOLET}; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.sx-link:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 2px; }
.sx-stale { opacity: .55; transition: opacity .2s; }
.sx-card { border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); padding: var(--space-sm, 12px); margin-bottom: var(--space-sm, 12px); background: var(--surface-1, rgba(255,255,255,.02)); }
.sx-card-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.sx-card-h h2 { font-size: var(--text-2xs, .64rem); text-transform: uppercase; letter-spacing: .07em; color: ${VIOLET}; font-weight: 700; margin: 0; }
.sx-card p { font-size: var(--text-2xs, .66rem); color: var(--ink-dim, #9a9a9a); line-height: 1.5; margin: 0 0 10px; }
.sx-card textarea { width: 100%; box-sizing: border-box; min-height: 72px; resize: vertical; font: inherit; font-size: var(--text-sm, .82rem); padding: 9px 10px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); background: var(--surface-1, rgba(255,255,255,.03)); color: var(--ink-bright, #fff); }
.sx-card textarea:focus, .sx-card select:focus { outline: none; border-color: var(--wallet-stroke-strong, rgba(139,92,246,.5)); }
.sx-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.sx-row select { font: inherit; font-size: var(--text-xs, .76rem); padding: 7px 9px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); background: var(--surface-1, rgba(255,255,255,.03)); color: var(--ink-bright, #fff); max-width: 100%; min-width: 0; }
.sx-row .so-btn { margin-left: auto; }
.sx-out { margin-top: 10px; }
.sx-expl { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.sx-expl li { font-size: var(--text-2xs, .68rem); color: var(--ink-dim, #a8a8a8); line-height: 1.45; padding-left: 10px; border-left: 2px solid var(--wallet-stroke, rgba(139,92,246,.35)); }
.sx-expl code { font-family: var(--font-mono, monospace); color: ${VIOLET}; font-size: .95em; }
.sx-flag { font-size: var(--text-2xs, .66rem); line-height: 1.45; margin: 6px 0 0; padding: 7px 9px; border-radius: 8px; background: var(--surface-2, rgba(255,255,255,.04)); color: var(--ink-dim, #b0b0b0); }
.sx-flag b { color: var(--ink, #ddd); }
.sx-flag[data-kind="clamp"] { border-left: 2px solid var(--warning, #fbbf24); }
.sx-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 560px) { .sx-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.sx-metric { border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: 8px; padding: 8px 9px; min-width: 0; }
.sx-metric span { display: block; font-size: var(--text-2xs, .6rem); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint, #777); }
.sx-metric b { display: block; margin-top: 2px; font-size: var(--text-md, .95rem); color: var(--ink-bright, #fff); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sx-metric b[data-sign="pos"] { color: var(--success, #4ade80); }
.sx-metric b[data-sign="neg"] { color: var(--danger, #f87171); }
.sx-cta { font-size: var(--text-2xs, .68rem); color: var(--ink-dim, #a8a8a8); line-height: 1.5; }
.sx-cta a { color: ${VIOLET}; }
`;
	document.head.appendChild(s);
}

async function readError(res, fallback) {
	const j = await res.json().catch(() => ({}));
	return j?.error_description || j?.error?.message || j?.message || fallback;
}

// ── live match preview ───────────────────────────────────────────────────────

export function mountLivePreview(host, { getConfig, onState }) {
	ensureStyles();
	if (!host) return { refresh() {}, destroy() {} };
	let hours = 24;
	let seq = 0;
	let ctrl = null;
	let timer = null;
	let last = null;
	let dead = false;
	host.className = 'sx-live';
	host.innerHTML = `<div class="sx-live-head">
			<span class="sx-live-h" id="sx-live-h">Recent launches it would buy</span>
			<span class="sx-win" role="group" aria-label="Preview window">${[1, 6, 24].map((h) => `<button type="button" data-h="${h}" aria-pressed="${h === hours}">${h}h</button>`).join('')}</span>
		</div>
		<div class="sx-live-body" aria-live="polite" aria-labelledby="sx-live-h"></div>`;
	const body = host.querySelector('.sx-live-body');
	host.querySelector('.sx-win').addEventListener('click', (e) => {
		const b = e.target.closest('button[data-h]');
		if (!b) return;
		hours = Number(b.dataset.h);
		host.querySelectorAll('.sx-win button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
		run();
	});
	body.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) run(); });

	function skeleton() {
		body.innerHTML = `<span class="sx-skel" style="width:46%;height:30px"></span>
			<span class="sx-skel" style="width:100%;height:9px;margin-top:12px"></span>
			<span class="sx-skel" style="width:82%;height:9px;margin-top:8px"></span>
			<span class="sx-skel" style="width:64%;height:9px;margin-top:8px"></span>`;
	}

	async function run() {
		clearTimeout(timer);
		ctrl?.abort();
		ctrl = new AbortController();
		const my = ++seq;
		if (last) body.classList.add('sx-stale');
		else skeleton();
		onState?.({ status: 'loading', data: last });
		try {
			const config = getConfig();
			const res = await apiFetch('/api/strategies/preview', {
				method: 'POST',
				allowAnonymous: true,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ config, hours, network: config.network }),
				signal: ctrl.signal,
				timeoutMs: 30_000,
			});
			if (my !== seq || dead) return;
			if (!res.ok) throw new Error(await readError(res, 'The launch history could not be read right now.'));
			const { data } = await res.json();
			if (my !== seq || dead) return;
			last = data;
			body.classList.remove('sx-stale');
			body.innerHTML = renderPreview(data);
			onState?.({ status: 'ready', data });
		} catch (err) {
			if (err?.name === 'AbortError' || my !== seq || dead || err?.redirected) return;
			last = null;
			body.classList.remove('sx-stale');
			body.innerHTML = `<div class="sx-err">${esc(err?.message || 'Preview unavailable.')} <button type="button" class="sx-link" data-retry>Try again</button></div>`;
			onState?.({ status: 'error', data: null });
		}
	}

	run();
	return {
		refresh() { clearTimeout(timer); if (last) body.classList.add('sx-stale'); onState?.({ status: 'loading', data: last }); timer = setTimeout(run, 400); },
		retry() { run(); },
		destroy() { dead = true; clearTimeout(timer); ctrl?.abort(); },
	};
}

function topBlockers(d) {
	const all = [...Object.entries(d.entry_rejects || {}), ...Object.entries(d.blocked_by || {})];
	if (d.impact_blocked) all.push(['price_impact', d.impact_blocked]);
	const merged = new Map();
	for (const [k, n] of all) {
		const label = blockLabel(k);
		merged.set(label, (merged.get(label) || 0) + n);
	}
	return [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
}

function renderPreview(d) {
	const universe = Number(d.universe) || 0;
	const win = `${d.window_hours}h`;
	if (!universe) {
		return `<div class="sx-big"><b>0</b><span>launches recorded in the last ${win}</span></div>
			<p class="sx-note">No ${d.network === 'devnet' ? 'devnet ' : ''}launch history in this window yet. Try a longer window${d.network === 'devnet' ? ' or switch to mainnet' : ''}.</p>`;
	}
	const pct = (n) => `${Math.max(0, Math.min(100, (n / universe) * 100)).toFixed(1)}%`;
	const step = (label, n) => `<li><span>${label}</span><b>${fmtN(n)}</b><span class="sx-bar"><i style="width:${pct(n)}"></i></span></li>`;
	const blockers = topBlockers(d);
	const head = d.would_buy > 0
		? `<div class="sx-big"><b>${fmtN(d.would_buy)}</b><span>of ${fmtN(universe)} launches in the last ${win}</span></div>`
		: `<div class="sx-big"><b>0</b><span>of ${fmtN(universe)} launches in the last ${win}</span></div>
			<p class="sx-note">Nothing passed. ${blockers.length ? `The biggest filter is <b>${esc(blockers[0][0].toLowerCase())}</b>; loosen it to see matches.` : 'Loosen a rule to see matches.'}</p>`;
	const sample = (d.sample || []).length
		? `<div class="sx-sub">Examples</div><ul class="sx-sample">${d.sample.map((s) => `<li><a href="/coin/${encodeURIComponent(s.mint)}"><code>${esc(shortAddr(s.mint))}</code><span>${s.holders != null ? `${fmtN(s.holders)} holders · ` : ''}◎${s.liquidity_sol}${s.live_check ? ' · live check' : ''} · ${esc(timeAgo(s.seen_at))}</span></a></li>`).join('')}</ul>`
		: '';
	return `${head}
		<ul class="sx-funnel">
			${step('Passed entry rules', d.passed_entry)}
			${step('Passed research gates', d.passed_research)}
			${step('Within price impact', d.would_buy)}
		</ul>
		${blockers.length ? `<div class="sx-sub">Top reasons skipped</div><ul class="sx-blockers">${blockers.map(([l, n]) => `<li><span>${esc(l)}</span><b>${fmtN(n)}</b></li>`).join('')}</ul>` : ''}
		${sample}
		${d.live_check ? `<p class="sx-note">${fmtN(d.live_check)} of these depend on a check only run at buy time (firewall score or authorities), so the live count can be lower.</p>` : ''}
		${(d.caveats || []).length ? `<details class="sx-det"><summary>How this is counted</summary><ul>${d.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}`;
}

// ── owned agents (compile + backtest are scoped to an agent the caller owns) ──

let agentsPromise = null;
function loadMyAgents() {
	agentsPromise ??= apiFetch('/api/agents', { allowAnonymous: true })
		.then(async (res) => {
			if (res.status === 401) return { signedIn: false, agents: [] };
			if (!res.ok) throw new Error(await readError(res, 'Could not load your agents.'));
			const j = await res.json();
			const list = (j.agents || j.data?.agents || j.data || []).filter((a) => a && a.id);
			return { signedIn: true, agents: list };
		})
		.catch((err) => { agentsPromise = null; throw err; });
	return agentsPromise;
}

const agentSelectHTML = (agents, id) => `<select id="${id}" aria-label="Agent">${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || shortAddr(a.id))}</option>`).join('')}</select>`;

function noAgentHTML(state) {
	if (!state.signedIn) return `<div class="sx-cta"><a href="/login?next=${encodeURIComponent(location.pathname + location.search)}">Sign in</a> to use this with one of your agents.</div>`;
	return '<div class="sx-cta">This runs against one of your agents\' guards. <a href="/create">Create an agent</a> first, then come back.</div>';
}

// ── describe it in words ─────────────────────────────────────────────────────

export function mountCompileBox(host, { getNetwork, onCompiled }) {
	ensureStyles();
	if (!host) return;
	host.className = 'sx-card';
	host.innerHTML = `<div class="sx-card-h"><h2>Describe it in words</h2></div>
		<p>Write the plan in plain language. It becomes the settings below, clamped to your agent's caps, with a reason for every field. Nothing is saved until you press Create.</p>
		<textarea id="sx-nl-text" aria-label="Describe your strategy" maxlength="2000" placeholder="e.g. Buy 0.2 SOL of new launches with 100+ holders, no wallet over 15%, mint and freeze renounced, max 3% price impact. Take profit at 2x, stop at 30%. Ask me first."></textarea>
		<div class="sx-row"><span id="sx-nl-agent"></span><button type="button" class="so-btn so-btn-primary" id="sx-nl-go">Build settings</button></div>
		<div class="sx-out" id="sx-nl-out" aria-live="polite"></div>`;
	const out = host.querySelector('#sx-nl-out');
	const go = host.querySelector('#sx-nl-go');
	const text = host.querySelector('#sx-nl-text');
	const agentSlot = host.querySelector('#sx-nl-agent');
	let agents = null;

	loadMyAgents().then((st) => {
		agents = st;
		if (st.agents.length > 1) agentSlot.innerHTML = agentSelectHTML(st.agents, 'sx-nl-agent-sel');
		if (!st.agents.length) { out.innerHTML = noAgentHTML(st); go.disabled = true; }
	}).catch((err) => { out.innerHTML = `<div class="sx-err">${esc(err.message)}</div>`; });

	text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go.click(); });
	go.addEventListener('click', async () => {
		const t = text.value.trim();
		if (t.length < 3) { out.innerHTML = '<div class="sx-err">Describe the strategy in a sentence or two first.</div>'; text.focus(); return; }
		if (!agents?.agents.length) return;
		const agentId = host.querySelector('#sx-nl-agent-sel')?.value || agents.agents[0].id;
		go.disabled = true; go.textContent = 'Building…';
		out.innerHTML = '<span class="sx-skel" style="width:100%;height:10px"></span><span class="sx-skel" style="width:72%;height:10px;margin-top:8px"></span>';
		try {
			const res = await apiFetch('/api/sniper/compile', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ agent_id: agentId, text: t, network: getNetwork() }),
			});
			if (!res.ok) throw new Error(await readError(res, 'Could not build settings from that description.'));
			const r = await res.json();
			if (!r.strategy_object) throw new Error('The compiler returned no settings. Try rephrasing.');
			onCompiled(r.strategy_object);
			out.innerHTML = renderCompile(r);
		} catch (err) {
			if (err?.redirected) return;
			out.innerHTML = `<div class="sx-err">${esc(err.message || 'Could not build settings.')}</div>`;
		} finally {
			go.disabled = false; go.textContent = 'Build settings';
		}
	});
}

function fmtExplValue(v) {
	if (Array.isArray(v)) return v.map((x) => (x == null ? 'any' : x)).join(' to ');
	if (v === true) return 'on';
	return v == null ? 'off' : String(v);
}

function renderCompile(r) {
	const ex = (r.explanations || []).map((e) => `<li><code>${esc(e.field)}</code> = <b>${esc(fmtExplValue(e.value))}</b>. ${esc(e.why)}</li>`).join('');
	const clamped = (r.clamped || []).map((c) => `<div class="sx-flag" data-kind="clamp"><b>Clamped:</b> ${esc(c)}</div>`).join('');
	const assumed = (r.assumptions || []).map((c) => `<div class="sx-flag"><b>Assumed:</b> ${esc(c)}</div>`).join('');
	const warned = (r.warnings || []).map((c) => `<div class="sx-flag" data-kind="clamp"><b>Note:</b> ${esc(c)}</div>`).join('');
	return `<p style="margin:0 0 8px">Applied to the settings below${r.via === 'heuristic' ? ' (parsed by rules; the model was unavailable)' : ''}. Review them, then save.</p>
		${ex ? `<ul class="sx-expl">${ex}</ul>` : ''}${clamped}${assumed}${warned}`;
}

// ── backtest with the gates applied ──────────────────────────────────────────

// Map a Strategy Object onto the sniper rule shape the replay engine reads.
export function toSniperStrategy(cfg) {
	const e = cfg.entry || {}, s = cfg.sizing || {}, x = cfg.exits || {}, r = cfg.research || {};
	return {
		trigger: 'new_mint',
		per_trade_lamports: String(Math.round((Number(s.amount_sol) || 0) * 1e9)),
		slippage_bps: s.max_slippage_bps ?? 500,
		max_price_impact_pct: s.max_price_impact_bps == null ? null : s.max_price_impact_bps / 100,
		min_market_cap_usd: e.min_market_cap_usd ?? null,
		max_market_cap_usd: e.max_market_cap_usd ?? null,
		max_creator_launches: r.dev_history?.max_launches ?? e.max_creator_launches ?? null,
		min_creator_graduated: r.dev_history?.min_graduated ?? e.min_creator_graduated ?? null,
		require_socials: e.require_socials === true,
		require_sol_quote: e.require_sol_quote !== false,
		take_profit_pct: x.take_profit_pct ?? null,
		stop_loss_pct: x.stop_loss_pct ?? null,
		trailing_stop_pct: x.trailing_stop_pct ?? null,
		max_hold_seconds: x.max_hold_minutes == null ? null : Math.round(x.max_hold_minutes * 60),
		avoid_dev_dump: r.dev_history?.block_dev_sold === true,
		research: r,
	};
}

export function mountGatedBacktest(host, { getConfig }) {
	ensureStyles();
	if (!host) return;
	host.className = 'sx-card';
	host.innerHTML = `<div class="sx-card-h"><h2>Backtest with these gates</h2></div>
		<p>Replays these exact rules, research gates included, over real launches three.ws recorded, with the same exit order the live runtime uses. It never invents launches.</p>
		<div class="sx-row">
			<span id="sx-bt-agent"></span>
			<select id="sx-bt-win" aria-label="Backtest window"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select>
			<button type="button" class="so-btn so-btn-primary" id="sx-bt-go">Run backtest</button>
		</div>
		<div class="sx-out" id="sx-bt-out" aria-live="polite"></div>`;
	const out = host.querySelector('#sx-bt-out');
	const go = host.querySelector('#sx-bt-go');
	let agents = null;

	loadMyAgents().then((st) => {
		agents = st;
		if (st.agents.length > 1) host.querySelector('#sx-bt-agent').innerHTML = agentSelectHTML(st.agents, 'sx-bt-agent-sel');
		if (!st.agents.length) { out.innerHTML = noAgentHTML(st); go.disabled = true; }
	}).catch((err) => { out.innerHTML = `<div class="sx-err">${esc(err.message)}</div>`; });

	go.addEventListener('click', async () => {
		if (!agents?.agents.length) return;
		const cfg = getConfig();
		const agentId = host.querySelector('#sx-bt-agent-sel')?.value || agents.agents[0].id;
		go.disabled = true; go.textContent = 'Replaying…';
		out.innerHTML = `<div class="sx-metrics">${'<div class="sx-metric"><span class="sx-skel" style="width:60%;height:8px"></span><span class="sx-skel" style="width:80%;height:16px;margin-top:6px"></span></div>'.repeat(4)}</div>`;
		try {
			const res = await apiFetch('/api/sniper/backtest', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ agent_id: agentId, strategy: toSniperStrategy(cfg), window_days: Number(host.querySelector('#sx-bt-win').value), network: cfg.network }),
				timeoutMs: 120_000,
			});
			if (!res.ok) throw new Error(await readError(res, 'The backtest could not run right now.'));
			out.innerHTML = renderBacktest(await res.json());
		} catch (err) {
			if (err?.redirected) return;
			out.innerHTML = `<div class="sx-err">${esc(err.message || 'The backtest could not run.')} <button type="button" class="sx-link" id="sx-bt-retry">Try again</button></div>`;
			out.querySelector('#sx-bt-retry')?.addEventListener('click', () => go.click());
		} finally {
			go.disabled = false; go.textContent = 'Run backtest';
		}
	});
}

function renderBacktest(r) {
	if (r.insufficient_data) {
		return `<div class="sx-flag"><b>Not enough history:</b> ${esc(r.message || 'Too few recorded launches matched to give an honest number.')} Try a longer window or loosen a gate.</div>${blockedList(r)}`;
	}
	const m = r.metrics || {};
	const sign = (n) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
	const cell = (label, val, s = '') => `<div class="sx-metric"><span>${label}</span><b data-sign="${s}">${val}</b></div>`;
	return `<div class="sx-metrics">
			${cell('Entries', fmtN(m.entries))}
			${cell('Win rate', m.win_rate == null ? '-' : `${(m.win_rate * 100).toFixed(0)}%`)}
			${cell('Avg return', fmtPct(m.expected_value_pct), sign(m.expected_value_pct))}
			${cell('Net P&amp;L', m.net_pnl_sol == null ? '-' : `◎${Number(m.net_pnl_sol).toFixed(2)}`, sign(m.net_pnl_sol))}
			${cell('Median', fmtPct(m.roi_median_pct), sign(m.roi_median_pct))}
			${cell('Worst 10%', fmtPct(m.roi_p10_pct), sign(m.roi_p10_pct))}
			${cell('Best 10%', fmtPct(m.roi_p90_pct), sign(m.roi_p90_pct))}
			${cell('Invested', m.total_invested_sol == null ? '-' : `◎${Number(m.total_invested_sol).toFixed(2)}`)}
		</div>
		<p class="sx-note">${fmtN(r.sample_size)} of ${fmtN(r.universe_size)} recorded launches over ${r.window_days} days passed your rules${r.cached ? ' (cached result for these exact settings)' : ''}.</p>
		${blockedList(r)}
		${(r.caveats || []).length ? `<details class="sx-det"><summary>Caveats</summary><ul>${r.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}`;
}

function blockedList(r) {
	const rows = Object.entries(r.research_blocked_by || {}).sort((a, b) => b[1] - a[1]);
	if (!rows.length) return '';
	return `<div class="sx-sub">Skipped by research gates</div><ul class="sx-blockers">${rows.map(([k, n]) => `<li><span>${esc(blockLabel(k))}</span><b>${fmtN(n)}</b></li>`).join('')}</ul>${r.research_live_checked ? `<p class="sx-note">${fmtN(r.research_live_checked)} entries relied on a check only run at buy time.</p>` : ''}`;
}
