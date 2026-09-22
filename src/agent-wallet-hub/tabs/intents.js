/**
 * Agent Wallet hub — Wallet Intents tab (Wave II, task 02).
 *
 * Owner-only. The agent's wallet, made programmable in plain language and
 * operable by talking to it. The owner describes a rule ("tip back anyone who
 * tips me more than 0.1 SOL, half of what they sent"; "when my balance is under
 * 0.05 SOL freeze spending and DM me"; "snipe launches from X under $40k, max 1
 * SOL each"); the copilot compiles it server-side into a STRICT, validated intent
 * card — what it parsed, the guardrails, a concrete dry-run — and on Confirm arms
 * it for real. The execution engine (api/_lib/wallet-intents.js + the cron) fires
 * armed intents on their trigger through the SAME spend-policy-gated, audited
 * signing paths every other outbound action uses, writing a custody event with
 * the intent_id. Receipts (real signatures) and running totals show per rule.
 *
 * The copilot also answers "how am I doing?" by reading real holdings + custody
 * P&L — it only reads there; funds never move from a question. A visitor's chat
 * never exposes or arms intents (the server 403s every non-owner).
 */

import { registerWalletTab } from '../registry.js';
import { formatUsd, formatSol, explorerTxUrl } from '../util.js';
import { consumeCsrfToken } from '../../api.js';

const STYLE_ID = 'awh-intents-style';
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const TRIGGER_ICON = {
	on_tip_received: '🫶', on_income: '💰', on_balance_below: '🛟',
	on_schedule: '🗓️', on_launch_matching: '🎯', on_stream_started: '🌊',
	credits_below: '🔋',
	on_mail_received: '✉️',
};
const ACTION_ICON = {
	tip: '🫶', transfer: '➡️', buy: '🛒', snipe: '🎯',
	withdraw: '🏦', split_income: '🪢', freeze: '🧊', notify: '🔔',
	fund_inference: '⚡',
};
const STATUS_TONE = {
	ok: 'ok', notified: 'ok', would_run: 'ok', confirmed: 'ok',
	skipped: 'muted', paused: 'warn', error: 'bad', failed: 'bad',
};

const TEMPLATES = [
	{ label: 'Tip back generously', text: 'Tip back anyone who tips me more than 0.1 SOL, half of what they sent.' },
	{ label: 'Self-protect on low balance', text: 'When my balance is under 0.05 SOL, freeze all spending and DM me.' },
	{ label: 'Share my income', text: 'Split 10% of everything I earn to my main wallet.' },
	{ label: 'Sweep profit on a schedule', text: 'Every Friday, withdraw anything above 2 SOL to my main wallet.' },
	{ label: 'Keep it thinking', text: 'When my credits fall below $1, top up 5 USDC from the wallet, at most once a day.' },
];

