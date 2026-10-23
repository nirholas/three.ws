/**
 * Agent Wallet hub — Snipe tab: the conversational strategy builder.
 *
 * Owner-only. Describe a snipe strategy in plain English; an LLM compiles it to a
 * validated agent_sniper_strategies config (every money/risk knob clamped to the
 * agent's runtime trade guards), we render it as fully editable chips, then
 * BACKTEST it against three.ws's own real captured history (pump_coin_intel ⋈
 * pump_coin_outcomes) using the exact gates + exit logic the live worker runs — so
 * the owner sees an honest projected win-rate, ROI distribution, and worst
 * drawdown BEFORE risking a lamport. One tap arms it on the agent's own wallet.
 *
 *   POST /api/sniper/compile   → NL → validated strategy + rationale
 *   POST /api/sniper/backtest  → strategy → honest metrics over real history
 *   POST /api/sniper/strategy  → arm it (existing endpoint)
 *
 * Nothing is simulated: the backtest replays real labeled launches; thin history
 * yields an explicit "insufficient data" verdict, never a flattering number.
 */

import { registerWalletTab } from '../registry.js';
import { consumeCsrfToken } from '../../api.js';
import { ensureRiskAck } from '../../shared/risk-ack.js';
import { renderIntegrity } from '../../shared/backtest-integrity-view.js';
import { formatSol, shortAddress, explorerAddressUrl } from '../util.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const STYLE_ID = 'awh-snipe-style';

