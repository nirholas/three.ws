// Turns confirmed on-chain transactions into ledger rows. The client may say
// "I just staked, signature X", but nothing in the ledger comes from that claim:
// the transaction is fetched from the cluster and parsed, and the pool, wallet,
// outcome and amount are read from the transaction itself. A background sync
// (syncPoolLedger) records anything made without the UI, so the daily cap and
// the reconciliation view cannot be bypassed by skipping the record call.

import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { connection } from './chain.js';
import { getPoolByAddress, recordLedger } from './store.js';
import { programId } from './program.js';

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const KINDS = { [disc('stake').toString('hex')]: 'stake', [disc('claim').toString('hex')]: 'claim', [disc('refund').toString('hex')]: 'refund' };

/**
 * Parse a getTransaction result into the single event it carries, or null when
 * it failed or does not contain exactly one stake, claim or refund of ours.
 */
export function parseProgramTx(tx, program = programId()) {
	if (!tx || tx.meta?.err) return null;
	const message = tx.transaction.message;
	const keys = message.getAccountKeys
		? message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat()
		: message.accountKeys;
	const ixs = (message.compiledInstructions || message.instructions.map((i) => ({ programIdIndex: i.programIdIndex, accountKeyIndexes: i.accounts, data: Buffer.from(i.data, 'base64') })));
	const ours = ixs.filter((i) => keys[i.programIdIndex].equals(program));
	if (ours.length !== 1) return null;
	const ix = ours[0];
	const data = Buffer.from(ix.data);
	const kind = KINDS[data.subarray(0, 8).toString('hex')];
	if (!kind) return null;
	const at = (n) => keys[ix.accountKeyIndexes[n]];
	if (kind === 'stake') {
		return { kind, pool: at(1).toBase58(), wallet: at(6).toBase58(), outcome: data[8], amount: data.readBigUInt64LE(9) };
	}
	// claim / refund: accounts are [pool, mint, vault, position, owner_tokens, owner, token_program]
	const pool = at(0).toBase58();
	const vault = at(2).toBase58();
	const idx = keys.findIndex((k) => k.toBase58() === vault);
	const pre = tx.meta.preTokenBalances.find((b) => b.accountIndex === idx);
	const post = tx.meta.postTokenBalances.find((b) => b.accountIndex === idx);
	const amount = BigInt(pre?.uiTokenAmount.amount ?? 0) - BigInt(post?.uiTokenAmount.amount ?? 0);
	return { kind, pool, wallet: at(5).toBase58(), outcome: null, amount };
}

export async function fetchParsed(signature) {
	const tx = await connection().getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
	if (!tx) return null;
	const parsed = parseProgramTx(tx);
	return parsed && { ...parsed, signature, slot: tx.slot };
}

/** Record one signature. Returns the parsed event, or null when it is not one of ours. */
export async function recordSignature(signature, accountId) {
	const event = await fetchParsed(signature);
	if (!event) return null;
	const pool = await getPoolByAddress(event.pool);
	if (!pool) return null;
	const inserted = await recordLedger({
		marketId: pool.marketId, accountId, wallet: event.wallet, kind: event.kind,
		outcomeIndex: event.outcome, amount: event.amount, signature, slot: event.slot,
	});
	return { ...event, marketId: pool.marketId, inserted };
}

/** Walk every signature touching the pool and record the ones the ledger has not seen. */
export async function syncPoolLedger(pool, { accountForWallet }) {
	const conn = connection();
	let before;
	let recorded = 0;
	for (;;) {
		const page = await conn.getSignaturesForAddress(new PublicKey(pool.poolAddress), { before, limit: 500 }, 'confirmed');
		if (!page.length) break;
		for (const s of page) {
			if (s.err) continue;
			const event = await fetchParsed(s.signature);
			if (!event || event.pool !== pool.poolAddress) continue;
			const inserted = await recordLedger({
				marketId: pool.marketId, accountId: await accountForWallet(event.wallet), wallet: event.wallet, kind: event.kind,
				outcomeIndex: event.outcome, amount: event.amount, signature: s.signature, slot: event.slot,
			});
			if (inserted) recorded++;
		}
		before = page[page.length - 1].signature;
		if (page.length < 500) break;
	}
	return recorded;
}
