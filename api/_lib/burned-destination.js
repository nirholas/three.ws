// Flags a Solana destination that shows the "sweeper bot" fingerprint: value
// arrives and is drained again within seconds, repeatedly, leaving a
// near-zero balance despite active funding. Ported from the owner's
// proprietary sol-sweeper-bots `burned-check` (tools/burned-check/check.mjs),
// adapted from a standalone CLI into a withdrawal-time warning: an injected
// `@solana/web3.js` Connection (this platform's own failover chain, never a
// hardcoded endpoint) replaces the CLI's bare `fetch`, and the heuristic is
// now a pure, independently testable function over the collected deltas.
//
// Read-only: only getBalance, getSignaturesForAddress and getTransaction are
// called. It never signs, never moves funds, and a collection failure
// degrades to `checked: false` rather than blocking the withdrawal it backs,
// the heuristic is a warning the owner weighs, not a security boundary that
// must fail closed.
//
// One deliberate fix over the upstream CLI: upstream tracks "quick out" by
// walking signatures newest-first and comparing timestamps without sorting,
// so an outflow that is merely OLDER than some later-seen inflow registers as
// "quick" regardless of the actual gap between them. This module sorts
// deltas into chronological order first, so "quick out" means what it says:
// an outflow within QUICK_OUT_WINDOW_MS of the nearest PRIOR inflow.

import { PublicKey } from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
export const QUICK_OUT_WINDOW_MS = 60_000;
export const NEAR_ZERO_LAMPORTS = Math.round(0.001 * LAMPORTS_PER_SOL);
export const DEFAULT_SIGNATURE_LIMIT = 25;
export const DEFAULT_INSPECT_LIMIT = 15;

/**
 * Pure classifier over one destination's recent balance deltas. No network
 * calls, so it can be exercised with synthetic transaction history in tests.
 *
 * @param {{
 *   balanceLamports: number,
 *   deltas: Array<{ deltaSol: number, blockTimeMs: number|null }>,
 *   sigCount: number,
 *   sigLimit: number,
 * }} input `deltas` need not be pre-sorted; this function sorts them.
 * @returns {{ verdict: string, flagged: boolean, note: string, inflows: number, outflows: number, quickOutflows: number }}
 */
export function classifySweepPattern({ balanceLamports, deltas, sigCount, sigLimit }) {
	const ordered = [...deltas].sort((a, b) => {
		if (a.blockTimeMs == null && b.blockTimeMs == null) return 0;
		if (a.blockTimeMs == null) return -1;
		if (b.blockTimeMs == null) return 1;
		return a.blockTimeMs - b.blockTimeMs;
	});

	let inflows = 0;
	let outflows = 0;
	let quickOutflows = 0;
	let lastInflowAt = null;
	for (const d of ordered) {
		if (d.deltaSol > 0) {
			inflows += 1;
			lastInflowAt = d.blockTimeMs;
		} else if (d.deltaSol < 0) {
			outflows += 1;
			if (lastInflowAt != null && d.blockTimeMs != null && d.blockTimeMs >= lastInflowAt && d.blockTimeMs - lastInflowAt <= QUICK_OUT_WINDOW_MS) {
				quickOutflows += 1;
			}
		}
	}

	const nearZero = balanceLamports < NEAR_ZERO_LAMPORTS;
	const churny = inflows > 0 && outflows > 0;

	if (nearZero && churny && (quickOutflows > 0 || sigCount >= sigLimit)) {
		return {
			verdict: 'likely_swept', flagged: true, inflows, outflows, quickOutflows,
			note: 'This address shows a near-zero balance with repeated in-then-out transfers. Funds sent here are likely to be drained on arrival by a sweeper bot.',
		};
	}
	if (nearZero && sigCount > 0) {
		return {
			verdict: 'empty_active_history', flagged: false, inflows, outflows, quickOutflows,
			note: 'This address is currently near zero with prior activity.',
		};
	}
	if (balanceLamports > 0) {
		return {
			verdict: 'holds_balance', flagged: false, inflows, outflows, quickOutflows,
			note: 'This address is currently funded.',
		};
	}
	return {
		verdict: 'no_activity', flagged: false, inflows, outflows, quickOutflows,
		note: 'No balance and no recent transaction history for this address.',
	};
}

/**
 * Collect the balance deltas `classifySweepPattern` needs for one address,
 * over an injected connection. Bounded by signature count on both the fetch
 * (`sigLimit`) and the per-transaction inspection pass (`inspectLimit`): a
 * sweeper pattern is a RECENT behavior, so deep history is not needed.
 *
 * @param {object} connection a `@solana/web3.js` Connection, or anything
 *   duck-typed the same way (getBalance, getSignaturesForAddress, getTransaction).
 * @param {string} address base58 Solana address
 * @param {{ sigLimit?: number, inspectLimit?: number }} [opts]
 */
export async function collectDestinationDeltas(connection, address, opts = {}) {
	const sigLimit = opts.sigLimit ?? DEFAULT_SIGNATURE_LIMIT;
	const inspectLimit = opts.inspectLimit ?? DEFAULT_INSPECT_LIMIT;
	const pubkey = new PublicKey(address);

	const [balanceLamports, signatures] = await Promise.all([
		connection.getBalance(pubkey, 'confirmed'),
		connection.getSignaturesForAddress(pubkey, { limit: sigLimit }),
	]);

	const toInspect = signatures.slice(0, Math.min(signatures.length, inspectLimit));
	const deltas = [];
	for (const s of toInspect) {
		if (s.err) continue;
		let tx;
		try {
			tx = await connection.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
		} catch {
			continue;
		}
		if (!tx?.meta) continue;
		const keys = tx.transaction?.message?.getAccountKeys
			? tx.transaction.message.getAccountKeys().staticAccountKeys
			: (tx.transaction?.message?.accountKeys ?? []);
		const idx = keys.findIndex((k) => (k?.toBase58 ? k.toBase58() : String(k)) === address);
		if (idx < 0) continue;
		const pre = tx.meta.preBalances?.[idx];
		const post = tx.meta.postBalances?.[idx];
		if (pre == null || post == null) continue;
		const deltaSol = (post - pre) / LAMPORTS_PER_SOL;
		if (deltaSol === 0) continue;
		deltas.push({ deltaSol, blockTimeMs: s.blockTime ? s.blockTime * 1000 : null, signature: s.signature });
	}

	return { balanceLamports: Number(balanceLamports), deltas, sigCount: signatures.length, sigLimit };
}

/**
 * Collect and classify one destination in a single call. Never throws: a
 * collection failure (RPC outage, invalid address) reports `checked: false`
 * so the caller can show the result as "unknown" rather than block on it.
 *
 * @param {object} connection injected `@solana/web3.js` Connection
 * @param {string} address base58 Solana address
 * @param {{ sigLimit?: number, inspectLimit?: number }} [opts]
 */
export async function checkBurnedDestination(connection, address, opts = {}) {
	try {
		const collected = await collectDestinationDeltas(connection, address, opts);
		return { checked: true, ...classifySweepPattern(collected) };
	} catch (err) {
		return { checked: false, flagged: false, verdict: 'unknown', note: 'Could not check this address right now.', error: err?.message || String(err) };
	}
}
