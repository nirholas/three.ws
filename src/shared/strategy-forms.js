// Shared Strategy Object UI primitives: the config editor, the equip picker, the
// human-readable rule summary, plus the styles every strategy surface uses. Reused
// by the /strategies library page and the agent-detail equip panel so the editor
// and the design stay in one place.
//
// 100% real: the editor POSTs/PATCHes to /api/strategies (server-validated against
// the same schema the runtime uses); the equip picker POSTs to
// /api/agents/:id/strategies. No mock state, no fake preview numbers.

import { apiFetch } from '../api.js';
import { mountLivePreview, mountCompileBox, mountGatedBacktest } from './strategy-settings.js';

export const VIOLET = 'var(--wallet-accent, #c4b5fd)';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const shortAddr = (a, h = 4, t = 4) => (a && a.length > h + t + 1 ? `${a.slice(0, h)}…${a.slice(-t)}` : a || '');
export function fmtSol(n) {
	if (n == null || !Number.isFinite(Number(n))) return '-';
	const v = Number(n);
	if (v === 0) return '0';
	if (Math.abs(v) < 0.001) return v.toExponential(1);
	return `${v.toFixed(v < 1 ? 4 : 2).replace(/\.?0+$/, '')}`;
}
export function timeAgo(t) {
	if (!t) return '';
	const d = (Date.now() - new Date(t).getTime()) / 1000;
	if (d < 0) return 'just now';
	if (d < 60) return 'just now';
	if (d < 3600) return `${Math.floor(d / 60)}m ago`;
	if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
	return `${Math.floor(d / 86400)}d ago`;
}

// ── toast ──────────────────────────────────────────────────────────────────────
let _toastEl = null;
let _toastTimer = null;
export function toast(msg, ms = 2800) {
	if (typeof document === 'undefined') return;
	if (!_toastEl) {
		_toastEl = document.createElement('div');
		_toastEl.className = 'so-toast';
		_toastEl.setAttribute('role', 'status');
		_toastEl.setAttribute('aria-live', 'polite');
		document.body.appendChild(_toastEl);
	}
	_toastEl.textContent = msg;
	_toastEl.dataset.show = 'true';
	clearTimeout(_toastTimer);
	_toastTimer = setTimeout(() => { if (_toastEl) _toastEl.dataset.show = 'false'; }, ms);
}

// ── rule summary: a one-line, honest plain-language read of a config ──────────
export function configSummary(config) {
	const c = config || {};
	const e = c.entry || {}, s = c.sizing || {}, x = c.exits || {}, k = c.risk || {}, r = c.research || {};
	const dv = r.dev_history || {};
	const parts = [];
	if (Array.isArray(e.sources) && e.sources.length === 1 && e.sources[0] === 'three_ws_launch') parts.push('three.ws launches');
	if (e.max_age_minutes != null) parts.push(`launches &lt;${e.max_age_minutes}m old`);
	const liq = r.min_liquidity_sol ?? e.min_liquidity_sol;
	if (liq != null) parts.push(`liq ≥◎${fmtSol(liq)}`);
	if (e.min_market_cap_usd != null || e.max_market_cap_usd != null) {
		const lo = e.min_market_cap_usd != null ? `$${fmtUsdShort(e.min_market_cap_usd)}` : '';
		const hi = e.max_market_cap_usd != null ? `$${fmtUsdShort(e.max_market_cap_usd)}` : '';
		parts.push(`MC ${lo}${lo && hi ? ' to ' : ''}${hi}`);
	}
	if (e.require_socials) parts.push('has socials');
	if (r.min_holders != null) parts.push(`≥${r.min_holders} holders`);
	if (r.max_top_holder_pct != null) parts.push(`top holder ≤${r.max_top_holder_pct}%`);
	if (r.security_min_score != null) parts.push(`security ≥${r.security_min_score}`);
	if (r.require_no_mint_authority || r.require_no_freeze_authority) parts.push('authorities renounced');
	const launches = dv.max_launches ?? e.max_creator_launches;
	if (launches != null) parts.push(`dev ≤${launches} launches`);
	const grads = dv.min_graduated ?? e.min_creator_graduated;
	if (grads != null) parts.push(`dev ≥${grads} grads`);
	if (dv.block_dev_sold) parts.push('dev holding');
	parts.push(`size ◎${fmtSol(s.amount_sol)}`);
	if (s.max_price_impact_bps != null) parts.push(`impact ≤${Number(s.max_price_impact_bps) / 100}%`);
	if (x.take_profit_pct != null) parts.push(`TP +${x.take_profit_pct}%`);
	if (x.stop_loss_pct != null) parts.push(`SL −${x.stop_loss_pct}%`);
	if (x.trailing_stop_pct != null) parts.push(`trail ${x.trailing_stop_pct}%`);
	if (x.max_hold_minutes != null) parts.push(`≤${formatMinutes(x.max_hold_minutes)}`);
	if (k.max_concurrent_positions != null) parts.push(`max ${k.max_concurrent_positions} open`);
	if (c.mode === 'auto') parts.push('auto');
	else if (c.version >= 2 || c.mode === 'ask') parts.push('asks first');
	return parts.join(' · ');
}
function fmtUsdShort(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return '-';
	if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
	return `${n}`;
}
function formatMinutes(m) {
	const n = Number(m);
	if (!Number.isFinite(n)) return '-';
	if (n >= 1440) return `${Math.round(n / 1440)}d`;
	if (n >= 60) return `${Math.round(n / 60)}h`;
	return `${n}m`;
}

