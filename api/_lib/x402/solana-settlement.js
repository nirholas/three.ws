// Resolve a Solana settlement signature into payer, payee, mint, and amount
// straight from the transaction's token-balance diff, plus fee, slot and
// time. Ground truth for an x402 payment, independent of whatever the
// settlement response claimed when the payment session recorded it.
//
// Split into a pure parser (testable against recorded/synthetic transaction
// JSON, no network) and a thin async wrapper that fetches the transaction
// over RPC.

import { solanaConnection } from '../solana/connection.js';
import { SOLANA_USDC_MINT } from '../../payments/_config.js';

export class SettlementResolveError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'SettlementResolveError';
		this.code = code;
	}
}

// Mints whose ticker we know without a lookup. $THREE is the platform coin;
// USDC is the asset nearly every x402 settlement moves.
const KNOWN_MINT_SYMBOLS = {
	[SOLANA_USDC_MINT]: 'USDC',
	FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump: 'THREE',
};

/** Ticker for a known mint, or null when the mint isn't one we recognise. */
export function mintSymbol(mint) {
	return KNOWN_MINT_SYMBOLS[mint] || null;
}

function atomicsOf(entry) {
	const raw = entry?.uiTokenAmount?.amount;
	try {
		return BigInt(raw ?? '0');
	} catch {
		return 0n;
	}
}

/**
 * Per-owner, per-mint token balance deltas from a confirmed transaction's
 * `meta`. Positive = the owner received; negative = the owner sent. Several
 * token accounts belonging to the same owner+mint (legal, if rare) are
 * summed into one row.
 *
 * @param {{ preTokenBalances?: Array, postTokenBalances?: Array }} meta
 * @returns {Array<{ owner: string, mint: string, decimals: number, deltaAtomics: bigint }>}
 */
export function tokenBalanceDeltas(meta) {
	const byKey = new Map();
	const rowFor = (entry) => {
		const key = `${entry.owner}:${entry.mint}`;
		let row = byKey.get(key);
		if (!row) {
			row = { owner: entry.owner, mint: entry.mint, decimals: entry.uiTokenAmount?.decimals ?? 0, deltaAtomics: 0n };
			byKey.set(key, row);
		}
		return row;
	};
	for (const p of meta?.preTokenBalances || []) {
		if (!p?.owner || !p?.mint) continue;
		rowFor(p).deltaAtomics -= atomicsOf(p);
	}
	for (const q of meta?.postTokenBalances || []) {
		if (!q?.owner || !q?.mint) continue;
		const row = rowFor(q);
		row.deltaAtomics += atomicsOf(q);
		row.decimals = q.uiTokenAmount?.decimals ?? row.decimals;
	}
	return [...byKey.values()].filter((r) => r.deltaAtomics !== 0n);
}

/**
 * Parse an already-fetched `getTransaction()` result into a settlement
 * record. Pure: never touches the network, so it is unit-testable against
 * recorded or synthetic transaction JSON.
 *
 * A plain x402 settlement moves exactly one mint (USDC), so the common case
 * is unambiguous. A transaction that also moved other SPL mints in the same
 * instruction set (a swap leg, an unrelated transfer sharing the signature)
 * has no price oracle to compare an arbitrary mint's value against USDC's, so
 * rather than guess, this resolves the caller-expected settlement mint
 * (`opts.mint`, default USDC) specifically. Only when that mint moved neither
 * way, and exactly one other mint has a complete sender+receiver pair, does
 * it fall back to that one mint; with more than one candidate and no match on
 * the expected mint, it throws rather than pick arbitrarily.
 *
 * @param {object} tx getTransaction()'s result: { meta, transaction, slot, blockTime }
 * @param {{ signature: string, mint?: string }} ctx mint defaults to USDC
 */
export function parseSettlement(tx, { signature, mint: expectedMint = SOLANA_USDC_MINT }) {
	if (!tx) {
		throw new SettlementResolveError('tx_not_found', `Transaction ${signature} is not confirmed.`);
	}
	if (tx.meta?.err) {
		throw new SettlementResolveError('tx_failed', `Transaction ${signature} failed on-chain.`);
	}

	const deltas = tokenBalanceDeltas(tx.meta);
	if (!deltas.length) {
		throw new SettlementResolveError('no_token_transfer', `No SPL token balance change found in ${signature}.`);
	}

	const byMint = new Map();
	for (const d of deltas) {
		const list = byMint.get(d.mint) || [];
		list.push(d);
		byMint.set(d.mint, list);
	}

	const settlementsByMint = new Map();
	for (const [mint, list] of byMint) {
		const sent = list.filter((d) => d.deltaAtomics < 0n);
		const received = list.filter((d) => d.deltaAtomics > 0n);
		if (!sent.length || !received.length) continue;
		const payerRow = sent.reduce((a, b) => (a.deltaAtomics < b.deltaAtomics ? a : b));
		const payeeRow = received.reduce((a, b) => (a.deltaAtomics > b.deltaAtomics ? a : b));
		settlementsByMint.set(mint, { mint, payer: payerRow.owner, payee: payeeRow.owner, amountAtomics: payeeRow.deltaAtomics, decimals: payeeRow.decimals });
	}

	let best = settlementsByMint.get(expectedMint) || null;
	if (!best && settlementsByMint.size === 1) {
		best = settlementsByMint.values().next().value;
	}
	if (!best) {
		throw new SettlementResolveError('no_token_transfer', `No matching payer/payee token transfer found in ${signature}.`);
	}

	return {
		signature,
		network: 'solana',
		payer: best.payer,
		payee: best.payee,
		mint: best.mint,
		symbol: mintSymbol(best.mint),
		amountAtomics: best.amountAtomics.toString(),
		decimals: best.decimals,
		feeLamports: Number(tx.meta.fee ?? 0),
		slot: Number(tx.slot ?? 0),
		blockTime: typeof tx.blockTime === 'number' ? tx.blockTime : null,
	};
}

/**
 * Fetch a confirmed Solana transaction and resolve it into a settlement
 * record.
 *
 * @param {string} signature
 * @param {{ connection?: import('@solana/web3.js').Connection, mint?: string }} [opts]
 *   `connection` injects one in tests (defaults to the shared mainnet
 *   connection); `mint` is the expected settlement mint (defaults to USDC).
 */
export async function resolveSettlement(signature, { connection, mint } = {}) {
	const conn = connection || solanaConnection({ network: 'mainnet' });
	const tx = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
	return parseSettlement(tx, { signature, mint });
}