const STYLE = `
.sb { display:flex; flex-direction:column; gap: var(--space-lg,18px); }
.sb-card { background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-lg,14px); padding: var(--space-lg,18px); }
.sb-hero { background: linear-gradient(160deg, var(--wallet-accent-soft,rgba(139,92,246,.1)), var(--surface-1,rgba(255,255,255,.03))); border:1px solid var(--wallet-stroke,rgba(139,92,246,.3)); }
.sb-card h2 { margin:0 0 4px; font-size: var(--text-lg,1.15rem); color: var(--ink-bright,#fff); font-family: var(--font-display, system-ui); }
.sb-card h3 { margin:0 0 4px; font-size: var(--text-ui,.9rem); color: var(--ink-bright,#fff); font-weight:600; }
.sb-card .sub { margin:0 0 var(--space-md,14px); font-size: var(--text-sm,.78rem); color: var(--ink-dim,#888); line-height:1.55; max-width: 60ch; }
.sb-ta { width:100%; box-sizing:border-box; min-height:84px; resize:vertical; font:inherit; font-size: var(--text-md,.84rem); line-height:1.55; color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-md,10px); padding:11px 13px; transition: border-color .14s; }
.sb-ta:focus { outline:none; border-color: var(--wallet-stroke-strong,rgba(139,92,246,.5)); }
.sb-egs { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.sb-eg { appearance:none; text-align:left; font:inherit; font-size: var(--text-2xs,.69rem); color: var(--ink-dim,#aaa); background: var(--surface-2,rgba(255,255,255,.05)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-pill,999px); padding:4px 10px; cursor:pointer; transition: color .14s, border-color .14s; }
.sb-eg:hover { color: var(--ink-bright,#fff); border-color: var(--wallet-stroke,rgba(139,92,246,.3)); }

.sb-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top: var(--space-md,14px); align-items:center; }
.sb-btn { appearance:none; font:inherit; font-size: var(--text-sm,.78rem); font-weight:600; cursor:pointer; border-radius: var(--radius-md,10px); padding:9px 16px; border:1px solid var(--stroke-strong,rgba(255,255,255,.14)); background: var(--surface-2,rgba(255,255,255,.06)); color: var(--ink,#e8e8e8); transition: background .14s, border-color .14s, transform .14s; }
.sb-btn:hover { background: var(--surface-3,rgba(255,255,255,.09)); color: var(--ink-bright,#fff); }
.sb-btn:active { transform: translateY(1px); }
.sb-btn:disabled { opacity:.5; cursor:not-allowed; }
.sb-btn:focus-visible { outline:2px solid var(--wallet-focus,rgba(139,92,246,.7)); outline-offset:2px; }
.sb-btn.primary { background: var(--wallet-accent,#c4b5fd); border-color: var(--wallet-accent,#c4b5fd); color:#160d28; }
.sb-btn.primary:hover { background: var(--wallet-accent-strong,#a78bfa); border-color: var(--wallet-accent-strong,#a78bfa); }
.sb-btn.ghost { background:transparent; border-color: var(--stroke,rgba(255,255,255,.1)); }

.sb-summary { font-size: var(--text-md,.84rem); color: var(--ink,#e8e8e8); line-height:1.55; }
.sb-via { font-size: var(--text-2xs,.69rem); color: var(--ink-faint,rgba(255,255,255,.45)); margin-top:6px; }
.sb-notes { margin:10px 0 0; padding:10px 12px; border-radius: var(--radius-md,10px); font-size: var(--text-sm,.76rem); line-height:1.5; }
.sb-notes ul { margin:4px 0 0; padding-left:18px; } .sb-notes li { margin:2px 0; }
.sb-notes.amber { background: color-mix(in srgb, var(--warn,#fbbf24) 10%, transparent); border:1px solid color-mix(in srgb, var(--warn,#fbbf24) 30%, transparent); color: var(--warn,#fbbf24); }
.sb-notes.blue { background: color-mix(in srgb, var(--wallet-accent,#a78bfa) 9%, transparent); border:1px solid color-mix(in srgb, var(--wallet-accent,#a78bfa) 28%, transparent); color: var(--wallet-accent,#c4b5fd); }
.sb-notes.red { background: color-mix(in srgb, var(--danger,#f87171) 10%, transparent); border:1px solid color-mix(in srgb, var(--danger,#f87171) 32%, transparent); color: var(--danger,#f87171); }

.sb-fields { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap:10px; margin-top: var(--space-md,14px); }
.sb-fld { display:flex; flex-direction:column; gap:4px; }
.sb-fld label { font-size: var(--text-2xs,.66rem); color: var(--ink-dim,#888); text-transform:uppercase; letter-spacing:.04em; }
.sb-inwrap { position:relative; display:flex; align-items:center; }
.sb-in { width:100%; box-sizing:border-box; font:inherit; font-size: var(--text-sm,.8rem); font-family: var(--font-mono,ui-monospace,monospace); color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.04)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-sm,8px); padding:8px 10px; }
.sb-in:focus { outline:none; border-color: var(--wallet-stroke-strong,rgba(139,92,246,.5)); }
.sb-unit { position:absolute; right:9px; font-size: var(--text-2xs,.66rem); color: var(--ink-faint,rgba(255,255,255,.4)); pointer-events:none; }
select.sb-in { appearance:none; cursor:pointer; }
.sb-toggles { display:flex; flex-wrap:wrap; gap:14px; margin-top: var(--space-md,14px); }
.sb-tog { display:flex; align-items:center; gap:7px; font-size: var(--text-sm,.78rem); color: var(--ink,#d8d8d8); cursor:pointer; }
.sb-tog input { accent-color: var(--wallet-accent,#a78bfa); width:15px; height:15px; }
.sb-stale { font-size: var(--text-2xs,.69rem); color: var(--warn,#fbbf24); }

.sb-seg { display:inline-flex; gap:2px; background: var(--surface-2,rgba(255,255,255,.05)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-pill,999px); padding:2px; }
.sb-seg button { appearance:none; font:inherit; font-size: var(--text-2xs,.69rem); font-weight:600; color: var(--ink-dim,#999); background:transparent; border:0; border-radius: var(--radius-pill,999px); padding:5px 12px; cursor:pointer; }
.sb-seg button.on { background: var(--wallet-accent,#c4b5fd); color:#160d28; }

.sb-kpis { display:grid; grid-template-columns: repeat(auto-fit, minmax(108px,1fr)); gap:0; border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); overflow:hidden; margin-top: var(--space-md,14px); }
.sb-kpi { padding:12px 13px; border-right:1px solid var(--stroke,rgba(255,255,255,.08)); border-bottom:1px solid var(--stroke,rgba(255,255,255,.08)); }
.sb-kpi .l { font-size: var(--text-2xs,.63rem); color: var(--ink-faint,rgba(255,255,255,.45)); text-transform:uppercase; letter-spacing:.04em; display:block; margin-bottom:5px; }
.sb-kpi .v { font-family: var(--font-mono,ui-monospace,monospace); font-size: var(--text-md,.95rem); font-weight:700; color: var(--ink-bright,#fff); }
.sb-pos { color: var(--success,#4ade80); } .sb-neg { color: var(--danger,#f87171); } .sb-muted { color: var(--ink-dim,#888); }

.sb-dist { margin-top: var(--space-md,14px); }
.sb-dist-bar { position:relative; height:30px; border-radius: var(--radius-sm,8px); background: linear-gradient(90deg, color-mix(in srgb,var(--danger,#f87171) 22%,transparent), var(--surface-2,rgba(255,255,255,.05)) 50%, color-mix(in srgb,var(--success,#4ade80) 22%,transparent)); border:1px solid var(--stroke,rgba(255,255,255,.1)); overflow:hidden; }
.sb-dist-zero { position:absolute; top:0; bottom:0; width:1px; background: var(--ink-faint,rgba(255,255,255,.4)); }
.sb-dist-band { position:absolute; top:6px; bottom:6px; background: color-mix(in srgb,var(--wallet-accent,#a78bfa) 30%,transparent); border-radius:4px; }
.sb-dist-med { position:absolute; top:2px; bottom:2px; width:2px; background: var(--wallet-accent,#c4b5fd); }
.sb-dist-legend { display:flex; justify-content:space-between; font-size: var(--text-2xs,.66rem); color: var(--ink-faint,rgba(255,255,255,.45)); margin-top:5px; font-family: var(--font-mono,ui-monospace,monospace); gap:6px; flex-wrap:wrap; }
.sb-splits { display:flex; height:10px; border-radius:999px; overflow:hidden; margin-top:10px; border:1px solid var(--stroke,rgba(255,255,255,.1)); }
.sb-splits i { display:block; height:100%; }
.sb-splits-legend { display:flex; flex-wrap:wrap; gap:10px; margin-top:7px; font-size: var(--text-2xs,.66rem); color: var(--ink-dim,#999); }
.sb-splits-legend span { display:inline-flex; align-items:center; gap:5px; }
.sb-dot { width:8px; height:8px; border-radius:2px; display:inline-block; }

.sb-trades { margin-top: var(--space-md,14px); }
.sb-trades h4 { margin:0 0 7px; font-size: var(--text-2xs,.69rem); text-transform:uppercase; letter-spacing:.04em; color: var(--ink-faint,rgba(255,255,255,.45)); }
.sb-trade { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-radius: var(--radius-sm,8px); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.07)); margin-bottom:6px; }
.sb-trade .who { display:flex; flex-direction:column; gap:2px; min-width:0; }
.sb-trade .sym { font-size: var(--text-sm,.78rem); color: var(--ink-bright,#fff); }
.sb-trade .mint a { font-size: var(--text-2xs,.66rem); color: var(--ink-dim,#888); text-decoration:none; font-family: var(--font-mono,ui-monospace,monospace); }
.sb-trade .mint a:hover { color: var(--wallet-accent,#c4b5fd); }
.sb-trade .res { text-align:right; font-family: var(--font-mono,ui-monospace,monospace); font-size: var(--text-sm,.8rem); font-weight:700; flex:none; }
.sb-trade .res small { display:block; font-weight:400; font-size: var(--text-2xs,.63rem); color: var(--ink-faint,rgba(255,255,255,.45)); text-transform:capitalize; }

.sb-caveats { margin-top: var(--space-md,14px); font-size: var(--text-2xs,.7rem); color: var(--ink-faint,rgba(255,255,255,.5)); line-height:1.55; }
.sb-caveats ul { margin:5px 0 0; padding-left:16px; } .sb-caveats li { margin:2px 0; }
.sb-conf { display:inline-flex; align-items:center; gap:5px; font-size: var(--text-2xs,.66rem); font-weight:600; text-transform:uppercase; letter-spacing:.04em; padding:3px 9px; border-radius:999px; border:1px solid currentColor; }
.sb-conf.high { color: var(--success,#4ade80); } .sb-conf.medium { color: var(--warn,#fbbf24); } .sb-conf.low { color: var(--ink-dim,#888); }

.sb-skel { height:14px; border-radius:6px; background: var(--surface-2,rgba(255,255,255,.05)); animation: sb-sk 1.4s ease-in-out infinite; margin:9px 0; }
.sb-spin { display:inline-block; width:13px; height:13px; border:2px solid rgba(0,0,0,.25); border-top-color: currentColor; border-radius:50%; animation: sb-rot .7s linear infinite; vertical-align:-2px; margin-right:6px; }
.sb-err { background: color-mix(in srgb, var(--danger,#f87171) 12%, transparent); border:1px solid color-mix(in srgb, var(--danger,#f87171) 32%, transparent); color: var(--danger,#f87171); border-radius: var(--radius-md,10px); padding:10px 12px; font-size: var(--text-sm,.78rem); }
.sb-dash { display:inline-flex; align-items:center; gap:6px; text-decoration:none; color: var(--ink-dim,#999); font-size: var(--text-2xs,.69rem); }
.sb-dash:hover { color: var(--ink-bright,#fff); } .sb-dash::after { content:'↗'; }
@keyframes sb-rot { to { transform: rotate(360deg); } }
@keyframes sb-sk { 0%,100%{opacity:.4} 50%{opacity:.8} }
@media (prefers-reduced-motion: reduce) { .sb-skel, .sb-spin { animation:none; } }
`;