// ── styles (injected once) ─────────────────────────────────────────────────────
const STYLE_ID = 'so-shared-styles';
export function ensureStrategyStyles() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const s = document.createElement('style');
	s.id = STYLE_ID;
	s.textContent = `
.so-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(10px); background: var(--bg-1, #1a1a1a); color: var(--ink-bright, #fff); border: 1px solid var(--wallet-stroke-strong, rgba(139,92,246,.5)); border-radius: var(--radius-md, 10px); padding: 11px 18px; font-size: var(--text-sm, .82rem); opacity: 0; pointer-events: none; transition: opacity .22s, transform .22s; z-index: 10000; max-width: 90vw; box-shadow: var(--shadow-2, 0 12px 32px rgba(0,0,0,.5)); }
.so-toast[data-show="true"] { opacity: 1; transform: translateX(-50%) translateY(0); }
.so-modal-back { position: fixed; inset: 0; background: rgba(0,0,0,.66); backdrop-filter: blur(var(--blur-sm, 4px)); z-index: 9998; display: flex; align-items: center; justify-content: center; padding: 16px; }
.so-modal { width: min(540px, 96vw); max-height: 92vh; overflow: auto; background: var(--bg-1, #141414); border: 1px solid var(--wallet-stroke, rgba(139,92,246,.3)); border-radius: var(--radius-lg, 14px); padding: var(--space-lg, 22px); box-shadow: var(--shadow-3, 0 24px 64px rgba(0,0,0,.6)); }
.so-modal h3 { margin: 0 0 4px; font-family: var(--font-display, inherit); font-size: var(--text-lg, 1.1rem); color: var(--ink-bright, #fff); }
.so-modal .so-sub { font-size: var(--text-xs, .72rem); color: var(--ink-dim, #9a9a9a); margin: 0 0 var(--space-md, 16px); line-height: 1.5; }
.so-group { border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); padding: var(--space-sm, 12px); margin-bottom: var(--space-sm, 12px); }
.so-group > legend, .so-glabel { font-size: var(--text-2xs, .64rem); text-transform: uppercase; letter-spacing: .07em; color: ${VIOLET}; font-weight: 700; padding: 0 4px; margin-bottom: 8px; display: block; }
.so-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 460px) { .so-grid { grid-template-columns: 1fr; } }
.so-field { margin-bottom: 2px; }
.so-field label { display: block; font-size: var(--text-2xs, .66rem); color: var(--ink-dim, #9a9a9a); margin-bottom: 5px; }
.so-field input, .so-field select { width: 100%; box-sizing: border-box; font: inherit; font-size: var(--text-sm, .82rem); padding: 8px 10px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); background: var(--surface-1, rgba(255,255,255,.03)); color: var(--ink-bright, #fff); }
.so-field input:focus, .so-field select:focus { outline: none; border-color: var(--wallet-stroke-strong, rgba(139,92,246,.5)); }
.so-field .so-hint { font-size: var(--text-2xs, .6rem); color: var(--ink-faint, #777); margin-top: 3px; }
.so-checkrow { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm, .8rem); color: var(--ink, #ddd); cursor: pointer; margin-top: 4px; }
.so-preview { font-size: var(--text-xs, .72rem); color: var(--ink-dim, #b8b8b8); line-height: 1.6; padding: var(--space-sm, 10px); border-radius: var(--radius-md, 10px); background: var(--wallet-accent-soft, rgba(139,92,246,.08)); border: 1px solid var(--wallet-stroke, rgba(139,92,246,.25)); margin: var(--space-sm, 10px) 0; }
.so-preview b { color: ${VIOLET}; font-family: var(--font-mono, monospace); }
.so-err { color: var(--danger, #f87171); font-size: var(--text-xs, .72rem); margin: 6px 0; }
.so-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: var(--space-md, 16px); }
.so-btn { font: inherit; font-size: var(--text-sm, .8rem); padding: 9px 16px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); background: var(--surface-2, rgba(255,255,255,.05)); color: var(--ink, #e8e8e8); cursor: pointer; transition: all var(--duration-fast, .16s); white-space: nowrap; }
.so-btn:hover { border-color: var(--wallet-stroke-strong, rgba(139,92,246,.5)); color: #fff; }
.so-btn:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 2px; }
.so-btn-primary { background: ${VIOLET}; color: #1a1340; border-color: transparent; font-weight: 700; }
.so-btn-primary:hover { background: var(--wallet-accent-strong, #a78bfa); color: #1a1340; }
.so-btn-primary:disabled { opacity: .6; cursor: progress; }
.so-pick { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 9px; border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); background: var(--surface-1, rgba(255,255,255,.03)); color: var(--ink, #e8e8e8); cursor: pointer; margin-bottom: 6px; transition: border-color .16s; }
.so-pick:hover { border-color: var(--wallet-stroke, rgba(139,92,246,.35)); }
.so-pick img, .so-pick .so-av { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: var(--surface-2, rgba(255,255,255,.06)); flex: 0 0 auto; }
.so-pick .so-pname { font-size: var(--text-sm, .82rem); font-weight: 600; color: var(--ink-bright, #fff); }
.so-compose { max-width: 1040px; margin: 0 auto; }
.so-compose-head { margin-bottom: var(--space-lg, 22px); }
.so-compose-back { background: none; border: none; color: var(--ink-dim, #9a9a9a); font: inherit; font-size: var(--text-sm, .82rem); cursor: pointer; padding: 4px 0; display: inline-flex; align-items: center; gap: 6px; transition: color .16s; }
.so-compose-back:hover { color: var(--ink-bright, #fff); }
.so-compose-back:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 3px; border-radius: 4px; }
.so-compose-title { font-family: var(--font-display, inherit); font-size: clamp(1.5rem, 4vw, 2.1rem); color: var(--ink-bright, #fff); letter-spacing: -.02em; margin: 10px 0 8px; }
.so-compose-lead { max-width: 620px; color: var(--ink-dim, #9a9a9a); font-size: var(--text-sm, .84rem); line-height: 1.6; margin: 0; }
.so-compose-grid { display: grid; grid-template-columns: 1fr; gap: var(--space-lg, 20px); }
@media (min-width: 880px) { .so-compose-grid { grid-template-columns: minmax(0, 1fr) 296px; align-items: start; } }
@media (min-width: 880px) { .so-compose-side { position: sticky; top: 84px; } }
.so-mbar { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 14px 0 0; padding: 10px 12px; border: 1px solid var(--wallet-stroke, rgba(139,92,246,.3)); border-radius: var(--radius-lg, 14px); background: color-mix(in srgb, var(--bg-1, #141414) 92%, transparent); backdrop-filter: blur(10px); box-shadow: var(--shadow-2, 0 12px 32px rgba(0,0,0,.4)); }
.so-mbar-t { min-width: 0; font-size: var(--text-xs, .72rem); color: var(--ink-dim, #9a9a9a); line-height: 1.35; transition: opacity .2s; }
.so-mbar-t b { color: var(--ink-bright, #fff); font-size: .95rem; font-variant-numeric: tabular-nums; }
.so-mbar[data-status="loading"] .so-mbar-t { opacity: .6; }
.so-mbar-go { flex: none; }
@media (min-width: 880px) { .so-mbar { display: none; } }
.so-side-card { border: 1px solid var(--wallet-stroke, rgba(139,92,246,.3)); border-radius: var(--radius-lg, 14px); background: var(--bg-1, #141414); padding: var(--space-lg, 18px); box-shadow: var(--shadow-2, 0 12px 32px rgba(0,0,0,.4)); }
.so-side-h { font-size: var(--text-2xs, .64rem); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-dim, #9a9a9a); font-weight: 700; margin-bottom: 8px; }
.so-side-card .so-preview { margin-top: 0; }
.so-side-points { list-style: none; padding: 0; margin: 12px 0 4px; display: flex; flex-direction: column; gap: 7px; }
.so-side-points li { font-size: var(--text-2xs, .66rem); color: var(--ink-dim, #999); padding-left: 15px; position: relative; line-height: 1.45; }
.so-side-points li::before { content: ''; position: absolute; left: 0; top: 6px; width: 6px; height: 6px; border-radius: 50%; background: ${VIOLET}; }
.so-side-points b { color: var(--ink, #ccc); font-weight: 600; }
.so-side-save { width: 100%; justify-content: center; margin-top: 14px; }
.so-side-cancel { width: 100%; justify-content: center; margin-top: 7px; background: transparent; border-color: transparent; }
.so-side-cancel:hover { background: var(--surface-2, rgba(255,255,255,.05)); }
.so-gp { font-size: var(--text-2xs, .66rem); color: var(--ink-dim, #9a9a9a); line-height: 1.5; margin: 0 0 10px; }
.so-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
@media (max-width: 460px) { .so-seg:not(.so-seg-inline) { grid-template-columns: 1fr; } }
.so-seg-opt { position: relative; display: block; cursor: pointer; }
.so-seg-opt input { position: absolute; opacity: 0; pointer-events: none; }
.so-seg-opt > span { display: block; height: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: var(--radius-md, 10px); border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); background: var(--surface-1, rgba(255,255,255,.03)); transition: border-color .16s, background .16s; }
.so-seg-opt b { display: block; font-size: var(--text-sm, .8rem); color: var(--ink-bright, #fff); font-weight: 600; }
.so-seg-opt small { display: block; font-size: var(--text-2xs, .64rem); color: var(--ink-dim, #9a9a9a); line-height: 1.45; margin-top: 3px; }
.so-seg-inline .so-seg-opt > span { padding: 8px 10px; text-align: center; }
.so-seg-opt:hover > span { border-color: var(--wallet-stroke, rgba(139,92,246,.35)); }
.so-seg-opt input:checked + span { border-color: var(--wallet-stroke-strong, rgba(139,92,246,.6)); background: var(--wallet-accent-soft, rgba(139,92,246,.1)); box-shadow: inset 0 0 0 1px var(--wallet-stroke-strong, rgba(139,92,246,.6)); }
.so-seg-opt input:focus-visible + span { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 2px; }
.so-gates { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
@media (max-width: 560px) { .so-gates { grid-template-columns: 1fr; } }
.so-gate { border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); padding: 9px 10px; background: var(--surface-1, rgba(255,255,255,.02)); transition: border-color .16s, background .16s; margin-top: 6px; }
.so-gates .so-gate { margin-top: 0; }
.so-gate[data-on="true"] { border-color: var(--wallet-stroke, rgba(139,92,246,.35)); background: var(--wallet-accent-soft, rgba(139,92,246,.06)); }
.so-gate-head { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: var(--text-xs, .74rem); color: var(--ink, #ddd); }
.so-gate-label { flex: 1; min-width: 0; }
.so-gate-out { font-family: var(--font-mono, monospace); font-size: var(--text-2xs, .66rem); color: var(--ink-faint, #777); white-space: nowrap; }
.so-gate[data-on="true"] .so-gate-out { color: ${VIOLET}; }
.so-gate-ctl { display: flex; align-items: center; gap: 8px; margin-top: 7px; }
.so-gate-ctl input[type="range"] { flex: 1; min-width: 0; accent-color: ${VIOLET}; height: 20px; cursor: pointer; }
.so-gate-ctl input[type="range"]:disabled { opacity: .35; cursor: not-allowed; }
.so-gate-ctl input[type="number"] { width: 78px; flex: 0 0 auto; box-sizing: border-box; font: inherit; font-size: var(--text-xs, .76rem); padding: 6px 8px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); background: var(--surface-1, rgba(255,255,255,.03)); color: var(--ink-bright, #fff); }
.so-gate-ctl input[type="number"]:disabled { opacity: .4; }
.so-gate-ctl input:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 2px; }
.so-gate .so-hint { font-size: var(--text-2xs, .6rem); color: var(--ink-faint, #777); margin-top: 4px; line-height: 1.4; }
.so-gate-head input, .so-checkrow input { accent-color: ${VIOLET}; width: 15px; height: 15px; flex: 0 0 auto; }
.so-json { border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); padding: 0 var(--space-sm, 12px); margin-bottom: var(--space-sm, 12px); }
.so-json > summary { cursor: pointer; padding: 11px 0; font-size: var(--text-xs, .74rem); font-weight: 600; color: var(--ink, #ddd); list-style-position: inside; }
.so-json > summary:focus-visible { outline: 2px solid var(--wallet-focus, rgba(139,92,246,.7)); outline-offset: 2px; border-radius: 4px; }
.so-json textarea { width: 100%; box-sizing: border-box; min-height: 280px; resize: vertical; font-family: var(--font-mono, monospace); font-size: var(--text-2xs, .68rem); line-height: 1.5; padding: 10px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--stroke-strong, rgba(255,255,255,.14)); background: var(--bg-0, rgba(0,0,0,.25)); color: var(--ink-bright, #fff); tab-size: 2; }
.so-json textarea:focus { outline: none; border-color: var(--wallet-stroke-strong, rgba(139,92,246,.5)); }
.so-json-st { font-size: var(--text-2xs, .64rem); min-height: 1.4em; margin: 5px 0 10px; color: var(--ink-faint, #777); }
.so-json-st[data-kind="err"] { color: var(--danger, #f87171); }
.so-json-st[data-kind="ok"] { color: var(--success, #4ade80); }
`;
	document.head.appendChild(s);
}

