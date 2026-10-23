import { inspectWireTransaction } from '../solana/transaction-v1.js';

// Bounded walk-back for the creation signature: getSignaturesForAddress has
// no forward cursor, so finding the first transaction on a mint means paging
// backward from the newest. A heavily-traded coin can have far more history
// than is worth walking on a 60s-cached read, so this caps the cost rather
// than ever hanging the request.
const SIG_PAGE = 1000;
const CREATION_PAGE_BUDGET = 8;

function unavailable(reason) {
	return { available: false, reason };
}

/** Walk getSignaturesForAddress backward to the mint's first transaction, then inspect its wire bytes. Never throws: every failure mode returns `{ available: false, reason }`. */
export async function findCreation(connection, mint) {
	try {
		let before;
		let earliestSig = null;
		let reachedGenesis = false;
		for (let page = 0; page < CREATION_PAGE_BUDGET; page++) {
			const params = before
				? [mint, { limit: SIG_PAGE, commitment: 'confirmed', before }]
				: [mint, { limit: SIG_PAGE, commitment: 'confirmed' }];
			const rpc = await connection._rpcRequest('getSignaturesForAddress', params);
			if (rpc.error) throw new Error(rpc.error.message || 'Solana RPC rejected getSignaturesForAddress');
			const sigs = Array.isArray(rpc.result) ? rpc.result : [];
			if (!sigs.length) {
				reachedGenesis = true;
				break;
			}
			earliestSig = sigs[sigs.length - 1];
			if (sigs.length < SIG_PAGE) {
				reachedGenesis = true;
				break;
			}
			before = earliestSig.signature;
		}
		if (!earliestSig) return unavailable('this mint has no transaction history on this RPC');
		if (!reachedGenesis) {
			return unavailable('this coin has too much trade history to walk back to its creation transaction within the lookup budget');
		}

		const txRpc = await connection._rpcRequest('getTransaction', [
			earliestSig.signature,
			{ encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
		]);
		if (txRpc.error) throw new Error(txRpc.error.message || 'Solana RPC rejected getTransaction');
		if (!txRpc.result) {
			return { available: false, reason: 'the creation transaction is too old for this RPC to serve', signature: earliestSig.signature };
		}
		const encoded = txRpc.result.transaction?.[0];
		if (typeof encoded !== 'string') {
			return { available: false, reason: 'the creation transaction came back in an unsupported encoding', signature: earliestSig.signature };
		}
		const inspection = inspectWireTransaction(encoded);
		return {
			available: true,
			signature: earliestSig.signature,
			slot: txRpc.result.slot ?? null,
			block_time: txRpc.result.blockTime ?? null,
			version: inspection.version,
			version_label: inspection.versionLabel,
			bytes: inspection.bytes,
			limit_bytes: inspection.limitBytes,
			utilization_pct: inspection.utilizationPct,
		};
	} catch (e) {
		return { available: false, reason: e?.message || 'creation lookup failed' };
	}
}
