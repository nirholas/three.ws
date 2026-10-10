// Shared Strategy Object panel — equipped, leashed, autonomous trading made into a
// first-class surface on the agent detail page. Renders by viewer role:
//
//   • Owner of the viewed agent → manage the strategies THIS agent runs: the global
//     kill switch (leash), each equip with its live P&L + positions, pause/unequip,
//     "Run now", and "+ Equip a strategy" (from your library or the marketplace).
//     Each equip also carries its buy mode (ask before each buy, or auto within
//     caps), the pending approval requests ask mode files, and a decision log of
//     which research check blocked or bought which coin.
//   • Visitor → the strategies THIS agent's creator publishes (equip one with your
//     own agent — the sibling primitive to mirroring), or a browse-the-library CTA.
//   • Logged-out → the same discovery + a sign-in prompt.
//
// 100% real: equips, positions, and P&L all come from /api/agents/:id/strategies
// (real fills, real signatures, real spend-policy caps). No mock positions.

import { apiFetch } from '../api.js';
import {
	ensureStrategyStyles, esc, shortAddr, fmtSol, timeAgo, toast, configSummary,
	openStrategyEditor, openEquipPicker, VIOLET,
} from './strategy-forms.js';
import { ensureRiskAck } from './risk-ack.js';

const STYLE_ID = 'sop-panel-styles';
function ensurePanelStyles() {
	ensureStrategyStyles();
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const s = document.createElement('style');
	s.id = STYLE_ID;
	s.textContent = `
.sop { font-family: var(--font-body, system-ui); color: var(--ink, #e8e8e8); display: flex; flex-direction: column; gap: var(--space-sm, 10px); }
.sop-sk { height: 56px; border-radius: var(--radius-md, 10px); background: linear-gradient(90deg, var(--surface-1, rgba(255,255,255,.03)) 25%, var(--surface-2, rgba(255,255,255,.05)) 50%, var(--surface-1, rgba(255,255,255,.03)) 75%); background-size: 200% 100%; animation: sop-sh 1.3s infinite; }
@keyframes sop-sh { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.sop-empty { text-align: center; padding: var(--space-lg, 22px) var(--space-md, 16px); color: var(--ink-dim, #9a9a9a); font-size: var(--text-sm, .8rem); line-height: 1.5; }
.sop-empty strong { color: var(--ink-bright, #fff); display: block; margin-bottom: 4px; font-family: var(--font-display, inherit); }
.sop-err { color: var(--danger, #f87171); font-size: var(--text-sm, .8rem); padding: var(--space-sm, 10px); }
.sop-leash { display: flex; align-items: center; gap: var(--space-sm, 10px); padding: var(--space-sm, 10px) var(--space-md, 14px); border: 1px solid var(--wallet-stroke, rgba(139,92,246,.3)); border-radius: var(--radius-md, 10px); background: var(--wallet-accent-soft, rgba(139,92,246,.08)); }
.sop-leash-ico { width: 24px; height: 24px; flex: 0 0 auto; color: ${VIOLET}; }
.sop-leash-txt { flex: 1 1 auto; font-size: var(--text-xs, .72rem); color: var(--ink-dim, #b8b8b8); line-height: 1.4; }
.sop-leash-txt b { color: ${VIOLET}; font-family: var(--font-mono, monospace); }
.sop-toggle { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; user-select: none; font-size: var(--text-2xs, .68rem); color: var(--ink-dim, #b8b8b8); }
.sop-switch { width: 38px; height: 22px; border-radius: 999px; background: var(--surface-3, rgba(255,255,255,.1)); position: relative; transition: background var(--duration-fast, .18s) var(--ease-standard, ease); flex: 0 0 auto; }
.sop-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform var(--duration-fast, .18s) var(--ease-standard, ease); }
.sop-switch[data-on="true"] { background: var(--danger, #f87171); }
.sop-switch[data-on="true"]::after { transform: translateX(16px); }
.sop-switch.go[data-on="true"] { background: var(--success, #4ade80); }
.sop-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm, 10px); }
.sop-equip { border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); background: var(--surface-1, rgba(255,255,255,.03)); padding: var(--space-sm, 10px) var(--space-md, 12px); transition: border-color .18s; }
.sop-equip:hover { border-color: var(--wallet-stroke, rgba(139,92,246,.3)); }
.sop-equip[data-paused="true"] { opacity: .6; }
.sop-eq-head { display: flex; align-items: center; gap: var(--space-sm, 10px); }
.sop-eq-body { flex: 1 1 auto; min-width: 0; }
.sop-eq-name { font-size: var(--text-sm, .84rem); font-weight: 600; color: var(--ink-bright, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sop-eq-sum { font-size: var(--text-2xs, .64rem); color: var(--ink-dim, #9a9a9a); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sop-eq-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.sop-perf { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 7px; font-family: var(--font-mono, monospace); font-size: var(--text-2xs, .64rem); color: var(--ink-dim, #9a9a9a); }
.sop-perf .pos { color: var(--success, #4ade80); }
.sop-perf .neg { color: var(--danger, #f87171); }
.sop-perf .unproven { color: var(--warn, #fbbf24); }
.sop-pos { margin-top: 7px; display: flex; flex-direction: column; gap: 4px; }
.sop-p { display: flex; align-items: center; gap: 8px; font-size: var(--text-2xs, .66rem); padding: 5px 8px; border-radius: var(--radius-sm, 6px); background: var(--surface-1, rgba(255,255,255,.025)); }
.sop-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.sop-dot.open { background: var(--success, #4ade80); }
.sop-dot.closing { background: var(--warn, #fbbf24); }
.sop-dot.closed { background: var(--ink-dim, #888); }
.sop-dot.failed { background: var(--danger, #f87171); }
.sop-p-main { flex: 1 1 auto; min-width: 0; color: var(--ink, #ddd); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sop-p-pnl { font-family: var(--font-mono, monospace); flex: 0 0 auto; }
.sop-p-pnl.pos { color: var(--success, #4ade80); }
.sop-p-pnl.neg { color: var(--danger, #f87171); }
.sop-p a { color: ${VIOLET}; text-decoration: none; }
.sop-btn { font: inherit; font-size: var(--text-2xs, .66rem); padding: 5px 9px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); background: var(--surface-2, rgba(255,255,255,.05)); color: var(--ink, #e8e8e8); cursor: pointer; transition: all .16s; white-space: nowrap; }
.sop-btn:hover { border-color: var(--wallet-stroke-strong, rgba(139,92,246,.5)); color: #fff; }
.sop-btn:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 2px; }
.sop-btn-primary { background: ${VIOLET}; color: #1a1340; border-color: transparent; font-weight: 700; }
.sop-btn-primary:hover { background: var(--wallet-accent-strong, #a78bfa); }
.sop-btn-danger { color: var(--danger, #f87171); border-color: var(--danger, #f87171); background: transparent; }
.sop-btn-ico { padding: 5px 8px; line-height: 1; }
.sop-h { font-size: var(--text-2xs, .64rem); text-transform: uppercase; letter-spacing: .07em; color: var(--ink-dim, #9a9a9a); margin: var(--space-xs, 8px) 0 2px; }
.sop-add { text-align: center; }
.sop-mp-card { border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); background: var(--surface-1, rgba(255,255,255,.03)); padding: var(--space-sm, 10px) var(--space-md, 12px); display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.sop-mp-body { flex: 1 1 auto; min-width: 0; }
.sop-mp-name { font-size: var(--text-sm, .82rem); font-weight: 600; color: var(--ink-bright, #fff); }
.sop-mp-sum { font-size: var(--text-2xs, .62rem); color: var(--ink-dim, #9a9a9a); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sop-mode { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: var(--text-2xs, .64rem); color: var(--ink-dim, #9a9a9a); flex-wrap: wrap; }
.sop-seg { display: inline-flex; border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); border-radius: 999px; padding: 2px; }
.sop-seg button { font: inherit; font-size: var(--text-2xs, .64rem); padding: 3px 10px; border: 0; border-radius: 999px; background: transparent; color: var(--ink-dim, #9a9a9a); cursor: pointer; transition: background .16s, color .16s; }
.sop-seg button:hover:not([aria-pressed="true"]) { color: var(--ink-bright, #fff); }
.sop-seg button[aria-pressed="true"] { background: var(--wallet-accent-soft, rgba(139,92,246,.18)); color: ${VIOLET}; font-weight: 700; cursor: default; }
.sop-seg button[data-mode="auto"][aria-pressed="true"] { background: rgba(74,222,128,.14); color: var(--success, #4ade80); }
.sop-seg button:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 1px; }
.sop-seg button:disabled { opacity: .5; cursor: progress; }
.sop-appr { border: 1px solid var(--warn, #fbbf24); border-radius: var(--radius-md, 10px); background: rgba(251,191,36,.05); padding: var(--space-sm, 10px) var(--space-md, 12px); animation: sop-in .24s ease both; }
@keyframes sop-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .sop-appr { animation: none; } }
.sop-appr + .sop-appr { margin-top: 6px; }
.sop-appr-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sop-appr-sum { font-size: var(--text-sm, .8rem); color: var(--ink-bright, #fff); font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.sop-appr-exp { font-family: var(--font-mono, monospace); font-size: var(--text-2xs, .64rem); color: var(--warn, #fbbf24); white-space: nowrap; }
.sop-appr-tbl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 8px 0; font-size: var(--text-2xs, .66rem); }
.sop-appr-tbl dt { color: var(--ink-faint, #808080); }
.sop-appr-tbl dd { margin: 0; color: var(--ink, #ddd); min-width: 0; overflow-wrap: anywhere; }
.sop-appr-tbl a { color: ${VIOLET}; text-decoration: none; font-family: var(--font-mono, monospace); }
.sop-appr-tbl a:hover { text-decoration: underline; }
.sop-appr-notes { margin: 0 0 8px; padding-left: 16px; font-size: var(--text-2xs, .64rem); color: var(--ink-dim, #a8a8a8); line-height: 1.5; }
.sop-appr-act { display: flex; gap: 6px; justify-content: flex-end; }
.sop-log { border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); padding: 0 var(--space-md, 12px); }
.sop-log > summary { cursor: pointer; padding: 9px 0; font-size: var(--text-xs, .72rem); color: var(--ink, #ddd); font-weight: 600; }
.sop-log > summary:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 2px; border-radius: 4px; }
.sop-log-body { padding-bottom: 10px; display: flex; flex-direction: column; gap: 4px; }
.sop-dec { display: grid; grid-template-columns: auto 1fr auto; gap: 2px 8px; align-items: baseline; font-size: var(--text-2xs, .66rem); padding: 5px 8px; border-radius: var(--radius-sm, 6px); background: var(--surface-1, rgba(255,255,255,.025)); }
.sop-dec .sop-dot { align-self: center; }
.sop-dec-main { min-width: 0; color: var(--ink, #ddd); overflow-wrap: anywhere; }
.sop-dec-main a { color: ${VIOLET}; text-decoration: none; font-family: var(--font-mono, monospace); }
.sop-dec-when { color: var(--ink-faint, #777); white-space: nowrap; }
.sop-dec-why { grid-column: 2 / -1; color: var(--ink-dim, #9a9a9a); line-height: 1.4; }
.sop-dot.blocked { background: var(--danger, #f87171); }
.sop-dot.approval { background: var(--warn, #fbbf24); }
.sop-dot.executed { background: var(--success, #4ade80); }
.sop-dot.skipped { background: var(--ink-dim, #888); }
`;
	document.head.appendChild(s);
}