const DEFAULTS = {
	version: 2,
	mode: 'ask',
	network: 'mainnet',
	entry: { trigger: 'new_launch', sources: [], max_age_minutes: 60, min_market_cap_usd: null, max_market_cap_usd: null, min_liquidity_sol: null, require_socials: false, max_creator_launches: null, min_creator_graduated: null, require_sol_quote: true },
	sizing: { amount_sol: 0.1, max_slippage_bps: 500, max_price_impact_bps: null },
	exits: { take_profit_pct: 100, stop_loss_pct: 40, trailing_stop_pct: null, max_hold_minutes: null },
	risk: { max_concurrent_positions: 3, cooldown_minutes: 0 },
	research: {
		min_holders: null, max_top_holder_pct: null, min_liquidity_sol: null, security_min_score: null,
		require_no_mint_authority: false, require_no_freeze_authority: false,
		dev_history: { max_launches: null, min_graduated: null, block_dev_sold: false },
	},
};

const numOrNull = (v) => { const s = String(v ?? '').trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// ── shared editor internals ────────────────────────────────────────────────────
// One source of truth for the strategy form, used by both the modal editor
// (openStrategyEditor: in-context editing on an agent profile) and the full-page
// builder (mountStrategyComposer: the /strategies "New strategy" flow). The field
// markup, parsing, live preview, and save all live here so the two surfaces can
// never drift apart. Every control and the JSON view edit the same config object.

// Fold any stored config (v1 or v2, camelCase or snake_case keys) into editor
// state. Liquidity and creator history live in both `entry` (v1) and `research`
// (v2); the server treats them as one setting, so the editor does too.
function stateFromConfig(cfg, base = {}) {
	const c = isObj(cfg) ? cfg : {};
	const e = isObj(c.entry) ? c.entry : {};
	const s = isObj(c.sizing) ? c.sizing : {};
	const r = isObj(c.research) ? c.research : {};
	const dvRaw = r.dev_history ?? r.devHistory;
	const dv = isObj(dvRaw) ? dvRaw : {};
	const pick = (o, a, b) => (o[a] !== undefined ? o[a] : o[b]);
	const sources = Array.isArray(e.sources) && e.sources.map(String).includes('three_ws_launch') && !e.sources.map(String).includes('pump_curve') ? ['three_ws_launch'] : [];
	return {
		name: base.name ?? '',
		description: base.description ?? '',
		mode: c.mode === 'auto' ? 'auto' : 'ask',
		network: c.network === 'devnet' ? 'devnet' : 'mainnet',
		entry: { ...DEFAULTS.entry, ...e, sources },
		sizing: { ...DEFAULTS.sizing, ...s, max_price_impact_bps: numOrNull(pick(s, 'max_price_impact_bps', 'maxPriceImpactBps')) },
		exits: { ...DEFAULTS.exits, ...(isObj(c.exits) ? c.exits : {}) },
		risk: { ...DEFAULTS.risk, ...(isObj(c.risk) ? c.risk : {}) },
		research: {
			min_holders: numOrNull(pick(r, 'min_holders', 'minHolders')),
			max_top_holder_pct: numOrNull(pick(r, 'max_top_holder_pct', 'maxTopHolderPct')),
			min_liquidity_sol: numOrNull(pick(r, 'min_liquidity_sol', 'minLiquiditySol') ?? e.min_liquidity_sol),
			security_min_score: numOrNull(pick(r, 'security_min_score', 'securityMinScore')),
			require_no_mint_authority: pick(r, 'require_no_mint_authority', 'requireNoMintAuthority') === true,
			require_no_freeze_authority: pick(r, 'require_no_freeze_authority', 'requireNoFreezeAuthority') === true,
			dev_history: {
				max_launches: numOrNull(pick(dv, 'max_launches', 'maxLaunches') ?? e.max_creator_launches),
				min_graduated: numOrNull(pick(dv, 'min_graduated', 'minGraduated') ?? e.min_creator_graduated),
				block_dev_sold: pick(dv, 'block_dev_sold', 'blockDevSold') === true,
			},
		},
	};
}

function makeState(existing) {
	return stateFromConfig(existing?.config ? structuredCloneSafe(existing.config) : DEFAULTS, existing || {});
}

const numVal = (v) => (v == null ? '' : v);
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, path, v) {
	const keys = path.split('.');
	let t = o;
	for (const k of keys.slice(0, -1)) t = t[k] ??= {};
	t[keys[keys.length - 1]] = v;
}