function injectStyle() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const tag = document.createElement('style');
	tag.id = STYLE_ID;
	tag.textContent = STYLE;
	document.head.appendChild(tag);
}

const EXAMPLES = [
	"Snipe creators who've graduated at least two coins, market cap under $30k, organic distribution. Take profit at 3x, stop loss 40%, 30% trailing stop, max 0.3 SOL per trade.",
	'Intel-confirmed only: quality 60+, bundle score under 0.3, top holder under 25%. 0.1 SOL each, 1 SOL/day, take profit 2x, stop loss 35%.',
	'Snipe brand-new launches with socials, max cap $25k. 0.2 SOL per snipe, stop loss 30%, trailing 25%, exit after 30 minutes.',
];

// ── fetch helper: never throws, always a designed result ──────────────────────
async function call(url, { method = 'GET', body = null } = {}) {
	try {
		const opts = { method, credentials: 'include', headers: {} };
		if (body != null) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
		if (method !== 'GET') {
			const token = await consumeCsrfToken();
			if (token) opts.headers['x-csrf-token'] = token;
		}
		const r = await fetch(url, opts);
		let j = null;
		try { j = await r.json(); } catch { /* empty */ }
		if (!r.ok) return { ok: false, status: r.status, code: j?.error || 'error', message: j?.error_description || `request failed (${r.status})` };
		return { ok: true, status: r.status, data: j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: err?.message || 'network error' };
	}
}