const LEASH_SVG = '<svg class="sop-leash-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

// Devnet equips trade test SOL, so the server waives the real-funds agreement for them.
const isDevnet = (e) => String(e?.network || '').toLowerCase() === 'devnet';
// Server errors come back as { error: code, error_description }.
const errMsg = (j, fallback) => j?.error_description || j?.error?.message || (typeof j?.error === 'string' ? j.error.replace(/_/g, ' ') : '') || fallback;

const DECISION_WORD = { blocked: 'Blocked', approval: 'Asked you', executed: 'Bought', skipped: 'Skipped', failed: 'Failed' };
const CHECK_LABELS = {
	min_holders: 'Minimum holders', max_top_holder_pct: 'Largest holder share', min_liquidity_sol: 'Minimum liquidity',
	security_min_score: 'Firewall security score', require_no_mint_authority: 'Mint authority renounced',
	require_no_freeze_authority: 'Freeze authority renounced', dev_max_launches: 'Creator launch count',
	dev_min_graduated: 'Creator graduations', dev_block_sold: 'Creator has not sold', mode_ask: 'Ask mode',
	approval_unavailable: 'Approval request', price_impact: 'Price impact',
};

function expiresIn(t) {
	const ms = new Date(t).getTime() - Date.now();
	if (!(ms > 0)) return 'expired';
	const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
	return `${m}:${String(sec).padStart(2, '0')} left`;
}

