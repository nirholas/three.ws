// Solana Pay for agent invoices: the transfer-request URL a wallet opens, its
// QR code, and the on-chain read that finds and measures a payment.
//
// How a payment is matched to an invoice:
//   1. Every invoice owns a fresh `reference` public key. The Solana Pay URL
//      tells the payer's wallet to add it as a read-only account on the
//      transfer, so `getSignaturesForAddress(reference)` returns exactly the
//      transactions that paid this invoice and nothing else.
//   2. The URL also carries the memo `three.ws invoice <number>`. A wallet that
//      honors it writes that memo on-chain. A transaction that carries the
//      reference but a memo naming some other invoice is recorded and not
//      counted, so a reference reused by mistake can never settle the wrong
//      invoice. A wallet that drops the memo still pays: the reference alone is
//      unique to the invoice.
//   3. What counts is what the recipient actually received in this
//      transaction: the lamport delta on its account for SOL, or the token
//      balance delta across every account it owns of the invoice's mint for SPL
//      tokens. That covers classic SPL and Token-2022 alike, and a transfer-fee
//      mint is measured net of the fee, which is what the seller really got.

import QRCode from 'qrcode';
import { PublicKey } from '@solana/web3.js';
import { MEMO_PROGRAM_ID } from '../custody/builders.js';
import { formatAtomics } from './assets.js';

const MEMO_ID = MEMO_PROGRAM_ID.toBase58();
const LEGACY_MEMO_ID = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';

/** The memo a paying wallet writes on-chain for an invoice. */
export function invoiceChainMemo(number) {
	return `three.ws invoice ${number}`;
}

/**
 * The Solana Pay transfer-request URL for an invoice. Amount is the amount
 * still due, so a payer who already sent part of it is asked for the rest.
 */
export function solanaPayUrl(inv, { dueAtomics = null } = {}) {
	const remaining = dueAtomics != null ? BigInt(dueAtomics) : BigInt(inv.amount_atomics) - BigInt(inv.paid_atomics || 0);
	const params = new URLSearchParams();
	if (remaining > 0n) params.set('amount', formatAtomics(remaining, inv.decimals));
	if (inv.asset !== 'SOL') params.set('spl-token', inv.mint);
	params.set('reference', inv.reference);
	params.set('label', 'three.ws');
	params.set('message', String(inv.memo || '').slice(0, 120) || `Invoice ${inv.number}`);
	params.set('memo', invoiceChainMemo(inv.number));
	// URLSearchParams encodes a space as '+', which Solana Pay wallets read
	// literally; the spec wants percent-encoding.
	return `solana:${inv.recipient_address}?${params.toString().replace(/\+/g, '%20')}`;
}

/** A block explorer link for a transaction on the given network. */
export function explorerTxUrl(signature, network) {
	if (!signature) return null;
	return `https://solscan.io/tx/${encodeURIComponent(signature)}${network && network !== 'mainnet' ? `?cluster=${encodeURIComponent(network)}` : ''}`;
}

