// The three assets an agent can invoice, sell, or send in: USDC, SOL and $THREE.
//
// Everything that crosses this module is in base units (atomics) as a BigInt or
// a decimal string, never a float, so 0.1 + 0.2 never ends up on an invoice.
// A decimal amount from a caller is parsed in string space at the asset's
// precision and refused when it carries more digits than the asset can hold.

import { USDC_MINT_BY_NETWORK } from '../custody/builders.js';
import { TOKEN_MINT, TOKEN_DECIMALS } from '../token/config.js';
import { getTokenPriceUsd } from '../token/price.js';
import { solanaMintUsdPrice } from '../balances.js';

export const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112';
export const ASSETS = Object.freeze(['USDC', 'SOL', 'THREE']);
export const NETWORKS = Object.freeze(['mainnet', 'devnet']);

export class CommerceError extends Error {
	constructor(code, message, status = 400, extra = undefined) {
		super(message);
		this.code = code;
		this.status = status;
		this.extra = extra;
	}
}

/** Uppercase an asset name and accept the `$THREE` spelling. */
export function normalizeAsset(raw) {
	const a = String(raw || '').trim().toUpperCase().replace(/^\$/, '');
	if (!ASSETS.includes(a)) throw new CommerceError('invalid_asset', `asset must be one of ${ASSETS.join(', ')}`);
	return a;
}

/**
 * The network a caller may use. Devnet exists for testing and is always open;
 * mainnet is the default.
 */
export function normalizeNetwork(raw) {
	const n = raw == null || raw === '' ? 'mainnet' : String(raw).trim().toLowerCase();
	if (!NETWORKS.includes(n)) throw new CommerceError('invalid_network', `network must be one of ${NETWORKS.join(', ')}`);
	return n;
}

/**
 * Mint, decimals and display symbol for an asset on a network. $THREE trades on
 * mainnet only, so a devnet $THREE invoice is refused rather than pointed at a
 * mint that does not exist there.
 */
export function assetSpec(asset, network) {
	if (asset === 'SOL') return { asset, mint: SOL_NATIVE_MINT, decimals: 9, symbol: 'SOL', native: true };
	if (asset === 'USDC') return { asset, mint: USDC_MINT_BY_NETWORK[network], decimals: 6, symbol: 'USDC', native: false };
	if (asset === 'THREE') {
		if (network !== 'mainnet') {
			throw new CommerceError('asset_unavailable', '$THREE lives on mainnet only. Use USDC or SOL for a devnet invoice.');
		}
		return { asset, mint: TOKEN_MINT, decimals: TOKEN_DECIMALS, symbol: '$THREE', native: false };
	}
	throw new CommerceError('invalid_asset', `asset must be one of ${ASSETS.join(', ')}`);
}

/**
 * Parse a human amount ("12.5", 12.5) into base units. Refuses zero, negatives,
 * exponent notation, and more fractional digits than the asset carries.
 * @returns {bigint}
 */
export function parseAmount(raw, decimals) {
	const s = typeof raw === 'number' ? numberToPlain(raw) : String(raw ?? '').trim();
	if (!/^\d+(\.\d+)?$/.test(s)) throw new CommerceError('invalid_amount', 'amount must be a positive decimal number, like 12.5');
	const [whole, frac = ''] = s.split('.');
	if (frac.length > decimals) {
		throw new CommerceError('invalid_amount', `amount has more than ${decimals} decimal places`);
	}
	const atomics = BigInt(whole + frac.padEnd(decimals, '0'));
	if (atomics <= 0n) throw new CommerceError('invalid_amount', 'amount must be greater than zero');
	if (atomics > 10n ** 30n) throw new CommerceError('invalid_amount', 'amount is too large');
	return atomics;
}

function numberToPlain(n) {
	if (!Number.isFinite(n)) return '';
	// toFixed(18) renders 1e-7 as 0.000000100000000000; trim the noise.
	const s = Math.abs(n) < 1e-6 || Math.abs(n) >= 1e21 ? n.toFixed(18) : String(n);
	return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Base units to an exact decimal string ("1500000", 6 -> "1.5"). */
export function formatAtomics(atomics, decimals) {
	const v = BigInt(atomics);
	const neg = v < 0n;
	const abs = neg ? -v : v;
	const base = 10n ** BigInt(decimals);
	const whole = abs / base;
	const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
	return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * Live USD price of one whole unit of `asset`. USDC is pegged at 1. SOL and
 * $THREE read live prices; a price outage returns null so the caller can decide
 * whether a missing price blocks the action (a spend) or just leaves a field
 * empty (an invoice income figure).
 * @returns {Promise<number|null>}
 */
export async function usdPrice(asset) {
	if (asset === 'USDC') return 1;
	try {
		if (asset === 'SOL') {
			const p = await solanaMintUsdPrice(SOL_NATIVE_MINT);
			return p > 0 ? p : null;
		}
		if (asset === 'THREE') {
			const p = Number((await getTokenPriceUsd())?.priceUsd);
			return Number.isFinite(p) && p > 0 ? p : null;
		}
	} catch {
		return null;
	}
	return null;
}

/** USD value of `atomics` of an asset, or null when no price is available. */
export async function atomicsToUsd(asset, atomics, decimals) {
	const price = await usdPrice(asset);
	if (price == null) return null;
	const units = Number(formatAtomics(atomics, decimals));
	return Math.round(units * price * 1e6) / 1e6;
}
