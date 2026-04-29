/**
 * Pumpkit claims — pump.fun fee-claim monitor
 *
 * Exports:
 *   watchClaims({ creator, sinceTs, onClaim, signal, network })
 *   listRecentClaims({ creator, limit, network })
 *
 * Transport: polls Solana RPC (getSignaturesForAddress + getParsedTransaction).
 * No external indexer required; works browser + Node.
 */

import { SOLANA_RPC } from '../erc8004/solana-deploy.js';

// The three pump.fun on-chain programs that emit fee-claim instructions.
const PUMP_PROGRAMS = new Set([
	'6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump bonding curve
	'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // PumpSwap AMM
	'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', // PumpFees (social)
]);

const POLL_INTERVAL_MS = 15_000;

async function getConn(network = 'mainnet') {
	const { Connection } = await import('@solana/web3.js');
	return new Connection(SOLANA_RPC[network] || SOLANA_RPC.mainnet, 'confirmed');
}

function _hasPumpIx(tx) {
	const inner = tx.meta?.innerInstructions?.flatMap((i) => i.instructions) ?? [];
	return [...(tx.transaction.message.instructions ?? []), ...inner].some((ix) =>
		PUMP_PROGRAMS.has(ix.programId?.toString?.()),
	);
}

function _lamportsDelta(tx, creator) {
	const accounts = tx.transaction.message.accountKeys;
	const idx = accounts.findIndex((a) => a.pubkey.toString() === creator);
	if (idx === -1) return 0;
	return (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0);
}

function _parseClaim(tx, signature, creator) {
	const lamports = _lamportsDelta(tx, creator);
	const mint = tx.meta.postTokenBalances?.[0]?.mint ?? null;
	return {
		signature,
		mint,
		lamports,
		ts: tx.blockTime ?? Math.floor(Date.now() / 1000),
	};
}

/**
 * Returns the last `limit` pump.fun fee-claim events for the creator wallet,
 * newest first. Each event: { signature, mint, lamports, ts }.
 *
 * @param {{ creator: string, limit?: number, network?: string }} opts
 */
export async function listRecentClaims({ creator, limit = 20, network = 'mainnet' }) {
	const { PublicKey } = await import('@solana/web3.js');
	const conn = await getConn(network);
	const pk = new PublicKey(creator);

	const sigInfos = await conn.getSignaturesForAddress(pk, { limit: Math.min(100, limit * 4) });
	const results = [];

	for (const { signature } of sigInfos) {
		if (results.length >= limit) break;
		let tx;
		try {
			tx = await conn.getParsedTransaction(signature, {
				maxSupportedTransactionVersion: 0,
				commitment: 'confirmed',
			});
		} catch {
			continue;
		}
		if (!tx || !_hasPumpIx(tx)) continue;
		if (_lamportsDelta(tx, creator) <= 0) continue;
		results.push(_parseClaim(tx, signature, creator));
	}

	return results;
}

/**
 * Subscribes to pump.fun fee-claim events for `creator` wallet.
 * Calls onClaim({ signature, mint, lamports, ts }) for each new claim.
 * Resolves when the AbortSignal fires.
 *
 * @param {{ creator: string, sinceTs?: number, onClaim: Function, signal?: AbortSignal, network?: string }} opts
 */
export async function watchClaims({ creator, sinceTs = 0, onClaim, signal, network = 'mainnet' }) {
	const seen = new Set();
	let lastTs = sinceTs;

	const poll = async () => {
		let claims;
		try {
			claims = await listRecentClaims({ creator, limit: 20, network });
		} catch {
			return;
		}
		for (const claim of claims) {
			if (seen.has(claim.signature) || claim.ts <= lastTs) continue;
			seen.add(claim.signature);
			try {
				await onClaim(claim);
			} catch {
				// onClaim errors must not kill the poll loop
			}
		}
		if (claims.length) {
			lastTs = Math.max(lastTs, ...claims.map((c) => c.ts));
		}
	};

	await poll();

	if (signal?.aborted) return;

	await new Promise((resolve) => {
		const iv = setInterval(async () => {
			if (signal?.aborted) {
				clearInterval(iv);
				resolve();
				return;
			}
			await poll();
		}, POLL_INTERVAL_MS);

		signal?.addEventListener('abort', () => {
			clearInterval(iv);
			resolve();
		});
	});
}
