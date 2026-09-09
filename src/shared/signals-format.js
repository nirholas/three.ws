/**
 * Display helpers shared by the Signal Marketplace directory (/signals) and a
 * feed's detail page (/signals/:slug).
 *
 * Both surfaces render the same three things and used to render them twice, one
 * copy each, which is how they drifted: a feed priced at 12.345678 USDC printed
 * its raw float on both pages, and a publisher with no profile image got an
 * empty grey square because the identicon data-URI was assigned to a CSS
 * `background` shorthand that cannot take a bare URL. One module, one answer.
 */

import { escapeHtml, identicon } from '../trader-format.js';

const usdcFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const usdcSubUnitFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

/**
 * A USDC amount as a reader sees money: grouped thousands, at most two decimals,
 * and no trailing zeros. Sub-cent prices are real here (a feed can charge
 * 0.0005 USDC a signal), so anything under 1 keeps up to six decimals rather
 * than rounding away the entire price.
 */
export function fmtUsdc(value) {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return '0';
	return n < 1 ? usdcSubUnitFmt.format(n) : usdcFmt.format(n);
}

/** A billing epoch in the shortest honest unit: 86400 -> "day", 900 -> "15m". */
export function epochLabel(seconds) {
	const sec = Number(seconds);
	if (!Number.isFinite(sec) || sec <= 0) return 'epoch';
	if (sec % 86400 === 0) { const d = sec / 86400; return d === 1 ? 'day' : `${d}d`; }
	if (sec % 3600 === 0) { const h = sec / 3600; return h === 1 ? 'hour' : `${h}h`; }
	return `${Math.round(sec / 60)}m`;
}

/**
 * The publisher's avatar as an <img>, always.
 *
 * identicon() returns a data-URI meant for an `src`, so the fallback has to be
 * an image too: rendering it into `style="background:..."` silently produced no
 * image at all. A profile URL that 404s swaps to the identicon through
 * /inline-behaviors.js (data-fallback-src) instead of leaving a broken glyph.
 */
export function publisherAvatarHtml(publisher, cls = 'sm-avatar') {
	const seed = publisher?.agent_id || publisher?.name || '?';
	const fallback = identicon(seed);
	const src = publisher?.image || fallback;
	return `<img class="${cls}" src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" data-fallback-src="${escapeHtml(fallback)}" data-fallback="keep" />`;
}