function previewText(state) {
	return configSummary(buildConfig(state)) || 'Define your rules above.';
}

// Plain inputs: one row per control, read and written through its config path.
const PLAIN_FIELDS = [
	{ id: 'so-name', path: 'name', kind: 'str' },
	{ id: 'so-desc', path: 'description', kind: 'str' },
	{ id: 'so-net', path: 'network', kind: 'str' },
	{ id: 'so-age', path: 'entry.max_age_minutes', kind: 'num' },
	{ id: 'so-mcmin', path: 'entry.min_market_cap_usd', kind: 'num' },
	{ id: 'so-mcmax', path: 'entry.max_market_cap_usd', kind: 'num' },
	{ id: 'so-socials', path: 'entry.require_socials', kind: 'bool' },
	{ id: 'so-size', path: 'sizing.amount_sol', kind: 'num' },
	{ id: 'so-slip', path: 'sizing.max_slippage_bps', kind: 'num' },
	{ id: 'so-tp', path: 'exits.take_profit_pct', kind: 'num' },
	{ id: 'so-sl', path: 'exits.stop_loss_pct', kind: 'num' },
	{ id: 'so-trail', path: 'exits.trailing_stop_pct', kind: 'num' },
	{ id: 'so-hold', path: 'exits.max_hold_minutes', kind: 'num' },
	{ id: 'so-conc', path: 'risk.max_concurrent_positions', kind: 'num' },
	{ id: 'so-cool', path: 'risk.cooldown_minutes', kind: 'num' },
	{ id: 'so-r-mint', path: 'research.require_no_mint_authority', kind: 'bool' },
	{ id: 'so-r-freeze', path: 'research.require_no_freeze_authority', kind: 'bool' },
	{ id: 'so-r-devsold', path: 'research.dev_history.block_dev_sold', kind: 'bool' },
];

// Gates: an on/off switch plus a slider and a number box. Off stores null, which
// the runtime reads as "this check is not enforced". `scale` converts the
// displayed unit to the stored one (price impact shows % and stores bps).
const GATES = [
	{ id: 'so-impact', path: 'sizing.max_price_impact_bps', label: 'Max price impact', unit: '%', min: 0.5, max: 25, step: 0.5, def: 5, scale: 100, hint: 'skip a buy that would move the price more than this; can only tighten your agent’s own breaker' },
	{ id: 'so-r-holders', path: 'research.min_holders', label: 'Minimum holders', unit: '', min: 0, max: 1000, step: 5, def: 50, hint: 'distinct wallets holding the coin' },
	{ id: 'so-r-top', path: 'research.max_top_holder_pct', label: 'Largest holder share, at most', unit: '%', min: 1, max: 100, step: 1, def: 20, hint: 'excludes the bonding curve itself' },
	{ id: 'so-r-liq', path: 'research.min_liquidity_sol', label: 'Minimum liquidity', unit: ' SOL', min: 0, max: 85, step: 0.5, def: 5, hint: 'SOL in the bonding curve' },
	{ id: 'so-r-score', path: 'research.security_min_score', label: 'Firewall security score, at least', unit: '/100', min: 0, max: 100, step: 5, def: 60, hint: 'the three.ws token firewall, run live before every buy' },
	{ id: 'so-r-launches', path: 'research.dev_history.max_launches', label: 'Creator launches, at most', unit: '', min: 0, max: 50, step: 1, def: 3, hint: 'skip serial deployers' },
	{ id: 'so-r-grad', path: 'research.dev_history.min_graduated', label: 'Creator graduations, at least', unit: '', min: 0, max: 20, step: 1, def: 1, hint: 'coins this creator took off the curve before' },
];

