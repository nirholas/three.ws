// Inspect any endpoint: do an unpaid request, and if it answers 402, decode the
// payment challenge into a readable summary. Selection is dual-rail: the
// extension can satisfy USDC EIP-3009 on EVM (Base + other chains) OR the
// `exact` scheme in USDC/$THREE on Solana. Reachable as a standalone command
// (paste a URL) or from a bazaar item.

import { parseChallenge, amountToUsd, isEip3009Accept } from '../../x402-fetch/src/parse-challenge.js';
import { isSolanaExactAccept, isThreeAccept, isUsdcAccept, tokenLabel } from './solana.js';

const NETWORK_BASE = 'eip155:8453';

/** Which rail settles this accept, or null if this extension can't pay it. */
export function railOf(a) {
	if (isSolanaExactAccept(a)) return 'solana';
	if (isEip3009Accept(a)) return 'evm';
	return null;
}

// Auth-hint placeholders (amount "0" / extra.authRequired) are never payable.
function isNonZero(a) {
	if (!a || typeof a !== 'object') return false;
	if (a.extra?.authRequired != null) return false;
	return String(a.amount ?? a.maxAmountRequired ?? '') !== '0';
}

/**
 * Select the payment requirement to settle across both rails.
 * @param {any[]} accepts
 * @param {{ preferNetwork?: string, preferToken?: 'auto'|'usdc'|'three', wallets?: {evm?:boolean, solana?:boolean} }} [opts]
 */
export function selectRequirement(accepts, { preferNetwork, preferToken, wallets = { evm: true, solana: true } } = {}) {
	const payable = accepts.filter(
		(a) => isNonZero(a) && ((wallets.solana && isSolanaExactAccept(a)) || (wallets.evm && isEip3009Accept(a))),
	);
	if (!payable.length) return null;

	// 1. An explicit CAIP-2 network preference wins (covers eip155:* and solana:*).
	if (preferNetwork) {
		const m = payable.find((a) => a.network === preferNetwork);
		if (m) return m;
	}
	// 2. Explicit token preference.
	if (preferToken === 'three') {
		const m = payable.find(isThreeAccept);
		if (m) return m;
	}
	if (preferToken === 'usdc') {
		const m = payable.find((a) => isUsdcAccept(a));
		if (m) return m;
	}
	// 3. Auto: prefer Solana USDC, then any Solana accept (incl. $THREE),
	//    then Base USDC, then anything payable.
	return (
		payable.find((a) => isSolanaExactAccept(a) && isUsdcAccept(a)) ||
		payable.find((a) => isSolanaExactAccept(a)) ||
		payable.find((a) => a.network === NETWORK_BASE) ||
		payable[0]
	);
}

/**
 * @returns {Promise<{ status:number, paid:boolean, accepts:any[], chosen:any|null, rail:string|null, resource:any, raw:any }>}
 */
export async function inspectEndpoint(url, { method = 'GET', preferNetwork, preferToken, wallets } = {}) {
	const res = await fetch(url, { method, headers: { accept: 'application/json' } });

	if (res.status !== 402) {
		return {
			status: res.status,
			paid: res.status >= 200 && res.status < 300,
			accepts: [],
			chosen: null,
			rail: null,
			resource: null,
			raw: null,
		};
	}

	const parsed = await parseChallenge(res);
	const accepts = parsed?.accepts || [];
	const chosen = selectRequirement(accepts, { preferNetwork, preferToken, wallets });
	return {
		status: 402,
		paid: false,
		accepts,
		chosen,
		rail: chosen ? railOf(chosen) : null,
		resource: parsed?.resource || null,
		raw: parsed?.raw || null,
	};
}

/** Human summary lines for a parsed challenge. */
export function summarize(result) {
	if (result.status !== 402) {
		return [
			`Status: ${result.status}`,
			result.paid
				? 'No payment required — this endpoint answered without a 402.'
				: 'Endpoint did not return a 402 payment challenge.',
		];
	}
	const lines = ['Status: 402 Payment Required', ''];
	result.accepts.forEach((a, i) => {
		const amount = amountToUsd(a);
		const rail = railOf(a);
		const railTag = rail ? ` [${rail}]` : '';
		const mark = a === result.chosen ? ' ← payable by this wallet' : '';
		const token = tokenLabel(a);
		const price = isUsdcAccept(a) ? `$${amount.toFixed(6)} ${token}` : `${amount.toFixed(6)} ${token}`;
		lines.push(`#${i + 1} ${a.network || '?'} · ${a.scheme || 'exact'} · ${price}${railTag}${mark}`);
		if (a.payTo) lines.push(`     payTo: ${a.payTo}`);
	});
	if (!result.chosen) {
		lines.push(
			'',
			'⚠ No requirement this wallet can satisfy. This extension pays USDC EIP-3009 on EVM (Base + other chains) or the exact scheme in USDC/$THREE on Solana — set the matching wallet key.',
		);
	}
	return lines;
}