const STYLE = `
.wi-wrap { display:flex; flex-direction:column; gap: var(--space-lg,1.618rem); }
.wi-hero { background: linear-gradient(160deg, var(--wallet-accent-soft,rgba(139,92,246,.1)), var(--surface-1,rgba(255,255,255,.03))); border:1px solid var(--wallet-stroke,rgba(139,92,246,.3)); border-radius: var(--radius-lg,14px); padding: var(--space-lg,18px); position:relative; overflow:hidden; }
.wi-hero::after { content:''; position:absolute; inset:0; background: radial-gradient(120% 80% at 90% -10%, var(--wallet-glow,rgba(139,92,246,.25)), transparent 60%); pointer-events:none; opacity:.7; }
.wi-hero-top { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.wi-title { font-family: var(--font-display,'Space Grotesk',sans-serif); font-size: var(--text-lg,1.18rem); font-weight:600; color: var(--ink-bright,#fff); margin:0; }
.wi-title small { display:block; font-family: var(--font-body,Inter,sans-serif); font-size: var(--text-sm,.764rem); font-weight:400; color: var(--ink-dim,#888); margin-top:3px; }
.wi-stats { display:flex; gap:8px; flex-wrap:wrap; margin-top: var(--space-md,14px); }
.wi-stat { background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); padding:9px 12px; min-width:96px; }
.wi-stat .l { font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); text-transform:uppercase; letter-spacing:.03em; }
.wi-stat .n { font-family: var(--font-mono,ui-monospace,monospace); font-size: var(--text-md,.8125rem); color: var(--ink-bright,#fff); margin-top:3px; }
.wi-frozen { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top: var(--space-md,14px); padding:10px 13px; border-radius: var(--radius-md,10px); border:1px solid color-mix(in srgb, var(--danger,#f87171) 35%, transparent); background: color-mix(in srgb, var(--danger,#f87171) 8%, transparent); color: var(--danger,#f87171); font-size: var(--text-sm,.764rem); }

.wi-card { background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-lg,14px); padding: var(--space-lg,18px); }
.wi-card h3 { margin:0 0 4px; font-size: var(--text-ui,.875rem); color: var(--ink-bright,#fff); font-weight:600; display:flex; align-items:center; gap:8px; }
.wi-card .sub { margin:0 0 var(--space-md,14px); font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); }

.wi-compose { display:flex; gap:8px; align-items:flex-end; }
.wi-ta { width:100%; box-sizing:border-box; min-height:54px; resize:vertical; font:inherit; font-size: var(--text-md,.8125rem); line-height:1.5; color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-md,10px); padding:11px 13px; transition: border-color var(--duration-fast,140ms); }
.wi-ta:focus { outline:none; border-color: var(--wallet-stroke-strong,rgba(139,92,246,.5)); }
.wi-egs { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.wi-eg { appearance:none; font:inherit; font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#aaa); background: var(--surface-2,rgba(255,255,255,.05)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-pill,999px); padding:5px 11px; cursor:pointer; transition: color var(--duration-fast,140ms), border-color var(--duration-fast,140ms); }
.wi-eg:hover { color: var(--ink-bright,#fff); border-color: var(--wallet-stroke,rgba(139,92,246,.3)); }

.wi-btn { appearance:none; font:inherit; font-size: var(--text-sm,.764rem); font-weight:600; cursor:pointer; border-radius: var(--radius-md,10px); padding:9px 16px; border:1px solid var(--stroke-strong,rgba(255,255,255,.14)); background: var(--surface-2,rgba(255,255,255,.06)); color: var(--ink,#e8e8e8); transition: background var(--duration-fast,140ms), border-color var(--duration-fast,140ms), transform var(--duration-fast,140ms); white-space:nowrap; }
.wi-btn:hover:not(:disabled) { background: var(--surface-3,rgba(255,255,255,.09)); color: var(--ink-bright,#fff); }
.wi-btn:active:not(:disabled) { transform: translateY(1px); }
.wi-btn:disabled { opacity:.5; cursor:not-allowed; }
.wi-btn:focus-visible { outline: 2px solid var(--wallet-focus,rgba(139,92,246,.7)); outline-offset:2px; }
.wi-btn.primary { background: var(--wallet-accent,#c4b5fd); border-color: var(--wallet-accent,#c4b5fd); color:#160d28; }
.wi-btn.primary:hover:not(:disabled) { background: var(--wallet-accent-strong,#a78bfa); border-color: var(--wallet-accent-strong,#a78bfa); }
.wi-btn.danger { color: var(--danger,#f87171); border-color: color-mix(in srgb, var(--danger,#f87171) 40%, transparent); background: color-mix(in srgb, var(--danger,#f87171) 8%, transparent); }
.wi-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger,#f87171) 16%, transparent); color:#fff; }
.wi-btn.ghost { background:transparent; border-color: var(--stroke,rgba(255,255,255,.1)); }
.wi-btn.sm { padding:6px 11px; font-size: var(--text-2xs,.6875rem); }

/* Intent card — the headline: a parsed rule the owner confirms. */
.wi-intent-card { margin-top: var(--space-md,14px); border:1px solid var(--wallet-stroke,rgba(139,92,246,.35)); border-radius: var(--radius-lg,14px); background: color-mix(in srgb, var(--wallet-accent,#c4b5fd) 6%, var(--surface-1,rgba(255,255,255,.03))); padding: var(--space-md,15px); animation: wi-pop var(--duration-base,220ms) var(--ease-out,ease); }
.wi-intent-head { display:flex; gap:10px; align-items:flex-start; }
.wi-intent-ic { font-size:22px; line-height:1; flex:none; }
.wi-readback { font-size: var(--text-md,.8125rem); color: var(--ink-bright,#fff); line-height:1.5; }
.wi-meta { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.wi-chip { font-size: var(--text-2xs,.6875rem); padding:3px 9px; border-radius: var(--radius-pill,999px); border:1px solid var(--stroke,rgba(255,255,255,.12)); color: var(--ink-dim,#aaa); background: var(--surface-1,rgba(255,255,255,.03)); }
.wi-chip.accent { color: var(--wallet-accent,#c4b5fd); border-color: var(--wallet-stroke,rgba(139,92,246,.3)); }
.wi-sim { margin-top:11px; padding:10px 12px; border-radius: var(--radius-md,10px); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.08)); }
.wi-sim .h { font-size: var(--text-2xs,.6875rem); text-transform:uppercase; letter-spacing:.05em; color: var(--ink-dim,#888); margin-bottom:5px; }
.wi-sim p { margin:3px 0; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); }
.wi-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top: var(--space-md,13px); }
.wi-pub { display:flex; align-items:center; gap:8px; margin-top:11px; font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); cursor:pointer; }
.wi-pub input { accent-color: var(--wallet-accent,#c4b5fd); }
.wi-clarify { margin-top: var(--space-md,14px); padding:12px 14px; border-radius: var(--radius-md,10px); border:1px solid color-mix(in srgb, var(--warn,#fbbf24) 30%, transparent); background: color-mix(in srgb, var(--warn,#fbbf24) 8%, transparent); color: var(--warn,#fbbf24); font-size: var(--text-sm,.764rem); }

/* Rules list */
.wi-rules { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; }
.wi-rule { border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-md,11px); background: var(--surface-1,rgba(255,255,255,.03)); padding:12px 13px; transition: border-color var(--duration-fast,140ms); }
.wi-rule[data-off="true"] { opacity:.58; }
.wi-rule:hover { border-color: var(--wallet-stroke,rgba(139,92,246,.28)); }
.wi-rule-top { display:flex; gap:11px; align-items:flex-start; }
.wi-rule-ic { font-size:18px; line-height:1.2; flex:none; }
.wi-rule-body { flex:1; min-width:0; }
.wi-rule-ttl { font-size: var(--text-md,.8125rem); color: var(--ink-bright,#fff); font-weight:600; }
.wi-rule-desc { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#999); margin-top:3px; line-height:1.45; }
.wi-rule-foot { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:8px; font-size: var(--text-2xs,.6875rem); color: var(--ink-faint,rgba(255,255,255,.5)); }
.wi-rule-foot a { color: var(--wallet-accent,#c4b5fd); text-decoration:none; border-bottom:1px dotted currentColor; }
.wi-rule-ctl { display:flex; gap:6px; align-items:center; flex:none; }
.wi-pill { font-size: var(--text-2xs,.6875rem); padding:2px 9px; border-radius: var(--radius-pill,999px); border:1px solid currentColor; text-transform:capitalize; }
.wi-pill.ok { color: var(--success,#4ade80); } .wi-pill.warn { color: var(--warn,#fbbf24); } .wi-pill.bad { color: var(--danger,#f87171); } .wi-pill.muted { color: var(--ink-dim,#888); }
/* toggle switch */
.wi-sw { position:relative; width:38px; height:21px; flex:none; cursor:pointer; }
.wi-sw input { position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer; }
.wi-sw .track { position:absolute; inset:0; border-radius:999px; background: var(--surface-3,rgba(255,255,255,.12)); transition: background var(--duration-fast,140ms); }
.wi-sw .thumb { position:absolute; top:2px; left:2px; width:17px; height:17px; border-radius:50%; background:#fff; transition: transform var(--duration-fast,140ms); }
.wi-sw input:checked + .track { background: var(--wallet-accent,#c4b5fd); }
.wi-sw input:checked + .track + .thumb { transform: translateX(17px); }
.wi-sw input:focus-visible + .track { outline:2px solid var(--wallet-focus,rgba(139,92,246,.7)); outline-offset:2px; }
.wi-row-actions { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }

/* Copilot */
.wi-copilot .log { display:flex; flex-direction:column; gap:9px; margin-bottom:11px; max-height:240px; overflow-y:auto; }
.wi-bubble { max-width:88%; padding:9px 12px; border-radius:13px; font-size: var(--text-sm,.764rem); line-height:1.5; }
.wi-bubble.user { align-self:flex-end; background: var(--wallet-accent,#c4b5fd); color:#160d28; border-bottom-right-radius:4px; }
.wi-bubble.bot { align-self:flex-start; background: var(--surface-2,rgba(255,255,255,.06)); color: var(--ink,#e8e8e8); border:1px solid var(--stroke,rgba(255,255,255,.08)); border-bottom-left-radius:4px; }
.wi-bubble .spk { background:none; border:none; cursor:pointer; color:inherit; opacity:.6; font-size:13px; margin-left:6px; padding:0; }
.wi-bubble .spk:hover { opacity:1; }

.wi-empty { text-align:center; padding: var(--space-lg,18px) var(--space-md,14px); color: var(--ink-dim,#888); font-size: var(--text-sm,.764rem); }
.wi-empty .ic { font-size:30px; margin-bottom:8px; }
.wi-skel { height:14px; border-radius:6px; background: var(--surface-2,rgba(255,255,255,.05)); animation: wi-sk 1.4s ease-in-out infinite; margin:10px 0; }
.wi-spin { display:inline-block; width:13px; height:13px; border:2px solid rgba(0,0,0,.25); border-top-color: currentColor; border-radius:50%; animation: wi-rot .7s linear infinite; vertical-align:-2px; margin-right:6px; }
.wi-err { background: color-mix(in srgb, var(--danger,#f87171) 12%, transparent); border:1px solid color-mix(in srgb, var(--danger,#f87171) 32%, transparent); color: var(--danger,#f87171); border-radius: var(--radius-md,10px); padding:10px 12px; font-size: var(--text-sm,.764rem); }
@keyframes wi-rot { to { transform: rotate(360deg); } }
@keyframes wi-sk { 0%,100%{opacity:.4} 50%{opacity:.8} }
@keyframes wi-pop { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .wi-skel,.wi-spin,.wi-intent-card { animation:none; transition:none; } }
`;