export function mountStrategyPanel({ mount, agent, isOwner = false }) {
	if (!mount) return { destroy() {} };
	ensurePanelStyles();
	const card = mount.closest('#ad-strategy-objects-card') || mount.parentElement;
	const agentId = agent.id;
	let alive = true;
	let countdown = null;
	const isLoggedIn = () => window.__authed !== false;
	const root = document.createElement('div');
	root.className = 'sop';
	mount.replaceChildren(root);
	root.innerHTML = '<div class="sop-sk"></div><div class="sop-sk"></div>';

	const show = () => { if (card) card.hidden = false; };
	const hide = () => { if (card) card.hidden = true; };

	function pnlClass(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

	function perfLine(p) {
		if (!p || !p.proven) return `<span class="unproven">Unproven — no closed trades yet</span>`;
		const roi = p.roi_pct != null ? `<span class="${pnlClass(p.roi_pct)}">${p.roi_pct > 0 ? '+' : ''}${p.roi_pct}% ROI</span>` : '';
		const pnl = `<span class="${pnlClass(p.pnl_sol)}">${p.pnl_sol > 0 ? '+' : ''}◎${fmtSol(p.pnl_sol)}</span>`;
		const win = p.win_rate != null ? `<span>${p.win_rate}% win</span>` : '';
		return `${roi}${pnl}${win}<span>${p.trades} closed${p.open ? ` · ${p.open} open` : ''}</span>`;
	}

	function positionRow(p) {
		const cls = p.status === 'open' ? 'open' : p.status === 'closing' ? 'closing' : p.status === 'failed' ? 'failed' : 'closed';
		const live = p.status === 'open' || p.status === 'closing';
		const pnl = p.pnl_sol != null ? p.pnl_sol : (live && p.value_sol != null && p.entry_sol != null ? p.value_sol - p.entry_sol : null);
		const pnlPct = p.entry_sol > 0 && pnl != null ? (pnl / p.entry_sol) * 100 : null;
		const sig = (p.exit_sig || p.entry_sig) ? ` <a href="https://solscan.io/tx/${esc(p.exit_sig || p.entry_sig)}" target="_blank" rel="noopener" title="View on Solscan">↗</a>` : '';
		const label = live
			? `holding ${esc(p.symbol || shortAddr(p.mint))} · in ◎${fmtSol(p.entry_sol)}${p.value_sol != null ? ` → ◎${fmtSol(p.value_sol)}` : ''}`
			: `${esc(exitWord(p.exit_reason))} ${esc(p.symbol || shortAddr(p.mint))} · ◎${fmtSol(p.entry_sol)} → ◎${fmtSol(p.exit_sol)}`;
		const pnlEl = pnl != null ? `<span class="sop-p-pnl ${pnlClass(pnl)}">${pnl > 0 ? '+' : ''}◎${fmtSol(pnl)}${pnlPct != null ? ` (${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(0)}%)` : ''}</span>` : '';
		return `<div class="sop-p"><span class="sop-dot ${cls}"></span><span class="sop-p-main">${label}${sig}</span>${pnlEl}</div>`;
	}
	function exitWord(r) {
		return ({ take_profit: 'TP hit', stop_loss: 'stopped out', trailing_stop: 'trailed out', timeout: 'held out', manual: 'closed', kill_switch: 'killed', error: 'errored' })[r] || 'closed';
	}

	function renderOwner(d) {
		const positionsByEquip = new Map();
		for (const p of d.positions || []) {
			if (!positionsByEquip.has(p.equip_id)) positionsByEquip.set(p.equip_id, []);
			positionsByEquip.get(p.equip_id).push(p);
		}
		const equipsHtml = d.equips.length
			? d.equips.map((e) => {
				const ps = (positionsByEquip.get(e.equip_id) || []).slice(0, 4);
				return `<div class="sop-equip" data-equip="${esc(e.equip_id)}" data-paused="${!e.active}">
					<div class="sop-eq-head">
						<div class="sop-eq-body">
							<div class="sop-eq-name">${esc(e.strategy_name)}${e.network === 'devnet' ? ' · devnet' : ''}</div>
							<div class="sop-eq-sum">${configSummary(e.config)}</div>
						</div>
						<div class="sop-eq-actions">
							<label class="sop-toggle" title="${e.active ? 'Pause' : 'Resume'} this strategy"><span class="sop-switch go" data-on="${e.active}" data-act="toggle"></span></label>
							<button class="sop-btn sop-btn-ico sop-btn-danger" data-act="unequip" title="Unequip">✕</button>
						</div>
					</div>
					<div class="sop-perf">${perfLine(e.performance)}${e.last_fired_at ? `<span>last fired ${timeAgo(e.last_fired_at)}</span>` : ''}</div>
					<div class="sop-mode"><span>Buys</span><span class="sop-seg" role="group" aria-label="Buy mode for ${esc(e.strategy_name)}">
						<button type="button" data-mode="ask" aria-pressed="${modeOf(e) === 'ask'}" title="File an approval request for every match">Ask first</button>
						<button type="button" data-mode="auto" aria-pressed="${modeOf(e) === 'auto'}" title="Buy every match within the agent's caps">Auto</button>
					</span><span>${modeOf(e) === 'auto' ? 'buys matches on its own, within caps' : 'waits for your approval on every buy'}</span></div>
					${ps.length ? `<div class="sop-pos">${ps.map(positionRow).join('')}</div>` : ''}
				</div>`;
			}).join('')
			: `<div class="sop-empty"><strong>No strategy equipped</strong>Equip a rule-based plan and this agent trades it for real — within your spend policy. <br><a href="/strategies" style="color:${VIOLET}">Browse strategies →</a></div>`;

		root.innerHTML = `
			<div class="sop-leash">
				${LEASH_SVG}
				<div class="sop-leash-txt">${d.killed
					? 'Strategies are <b>halted</b> by your kill switch. No strategy will trade until you turn it back on.'
					: `Leashed autonomy: ${d.equips.filter((e) => e.active).length} active ${d.equips.filter((e) => e.active).length === 1 ? 'strategy' : 'strategies'}, strictly inside your spend policy. Stop anytime.`}</div>
				<label class="sop-toggle" title="${d.killed ? 'Resume all strategies' : 'Halt ALL strategies instantly'}">${d.killed ? 'Killed' : 'Kill'} <span class="sop-switch" data-on="${d.killed}" data-act="kill"></span></label>
			</div>
			<div class="sop-row">
				<div style="font-size:var(--text-2xs,.64rem);color:var(--ink-dim,#9a9a9a)">${d.equips.length} equipped</div>
				<button class="sop-btn" data-act="run" ${d.killed ? 'disabled' : ''} title="Evaluate launches & positions now">↻ Run now</button>
			</div>
			<div id="sop-approvals" aria-live="polite"></div>
			<div id="sop-equips">${equipsHtml}</div>
			<div class="sop-add"><button class="sop-btn sop-btn-primary" data-act="equip" style="margin-top:4px">+ Equip a strategy</button> <a class="sop-btn" href="/strategies" style="text-decoration:none;display:inline-block">Open library</a></div>
			${d.equips.length ? '<details class="sop-log" id="sop-log"><summary>Decision log: what each check blocked or bought</summary><div class="sop-log-body" id="sop-log-body"></div></details>' : ''}`;
		wireOwner(d);
		if (d.equips.length) loadApprovals();
	}

	function modeOf(e) { return e.config?.mode === 'auto' ? 'auto' : 'ask'; }

	// Pending ask-mode buys. Each card shows exactly what will be signed (coin,
	// amount, chain, where the SOL goes, the research notes) and expires on its own.
	async function loadApprovals() {
		const host = root.querySelector('#sop-approvals');
		if (!host) return;
		let rows = [];
		try {
			const res = await apiFetch(`/api/agents/${agentId}/strategies/approvals?status=pending&limit=10`, { allowAnonymous: true });
			if (!res.ok) throw new Error(errMsg(await res.json().catch(() => ({})), 'Could not load approval requests'));
			rows = (await res.json()).data?.approvals || [];
		} catch (err) {
			if (err?.redirected || !alive) return;
			host.innerHTML = `<div class="sop-err">${esc(err.message)} <button class="sop-btn" data-retry-appr>Retry</button></div>`;
			host.querySelector('[data-retry-appr]')?.addEventListener('click', loadApprovals);
			return;
		}
		if (!alive) return;
		clearInterval(countdown);
		if (!rows.length) { host.innerHTML = ''; return; }
		host.innerHTML = `<div class="sop-h">Waiting for your approval (${rows.length})</div>${rows.map(approvalCard).join('')}`;
		countdown = setInterval(() => {
			if (!alive || !host.isConnected) { clearInterval(countdown); return; }
			let anyLive = false;
			host.querySelectorAll('[data-expires]').forEach((el) => {
				const left = expiresIn(el.dataset.expires);
				el.textContent = left;
				if (left === 'expired') el.closest('.sop-appr')?.querySelector('[data-approve]')?.setAttribute('disabled', '');
				else anyLive = true;
			});
			if (!anyLive) { clearInterval(countdown); loadApprovals(); }
		}, 1000);
		host.querySelectorAll('.sop-appr').forEach((cardEl) => {
			const a = rows.find((r) => r.id === cardEl.dataset.id);
			cardEl.querySelector('[data-approve]')?.addEventListener('click', (ev) => approve(a, ev.currentTarget));
			cardEl.querySelector('[data-deny]')?.addEventListener('click', (ev) => deny(a, ev.currentTarget));
		});
	}

	function approvalCard(a) {
		const mint = a.payload?.mint || a.recipient;
		const usd = a.amount_usd != null ? ` (about $${Number(a.amount_usd).toFixed(2)})` : '';
		const notes = Array.isArray(a.risk_notes) ? a.risk_notes : [];
		return `<div class="sop-appr" data-id="${esc(a.id)}">
			<div class="sop-appr-h"><div class="sop-appr-sum">${esc(a.summary)}</div><span class="sop-appr-exp" data-expires="${esc(a.expires_at)}">${expiresIn(a.expires_at)}</span></div>
			<dl class="sop-appr-tbl">
				<dt>Amount</dt><dd>◎${fmtSol(a.amount)} SOL${usd}</dd>
				<dt>Token</dt><dd><a href="/coin/${encodeURIComponent(mint)}" title="${esc(mint)}">${esc(shortAddr(mint, 6, 6))}</a></dd>
				<dt>Chain</dt><dd>Solana ${a.network === 'devnet' ? 'devnet' : 'mainnet'}</dd>
				<dt>Pays</dt><dd>${esc(a.recipient_label || shortAddr(a.recipient))}</dd>
				<dt>Limits</dt><dd>${a.payload?.slippage_bps != null ? `${a.payload.slippage_bps / 100}% slippage` : ''}${a.payload?.max_price_impact_pct != null ? ` · ${a.payload.max_price_impact_pct}% max impact` : ''}</dd>
			</dl>
			${notes.length ? `<ul class="sop-appr-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
			<div class="sop-appr-act">
				<button type="button" class="sop-btn" data-deny>Deny</button>
				<button type="button" class="sop-btn sop-btn-primary" data-approve>Approve and buy</button>
			</div>
		</div>`;
	}

	async function approve(a, btn) {
		if (!a) return;
		if (!(await ensureRiskAck({ context: 'strategy' }))) return;
		const card = btn.closest('.sop-appr');
		card?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
		btn.textContent = 'Buying…';
		try {
			const res = await apiFetch(`/api/agents/${agentId}/strategies/approve`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ approval_id: a.id, payload_hash: a.payload_hash }),
			});
			const j = await res.json().catch(() => ({}));
			if (!res.ok && !j.data) throw new Error(errMsg(j, 'Could not approve'));
			const r = j.data || {};
			if (r.executed) toast(r.already ? 'Already approved' : 'Approved: the buy went through within your caps');
			else toast(`Nothing was bought: ${r.message || r.code || 'the trade did not complete'}`);
		} catch (err) { if (!err?.redirected) toast(err.message || 'Could not approve'); }
		load();
	}

	async function deny(a, btn) {
		if (!a) return;
		btn.disabled = true;
		try {
			const res = await apiFetch(`/api/agents/${agentId}/strategies/deny`, {
				method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approval_id: a.id }),
			});
			if (!res.ok) throw new Error(errMsg(await res.json().catch(() => ({})), 'Could not deny'));
			toast('Denied. This coin will not be asked about again.');
		} catch (err) { if (!err?.redirected) toast(err.message || 'Could not deny'); }
		loadApprovals();
	}

	async function loadDecisions() {
		const body = root.querySelector('#sop-log-body');
		if (!body) return;
		body.innerHTML = '<div class="sop-sk" style="height:30px"></div><div class="sop-sk" style="height:30px"></div>';
		try {
			const res = await apiFetch(`/api/agents/${agentId}/strategies/decisions?limit=30`, { allowAnonymous: true });
			if (!res.ok) throw new Error(errMsg(await res.json().catch(() => ({})), 'Could not load the decision log'));
			const rows = (await res.json()).data?.decisions || [];
			if (!alive) return;
			body.innerHTML = rows.length
				? rows.map(decisionRow).join('')
				: '<div class="sop-empty" style="padding:12px"><strong>No decisions yet</strong>Each sweep (every 2 minutes, or Run now) records why a launch was bought, asked about, or blocked.</div>';
		} catch (err) {
			if (err?.redirected || !alive) return;
			body.innerHTML = `<div class="sop-err">${esc(err.message)} <button class="sop-btn" data-retry-log>Retry</button></div>`;
			body.querySelector('[data-retry-log]')?.addEventListener('click', loadDecisions);
		}
	}

	function decisionRow(r) {
		const check = r.check_name ? (CHECK_LABELS[r.check_name] || r.check_name.replace(/_/g, ' ')) : '';
		const seen = r.seen_count > 1 ? ` · seen ${r.seen_count}×` : '';
		return `<div class="sop-dec">
			<span class="sop-dot ${esc(r.decision)}"></span>
			<span class="sop-dec-main"><b>${DECISION_WORD[r.decision] || esc(r.decision)}</b> <a href="/coin/${encodeURIComponent(r.mint)}">${esc(shortAddr(r.mint))}</a>${r.strategy_name ? ` · ${esc(r.strategy_name)}` : ''}${check ? ` · ${esc(check)}` : ''}${r.signature ? ` <a href="https://solscan.io/tx/${esc(r.signature)}" target="_blank" rel="noopener" title="View on Solscan">↗</a>` : ''}</span>
			<span class="sop-dec-when">${esc(timeAgo(r.updated_at))}${seen}</span>
			${r.reason ? `<span class="sop-dec-why">${esc(r.reason)}</span>` : ''}
		</div>`;
	}

	function wireOwner(d) {
		root.querySelector('[data-act="kill"]')?.parentElement?.addEventListener('click', async (e) => {
			e.preventDefault();
			await postAction('kill', { killed: !d.killed }, !d.killed ? 'All strategies halted' : 'Strategies resumed');
			load();
		});
		root.querySelector('[data-act="run"]')?.addEventListener('click', async (e) => {
			const btn = e.currentTarget;
			// The sweep only needs the real-funds agreement when a mainnet equip is in it.
			if (d.equips.some((x) => !isDevnet(x)) && !(await ensureRiskAck({ context: 'strategy' }))) return;
			btn.disabled = true; btn.textContent = 'Running…';
			try {
				const res = await apiFetch(`/api/agents/${agentId}/strategies/sweep`, { method: 'POST' });
				const j = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(errMsg(j, 'Run failed'));
				const all = (j.data?.results || []).flatMap((r) => r.results || []);
				const exec = all.filter((r) => r.status === 'executed').length;
				const asked = all.filter((r) => r.status === 'approval' && r.created).length;
				const skip = all.filter((r) => r.status === 'skipped').length;
				toast(all.length ? `Evaluated: ${exec} bought, ${asked} waiting for you, ${skip} skipped` : 'No entries or exits this run');
			} catch (err) { if (!err?.redirected) toast(err.message || 'Run failed'); }
			load();
		});
		root.querySelector('[data-act="equip"]')?.addEventListener('click', () => openEquipFlow());
		root.querySelector('#sop-log')?.addEventListener('toggle', (ev) => { if (ev.currentTarget.open) loadDecisions(); });
		root.querySelectorAll('.sop-equip').forEach((row) => {
			const equipId = row.dataset.equip;
			const e = d.equips.find((x) => x.equip_id === equipId);
			row.querySelector('[data-act="toggle"]')?.parentElement?.addEventListener('click', async (ev) => {
				ev.preventDefault();
				await postAction('toggle', { equip_id: equipId, active: !e.active }, e.active ? 'Strategy paused' : 'Strategy resumed');
				load();
			});
			row.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
				const mode = b.dataset.mode;
				if (mode === modeOf(e)) return;
				if (mode === 'auto') {
					if (!confirm(`Switch “${e.strategy_name}” to auto? It will buy every coin that passes its gates without asking, always inside this agent's spend policy.`)) return;
					if (!isDevnet(e) && !(await ensureRiskAck({ context: 'strategy' }))) return;
				}
				row.querySelectorAll('[data-mode]').forEach((x) => { x.disabled = true; });
				await postAction('mode', { equip_id: equipId, mode }, mode === 'auto' ? 'Auto: buys within caps without asking' : 'Ask first: every buy waits for your approval');
				load();
			}));
			row.querySelector('[data-act="unequip"]')?.addEventListener('click', async () => {
				if (!confirm(`Unequip “${e.strategy_name}”? Open positions stay yours to manage; no new entries start.`)) return;
				await postAction('unequip', { equip_id: equipId }, 'Strategy unequipped');
				load();
			});
		});
	}

	async function postAction(action, body, okMsg) {
		try {
			const res = await apiFetch(`/api/agents/${agentId}/strategies/${action}`, {
				method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
			});
			if (!res.ok) throw new Error(errMsg(await res.json().catch(() => ({})), 'Action failed'));
			if (okMsg) toast(okMsg);
			return true;
		} catch (e) { if (!e?.redirected) toast(e.message || 'Action failed'); return false; }
	}

	// Owner "+ Equip": pick a strategy from your library (or create one), then equip it here.
	async function openEquipFlow() {
		let mine = [];
		try {
			const res = await apiFetch('/api/strategies?scope=mine&limit=40', { allowAnonymous: true });
			if (res.ok) mine = (await res.json()).data?.strategies || [];
		} catch { /* handled below */ }
		ensurePanelStyles();
		const back = document.createElement('div');
		back.className = 'so-modal-back';
		const listHtml = mine.length
			? mine.map((s) => `<button type="button" class="so-pick" data-id="${esc(s.id)}"><div class="so-av"></div><span style="min-width:0"><span class="so-pname" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</span><span style="font-size:var(--text-2xs,.62rem);color:var(--ink-dim,#9a9a9a);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${configSummary(s.config)}</span></span></button>`).join('')
			: `<div class="sop-empty" style="padding:14px"><strong>Your library is empty</strong>Create your first strategy, or browse the marketplace.</div>`;
		back.innerHTML = `<div class="so-modal" role="dialog" aria-modal="true" aria-label="Equip a strategy">
			<h3>Equip a strategy on ${esc(agent.name || 'this agent')}</h3>
			<p class="so-sub">Pick one of your strategies to run on this agent, or build a new one. It trades within this agent's spend policy.</p>
			${listHtml}
			<div class="so-actions" style="justify-content:space-between">
				<button type="button" class="so-btn" id="sop-new">+ New strategy</button>
				<span><a class="so-btn" href="/strategies" style="text-decoration:none;display:inline-block">Marketplace</a> <button type="button" class="so-btn" id="sop-eq-cancel">Close</button></span>
			</div>
		</div>`;
		const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
		const onKey = (ev) => { if (ev.key === 'Escape') close(); };
		back.addEventListener('click', (ev) => { if (ev.target === back) close(); });
		document.addEventListener('keydown', onKey);
		back.querySelector('#sop-eq-cancel').addEventListener('click', close);
		back.querySelector('#sop-new').addEventListener('click', async () => {
			close();
			const created = await openStrategyEditor({});
			if (created?.id) { await equipStrategyHere(created.id); load(); }
		});
		back.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', async () => {
			close();
			await equipStrategyHere(b.dataset.id);
			load();
		}));
		document.body.appendChild(back);
	}

	async function equipStrategyHere(strategyId) {
		try {
			const res = await apiFetch(`/api/agents/${agentId}/strategies`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ strategy_id: strategyId }),
			});
			const j = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(j?.error?.message || 'Could not equip');
			toast('Strategy equipped — running within this agent’s limits');
		} catch (e) { if (!e?.redirected) toast(e.message || 'Could not equip'); }
	}

	// Visitor / logged-out: surface the strategies THIS agent's creator publishes —
	// equip one with your OWN agent (the sibling primitive to mirroring).
	async function renderVisitor() {
		let published = [];
		try {
			// Resolve the creator server-side from the agent id (the public agent
			// response omits owner_id) so we can show what this creator publishes.
			const res = await apiFetch(`/api/strategies?scope=published&agent=${encodeURIComponent(agentId)}&limit=12`, { allowAnonymous: true });
			if (res.ok) published = (await res.json()).data?.strategies || [];
		} catch { /* fall through to hide */ }
		if (!published.length) { hide(); return; }
		show();
		const cardsHtml = published.map((s) => {
			const p = s.performance || {};
			const perf = p.proven
				? `<span class="${p.roi_pct > 0 ? 'pos' : p.roi_pct < 0 ? 'neg' : ''}" style="font-family:var(--font-mono,monospace)">${p.roi_pct != null ? `${p.roi_pct > 0 ? '+' : ''}${p.roi_pct}% ROI · ` : ''}${p.trades} trades</span>`
				: '<span style="color:var(--warn,#fbbf24)">Unproven</span>';
			return `<div class="sop-mp-card">
				<div class="sop-mp-body">
					<div class="sop-mp-name">${esc(s.name)}</div>
					<div class="sop-mp-sum">${configSummary(s.config)}</div>
					<div class="sop-perf" style="margin-top:4px">${perf}</div>
				</div>
				<button class="sop-btn sop-btn-primary" data-equip-id="${esc(s.id)}" data-name="${esc(s.name)}">Equip</button>
			</div>`;
		}).join('');
		root.innerHTML = `
			<div style="font-size:var(--text-xs,.72rem);color:var(--ink-dim,#9a9a9a);margin-bottom:4px">Strategies <b style="color:${VIOLET}">${esc(agent.name || 'this creator')}</b> publishes — equip one with your own agent. It runs inside <b style="color:${VIOLET}">your</b> spend policy.</div>
			${cardsHtml}
			<div class="sop-add" style="margin-top:6px"><a class="sop-btn" href="/strategies" style="text-decoration:none;display:inline-block">Browse all strategies →</a></div>`;
		root.querySelectorAll('[data-equip-id]').forEach((b) => b.addEventListener('click', async () => {
			const s = published.find((x) => x.id === b.dataset.equipId);
			if (!isLoggedIn()) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
			await openEquipPicker({ strategy: s });
		}));
	}

	async function load() {
		if (!alive) return;
		try {
			if (isOwner) {
				const res = await apiFetch(`/api/agents/${agentId}/strategies`, { allowAnonymous: true });
				if (res.status === 403 || res.status === 401) { renderVisitor(); return; }
				if (!res.ok) throw new Error('load failed');
				const d = (await res.json()).data;
				show();
				renderOwner(d);
			} else {
				renderVisitor();
			}
		} catch (e) {
			if (e?.redirected) return;
			root.innerHTML = `<div class="sop-err">Couldn't load strategies. <button class="sop-btn" id="sop-retry">Retry</button></div>`;
			root.querySelector('#sop-retry')?.addEventListener('click', load);
			show();
		}
	}

	load();
	return { destroy() { alive = false; clearInterval(countdown); mount.replaceChildren(); } };
}