const fmtGate = (g, v) => (v == null ? 'off' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${g.unit}`);

function gateHTML(g, state) {
	const stored = getPath(state, g.path);
	const on = stored != null;
	const v = on ? stored / (g.scale || 1) : g.def;
	return `<div class="so-gate" data-gate="${g.id}" data-on="${on}">
		<label class="so-gate-head"><input type="checkbox" class="so-gate-on" id="${g.id}-on" ${on ? 'checked' : ''}><span class="so-gate-label">${g.label}</span><output class="so-gate-out" id="${g.id}-out" for="${g.id}">${fmtGate(g, on ? v : null)}</output></label>
		<div class="so-gate-ctl">
			<input type="range" id="${g.id}-range" min="${g.min}" max="${g.max}" step="${g.step}" value="${Math.min(g.max, Math.max(g.min, v))}" aria-label="${g.label}" ${on ? '' : 'disabled'}>
			<input type="number" id="${g.id}" min="${g.min}" step="${g.step}" value="${v}" aria-label="${g.label} value" ${on ? '' : 'disabled'}>
		</div>
		<div class="so-hint">${g.hint}</div>
	</div>`;
}

// The form fields, without any chrome. `preview` controls whether the inline
// preview/error block is emitted here (the modal wants it inline; the page hosts
// them in its sticky side panel instead).
function strategyFieldsHTML(state, { preview = true } = {}) {
	const src = state.entry.sources.includes('three_ws_launch') ? 'three_ws_launch' : 'all';
	return `<div class="so-field"><label for="so-name">Name</label><input id="so-name" maxlength="80" placeholder="e.g. Fresh-launch sniper" value="${esc(state.name)}"></div>
		<div class="so-field"><label for="so-desc">Description <span style="color:var(--ink-faint,#777)">(optional)</span></label><input id="so-desc" maxlength="2000" placeholder="What edge does this capture?" value="${esc(state.description)}"></div>

		<fieldset class="so-group"><legend>Mode: who pulls the trigger</legend>
			<div class="so-seg" role="radiogroup" aria-label="Mode">
				<label class="so-seg-opt"><input type="radio" name="so-mode" value="ask" ${state.mode === 'ask' ? 'checked' : ''}><span><b>Ask before each buy</b><small>You get an approval request with the coin, amount and risk notes. Nothing is bought until you say yes.</small></span></label>
				<label class="so-seg-opt"><input type="radio" name="so-mode" value="auto" ${state.mode === 'auto' ? 'checked' : ''}><span><b>Auto within caps</b><small>Buys every match on its own, inside your agent’s spend policy and these gates.</small></span></label>
			</div>
		</fieldset>

		<fieldset class="so-group"><legend>Entry: when to buy</legend>
			<div class="so-seg so-seg-inline" role="radiogroup" aria-label="Launch sources">
				<label class="so-seg-opt"><input type="radio" name="so-src" value="all" ${src === 'all' ? 'checked' : ''}><span><b>All launches</b></span></label>
				<label class="so-seg-opt"><input type="radio" name="so-src" value="three_ws_launch" ${src === 'three_ws_launch' ? 'checked' : ''}><span><b>three.ws launches only</b></span></label>
			</div>
			<div class="so-grid">
				<div class="so-field"><label for="so-age">Max launch age (min)</label><input type="number" min="1" max="10080" id="so-age" value="${numVal(state.entry.max_age_minutes)}"><div class="so-hint">only act on launches newer than this</div></div>
				<div class="so-field"><label for="so-mcmin">Market cap band: min (USD)</label><input type="number" min="0" id="so-mcmin" placeholder="no floor" value="${numVal(state.entry.min_market_cap_usd)}"></div>
				<div class="so-field"><label for="so-mcmax">Market cap band: max (USD)</label><input type="number" min="0" id="so-mcmax" placeholder="no ceiling" value="${numVal(state.entry.max_market_cap_usd)}"></div>
			</div>
			<label class="so-checkrow"><input type="checkbox" id="so-socials" ${state.entry.require_socials ? 'checked' : ''}> Require socials (X / Telegram / site)</label>
		</fieldset>

		<fieldset class="so-group"><legend>Sizing</legend>
			<div class="so-field"><label for="so-size">Per-trade size</label>
				<div class="so-gate-ctl"><input type="range" id="so-size-range" min="0.01" max="2" step="0.01" value="${Math.min(2, Math.max(0.01, Number(state.sizing.amount_sol) || 0.1))}" aria-label="Per-trade size"><input type="number" min="0.0001" max="100" step="0.01" id="so-size" value="${numVal(state.sizing.amount_sol)}" aria-label="Per-trade size in SOL"></div>
				<div class="so-hint">SOL per buy, still capped by your agent’s spend policy</div></div>
			<div class="so-grid">
				<div class="so-field"><label for="so-slip">Max slippage (bps)</label><input type="number" min="0" max="10000" id="so-slip" value="${numVal(state.sizing.max_slippage_bps)}"><div class="so-hint">500 = 5%</div></div>
			</div>
			${gateHTML(GATES[0], state)}
		</fieldset>

		<fieldset class="so-group"><legend>Research gates: checked before every buy</legend>
			<p class="so-gp">Each switch adds a check the runtime runs on the coin before buying. A coin that fails one is skipped and the reason lands in your decision log. Data that cannot be read counts as a fail.</p>
			<div class="so-gates">${GATES.slice(1).map((g) => gateHTML(g, state)).join('')}</div>
			<label class="so-checkrow"><input type="checkbox" id="so-r-mint" ${state.research.require_no_mint_authority ? 'checked' : ''}> Mint authority renounced (no one can print more)</label>
			<label class="so-checkrow"><input type="checkbox" id="so-r-freeze" ${state.research.require_no_freeze_authority ? 'checked' : ''}> Freeze authority renounced (no one can freeze your tokens)</label>
			<label class="so-checkrow"><input type="checkbox" id="so-r-devsold" ${state.research.dev_history.block_dev_sold ? 'checked' : ''}> Skip coins whose creator already sold</label>
		</fieldset>

		<fieldset class="so-group"><legend>Exits: at least one upside exit + a stop-loss</legend>
			<div class="so-grid">
				<div class="so-field"><label for="so-tp">Take-profit (%)</label><input type="number" min="1" id="so-tp" value="${numVal(state.exits.take_profit_pct)}"><div class="so-hint">100 = sell at 2×</div></div>
				<div class="so-field"><label for="so-sl">Stop-loss (%), required</label><input type="number" min="1" max="99" id="so-sl" value="${numVal(state.exits.stop_loss_pct)}"></div>
				<div class="so-field"><label for="so-trail">Trailing stop (%)</label><input type="number" min="1" max="99" id="so-trail" value="${numVal(state.exits.trailing_stop_pct)}"><div class="so-hint">% drop from peak</div></div>
				<div class="so-field"><label for="so-hold">Max hold (min)</label><input type="number" min="1" id="so-hold" value="${numVal(state.exits.max_hold_minutes)}"></div>
			</div>
		</fieldset>

		<fieldset class="so-group"><legend>Risk</legend>
			<div class="so-grid">
				<div class="so-field"><label for="so-conc">Max concurrent positions</label><input type="number" min="1" max="50" id="so-conc" value="${numVal(state.risk.max_concurrent_positions)}"><div class="so-hint">pending approvals count toward this</div></div>
				<div class="so-field"><label for="so-cool">Cooldown between entries (min)</label><input type="number" min="0" id="so-cool" value="${numVal(state.risk.cooldown_minutes)}"></div>
				<div class="so-field"><label for="so-net">Network</label><select id="so-net"><option value="mainnet" ${state.network === 'mainnet' ? 'selected' : ''}>Mainnet</option><option value="devnet" ${state.network === 'devnet' ? 'selected' : ''}>Devnet</option></select></div>
			</div>
		</fieldset>

		<details class="so-json">
			<summary>Edit as JSON</summary>
			<p class="so-gp">The exact Strategy Object the controls above edit. Change it here and the controls follow.</p>
			<textarea id="so-json" spellcheck="false" aria-label="Strategy Object JSON">${esc(JSON.stringify(buildConfig(state), null, 2))}</textarea>
			<div class="so-json-st" id="so-json-st" role="status"></div>
		</details>${preview ? `

		<div class="so-preview" id="so-preview">${previewText(state)}</div>
		<div class="so-err" id="so-err" hidden></div>` : ''}`;
}

// Read every control in `root` back into `state` (root is the modal or composer).
function readInputs(root, state) {
	const q = (id) => root.querySelector(`#${id}`);
	for (const f of PLAIN_FIELDS) {
		const el = q(f.id);
		if (!el) continue;
		setPath(state, f.path, f.kind === 'bool' ? !!el.checked : f.kind === 'num' ? numOrNull(el.value) : el.value || (f.path === 'network' ? 'mainnet' : ''));
	}
	for (const g of GATES) {
		const on = q(`${g.id}-on`)?.checked;
		const v = numOrNull(q(g.id)?.value);
		setPath(state, g.path, on && v != null ? Math.round(v * (g.scale || 1) * 1e6) / 1e6 : null);
	}
	const mode = root.querySelector('input[name="so-mode"]:checked')?.value;
	state.mode = mode === 'auto' ? 'auto' : 'ask';
	const src = root.querySelector('input[name="so-src"]:checked')?.value;
	state.entry.sources = src === 'three_ws_launch' ? ['three_ws_launch'] : [];
}