function injectStyle() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const tag = document.createElement('style');
	tag.id = STYLE_ID;
	tag.textContent = STYLE;
	document.head.appendChild(tag);
}

function esc(s) {
	return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

async function call(url, { method = 'GET', body = null } = {}) {
	try {
		const opts = { method, credentials: 'include', headers: {} };
		if (body != null) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
		if (method !== 'GET') { const token = await consumeCsrfToken(); if (token) opts.headers['x-csrf-token'] = token; }
		const r = await fetch(url, opts);
		let j = null; try { j = await r.json(); } catch { /* */ }
		if (!r.ok) return { ok: false, status: r.status, code: j?.error || 'error', message: j?.error_description || `request failed (${r.status})`, data: j?.data ?? null };
		return { ok: true, status: r.status, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: err?.message || 'network error' };
	}
}

// Real voice: server TTS (the agent's voice via the platform synth) first,
// browser speech as the offline fallback so a readback always speaks.
async function speak(agentId, text) {
	try {
		const r = await fetch('/api/tts/speak', {
			method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: text.slice(0, 600), agent_id: agentId }),
		}).catch(() => null);
		if (r && r.ok && (r.headers.get('content-type') || '').startsWith('audio')) {
			const buf = await r.arrayBuffer();
			const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: r.headers.get('content-type') })));
			await audio.play();
			return;
		}
	} catch { /* fall through */ }
	try {
		if (typeof speechSynthesis !== 'undefined') {
			const u = new SpeechSynthesisUtterance(text.slice(0, 600));
			speechSynthesis.cancel();
			speechSynthesis.speak(u);
		}
	} catch { /* no voice available */ }
}

