/**
 * Wallet-layer formatting — the single source of truth for how the wallet program
 * renders money and addresses. Every wallet surface (chip, HUD, net-worth presence,
 * tip modal) routes through these so the SAME value reads identically everywhere:
 * a compact USD figure in the chip matches the compact figure in the presence bar,
 * and an address is shortened the same way on every card.
 *
 * Two USD tiers exist by design:
 *  - `formatWalletUsd` (here)        — compact, for dense chrome (chips, inline rows).
 *  - `formatNetWorth`  (wallet-networth.js) — precise, for the hero net-worth number
 *    ($1,500 / $2.00M). Do not collapse the two; they serve different densities.
 */

/**
 * Compact USD label: $0, <$0.01, $9.40, $950, $1.2K, $3.4M, $1.1B.
 * Returns null for non-finite input so callers can omit the figure entirely.
 */
export function formatWalletUsd(n) {
	if (n == null || !Number.isFinite(n)) return null;
	if (n <= 0) return '$0';
	if (n < 0.01) return '<$0.01';
	if (n < 10) return `$${n.toFixed(2)}`;
	if (n < 1000) return `$${Math.round(n)}`;
	if (n < 1e6) return `$${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
	if (n < 1e9) return `$${(n / 1e6).toFixed(1)}M`;
	return `$${(n / 1e9).toFixed(1)}B`;
}

/**
 * Same compact USD tier as `formatWalletUsd`, but never null — coerces a
 * missing/NaN value to `$0`. Use where the UI must always show a figure.
 */
export function formatWalletUsdSafe(n) {
	const v = Number(n);
	return formatWalletUsd(Number.isFinite(v) ? v : 0) ?? '$0';
}

export { shortAddress } from './address.js';