// Push `state` into every control (the JSON view and the compiler drive this).
function writeInputs(root, state) {
	const q = (id) => root.querySelector(`#${id}`);
	for (const f of PLAIN_FIELDS) {
		const el = q(f.id);
		if (!el) continue;
		const v = getPath(state, f.path);
		if (f.kind === 'bool') el.checked = !!v;
		else el.value = v == null ? '' : v;
	}
	for (const g of GATES) {
		const stored = getPath(state, g.path);
		const on = stored != null;
		const v = on ? stored / (g.scale || 1) : g.def;
		const box = root.querySelector(`[data-gate="${g.id}"]`);
		if (box) box.dataset.on = String(on);
		if (q(`${g.id}-on`)) q(`${g.id}-on`).checked = on;
		if (q(g.id)) { q(g.id).value = v; q(g.id).disabled = !on; }
		if (q(`${g.id}-range`)) { q(`${g.id}-range`).value = Math.min(g.max, Math.max(g.min, v)); q(`${g.id}-range`).disabled = !on; }
		if (q(`${g.id}-out`)) q(`${g.id}-out`).textContent = fmtGate(g, on ? v : null);
	}
	const sz = q('so-size-range');
	if (sz) sz.value = Math.min(2, Math.max(0.01, Number(state.sizing.amount_sol) || 0.1));
	const mode = root.querySelector(`input[name="so-mode"][value="${state.mode}"]`);
	if (mode) mode.checked = true;
	const src = root.querySelector(`input[name="so-src"][value="${state.entry.sources.includes('three_ws_launch') ? 'three_ws_launch' : 'all'}"]`);
	if (src) src.checked = true;
}

// Keep a slider and its number box in step, and switch a gate's controls on/off.
function syncPairs(root, target) {
	const id = target.id || '';
	if (id.endsWith('-range')) {
		const box = root.querySelector(`#${id.slice(0, -6)}`);
		if (box) box.value = target.value;
	} else if (target.type === 'number') {
		const range = root.querySelector(`#${id}-range`);
		const n = numOrNull(target.value);
		if (range && n != null) range.value = Math.min(Number(range.max), Math.max(Number(range.min), n));
	} else if (target.classList?.contains('so-gate-on')) {
		const gid = id.slice(0, -3);
		const box = root.querySelector(`[data-gate="${gid}"]`);
		if (box) box.dataset.on = String(target.checked);
		root.querySelector(`#${gid}`)?.toggleAttribute('disabled', !target.checked);
		root.querySelector(`#${gid}-range`)?.toggleAttribute('disabled', !target.checked);
		if (target.checked) root.querySelector(`#${gid}-range`)?.focus();
	}
	for (const g of GATES) {
		const out = root.querySelector(`#${g.id}-out`);
		if (!out) continue;
		const on = root.querySelector(`#${g.id}-on`)?.checked;
		out.textContent = fmtGate(g, on ? numOrNull(root.querySelector(`#${g.id}`)?.value) : null);
	}
}