/** The pay URL as an SVG QR code, sized by the viewer. */
export async function qrSvg(url) {
	return QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

function keyString(k) {
	if (!k) return null;
	if (typeof k === 'string') return k;
	if (k.pubkey) return keyString(k.pubkey);
	return typeof k.toBase58 === 'function' ? k.toBase58() : String(k);
}

/** Every memo string in a parsed transaction, top-level and inner. */
export function memosOf(tx) {
	const out = [];
	const visit = (ix) => {
		const pid = keyString(ix?.programId);
		if (pid !== MEMO_ID && pid !== LEGACY_MEMO_ID) return;
		if (typeof ix.parsed === 'string') out.push(ix.parsed);
		else if (typeof ix.data === 'string') out.push(ix.data);
	};
	for (const ix of tx?.transaction?.message?.instructions || []) visit(ix);
	for (const inner of tx?.meta?.innerInstructions || []) for (const ix of inner.instructions || []) visit(ix);
	return out;
}

/**
 * What `recipient` received of `mint` in one parsed transaction, in base units.
 * Negative or zero means this transaction paid the recipient nothing.
 * @returns {bigint}
 */
export function creditedAtomics(tx, { recipient, mint, native }) {
	const meta = tx?.meta;
	if (!meta || meta.err) return 0n;
	const keys = (tx.transaction?.message?.accountKeys || []).map(keyString);
	if (native) {
		const i = keys.indexOf(recipient);
		if (i < 0) return 0n;
		// The recipient paying its own fee would read as a negative delta; only an
		// incoming transfer counts.
		const delta = BigInt(meta.postBalances?.[i] ?? 0) - BigInt(meta.preBalances?.[i] ?? 0);
		return delta > 0n ? delta : 0n;
	}
	const sumFor = (balances) => {
		const byIndex = new Map();
		for (const b of balances || []) {
			if (b.mint !== mint || b.owner !== recipient) continue;
			byIndex.set(b.accountIndex, BigInt(b.uiTokenAmount?.amount ?? '0'));
		}
		return byIndex;
	};
	const pre = sumFor(meta.preTokenBalances);
	const post = sumFor(meta.postTokenBalances);
	let delta = 0n;
	for (const [idx, amt] of post) delta += amt - (pre.get(idx) ?? 0n);
	// An account that existed before and was closed in the same tx only shows up
	// in pre; it can only lower the total, which is the honest reading.
	for (const [idx, amt] of pre) if (!post.has(idx)) delta -= amt;
	return delta > 0n ? delta : 0n;
}

/** The fee payer (first signer) of a parsed transaction. */
export function payerOf(tx) {
	const keys = tx?.transaction?.message?.accountKeys || [];
	const signer = keys.find((k) => k?.signer);
	return keyString(signer || keys[0]) || null;
}

/**
 * Decide how one transaction counts toward an invoice.
 * @returns {{ amount: bigint, memo: string|null, payer: string|null, counted: boolean, reason: string|null }}
 */
export function classifyPayment(tx, inv) {
	const amount = creditedAtomics(tx, {
		recipient: inv.recipient_address,
		mint: inv.mint,
		native: inv.asset === 'SOL',
	});
	const memos = memosOf(tx);
	const memo = memos.length ? memos.join(' | ') : null;
	const payer = payerOf(tx);
	if (tx?.meta?.err) return { amount: 0n, memo, payer, counted: false, reason: 'transaction_failed' };
	if (amount <= 0n) return { amount, memo, payer, counted: false, reason: 'no_transfer_to_recipient' };
	// The memo, when present, must name this invoice. Matching on the number
	// (not the whole string) tolerates a wallet that prefixes its own text.
	if (memo && !memo.includes(inv.number)) return { amount, memo, payer, counted: false, reason: 'memo_mismatch' };
	return { amount, memo, payer, counted: true, reason: null };
}

/**
 * Every confirmed transaction that carries the invoice's reference, parsed.
 * Oldest first, so payments are applied in the order they landed.
 */
export async function findReferenceTransactions(connection, reference, { limit = 100 } = {}) {
	const sigs = await connection.getSignaturesForAddress(new PublicKey(reference), { limit }, 'confirmed');
	const ordered = sigs.filter((s) => !s.err).reverse();
	if (!ordered.length) return [];
	const parsed = [];
	// Small batches: some RPC lanes cap the JSON-RPC batch size.
	for (let i = 0; i < ordered.length; i += 10) {
		const chunk = ordered.slice(i, i + 10);
		const txs = await connection.getParsedTransactions(
			chunk.map((s) => s.signature),
			{ maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
		);
		txs.forEach((tx, j) => {
			if (tx) parsed.push({ signature: chunk[j].signature, slot: chunk[j].slot, blockTime: chunk[j].blockTime ?? tx.blockTime ?? null, tx });
		});
	}
	return parsed;
}
