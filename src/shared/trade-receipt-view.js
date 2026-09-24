/**
 * Trade receipt renderer: one HTML string builder for the "why it traded" view.
 *
 * Pure (no DOM, no fetch), so the same markup renders in the /trader/:id drawer
 * (browser) and server-side in the /trade/:id share page (api/trade-share.js).
 * Input is the model from api/_lib/trade-receipt.js, served at
 * /api/sniper/receipt?id=<position uuid>.
 *
 * Styling ships as RECEIPT_CSS beside the markup. Its colors resolve through the
 * host page's own tokens (--stroke/--surface-2 on the app shell, --line/--panel
 * on the standalone share page) with literal fallbacks, so it matches either.
 */

import { escapeHtml as esc } from '../trader-format.js';

const TIMING_LABEL = {
	before_entry: 'before entry',
	during_trade: 'seen while holding',
};

const CHECK_LABEL = {
	mint_authority: 'Mint authority',
	venue: 'Venue',
	round_trip: 'Buy/sell round-trip',
	concentration: 'Holder concentration',
	price_impact: 'Price impact',
	smart_money: 'Smart money',
	dev_behavior: 'Dev behavior',
	liquidity: 'Liquidity',
};

const PILLARS = ['pedigree', 'structure', 'narrative', 'momentum'];

function sol(v, { sign = true } = {}) {
	if (v == null || !Number.isFinite(Number(v))) return null;
	const n = Number(v);
	const abs = Math.abs(n);
	const body = abs !== 0 && abs < 0.0005 ? '<0.001' : abs.toFixed(abs >= 100 ? 1 : 3);
	const mark = sign ? (n > 0 ? '+' : n < 0 ? '-' : '') : '';
	return `${mark}${body} SOL`;
}

function pct(v, { sign = false, dp = 1 } = {}) {
	if (v == null || !Number.isFinite(Number(v))) return null;
	const n = Number(v);
	const mark = sign ? (n > 0 ? '+' : n < 0 ? '-' : '') : n < 0 ? '-' : '';
	return `${mark}${Math.abs(n).toFixed(dp)}%`;
}

/** A 0..1 ratio or an already-scaled 0..100 value, as a percent string. */
function ratioPct(v) {
	if (v == null || !Number.isFinite(Number(v))) return null;
	const n = Number(v);
	return pct(n <= 1 ? n * 100 : n, { dp: 0 });
}

/** Offset of a timestamp from the entry, as "+0.4s" / "-3m" / "+2h". */
export function offsetFromEntry(at, openedAt) {
	const a = new Date(at).getTime();
	const o = new Date(openedAt).getTime();
	if (!Number.isFinite(a) || !Number.isFinite(o)) return '';
	const d = (a - o) / 1000;
	const mark = d < 0 ? '-' : '+';
	const s = Math.abs(d);
	if (s < 10) return `${mark}${s.toFixed(1)}s`;
	if (s < 90) return `${mark}${Math.round(s)}s`;
	if (s < 5400) return `${mark}${Math.round(s / 60)}m`;
	return `${mark}${Math.round(s / 3600)}h`;
}

function timingChip(timing, at, openedAt) {
	if (!timing) return '';
	const off = at ? offsetFromEntry(at, openedAt) : '';
	return `<span class="rc-when rc-when-${esc(timing)}" title="${esc(at || '')}">${esc(TIMING_LABEL[timing] || timing)}${off ? ` · ${esc(off)}` : ''}</span>`;
}

function statusTone(status) {
	if (status === 'pass' || status === 'allow' || status === 'none') return 'ok';
	if (status === 'warn' || status === 'caution') return 'warn';
	if (status === 'fail' || status === 'block' || status === 'deny') return 'bad';
	return 'muted';
}

function link(href, label) {
	if (!href) return '';
	return `<a class="rc-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">&#8599;</span></a>`;
}

function card(title, whenHtml, body) {
	return `<section class="rc-card">
		<header class="rc-card-head"><h4>${esc(title)}</h4>${whenHtml}</header>
		${body}
	</section>`;
}