// Wire every control: each change re-reads the form, refreshes the summary and
// the JSON view, and notifies `onChange` (the live match preview). Editing the
// JSON parses it and pushes the result back into the controls.
function wireFormFields(root, state, { onChange } = {}) {
	const json = root.querySelector('#so-json');
	const jsonSt = root.querySelector('#so-json-st');
	const refreshSummary = () => { const p = root.querySelector('#so-preview'); if (p) p.innerHTML = previewText(state); };
	const fromControls = (ev) => {
		if (ev.target === json) return;
		syncPairs(root, ev.target);
		readInputs(root, state);
		refreshSummary();
		if (json && document.activeElement !== json) json.value = JSON.stringify(buildConfig(state), null, 2);
		if (jsonSt) { jsonSt.textContent = ''; jsonSt.dataset.kind = ''; }
		onChange?.(state);
	};
	root.querySelectorAll('input,select').forEach((el) => {
		el.addEventListener('input', fromControls);
		if (el.type === 'checkbox' || el.type === 'radio') el.addEventListener('change', fromControls);
	});
	let jsonTimer = null;
	json?.addEventListener('input', () => {
		clearTimeout(jsonTimer);
		jsonTimer = setTimeout(() => {
			let parsed;
			try { parsed = JSON.parse(json.value); } catch (err) {
				if (jsonSt) { jsonSt.textContent = `Not valid JSON yet: ${err.message}`; jsonSt.dataset.kind = 'err'; }
				return;
			}
			if (!isObj(parsed)) { if (jsonSt) { jsonSt.textContent = 'The Strategy Object must be a JSON object.'; jsonSt.dataset.kind = 'err'; } return; }
			applyConfig(root, state, parsed);
			if (jsonSt) { jsonSt.textContent = 'Controls updated from JSON.'; jsonSt.dataset.kind = 'ok'; }
			onChange?.(state);
		}, 300);
	});
	return {
		apply(config) {
			applyConfig(root, state, config);
			if (json) json.value = JSON.stringify(buildConfig(state), null, 2);
			onChange?.(state);
		},
	};
}

function applyConfig(root, state, config) {
	const next = stateFromConfig(config, { name: state.name, description: state.description });
	Object.assign(state, next);
	writeInputs(root, state);
	const p = root.querySelector('#so-preview'); if (p) p.innerHTML = previewText(state);
}

// The Strategy Object exactly as it is saved. Liquidity and creator history are
// written to both halves so a gate switched off stays off server-side.
function buildConfig(state) {
	const r = state.research;
	return {
		version: 2,
		mode: state.mode,
		network: state.network,
		entry: {
			...state.entry,
			trigger: 'new_launch',
			sources: state.entry.sources,
			min_liquidity_sol: r.min_liquidity_sol,
			max_creator_launches: r.dev_history.max_launches,
			min_creator_graduated: r.dev_history.min_graduated,
		},
		sizing: { ...state.sizing },
		exits: { ...state.exits },
		risk: { ...state.risk },
		research: { ...r, dev_history: { ...r.dev_history } },
	};
}

function showFieldErr(root, m) { const e = root.querySelector('#so-err'); if (e) { e.textContent = m; e.hidden = false; } }
function clearFieldErr(root) { const e = root.querySelector('#so-err'); if (e) e.hidden = true; }

// POST (create) or PATCH (edit). Returns the saved strategy, or throws.
async function submitStrategy(state, existing) {
	const payload = { name: state.name.trim(), description: state.description.trim() || null, config: buildConfig(state) };
	const res = await apiFetch(existing ? `/api/strategies/${existing.id}` : '/api/strategies', {
		method: existing ? 'PATCH' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	});
	const j = await res.json().catch(() => ({}));
	if (!res.ok) {
		const fieldErrs = j?.error?.errors || j?.errors;
		if (Array.isArray(fieldErrs) && fieldErrs.length) throw new Error(fieldErrs.map((e) => e.message).join(' '));
		throw new Error(j?.error?.message || j?.error_description || j?.message || 'Could not save');
	}
	return j.data;
}

// ── the strategy editor (modal) ────────────────────────────────────────────────
// In-context editing on an agent profile, where navigating to a full page would
// lose the surrounding context. The /strategies library uses the full-page
// builder below instead. existing: a strategy to edit (PATCH); null → create
// (POST). Resolves the saved strategy object, or null if cancelled.
export function openStrategyEditor({ existing = null } = {}) {
	ensureStrategyStyles();
	const state = makeState(existing);
	return new Promise((resolve) => {
		const back = document.createElement('div');
		back.className = 'so-modal-back';
		back.innerHTML = `<div class="so-modal" role="dialog" aria-modal="true" aria-label="${existing ? 'Edit' : 'New'} strategy">
			<h3>${existing ? 'Edit strategy' : 'New strategy'}</h3>
			<p class="so-sub">A strategy is a real, rule-based plan. When equipped, your agent evaluates real launches and executes on-chain, always inside your spend policy.</p>
			${strategyFieldsHTML(state)}
			<div id="so-live"></div>
			<div class="so-actions">
				<button type="button" class="so-btn" id="so-cancel">Cancel</button>
				<button type="button" class="so-btn so-btn-primary" id="so-save">${existing ? 'Save changes' : 'Create strategy'}</button>
			</div>
		</div>`;
		const modal = back.firstElementChild;
		const live = mountLivePreview(modal.querySelector('#so-live'), { getConfig: () => buildConfig(state) });
		wireFormFields(modal, state, { onChange: () => { clearFieldErr(modal); live.refresh(); } });
		modal.querySelector('#so-cancel').addEventListener('click', () => close(null));
		const btn = modal.querySelector('#so-save');
		btn.addEventListener('click', async () => {
			readInputs(modal, state);
			if (!state.name.trim()) { showFieldErr(modal, 'Give your strategy a name.'); return; }
			btn.disabled = true; btn.textContent = 'Saving…';
			try {
				const saved = await submitStrategy(state, existing);
				toast(existing ? 'Strategy updated' : 'Strategy created');
				close(saved);
			} catch (e) {
				if (e?.redirected) return;
				btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Create strategy';
				showFieldErr(modal, e.message || 'Could not save');
			}
		});
		function close(result) { live.destroy(); document.removeEventListener('keydown', onKey); back.remove(); resolve(result); }
		function onKey(e) { if (e.key === 'Escape') close(null); }
		back.addEventListener('click', (e) => { if (e.target === back) close(null); });
		document.addEventListener('keydown', onKey);
		document.body.appendChild(back);
		modal.querySelector('#so-name')?.focus();
	});
}

