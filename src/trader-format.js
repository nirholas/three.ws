/**
 * Shared formatting + presentation helpers for the trader surfaces
 * (leaderboard, profile, PnL card). Pure, dependency-free, safe to import in any
 * browser module. Centralized so the leaderboard row and the profile header can
 * never render the same number two different ways.
 */

import { shortAddress as shortAddr } from './shared/address.js';

const SOL = '◎';

export function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => (
		{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
	));
}

/** Compact number: 1234 → "1.2K", 1_500_000 → "1.5M". */
export function compact(n) {
	const v = Number(n) || 0;
	const abs = Math.abs(v);
	if (abs >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
	if (abs >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
	if (abs >= 1e3) return (v / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'K';
	return String(Math.round(v * 100) / 100);
}

/** Signed SOL with the ◎ glyph: 2.013 → "+2.01 ◎". */
export function fmtSol(n, { sign = true } = {}) {
	const v = Number(n) || 0;
	const s = sign && v > 0 ? '+' : '';
	const mag = Math.abs(v);
	const body = mag >= 1000 ? compact(mag) : mag.toFixed(mag >= 1 ? 2 : 3);
	return `${s}${v < 0 ? '−' : ''}${body} ${SOL}`;
}

/** Signed USD: 401.2 → "+$401". */
export function fmtUsd(n, { sign = true } = {}) {
	if (n == null) return '';
	const v = Number(n) || 0;
	const s = sign && v > 0 ? '+' : v < 0 ? '−' : '';
	const abs = Math.abs(v);
	const body = abs >= 1000 ? '$' + compact(abs) : '$' + abs.toFixed(abs < 1 ? 2 : 0);
	return `${s}${body}`;
}

/** Percent: 50.25 → "50.3%" (or "+50.3%" when signed). */
export function fmtPct(n, { sign = false, dp = 1 } = {}) {
	if (n == null) return '—';
	const v = Number(n) || 0;
	const s = sign && v > 0 ? '+' : v < 0 ? '−' : '';
	return `${s}${Math.abs(v).toFixed(dp)}%`;
}

/** Tailwind-free semantic class for a signed value. */
export function pnlClass(n) {
	const v = Number(n) || 0;
	return v > 0 ? 'lb-pos' : v < 0 ? 'lb-neg' : 'lb-muted';
}

/** Short pubkey: "7xKq…WtUK". */
export { shortAddr };

/** Human hold duration from seconds: 10 → "10s", 125 → "2m", 5400 → "1.5h". */
export function holdTime(seconds) {
	const s = Number(seconds) || 0;
	if (s < 60) return `${Math.round(s)}s`;
	if (s < 3600) return `${Math.round(s / 60)}m`;
	if (s < 86400) return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)}h`;
	return `${(s / 86400).toFixed(1)}d`;
}

/** Relative time: "just now", "3m ago", "2h ago", "5d ago". */
export function relTime(iso) {
	if (!iso) return '';
	const then = new Date(iso).getTime();
	if (!Number.isFinite(then)) return '';
	const diff = Math.max(0, Date.now() - then) / 1000;
	if (diff < 45) return 'just now';
	if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
	return `${Math.round(diff / 86400)}d ago`;
}

/**
 * Deterministic SVG identicon data-URI from a seed string. The visual fingerprint
 * for any trader without a profile image — stable per agent, never a blank void.
 */
export function identicon(seed) {
	let h = 2166136261;
	for (let i = 0; i < String(seed).length; i++) {
		h ^= String(seed).charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const hue = Math.abs(h) % 360;
	const hue2 = (hue + 140) % 360;
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>
		<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
		<stop offset='0' stop-color='hsl(${hue} 65% 55%)'/>
		<stop offset='1' stop-color='hsl(${hue2} 60% 38%)'/></linearGradient></defs>
		<rect width='64' height='64' fill='url(#g)'/>
		<circle cx='${20 + (Math.abs(h >> 3) % 24)}' cy='${20 + (Math.abs(h >> 7) % 24)}' r='12' fill='rgba(255,255,255,0.18)'/>
	</svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const CHECK_SVG = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 0.5l1.9 1.4 2.3-.3 1 2.1 2.1 1-.3 2.3 1.4 1.9-1.4 1.9.3 2.3-2.1 1-1 2.1-2.3-.3L8 15.5l-1.9-1.4-2.3.3-1-2.1-2.1-1 .3-2.3L-0.5 8l1.4-1.9-.3-2.3 2.1-1 1-2.1 2.3.3z" fill="currentColor" opacity="0.18"/><path d="M5.2 8.1l1.9 1.9 3.7-3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Verified badge markup (only when verified). */
export function verifiedBadge(verified, label = 'Verified track record') {
	if (!verified) return '';
	return `<span class="lb-verified" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${CHECK_SVG}</span>`;
}

/**
 * Signature-coin chip — the token a trader made (or lost) the most on. `coin` is a
 * `top_coin` object from the trader-stats truth layer ({ mint, symbol, name,
 * pnl_sol, roi_pct, … }). Renders the ticker + signed realized P&L, tinted by
 * direction. Returns '' when there is nothing to show, so callers can drop it in
 * unconditionally. `compact:true` omits the "made on" lead-in for tight rows.
 */
export function signatureCoin(coin, { compact = false } = {}) {
	if (!coin || (!coin.symbol && !coin.name && !coin.mint)) return '';
	const label = escapeHtml(coin.symbol || coin.name || shortAddr(coin.mint, 4, 4));
	const cls = pnlClass(coin.pnl_sol);
	const pnl = fmtSol(coin.pnl_sol);
	const lead = compact ? '' : '<span class="sig-coin-lead">made on</span>';
	const verb = coin.pnl_sol >= 0 ? 'best coin' : 'biggest hit';
	return `<span class="sig-coin ${cls}" title="${verb}: ${label} · ${escapeHtml(pnl)} realized${coin.roi_pct != null ? ` · ${coin.roi_pct > 0 ? '+' : ''}${coin.roi_pct}% ROI` : ''}">${lead}<span class="sig-coin-sym">${label}</span><span class="sig-coin-pnl">${escapeHtml(pnl)}</span></span>`;
}

/**
 * Compact P&L sparkline from a cumulative-realized-equity series (SOL, oldest→
 * newest — the `pnl_series` the trader-stats truth layer ships on every board row
 * and profile). Draws the shape of the run in a tiny inline SVG: a line + soft
 * area fill, a dashed break-even baseline, and a pulsing end-dot at the latest
 * point. Green when the trader is up on the window, red when down. Returns a muted
 * "no trend yet" placeholder under two closed trades so a new trader's row is never
 * a jarring empty cell. Purely presentational — every number is still proven in the
 * row's headline P&L and on-chain on the profile.
 *
 * @param {number[]} series cumulative realized SOL, oldest→newest
 * @param {{ w?: number, h?: number, label?: string }} [opts]
 */
export function pnlSparkline(series, { w = 68, h = 22, label = 'P&L trend' } = {}) {
	const pts = Array.isArray(series) ? series.filter((v) => Number.isFinite(v)) : [];
	if (pts.length < 2) {
		return `<span class="lb-spark lb-spark--empty" aria-hidden="true"><span class="lb-spark-flat"></span></span>`;
	}
	const data = [0, ...pts]; // anchor the curve at break-even so direction reads honestly
	const min = Math.min(...data), max = Math.max(...data);
	const range = (max - min) || 1;
	const pad = 2;
	const x = (i) => pad + (i / (data.length - 1)) * (w - pad * 2);
	const y = (v) => h - pad - ((v - min) / range) * (h - pad * 2);
	const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
	const last = data[data.length - 1];
	const up = last >= 0;
	const stroke = up ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)';
	const area = `${line} L${x(data.length - 1).toFixed(1)} ${(h - pad).toFixed(1)} L${x(0).toFixed(1)} ${(h - pad).toFixed(1)} Z`;
	const zeroY = y(0).toFixed(1);
	const ex = x(data.length - 1).toFixed(1), ey = y(last).toFixed(1);
	const gid = `sp${Math.abs(Math.round(last * 1e4))}${data.length}`;
	return `<span class="lb-spark ${up ? 'is-up' : 'is-down'}" role="img" aria-label="${escapeHtml(label)}: ${up ? 'up' : 'down'} over the window">
		<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">
			<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="${stroke}" stop-opacity="0.22"/>
				<stop offset="1" stop-color="${stroke}" stop-opacity="0"/>
			</linearGradient></defs>
			<line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" opacity="0.28"/>
			<path d="${area}" fill="url(#${gid})"/>
			<path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
			<circle class="lb-spark-dot" cx="${ex}" cy="${ey}" r="1.9" fill="${stroke}"/>
		</svg>
	</span>`;
}

export { SOL };