function esc(s) {
	return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
const lamToSol = (l) => Number(BigInt(l || '0')) / LAMPORTS_PER_SOL;
const fmtPctNum = (v, signed = false) => (v == null ? '—' : `${signed && v > 0 ? '+' : ''}${Number(v).toFixed(Number(v) % 1 === 0 ? 0 : 1)}%`);

// Editable field spec. Type drives the UI<->API value conversion.
const FIELDS = [
	{ key: 'trigger', label: 'Trigger', type: 'select', opts: [['new_mint', 'New launch'], ['intel_confirmed', 'Intel-confirmed']] },
	{ key: 'per_trade_lamports', label: 'Per trade', unit: 'SOL', type: 'sol' },
	{ key: 'daily_budget_lamports', label: 'Daily budget', unit: 'SOL', type: 'sol' },
	{ key: 'max_concurrent_positions', label: 'Max concurrent', type: 'int' },
	{ key: 'slippage_bps', label: 'Slippage', unit: '%', type: 'slip' },
	{ key: 'max_price_impact_pct', label: 'Max impact', unit: '%', type: 'num' },
	{ key: 'min_market_cap_usd', label: 'Min mcap', unit: '$', type: 'num', nullable: true },
	{ key: 'max_market_cap_usd', label: 'Max mcap', unit: '$', type: 'num', nullable: true },
	{ key: 'min_creator_graduated', label: 'Creator grad ≥', type: 'int', nullable: true },
	{ key: 'max_creator_launches', label: 'Creator launches ≤', type: 'int', nullable: true },
	{ key: 'take_profit_pct', label: 'Take profit', unit: '%', type: 'num', nullable: true },
	{ key: 'stop_loss_pct', label: 'Stop loss', unit: '%', type: 'num' },
	{ key: 'trailing_stop_pct', label: 'Trailing stop', unit: '%', type: 'num', nullable: true },
	{ key: 'max_hold_seconds', label: 'Max hold', unit: 'min', type: 'min' },
	{ key: 'min_quality_score', label: 'Min quality', type: 'num', nullable: true, intel: true },
	{ key: 'max_bundle_score', label: 'Max bundle', type: 'num', step: '0.05', nullable: true, intel: true },
	{ key: 'max_concentration_top1', label: 'Max top-holder', unit: '%', type: 'num', nullable: true, intel: true },
];

function fieldDisplay(s, f) {
	const v = s[f.key];
	if (f.type === 'sol') return v == null ? '' : String(+lamToSol(v).toFixed(4));
	if (f.type === 'slip') return v == null ? '' : String(+(v / 100).toFixed(2));
	if (f.type === 'min') return v == null ? '' : String(Math.round(v / 60));
	return v == null ? '' : String(v);
}

function applyField(s, f, raw) {
	if (f.type === 'select') { s[f.key] = raw; return; }
	const txt = String(raw).trim();
	if (txt === '') {
		// Mandatory fields snap back to a safe value rather than going null/unsafe.
		if (f.key === 'stop_loss_pct') { s[f.key] = 35; return; }
		if (f.type === 'sol') { s[f.key] = '0'; return; }
		if (!f.nullable) return;
		s[f.key] = null; return;
	}
	const num = Number(txt);
	if (!Number.isFinite(num) || num < 0) return;
	if (f.type === 'sol') s[f.key] = String(Math.round(num * LAMPORTS_PER_SOL));
	else if (f.type === 'slip') s[f.key] = Math.round(num * 100);
	else if (f.type === 'min') s[f.key] = Math.round(num * 60);
	else if (f.type === 'int') s[f.key] = Math.round(num);
	else s[f.key] = num;
}

registerWalletTab({
	id: 'snipe',
	label: 'Snipe',
	order: 40,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectStyle();
		const { agentId } = ctx;
		const dashUrl = `/dashboard/sniper#agent=${encodeURIComponent(agentId)}`;

		let destroyed = false;
		const state = {
			source: '',
			compiling: false,
			compiled: null,      // { via, strategy, summary, assumptions, clamped, warnings }
			compileError: null,
			window: 30,
			backtesting: false,
			backtest: null,
			backtestError: null,
			backtestStale: false,
			arming: false,
			armed: false,        // true once armed on-chain; cleared on any edit or re-compile
		};

		// ── renderers ──────────────────────────────────────────────────────────
		function render() {
			if (destroyed) return;
			panel.innerHTML = `<div class="sb">${renderComposer()}${state.compiled ? renderReview() : ''}</div>`;
			wire();
		}

		function renderComposer() {
			const busy = state.compiling;
			return `<div class="sb-card sb-hero">
				<h2>Describe a snipe strategy</h2>
				<p class="sub">Write it in plain English. We compile it into a validated config — clamped to this agent's spend guards — then backtest it against three.ws's own real launch history before you risk a lamport.</p>
				<textarea class="sb-ta" id="sb-src" aria-label="Describe your snipe strategy in plain English" placeholder="${esc(EXAMPLES[0])}" ${busy ? 'disabled' : ''}>${esc(state.source)}</textarea>
				<div class="sb-egs" role="group" aria-label="Example strategies — tap to use one">${EXAMPLES.map((e, i) => `<button type="button" class="sb-eg" data-eg="${i}" title="${esc(e)}">${esc(e.length > 60 ? e.slice(0, 58) + '…' : e)}</button>`).join('')}</div>
				<div class="sb-actions">
					<button type="button" class="sb-btn primary" id="sb-compile" ${busy ? 'disabled' : ''} ${busy ? 'aria-busy="true"' : ''}>${busy ? '<span class="sb-spin"></span>Compiling…' : (state.compiled ? 'Re-compile' : 'Compile strategy')}</button>
					<a class="sb-dash" href="${esc(dashUrl)}">Open the Sniper dashboard</a>
				</div>
				${state.compileError ? `<div class="sb-err" role="alert" style="margin-top:12px">${esc(state.compileError)} <button type="button" class="sb-btn ghost" id="sb-retry-c" style="margin-left:8px;padding:4px 10px">Retry</button></div>` : ''}
			</div>`;
		}

		function renderReview() {
			const c = state.compiled;
			const s = c.strategy;
			const intel = s.trigger === 'intel_confirmed';
			const fields = FIELDS.filter((f) => !f.intel || intel).map((f) => renderField(s, f)).join('');

			const toggles = `
				<div class="sb-toggles">
					${tog('require_socials', 'Require socials', s.require_socials)}
					${tog('require_sol_quote', 'SOL-quote only', s.require_sol_quote)}
					${intel ? tog('avoid_dev_dump', 'Avoid dev dump', s.avoid_dev_dump) : ''}
				</div>`;

			const notes = [
				c.clamped?.length ? noteBlock('blue', 'Clamped to your safety limits', c.clamped) : '',
				c.assumptions?.length ? noteBlock('amber', 'Assumptions', c.assumptions) : '',
				c.warnings?.length ? noteBlock('red', 'Before you arm', c.warnings) : '',
			].join('');

			const canArm = BigInt(s.per_trade_lamports || '0') > 0n && BigInt(s.daily_budget_lamports || '0') > 0n && Number(s.stop_loss_pct) > 0;

			return `<div class="sb-card">
				<h3>Compiled strategy</h3>
				<div class="sb-summary">${esc(c.summary)}</div>
				<div class="sb-via">Compiled ${c.via === 'model' ? 'by the model' : 'from your wording'} · every field below is editable — adjust and re-backtest.</div>
				${notes}
				<div class="sb-fields">${fields}</div>
				${toggles}
				<div class="sb-actions">
					<div class="sb-seg" role="group" aria-label="Backtest window">
						${[7, 30, 90].map((w) => `<button type="button" data-win="${w}" class="${w === state.window ? 'on' : ''}" aria-pressed="${w === state.window}">${w}d</button>`).join('')}
					</div>
					<button type="button" class="sb-btn primary" id="sb-bt" ${state.backtesting ? 'disabled' : ''} ${state.backtesting ? 'aria-busy="true"' : ''}>${state.backtesting ? '<span class="sb-spin"></span>Backtesting…' : 'Run backtest'}</button>
					${state.backtestStale ? '<span class="sb-stale" role="status">edited — re-run the backtest</span>' : ''}
				</div>
				${renderBacktest()}
				${state.armed ? `<div class="sb-notes blue" role="status" style="margin-top:14px"><strong>Armed ✓</strong><div style="margin-top:4px">This agent is now sniping on its own wallet, under its spend guards. Edit any field above and re-arm to update it, or <a class="sb-dash" href="${esc(dashUrl)}" style="display:inline-flex">manage it on the Sniper dashboard</a>.</div></div>` : ''}
				<div class="sb-actions" style="border-top:1px solid var(--stroke,rgba(255,255,255,.08));padding-top:14px;margin-top:18px">
					<button type="button" class="sb-btn primary" id="sb-arm" ${canArm && !state.arming ? '' : 'disabled'} ${state.arming ? 'aria-busy="true"' : ''}>${state.arming ? '<span class="sb-spin"></span>Arming…' : (state.armed ? 'Re-arm →' : 'Arm this strategy →')}</button>
					<span class="sb-via" style="margin:0">Arms on this agent's own funded wallet, under its spend guards. Disarm any time from the dashboard.</span>
				</div>
			</div>`;
		}

		function renderField(s, f) {
			if (f.type === 'select') {
				const opts = f.opts.map(([v, l]) => `<option value="${v}" ${s[f.key] === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
				return `<div class="sb-fld"><label for="f-${f.key}">${esc(f.label)}</label><div class="sb-inwrap"><select class="sb-in" id="f-${f.key}" data-field="${f.key}">${opts}</select></div></div>`;
			}
			const val = fieldDisplay(s, f);
			const step = f.step || (f.type === 'sol' ? '0.01' : f.type === 'int' || f.type === 'min' ? '1' : 'any');
			const ph = f.nullable ? 'any' : '';
			return `<div class="sb-fld"><label for="f-${f.key}">${esc(f.label)}</label>
				<div class="sb-inwrap">
					<input class="sb-in" id="f-${f.key}" data-field="${f.key}" type="number" inputmode="decimal" min="0" step="${step}" value="${esc(val)}" placeholder="${ph}" />
					${f.unit ? `<span class="sb-unit">${esc(f.unit)}</span>` : ''}
				</div></div>`;
		}

		function tog(key, label, on) {
			return `<label class="sb-tog"><input type="checkbox" data-tog="${key}" ${on ? 'checked' : ''}/> ${esc(label)}</label>`;
		}
		function noteBlock(tone, title, items) {
			return `<div class="sb-notes ${tone}"><strong>${esc(title)}</strong><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
		}

		function renderBacktest() {
			if (state.backtesting) {
				return `<div class="sb-card" style="margin-top:14px;background:var(--surface-1,rgba(255,255,255,.02))" role="status" aria-busy="true" aria-label="Backtesting against real launch history"><div class="sb-skel" style="width:40%"></div><div class="sb-skel"></div><div class="sb-skel" style="width:70%"></div></div>`;
			}
			if (state.backtestError) {
				return `<div class="sb-err" role="alert" style="margin-top:14px">${esc(state.backtestError)} <button type="button" class="sb-btn ghost" id="sb-bt-retry" style="margin-left:8px;padding:4px 10px">Retry</button></div>`;
			}
			const b = state.backtest;
			if (!b) return '';
			if (b.insufficient_data) {
				return `<div class="sb-notes amber" style="margin-top:14px"><strong>Insufficient history</strong><div style="margin-top:4px">${esc(b.message)}</div></div>`;
			}
			const m = b.metrics;
			const conf = b.caveats?.confidence || 'low';
			const od = m.outcome_distribution || {};
			const total = (od.graduated || 0) + (od.pumped || 0) + (od.flat || 0) + (od.rugged || 0);
			const pctOf = (x) => (total ? (x / total) * 100 : 0);

			// ROI distribution band (p10 → p90, median marker) mapped onto worst..best.
			const lo = Math.min(m.roi_worst_pct, 0), hi = Math.max(m.roi_best_pct, 0);
			const span = hi - lo || 1;
			const pos = (v) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;

			const trade = (t) => `<div class="sb-trade">
				<div class="who"><span class="sym">${esc(t.symbol || t.name || 'coin')}</span>
				<span class="mint"><a href="${esc(explorerAddressUrl(t.mint, b.network))}" target="_blank" rel="noopener">${esc(shortAddress(t.mint, 4, 4))} ↗</a></span></div>
				<div class="res ${t.roi_pct >= 0 ? 'sb-pos' : 'sb-neg'}">${fmtPctNum(t.roi_pct, true)}<small>${esc((t.exit_reason || '').replace('_', ' '))} · ${esc(t.outcome)} · ${t.ath_multiple}×</small></div>
			</div>`;

			return `<div class="sb-card" style="margin-top:14px;background:var(--surface-1,rgba(255,255,255,.02))">
				<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
					<h4 style="margin:0;font-size:var(--text-2xs,.69rem);text-transform:uppercase;letter-spacing:.04em;color:var(--ink-faint,rgba(255,255,255,.45))">Projected over ${b.sample_size} real launches · last ${b.window_days}d${b.cached ? ' · cached' : ''}</h4>
					<span class="sb-conf ${esc(conf)}">${esc(conf)} confidence</span>
				</div>
				<div class="sb-kpis">
					<div class="sb-kpi"><span class="l">Win rate</span><span class="v">${(m.win_rate * 100).toFixed(0)}%</span></div>
					<div class="sb-kpi"><span class="l">EV / trade</span><span class="v ${m.expected_value_pct >= 0 ? 'sb-pos' : 'sb-neg'}">${fmtPctNum(m.expected_value_pct, true)}</span></div>
					<div class="sb-kpi"><span class="l">Median ROI</span><span class="v ${m.roi_median_pct >= 0 ? 'sb-pos' : 'sb-neg'}">${fmtPctNum(m.roi_median_pct, true)}</span></div>
					<div class="sb-kpi"><span class="l">Max drawdown</span><span class="v ${m.max_drawdown_pct > 0 ? 'sb-neg' : 'sb-muted'}">${m.max_drawdown_pct > 0 ? '−' : ''}${m.max_drawdown_pct.toFixed(1)}%</span></div>
					<div class="sb-kpi"><span class="l">Net P&L</span><span class="v ${m.net_pnl_sol >= 0 ? 'sb-pos' : 'sb-neg'}">${formatSol(m.net_pnl_sol)} SOL</span></div>
					<div class="sb-kpi"><span class="l">Trades</span><span class="v">${m.entries}<span style="font-size:.7em;color:var(--ink-faint)"> · ${m.wins}W ${m.losses}L</span></span></div>
				</div>

				<div class="sb-dist">
					<div class="sb-dist-bar" role="img" aria-label="ROI distribution: worst ${fmtPctNum(m.roi_worst_pct, true)}, p10 ${fmtPctNum(m.roi_p10_pct, true)}, median ${fmtPctNum(m.roi_median_pct, true)}, p90 ${fmtPctNum(m.roi_p90_pct, true)}, best ${fmtPctNum(m.roi_best_pct, true)}">
						<div class="sb-dist-band" style="left:${pos(m.roi_p10_pct)};right:calc(100% - ${pos(m.roi_p90_pct)})"></div>
						<div class="sb-dist-med" style="left:${pos(m.roi_median_pct)}"></div>
						<div class="sb-dist-zero" style="left:${pos(0)}"></div>
					</div>
					<div class="sb-dist-legend"><span>worst ${fmtPctNum(m.roi_worst_pct, true)}</span><span>p10 ${fmtPctNum(m.roi_p10_pct, true)} · med ${fmtPctNum(m.roi_median_pct, true)} · p90 ${fmtPctNum(m.roi_p90_pct, true)}</span><span>best ${fmtPctNum(m.roi_best_pct, true)}</span></div>
				</div>

				${total ? `<div style="margin-top:14px">
					<div class="sb-splits" role="img" aria-label="Outcome mix: ${od.graduated || 0} graduated, ${od.pumped || 0} pumped, ${od.flat || 0} flat, ${od.rugged || 0} rugged">
						<i style="background:#4ade80;width:${pctOf(od.graduated)}%"></i><i style="background:#34d399;width:${pctOf(od.pumped)}%"></i><i style="background:#888;width:${pctOf(od.flat)}%"></i><i style="background:#f87171;width:${pctOf(od.rugged)}%"></i>
					</div>
					<div class="sb-splits-legend">
						<span><i class="sb-dot" style="background:#4ade80"></i>${od.graduated || 0} graduated</span>
						<span><i class="sb-dot" style="background:#34d399"></i>${od.pumped || 0} pumped</span>
						<span><i class="sb-dot" style="background:#888"></i>${od.flat || 0} flat</span>
						<span><i class="sb-dot" style="background:#f87171"></i>${od.rugged || 0} rugged</span>
					</div>
				</div>` : ''}

				${(b.sample_hits?.length || b.sample_misses?.length) ? `<div class="sb-trades">
					${b.sample_hits?.length ? `<h4>Best simulated entries</h4>${b.sample_hits.map(trade).join('')}` : ''}
					${b.sample_misses?.length ? `<h4 style="margin-top:10px">Worst simulated entries</h4>${b.sample_misses.map(trade).join('')}` : ''}
				</div>` : ''}

				${renderIntegrity(b)}
				<div class="sb-caveats">${b.stake_assumed ? `Modeled at a ${b.stake_sol} SOL notional stake (set a per-trade size to model your real size). ` : `Modeled at ${b.stake_sol} SOL per trade. `}
					<ul>${(b.caveats?.items || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
				</div>
			</div>`;
		}

		// ── wiring ─────────────────────────────────────────────────────────────
		function wire() {
			panel.querySelector('#sb-src')?.addEventListener('input', (e) => { state.source = e.target.value; });
			panel.querySelectorAll('[data-eg]').forEach((b) => b.addEventListener('click', () => {
				const ta = panel.querySelector('#sb-src');
				if (ta) { ta.value = EXAMPLES[Number(b.dataset.eg)] || ''; state.source = ta.value; ta.focus(); }
			}));
			panel.querySelector('#sb-compile')?.addEventListener('click', onCompile);
			panel.querySelector('#sb-retry-c')?.addEventListener('click', onCompile);

			panel.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('change', () => {
				const f = FIELDS.find((x) => x.key === el.dataset.field);
				if (!f || !state.compiled) return;
				applyField(state.compiled.strategy, f, el.value);
				invalidateBacktest();
				render(); // reflect normalization (trigger toggles intel fields, snapbacks)
			}));
			panel.querySelectorAll('[data-tog]').forEach((el) => el.addEventListener('change', () => {
				if (state.compiled) state.compiled.strategy[el.dataset.tog] = el.checked;
				invalidateBacktest();
			}));
			panel.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => {
				const w = Number(b.dataset.win);
				if (w !== state.window) { state.window = w; invalidateBacktest(); render(); }
			}));
			panel.querySelector('#sb-bt')?.addEventListener('click', onBacktest);
			panel.querySelector('#sb-bt-retry')?.addEventListener('click', onBacktest);
			panel.querySelector('#sb-arm')?.addEventListener('click', onArm);
		}

		function invalidateBacktest() {
			if (state.backtest || state.backtestError) { state.backtest = null; state.backtestError = null; }
			state.backtestStale = true;
			state.armed = false; // the armed config no longer matches the edited one
		}

		async function onCompile() {
			const text = (panel.querySelector('#sb-src')?.value || '').trim();
			if (text.length < 3) { ctx.toast('Describe your strategy first.'); return; }
			state.compiling = true; state.compileError = null; state.source = text; state.armed = false; render();
			const res = await call('/api/sniper/compile', { method: 'POST', body: { agent_id: agentId, network: ctx.getNetwork(), text } });
			if (destroyed) return;
			state.compiling = false;
			if (!res.ok) { state.compileError = res.message || 'Could not compile — try again.'; render(); return; }
			state.compiled = res.data;
			state.backtest = null; state.backtestError = null; state.backtestStale = false;
			render();
		}

		async function onBacktest() {
			if (!state.compiled) return;
			state.backtesting = true; state.backtestError = null; render();
			const res = await call('/api/sniper/backtest', {
				method: 'POST',
				body: { agent_id: agentId, network: ctx.getNetwork(), window_days: state.window, strategy: state.compiled.strategy },
			});
			if (destroyed) return;
			state.backtesting = false; state.backtestStale = false;
			if (!res.ok) { state.backtestError = res.message || 'Backtest failed — try again.'; render(); return; }
			state.backtest = res.data;
			render();
		}

		async function onArm() {
			const s = state.compiled?.strategy;
			if (!s) return;
			if (!(BigInt(s.per_trade_lamports || '0') > 0n) || !(BigInt(s.daily_budget_lamports || '0') > 0n)) {
				ctx.toast('Set a per-trade size and a daily budget first.'); return;
			}
			if (ctx.getNetwork() !== 'devnet' && !(await ensureRiskAck({ context: 'snipe' }))) return;
			state.arming = true; render();
			const res = await call('/api/sniper/strategy', {
				method: 'POST',
				body: { ...s, agent_id: agentId, network: ctx.getNetwork(), enabled: true, kill_switch: false },
			});
			if (destroyed) return;
			state.arming = false;
			if (!res.ok) { ctx.toast(res.message || 'Could not arm the strategy.'); render(); return; }
			state.armed = true;
			ctx.toast('Armed — this agent is now sniping on its own wallet.');
			render();
		}

		render();
		return { destroy() { destroyed = true; } };
	},
});