// ── the strategy builder (full page) ───────────────────────────────────────────
// Renders the whole builder into `host` as a page: a two-column workspace with
// the rules on the left and a sticky live summary, match preview and Create
// button on the right. This is the /strategies "New strategy" surface: a complex,
// multi-section form deserves room to breathe, not a cramped modal.
// onSaved(saved) fires after a successful create/edit; onCancel() fires on the
// back link.
export function mountStrategyComposer(host, { existing = null, onSaved, onCancel } = {}) {
	ensureStrategyStyles();
	const state = makeState(existing);
	host.innerHTML = `<div class="so-compose">
		<div class="so-compose-head">
			<button type="button" class="so-compose-back" id="so-back">← Strategies</button>
			<h1 class="so-compose-title">${existing ? 'Edit strategy' : 'New strategy'}</h1>
			<p class="so-compose-lead">A strategy is a real, rule-based plan. When equipped, your agent evaluates real launches and executes on-chain, always inside your spend policy.</p>
		</div>
		<div class="so-compose-grid">
			<div class="so-compose-main">
				<div id="so-nl"></div>
				${strategyFieldsHTML(state, { preview: false })}
				<div id="so-bt"></div>
				<div class="so-mbar" id="so-mbar" data-status="loading">
					<span class="so-mbar-t" aria-live="polite">Counting recent launches…</span>
					<button type="button" class="so-btn so-mbar-go" id="so-mbar-go">See matches</button>
				</div>
			</div>
			<aside class="so-compose-side">
				<div class="so-side-card">
					<div class="so-side-h">Your strategy</div>
					<div class="so-preview" id="so-preview">${previewText(state)}</div>
					<div id="so-live"></div>
					<ul class="so-side-points">
						<li><b>Ask by default</b>: nothing is bought until you approve it</li>
						<li><b>Spend-policy gated</b>: every trade is capped by your agent</li>
						<li><b>Kill switch</b>: halt everything at once</li>
					</ul>
					<div class="so-err" id="so-err" hidden></div>
					<button type="button" class="so-btn so-btn-primary so-side-save" id="so-save">${existing ? 'Save changes' : 'Create strategy'}</button>
					<button type="button" class="so-btn so-side-cancel" id="so-cancel">Cancel</button>
				</div>
			</aside>
		</div>
	</div>`;
	const root = host.firstElementChild;
	const getConfig = () => buildConfig(state);
	const mbar = root.querySelector('#so-mbar');
	const mbarText = mbar.querySelector('.so-mbar-t');
	const mbarGo = mbar.querySelector('#so-mbar-go');
	const live = mountLivePreview(root.querySelector('#so-live'), {
		getConfig,
		onState: ({ status, data }) => {
			mbar.dataset.status = status;
			if (status === 'error') { mbarText.textContent = 'Preview unavailable.'; mbarGo.textContent = 'Try again'; return; }
			mbarGo.textContent = 'See matches';
			if (!data) { mbarText.textContent = 'Counting recent launches…'; return; }
			mbarText.innerHTML = `<b>${Number(data.would_buy || 0).toLocaleString()}</b> of ${Number(data.universe || 0).toLocaleString()} launches in the last ${Number(data.window_hours) || 24}h would buy`;
		},
	});
	mbarGo.addEventListener('click', () => {
		if (mbar.dataset.status === 'error') { live.retry(); return; }
		root.querySelector('#so-live').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
	});
	const form = wireFormFields(root, state, { onChange: () => { clearFieldErr(root); live.refresh(); } });
	mountCompileBox(root.querySelector('#so-nl'), { getNetwork: () => state.network, onCompiled: (config) => form.apply(config) });
	mountGatedBacktest(root.querySelector('#so-bt'), { getConfig });
	root.querySelector('#so-back').addEventListener('click', () => { live.destroy(); onCancel?.(); });
	root.querySelector('#so-cancel').addEventListener('click', () => { live.destroy(); onCancel?.(); });
	const btn = root.querySelector('#so-save');
	btn.addEventListener('click', async () => {
		readInputs(root, state);
		if (!state.name.trim()) { showFieldErr(root, 'Give your strategy a name.'); root.querySelector('#so-name')?.focus(); return; }
		btn.disabled = true; btn.textContent = 'Saving…';
		try {
			const saved = await submitStrategy(state, existing);
			toast(existing ? 'Strategy updated' : 'Strategy created');
			live.destroy();
			onSaved?.(saved);
		} catch (e) {
			if (e?.redirected) return;
			btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Create strategy';
			showFieldErr(root, e.message || 'Could not save');
		}
	});
	root.querySelector('#so-name')?.focus();
}

function structuredCloneSafe(o) {
	try { return structuredClone(o); } catch { return JSON.parse(JSON.stringify(o)); }
}

// ── equip picker: choose which of MY agents equips this strategy ──────────────
// Resolves true if an equip was created.
export async function openEquipPicker({ strategy }) {
	ensureStrategyStyles();
	let mine = [];
	try {
		const res = await apiFetch('/api/agents', { allowAnonymous: true });
		if (res.ok) {
			const j = await res.json();
			mine = (j.agents || j.data?.agents || j.data || []).filter((a) => a && a.id);
		}
	} catch { /* handled below */ }
	if (!mine.length) { toast('You need your own agent first. Create or fork one'); return false; }

	if (mine.length === 1) return equipOn(mine[0], strategy);

	return new Promise((resolve) => {
		const back = document.createElement('div');
		back.className = 'so-modal-back';
		back.innerHTML = `<div class="so-modal" role="dialog" aria-modal="true" aria-label="Pick an agent to equip">
			<h3>Equip “${esc(strategy.name)}”</h3>
			<p class="so-sub">Pick the agent that will run these rules. It trades on-chain within <b style="color:var(--ink-bright,#fff)">its own</b> spend policy. No wallet access is shared.</p>
			<div>${mine.map((a) => `<button type="button" class="so-pick" data-id="${esc(a.id)}">${a.avatar_url || a.profile_image_url ? `<img loading="lazy" decoding="async" src="${esc(a.avatar_url || a.profile_image_url)}" alt="">` : '<div class="so-av"></div>'}<span class="so-pname">${esc(a.name || shortAddr(a.id))}</span></button>`).join('')}</div>
			<div class="so-actions"><button type="button" class="so-btn" id="so-pick-cancel">Cancel</button></div>
		</div>`;
		const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
		const onKey = (e) => { if (e.key === 'Escape') close(false); };
		back.addEventListener('click', (e) => { if (e.target === back) close(false); });
		document.addEventListener('keydown', onKey);
		back.querySelector('#so-pick-cancel').addEventListener('click', () => close(false));
		back.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', async () => {
			const agent = mine.find((a) => a.id === b.dataset.id);
			close(await equipOn(agent, strategy));
		}));
		document.body.appendChild(back);
	});
}

async function equipOn(agent, strategy) {
	try {
		const res = await apiFetch(`/api/agents/${agent.id}/strategies`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ strategy_id: strategy.id, network: strategy.config?.network || 'mainnet' }),
		});
		const j = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(j?.error?.message || 'Could not equip');
		toast(`Equipped on ${agent.name || 'your agent'}, running within its limits`);
		return true;
	} catch (e) {
		if (e?.redirected) return false;
		toast(e.message || 'Could not equip');
		return false;
	}
}
