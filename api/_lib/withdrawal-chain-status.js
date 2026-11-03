// On-chain verdict for a withdrawal whose payout transaction may have been
// broadcast. The reconciler in api/cron/[name].js (handleProcessWithdrawals)
// calls checkSendStatus(row) for every row stuck in `broadcast_unconfirmed` and
// acts on the answer:
//
//   confirmed  a persisted transaction landed successfully: funds moved, complete the row
//   expired    nothing can ever land (every attempt either reverted on chain or its
//              blockhash/nonce window closed with no trace): safe to fail and release
//   pending    undecidable right now (still inside the landing window, or the RPC
//              could not answer): leave the balance reserved and look again next tick
//
// The check is deliberately conservative: when in doubt the answer is `pending`,
// never `expired`, because a wrong `expired` frees a balance whose money moved.

import { solanaConnection } from './solana/connection.js';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * @typedef {{ state: 'confirmed', signature: string }
 *   | { state: 'expired', detail: string }
 *   | { state: 'pending', detail: string }} SendVerdict
 */

/** The attempts to check: every persisted one, or the single known signature. */
function attemptsOf(row) {
	const list = Array.isArray(row.send_attempts) ? row.send_attempts : [];
	if (list.length) return list;
	if (row.send_signature) {
		return [{ signature: row.send_signature, lastValidBlockHeight: row.last_valid_block_height ?? null }];
	}
	return [];
}

/**
 * Solana: ask for the status of every attempt's signature (searching history),
 * then decide. A null status only counts as "never landed" once the cluster's
 * FINALIZED block height has passed that attempt's lastValidBlockHeight; the
 * finalized height trails the tip, so this errs toward waiting longer.
 *
 * @param {object} row
 * @param {{ connection?: import('@solana/web3.js').Connection }} [deps]
 * @returns {Promise<SendVerdict>}
 */
export async function checkSolanaSend(row, deps = {}) {
	const attempts = attemptsOf(row);
	if (!attempts.length) return { state: 'pending', detail: 'no signature was persisted for this row' };
	const connection = deps.connection || solanaConnection({ url: SOLANA_RPC, commitment: 'finalized' });

	const sigs = attempts.map((a) => a.signature);
	const { value } = await connection.getSignatureStatuses(sigs, { searchTransactionHistory: true });

	for (let i = 0; i < sigs.length; i++) {
		const st = value?.[i];
		if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
			return { state: 'confirmed', signature: sigs[i] };
		}
	}

	const undecided = [];
	let reverted = 0;
	for (let i = 0; i < sigs.length; i++) {
		const st = value?.[i];
		if (st?.err) {
			reverted++;
			continue;
		}
		undecided.push(attempts[i]);
	}
	if (!undecided.length) {
		return { state: 'expired', detail: `${reverted} attempt(s) reverted on chain; none landed` };
	}

	const height = await connection.getBlockHeight('finalized');
	const open = undecided.filter((a) => {
		const last = Number(a.lastValidBlockHeight);
		// Without a recorded window the attempt can never be declared dead.
		return !Number.isFinite(last) || height <= last;
	});
	if (open.length) {
		return { state: 'pending', detail: `${open.length} attempt(s) still inside the landing window` };
	}
	return {
		state: 'expired',
		detail: `blockhash window closed at height ${height} with no trace of ${undecided.length} signature(s)`,
	};
}

/**
 * EVM: a transaction is dead once its nonce has been consumed by a different
 * transaction. The nonce count is read BEFORE the receipts so a transaction mined
 * between the two reads is still seen by the receipt lookup that follows.
 *
 * @param {object} row
 * @param {{ client?: object, treasury?: string }} [deps]
 * @returns {Promise<SendVerdict>}
 */
export async function checkEvmSend(row, deps = {}) {
	const attempts = attemptsOf(row).filter((a) => a.hash || a.signature);
	if (!attempts.length) return { state: 'pending', detail: 'no transaction hash was persisted for this row' };

	const { evmTreasuryAddress, evmPublicClient } = await import('./evm-transfer.js');
	const { resolveEvmChainId } = await import('./evm-transfer.js');
	const chainId = resolveEvmChainId(row.chain);
	if (!chainId) return { state: 'pending', detail: `unsupported chain ${row.chain}` };
	const client = deps.client || evmPublicClient(chainId);
	const treasury = deps.treasury || evmTreasuryAddress();

	const nonceCount = await client.getTransactionCount({ address: treasury, blockTag: 'latest' });

	let reverted = 0;
	for (const a of attempts) {
		const hash = a.hash || a.signature;
		let receipt = null;
		try {
			receipt = await client.getTransactionReceipt({ hash });
		} catch (e) {
			if (e?.name !== 'TransactionReceiptNotFoundError') throw e;
		}
		if (!receipt) continue;
		if (receipt.status === 'success') return { state: 'confirmed', signature: hash };
		reverted++;
	}

	const nonces = attempts.map((a) => (a.nonce ?? row.send_nonce));
	const allNoncesConsumed = nonces.every((n) => n != null && Number(n) < nonceCount);
	if (reverted === attempts.length) {
		return { state: 'expired', detail: `${reverted} attempt(s) reverted on chain; none landed` };
	}
	if (allNoncesConsumed) {
		return { state: 'expired', detail: `nonce ${nonces.join(',')} was consumed by another transaction; ours never landed` };
	}
	return { state: 'pending', detail: 'no receipt yet and the nonce is still open' };
}

/**
 * Dispatch on the row's chain.
 * @param {object} row an agent_withdrawals row
 * @returns {Promise<SendVerdict>}
 */
export async function checkSendStatus(row) {
	return row.chain === 'solana' ? checkSolanaSend(row) : checkEvmSend(row);
}