registerWalletTab({
	id: 'intents',
	label: 'Intents',
	order: 50,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectStyle();
		const base = (sub = '') => `/api/agents/${ctx.agentId}/intents${sub ? '/' + sub : ''}?network=${ctx.getNetwork()}`;

		let destroyed = false;
		const state = {
			loading: true, error: null,
			intents: [], summary: null,
			composer: '', compiling: false, draft: null, clarify: null, publishTrait: false,
			copilot: [], asking: false,
		};

		async function load() {
			state.loading = true; render();
			const res = await call(base());
			if (destroyed) return;
			state.loading = false;
			if (!res.ok) { state.error = res.message; }
			else { state.error = null; state.intents = res.data.intents || []; state.summary = res.data.summary || null; }
			render();
		}

		// ── renderers ──────────────────────────────────────────────────────────────
		function render() {
			if (destroyed) return;
			if (state.loading) {
				panel.innerHTML = `<div class="wi-wrap" role="status" aria-busy="true" aria-label="Loading your intents"><div class="wi-card"><div class="wi-skel" style="width:42%"></div><div class="wi-skel"></div><div class="wi-skel" style="width:75%"></div></div><div class="wi-card"><div class="wi-skel" style="width:30%"></div><div class="wi-skel"></div></div></div>`;
				return;
			}
			if (state.error) {
				panel.innerHTML = `<div class="wi-wrap"><div class="wi-err" role="alert">Couldn’t load your intents: ${esc(state.error)}</div><div class="wi-actions"><button class="wi-btn" id="wi-retry" type="button">Retry</button></div></div>`;
				panel.querySelector('#wi-retry')?.addEventListener('click', load);
				return;
			}
			panel.innerHTML = `<div class="wi-wrap">${renderHero()}${renderComposer()}${renderList()}${renderCopilot()}</div>`;
			wire();
			const log = panel.querySelector('.wi-copilot .log'); if (log) log.scrollTop = log.scrollHeight;
		}

		function renderHero() {
			const s = state.summary || {};
			const frozen = s.frozen
				? `<div class="wi-frozen" role="status"><span>🧊 Wallet is frozen — every autonomous spend is paused until you unfreeze it under Limits.</span></div>`
				: '';
			return `<div class="wi-hero">
				<div class="wi-hero-top">
					<h2 class="wi-title">Wallet intents<small>Tell your wallet what to do — it does it for real, inside your guardrails.</small></h2>
				</div>
				<div class="wi-stats">
					<div class="wi-stat"><div class="l">Active</div><div class="n">${s.enabled ?? 0} / ${s.count ?? 0}</div></div>
					<div class="wi-stat"><div class="l">Balance</div><div class="n">${s.balance_sol == null ? '—' : formatSol(s.balance_sol) + ' SOL'}</div></div>
					<div class="wi-stat"><div class="l">Lifetime moved</div><div class="n">${formatUsd(s.lifetime_usd || 0)}</div></div>
					<div class="wi-stat"><div class="l">Fires</div><div class="n">${s.lifetime_fires || 0}</div></div>
				</div>
				${frozen}
			</div>`;
		}

		function renderComposer() {
			const draft = state.draft;
			const clar = state.clarify;
			return `<div class="wi-card">
				<h3 id="wi-new-h">＋ New rule — describe it</h3>
				<p class="sub">Plain language. I’ll compile it into an exact, bounded rule you confirm before anything runs.</p>
				<div class="wi-compose">
					<textarea class="wi-ta" id="wi-src" aria-labelledby="wi-new-h" placeholder="e.g. Tip back anyone who tips me more than 0.1 SOL, half of what they sent.">${esc(state.composer)}</textarea>
					<button class="wi-btn primary" id="wi-compile" type="button" ${state.compiling ? 'disabled aria-busy="true"' : ''}>${state.compiling ? '<span class="wi-spin" aria-hidden="true"></span>Reading…' : 'Compile'}</button>
				</div>
				<div class="wi-egs" role="group" aria-label="Rule templates">${TEMPLATES.map((t, i) => `<button class="wi-eg" type="button" data-tpl="${i}" title="${esc(t.text)}">${esc(t.label)}</button>`).join('')}</div>
				${clar ? `<div class="wi-clarify" role="status">🤔 ${esc(clar)}</div>` : ''}
				${draft ? renderIntentCard(draft) : ''}
			</div>`;
		}

		function renderIntentCard(d) {
			const trig = d.intent.trigger, act = d.intent.action, lim = d.intent.limits || {};
			const chips = [];
			chips.push(`<span class="wi-chip accent">${TRIGGER_ICON[trig.type] || '•'} ${esc(labelTrigger(trig.type))}</span>`);
			chips.push(`<span class="wi-chip accent">${ACTION_ICON[act.type] || '•'} ${esc(act.type.replace('_', ' '))}</span>`);
			if (lim.per_action_usd != null) chips.push(`<span class="wi-chip">≤ $${esc(lim.per_action_usd)}/action</span>`);
			if (lim.daily_usd != null) chips.push(`<span class="wi-chip">≤ $${esc(lim.daily_usd)}/day</span>`);
			if (lim.total_usd != null) chips.push(`<span class="wi-chip">≤ $${esc(lim.total_usd)} total</span>`);
			const sim = d.simulation?.lines?.length
				? `<div class="wi-sim"><div class="h">Dry run</div>${d.simulation.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : '';
			const advertisable = trig.type === 'on_tip_received' || act.type === 'split_income' || (trig.type === 'on_launch_matching');
			return `<div class="wi-intent-card" role="group" aria-label="Parsed rule — review before arming">
				<div class="wi-intent-head">
					<span class="wi-intent-ic" aria-hidden="true">${TRIGGER_ICON[trig.type] || '✨'}</span>
					<div class="wi-readback">${esc(d.readback || d.intent.title)}
						<button class="wi-bubble-spk spk" id="wi-speak-draft" type="button" title="Hear it" aria-label="Hear this rule read aloud" style="background:none;border:none;cursor:pointer;color:inherit;opacity:.6;margin-left:6px">🔊</button>
					</div>
				</div>
				<div class="wi-meta">${chips.join('')}</div>
				${sim}
				${advertisable ? `<label class="wi-pub"><input type="checkbox" id="wi-pub" ${state.publishTrait ? 'checked' : ''}/> Advertise this behavior on my public profile (never the rule or caps)</label>` : ''}
				<div class="wi-actions">
					<button class="wi-btn primary" id="wi-arm" type="button">Confirm & arm</button>
					<button class="wi-btn ghost" id="wi-edit" type="button">Edit wording</button>
					<button class="wi-btn ghost" id="wi-cancel" type="button">Cancel</button>
				</div>
			</div>`;
		}

		function renderList() {
			if (!state.intents.length) {
				return `<div class="wi-card"><div class="wi-empty"><div class="ic" aria-hidden="true">🪄</div>No intents yet.<br/>Describe a rule above, or start from a template.</div></div>`;
			}
			return `<div class="wi-card">
				<h3>Your rules</h3>
				<p class="sub">Each runs automatically on its trigger — every action real, gated by your spend policy, logged with a receipt.</p>
				<ul class="wi-rules">${state.intents.map(renderRule).join('')}</ul>
			</div>`;
		}

		function renderRule(it) {
			const st = it.stats || {};
			const tone = STATUS_TONE[st.last_status] || 'muted';
			const sig = st.last_signature;
			const explorer = sig ? explorerTxUrl(sig, ctx.getNetwork()) : null;
			const fired = st.last_fired_at ? new Date(st.last_fired_at).toLocaleString() : null;
			const statusPill = st.last_status ? `<span class="wi-pill ${tone}">${esc(String(st.last_status).replace('_', ' '))}</span>` : '';
			const foot = [];
			if (fired) foot.push(`last ${esc(timeAgo(st.last_fired_at))}`);
			foot.push(`${st.fire_count || 0} fire${st.fire_count === 1 ? '' : 's'}`);
			if (st.spent_usd) foot.push(`${formatUsd(st.spent_usd)} moved`);
			if (st.last_note) foot.push(esc(String(st.last_note).slice(0, 80)));
			if (explorer) foot.push(`<a href="${esc(explorer)}" target="_blank" rel="noopener">receipt ↗</a>`);
			return `<li class="wi-rule" data-off="${it.enabled ? 'false' : 'true'}" data-id="${esc(it.id)}">
				<div class="wi-rule-top">
					<span class="wi-rule-ic" aria-hidden="true">${TRIGGER_ICON[it.trigger.type] || '•'}</span>
					<div class="wi-rule-body">
						<div class="wi-rule-ttl">${esc(it.title)} ${it.public_trait ? '<span class="wi-chip" title="advertised on your public profile">public</span>' : ''}</div>
						<div class="wi-rule-desc">${esc(it.readback || '')}</div>
						<div class="wi-rule-foot">${statusPill}${foot.map((f) => `<span>${f}</span>`).join('')}</div>
					</div>
					<div class="wi-rule-ctl">
						<label class="wi-sw" title="${it.enabled ? 'Armed' : 'Paused'}"><input type="checkbox" data-toggle="${esc(it.id)}" ${it.enabled ? 'checked' : ''} aria-label="${it.enabled ? 'Armed' : 'Paused'} — ${esc(it.title)}"/><span class="track" aria-hidden="true"></span><span class="thumb" aria-hidden="true"></span></label>
					</div>
				</div>
				<div class="wi-row-actions">
					<button class="wi-btn ghost sm" type="button" data-test="${esc(it.id)}" aria-label="Test now: ${esc(it.title)}">Test now</button>
					<button class="wi-btn danger sm" type="button" data-del="${esc(it.id)}" aria-label="Delete: ${esc(it.title)}">Delete</button>
				</div>
			</li>`;
		}

		function renderCopilot() {
			const log = state.copilot.map((m) => m.role === 'user'
				? `<div class="wi-bubble user">${esc(m.text)}</div>`
				: `<div class="wi-bubble bot">${esc(m.text)}<button class="spk" type="button" data-speak data-i="${m.i}" title="Hear it" aria-label="Hear this answer read aloud">🔊</button></div>`).join('');
			return `<div class="wi-card wi-copilot">
				<h3 id="wi-ask-h">Ask your wallet</h3>
				<p class="sub">“How am I doing?” · “What did my rules do this week?” — answered from your real balance + ledger. Never moves funds.</p>
				<div class="log" role="log" aria-live="polite" aria-label="Conversation with your wallet">${log || '<div class="wi-empty" style="padding:8px 0">Ask a question to see how your wallet is doing.</div>'}</div>
				<div class="wi-compose">
					<textarea class="wi-ta" id="wi-ask" aria-labelledby="wi-ask-h" style="min-height:42px" placeholder="How am I doing?"></textarea>
					<button class="wi-btn" id="wi-ask-btn" type="button" aria-label="Ask" ${state.asking ? 'disabled aria-busy="true"' : ''}>${state.asking ? '<span class="wi-spin" aria-hidden="true"></span>' : 'Ask'}</button>
				</div>
			</div>`;
		}

		// ── wiring ─────────────────────────────────────────────────────────────────
		function wire() {
			const srcEl = panel.querySelector('#wi-src');
			srcEl?.addEventListener('input', (e) => { state.composer = e.target.value; });
			panel.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
				const t = TEMPLATES[Number(b.dataset.tpl)]; if (!t) return;
				state.composer = t.text; const el = panel.querySelector('#wi-src'); if (el) { el.value = t.text; el.focus(); }
			}));
			panel.querySelector('#wi-compile')?.addEventListener('click', onCompile);
			panel.querySelector('#wi-arm')?.addEventListener('click', onArm);
			panel.querySelector('#wi-edit')?.addEventListener('click', () => { state.draft = null; state.clarify = null; render(); panel.querySelector('#wi-src')?.focus(); });
			panel.querySelector('#wi-cancel')?.addEventListener('click', () => { state.draft = null; state.clarify = null; state.composer = ''; render(); });
			panel.querySelector('#wi-pub')?.addEventListener('change', (e) => { state.publishTrait = e.target.checked; });
			panel.querySelector('#wi-speak-draft')?.addEventListener('click', () => { if (state.draft) speak(ctx.agentId, state.draft.readback || ''); });

			panel.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('change', () => onToggle(el.dataset.toggle, el.checked)));
			panel.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', () => onTest(b.dataset.test)));
			panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => onDelete(b.dataset.del)));

			panel.querySelector('#wi-ask-btn')?.addEventListener('click', onAsk);
			panel.querySelector('#wi-ask')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onAsk(); });
			panel.querySelectorAll('[data-speak]').forEach((b) => b.addEventListener('click', () => {
				const m = state.copilot.find((x) => String(x.i) === b.dataset.i); if (m) speak(ctx.agentId, m.text);
			}));
		}

		async function onCompile() {
			const text = (panel.querySelector('#wi-src')?.value || '').trim();
			if (!text) { ctx.toast('Describe a rule first.'); return; }
			state.compiling = true; state.composer = text; state.clarify = null; render();
			const res = await call(base('compile'), { method: 'POST', body: { text } });
			if (destroyed) return;
			state.compiling = false;
			if (!res.ok) { ctx.toast(res.message || 'Could not compile'); render(); return; }
			const d = res.data;
			if (!d.ok) {
				if (d.error === 'clarify' || d.clarify) { state.clarify = d.clarify || d.message; state.draft = null; }
				else { ctx.toast(d.message || 'I couldn’t turn that into a rule'); state.draft = null; }
				render(); return;
			}
			state.draft = d; state.clarify = null; state.publishTrait = false; render();
		}

		async function onArm() {
			const d = state.draft; if (!d) return;
			// A SOL destination that's still a name shouldn't reach arm — the server resolved it at compile.
			const dest = d.intent.action?.destination;
			if (dest && !SOL_ADDR_RE.test(dest) && !d.intent.action?.to_tipper) { ctx.toast('That destination didn’t resolve — edit the rule.'); return; }
			const btn = panel.querySelector('#wi-arm'); if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="wi-spin" aria-hidden="true"></span>Arming…'; }
			const res = await call(base(), { method: 'POST', body: { intent: d.intent, source_text: state.composer, public_trait: state.publishTrait, } });
			if (destroyed) return;
			if (!res.ok) { ctx.toast(res.message || 'Could not arm'); render(); return; }
			state.draft = null; state.composer = ''; state.clarify = null;
			ctx.toast('Armed — your wallet will act on it for real.');
			await load();
		}

		async function onToggle(id, enabled) {
			const res = await call(`${base().split('?')[0]}/${id}?network=${ctx.getNetwork()}`, { method: 'PUT', body: { enabled } });
			if (destroyed) return;
			if (!res.ok) { ctx.toast(res.message || 'Update failed'); await load(); return; }
			ctx.toast(enabled ? 'Armed.' : 'Paused.');
			await load();
		}

		async function onTest(id) {
			ctx.toast('Simulating…');
			const res = await call(base('run'), { method: 'POST', body: { intent_id: id, dry_run: true } });
			if (destroyed) return;
			if (!res.ok) { ctx.toast(res.message || 'Test failed'); return; }
			const r = (res.data.results || [])[0];
			if (r) ctx.toast(r.note || `Would ${r.status}.`, 3600);
			else ctx.toast('Nothing would happen right now.');
		}

		async function onDelete(id) {
			const it = state.intents.find((x) => x.id === id);
			if (it && !window.confirm(`Delete “${it.title}”? This can’t be undone.`)) return;
			const res = await call(`${base().split('?')[0]}/${id}?network=${ctx.getNetwork()}`, { method: 'DELETE' });
			if (destroyed) return;
			if (!res.ok) { ctx.toast(res.message || 'Delete failed'); return; }
			ctx.toast('Deleted.');
			await load();
		}

		let askIdx = 0;
		async function onAsk() {
			const el = panel.querySelector('#wi-ask');
			const q = (el?.value || '').trim(); if (!q) return;
			state.copilot.push({ role: 'user', text: q, i: askIdx++ });
			state.asking = true; render();
			const res = await call(base('copilot'), { method: 'POST', body: { message: q } });
			if (destroyed) return;
			state.asking = false;
			const reply = res.ok ? (res.data.reply || 'I’m not sure right now.') : (res.message || 'I couldn’t reach the ledger just now.');
			state.copilot.push({ role: 'bot', text: reply, i: askIdx++ });
			render();
		}

		load();
		return { destroy() { destroyed = true; } };
	},
});

// Local helpers (kept in-file so the tab is a single drop-in).
function labelTrigger(t) {
	return {
		on_tip_received: 'On a tip', on_income: 'On income', on_balance_below: 'On low balance',
		on_schedule: 'On schedule', on_launch_matching: 'On matching launch', on_stream_started: 'On stream start',
		on_mail_received: 'On new email',
	}[t] || t;
}
function timeAgo(iso) {
	if (!iso) return '';
	const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}