function kv(pairs) {
	const rows = pairs.filter(([, v]) => v != null && v !== '');
	if (!rows.length) return '';
	return `<dl class="rc-kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function oracleCard(o, openedAt) {
	const bars = PILLARS.filter((k) => o.pillars[k] != null).map((k) => {
		const v = Math.max(0, Math.min(100, o.pillars[k]));
		return `<div class="rc-bar"><span class="rc-bar-k">${esc(k)}</span><span class="rc-bar-track" role="img" aria-label="${esc(k)} ${v} of 100"><span class="rc-bar-fill" style="width:${v}%"></span></span><span class="rc-bar-v">${v}</span></div>`;
	}).join('');
	const reasons = o.reasons.length
		? `<ul class="rc-list">${o.reasons.map((r) => {
			const tone = r.lift == null ? 'muted' : r.lift >= 1.2 ? 'ok' : r.lift <= 0.8 ? 'bad' : 'muted';
			return `<li><span class="rc-dot rc-${tone}" aria-hidden="true"></span>${esc(r.text)}</li>`;
		}).join('')}</ul>`
		: '';
	const head = o.score != null ? `<p class="rc-big">${o.score}<small>/100${o.tier ? ` · ${esc(o.tier)}` : ''}</small></p>` : '';
	const body = `${head}${bars ? `<div class="rc-bars">${bars}</div>` : ''}
		${kv([['Rug risk', o.rug_risk != null ? `${o.rug_risk}/100` : null], ['Upside', o.upside != null ? `${o.upside}/100` : null], ['Give-back risk', o.give_back_risk != null ? `${o.give_back_risk}/100` : null]])}
		${reasons ? `<p class="rc-sub">What moved the score, against the base rate of similar launches:</p>${reasons}` : ''}`;
	return card('Oracle conviction', timingChip(o.timing, o.scored_at, openedAt), body);
}

function firewallCard(f, openedAt) {
	const checks = f.checks.length
		? `<ul class="rc-checks">${f.checks.map((c) => `<li class="rc-${statusTone(c.status)}"><span class="rc-dot" aria-hidden="true"></span><span>${esc(CHECK_LABEL[c.name] || c.name.replace(/_/g, ' '))}</span><span class="rc-check-s">${esc(c.status || '')}</span></li>`).join('')}</ul>`
		: '';
	const reasons = f.reasons.length ? `<ul class="rc-list rc-plain">${f.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '';
	const verdict = f.verdict ? `<span class="rc-pill rc-${statusTone(f.verdict)}">${esc(f.verdict)}</span>` : '';
	const body = `<p class="rc-line">${verdict}${f.score != null ? ` <span class="rc-dim">score ${f.score}/100</span>` : ''}${f.simulated ? ' <span class="rc-dim">· simulated on-chain before buying</span>' : ''}</p>${checks}${reasons}`;
	return card('Trade firewall', timingChip(f.timing, f.at, openedAt), body);
}

function judgeCard(j, openedAt) {
	const conf = j.confidence != null ? pct(j.confidence * 100, { dp: 0 }) : null;
	const body = `<p class="rc-line"><span class="rc-pill rc-${j.buy ? 'ok' : 'bad'}">${j.buy ? 'buy' : 'skip'}</span>${conf ? ` <span class="rc-dim">${esc(conf)} confidence</span>` : ''}</p>
		${j.thesis ? `<blockquote class="rc-quote">${esc(j.thesis)}</blockquote>` : ''}
		${j.model ? `<p class="rc-foot">Model: ${esc(j.model)}</p>` : ''}`;
	return card('LLM judge', timingChip(j.timing, j.at, openedAt), body);
}

function riskCard(r, openedAt) {
	const size = r.adjusted_sol != null && r.proposed_sol != null && r.adjusted_sol < r.proposed_sol
		? `Suggested ${sol(r.adjusted_sol, { sign: false })} instead of ${sol(r.proposed_sol, { sign: false })}`
		: null;
	const mode = r.enforced ? 'enforced' : r.level === 'shadow' ? 'shadow (recorded, not enforced)' : r.level;
	const body = `<p class="rc-line"><span class="rc-pill rc-${statusTone(r.severity)}">${esc(r.severity || 'none')}</span>${r.veto ? ' <span class="rc-dim">veto</span>' : ''}</p>
		${kv([['Mode', mode], ['Size', size]])}
		${r.reasons.length ? `<ul class="rc-list rc-plain">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
	return card('Risk Officer', timingChip(r.timing, r.at, openedAt), body);
}

function sentimentCard(s, openedAt) {
	const tone = s.signal === 'bullish' ? 'ok' : s.signal === 'bearish' ? 'bad' : 'muted';
	const conf = s.confidence != null ? pct(s.confidence * 100, { dp: 0 }) : null;
	const body = `<p class="rc-line">${s.signal ? `<span class="rc-pill rc-${tone}">${esc(s.signal)}</span>` : ''}${conf ? ` <span class="rc-dim">${esc(conf)} confidence</span>` : ''}${s.sentiment_adj ? ` <span class="rc-dim">· moved the buy bar ${s.sentiment_adj > 0 ? '+' : ''}${s.sentiment_adj} pts</span>` : ''}</p>
		${s.headline ? `<p class="rc-text">${esc(s.headline)}</p>` : ''}
		<p class="rc-foot">Paid market read over x402. ${link(s.receipt_url, 'Payment tx')}</p>`;
	return card('Market sentiment', timingChip(s.timing, s.at, openedAt), body);
}

function tokenRiskCard(t, openedAt) {
	const tone = t.rejected ? 'bad' : t.risk_level === 'low' ? 'ok' : t.risk_level === 'high' || t.risk_level === 'critical' ? 'bad' : 'warn';
	const body = `<p class="rc-line">${t.risk_level ? `<span class="rc-pill rc-${tone}">${esc(t.risk_level)} risk</span>` : ''}${t.rugpull_score != null ? ` <span class="rc-dim">rug-pull score ${t.rugpull_score}/100</span>` : ''}</p>
		<p class="rc-foot">Paid rug-pull check over x402. ${link(t.receipt_url, 'Payment tx')}</p>`;
	return card('Rug-pull check', timingChip(t.timing, t.at, openedAt), body);
}

function intelCard(i, openedAt) {
	const body = `${kv([
		['Launch quality', i.quality_score != null ? `${i.quality_score}/100` : null],
		['Category', i.category ? `${i.category}${i.is_news_meme ? ' · news meme' : ''}` : null],
		['Top 10 holders', ratioPct(i.concentration_top10)],
		['Organic buying', ratioPct(i.organic_score)],
		['Unique buyers', i.unique_buyers],
		['Smart wallets in', i.smart_money_count],
	])}
		${i.risk_flags.length ? `<p class="rc-line">${i.risk_flags.map((f) => `<span class="rc-pill rc-warn">${esc(String(f).replace(/_/g, ' '))}</span>`).join(' ')}</p>` : ''}
		${i.narrative ? `<p class="rc-text">${esc(i.narrative)}</p>` : ''}`;
	return card('Launch intel', timingChip(i.timing, i.observed_at, openedAt), body);
}

function legsHTML(legs, openedAt) {
	if (!legs.length) return '';
	return `<ol class="rc-legs">${legs.map((l) => {
		const pnl = l.leg_pnl_sol != null ? `<span class="rc-${l.leg_pnl_sol > 0 ? 'ok' : l.leg_pnl_sol < 0 ? 'bad' : 'muted'}-t">${esc(sol(l.leg_pnl_sol))}</span>` : '';
		const frac = l.sold_fraction != null && l.sold_fraction > 0 && l.sold_fraction < 1 ? ` <span class="rc-dim">sold ${esc(pct(l.sold_fraction * 100, { dp: 0 }))}</span>` : '';
		return `<li>
			<div class="rc-leg-head"><strong>${esc(l.label)}</strong><span class="rc-dim">${esc(offsetFromEntry(l.at, openedAt))}</span>${frac}${pnl ? ` ${pnl}` : ''}${link(l.tx_url, 'tx')}</div>
			${l.rationale ? `<p class="rc-text">${esc(l.rationale)}</p>` : ''}
		</li>`;
	}).join('')}</ol>`;
}

/**
 * The full receipt.
 *
 * @param {object} r  receipt from /api/sniper/receipt
 * @param {{ showLinks?: boolean }} [opts]  showLinks adds the share-page and
 *   track-record links (off on the share page itself, which already has them)
 */
export function receiptHTML(r, { showLinks = true } = {}) {
	const p = r.position;
	const e = r.evidence;
	const opened = p.opened_at;
	const cards = [
		e.oracle && oracleCard(e.oracle, opened),
		e.firewall && firewallCard(e.firewall, opened),
		e.judge && judgeCard(e.judge, opened),
		e.risk_review && riskCard(e.risk_review, opened),
		e.sentiment && sentimentCard(e.sentiment, opened),
		e.token_risk && tokenRiskCard(e.token_risk, opened),
		e.intel && intelCard(e.intel, opened),
	].filter(Boolean);
	const evidence = cards.length
		? `<div class="rc-grid">${cards.join('')}</div>`
		: `<p class="rc-empty">No gate recorded evidence for this entry. Older trades predate the decision log, and a fresh-launch snipe is scored on the launch itself before any market data exists. The legs below are still the full on-chain record.</p>`;
	const links = showLinks
		? `<p class="rc-actions">${p.share_url ? `<a class="rc-link" href="${esc(p.share_url)}">Open this trade's page</a>` : ''}${link(p.token_url, 'Token on Solscan')}</p>`
		: '';
	return `<div class="rc">
		<p class="rc-summary">${esc(r.summary)}</p>
		<p class="rc-trigger"><span class="rc-pill rc-muted">${esc(r.trigger.label)}</span>${r.trigger.detail ? ` ${esc(r.trigger.detail)}` : ''}${p.paper ? ' <span class="rc-pill rc-warn">paper fill</span>' : ''}</p>
		${evidence}
		${r.legs.length ? `<h4 class="rc-h">Every leg</h4>${legsHTML(r.legs, opened)}` : ''}
		<p class="rc-note">This is what the engine recorded at decision time. Evidence logged after the exit is left out, because it cannot have caused the trade.</p>
		${links}
	</div>`;
}

/** Skeleton shown while a receipt loads. */
export function receiptSkeletonHTML() {
	return `<div class="rc rc-loading" aria-busy="true" aria-label="Loading the evidence for this trade">
		<span class="rc-sk" style="width:70%"></span>
		<div class="rc-grid"><span class="rc-sk rc-sk-card"></span><span class="rc-sk rc-sk-card"></span><span class="rc-sk rc-sk-card"></span></div>
	</div>`;
}

export const RECEIPT_CSS = `
.rc{--rc-ink:var(--ink-bright,var(--ink,#f9fafb));--rc-dim:var(--ink-dim,#9ca3af);--rc-faint:var(--ink-faint,#6b7280);
	--rc-line:var(--stroke,var(--line,#1f2937));--rc-panel:var(--surface-2,var(--panel,#0e1015));
	--rc-ok:var(--success,#34d399);--rc-bad:var(--danger,#f87171);--rc-warn:var(--warn,#fbbf24);
	text-align:left;color:var(--rc-dim);font-size:13px;line-height:1.55;padding:6px 2px 10px;
	animation:rc-in .22s ease-out}
@keyframes rc-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.rc p{margin:0}
.rc-summary{color:var(--rc-ink);font-size:14px;font-weight:600;margin-bottom:8px!important}
.rc-trigger{margin-bottom:12px!important}
.rc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.rc-card{border:1px solid var(--rc-line);border-radius:12px;background:var(--rc-panel);padding:12px 14px;min-width:0;
	transition:border-color .15s ease}
.rc-card:hover{border-color:var(--rc-dim)}
.rc-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.rc-card-head h4,.rc-h{margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--rc-faint)}
.rc-h{margin:16px 0 8px}
.rc-when{font-size:11px;color:var(--rc-faint);white-space:nowrap}
.rc-when-during_trade{color:var(--rc-warn)}
.rc-big{font-size:26px;font-weight:800;color:var(--rc-ink);line-height:1.1;margin-bottom:8px!important}
.rc-big small{font-size:12px;font-weight:600;color:var(--rc-faint);margin-left:2px}
.rc-bars{display:grid;gap:4px;margin-bottom:8px}
.rc-bar{display:grid;grid-template-columns:72px 1fr 26px;align-items:center;gap:8px;font-size:11px}
.rc-bar-k{text-transform:capitalize;color:var(--rc-faint)}
.rc-bar-track{height:6px;border-radius:3px;background:var(--rc-line);overflow:hidden}
.rc-bar-fill{display:block;height:100%;border-radius:3px;background:color-mix(in srgb,var(--rc-ink) 72%,transparent)}
.rc-bar-v{text-align:right;color:var(--rc-dim);font-variant-numeric:tabular-nums}
.rc-kv{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin:0 0 6px}
.rc-kv div{min-width:0}
.rc-kv dt{font-size:11px;color:var(--rc-faint);margin:0}
.rc-kv dd{margin:0;color:var(--rc-ink);font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.rc-sub{font-size:12px;color:var(--rc-faint);margin:6px 0 4px!important}
.rc-list{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.rc-list li{display:flex;gap:8px;align-items:baseline;overflow-wrap:anywhere}
.rc-plain li::before{content:"";flex:none;width:4px;height:4px;border-radius:50%;background:var(--rc-faint);transform:translateY(-2px)}
.rc-checks{list-style:none;margin:6px 0;padding:0;display:grid;gap:3px}
.rc-checks li{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:center}
.rc-check-s{font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.rc-dot{width:7px;height:7px;border-radius:50%;background:var(--rc-faint);flex:none}
.rc-ok .rc-dot,.rc-dot.rc-ok{background:var(--rc-ok)} .rc-warn .rc-dot,.rc-dot.rc-warn{background:var(--rc-warn)}
.rc-bad .rc-dot,.rc-dot.rc-bad{background:var(--rc-bad)}
.rc-checks .rc-ok .rc-check-s{color:var(--rc-ok)} .rc-checks .rc-warn .rc-check-s{color:var(--rc-warn)} .rc-checks .rc-bad .rc-check-s{color:var(--rc-bad)}
.rc-pill{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;
	border-radius:999px;border:1px solid var(--rc-line);color:var(--rc-dim)}
.rc-pill.rc-ok{color:var(--rc-ok);border-color:color-mix(in srgb,var(--rc-ok) 40%,transparent)}
.rc-pill.rc-warn{color:var(--rc-warn);border-color:color-mix(in srgb,var(--rc-warn) 40%,transparent)}
.rc-pill.rc-bad{color:var(--rc-bad);border-color:color-mix(in srgb,var(--rc-bad) 40%,transparent)}
.rc-ok-t{color:var(--rc-ok)} .rc-bad-t{color:var(--rc-bad)} .rc-muted-t{color:var(--rc-dim)}
.rc-line{margin-bottom:6px!important}
.rc-dim{color:var(--rc-faint);font-size:12px}
.rc-text{color:var(--rc-dim);overflow-wrap:anywhere}
.rc-quote{margin:6px 0;padding:6px 10px;border-left:2px solid var(--rc-dim);color:var(--rc-ink);font-style:italic}
.rc-foot{font-size:11px;color:var(--rc-faint);margin-top:6px!important}
.rc-legs{list-style:none;margin:0;padding:0 0 0 14px;border-left:1px solid var(--rc-line);display:grid;gap:8px}
.rc-legs li{position:relative}
.rc-legs li::before{content:"";position:absolute;left:-18px;top:6px;width:7px;height:7px;border-radius:50%;background:var(--rc-dim)}
.rc-leg-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;color:var(--rc-ink)}
.rc-link{color:var(--rc-dim);text-decoration:none;border-bottom:1px dotted var(--rc-faint);white-space:nowrap;font-size:12px;
	transition:color .15s ease}
.rc-link:hover,.rc-link:focus-visible{color:var(--rc-ink)}
.rc-link:focus-visible{outline:2px solid var(--accent,#34d399);outline-offset:2px;border-radius:2px}
.rc-note{font-size:11px;color:var(--rc-faint);margin-top:12px!important}
.rc-actions{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px!important}
.rc-empty{border:1px dashed var(--rc-line);border-radius:12px;padding:12px 14px}
.rc-sk{display:block;height:14px;border-radius:6px;margin-bottom:10px;
	background:linear-gradient(90deg,var(--rc-line) 25%,var(--rc-panel) 50%,var(--rc-line) 75%);background-size:200% 100%;
	animation:rc-sk 1.2s linear infinite}
.rc-sk-card{height:120px;border-radius:12px;margin:0}
@keyframes rc-sk{from{background-position:200% 0}to{background-position:-200% 0}}
@media (max-width:520px){.rc-kv{grid-template-columns:1fr}.rc-grid{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.rc,.rc-sk{animation:none}.rc-card,.rc-link{transition:none}}
`;
