// The platform fee ledger: one append-only platform_fee_events row per fee
// three.ws takes, written in the same database transaction as the money-state
// change it belongs to.
//
// Two ways in:
//   withPlatformFee(db, statement, ev)  run a money-state statement and the fee
//                                       insert as one sql.transaction, so the fee
//                                       row commits or rolls back with it.
//   recordPlatformFee(ev, opts)         the insert on its own, for a path whose
//                                       only durable state change is the fee.
//
// Idempotency is the database's job: UNIQUE (source, source_ref) plus
// ON CONFLICT DO NOTHING, so a replayed confirm, a retried cron pass or two
// concurrent confirms of the same signature all leave exactly one row.
//
// A fee that rode inside a wallet-signed transaction is never trusted from the
// client: feeReceivedInTx reads what the fee wallet actually received from the
// confirmed transaction's own balance meta.
//
// Schema and rationale: api/_lib/migrations/20261104150000_platform_fee_events.sql.
// Reconciler: scripts/reconcile-platform-fees.mjs (npm run audit:platform-fees).

import { sql as defaultSql } from './db.js';
import { SOLANA_USDC_MINT, SOLANA_USDC_MINT_DEVNET } from '../payments/_config.js';

export const PLATFORM_FEE_SOURCES = Object.freeze([
	'pump_trade',
	'pump_launch',
	'agent_trade',
	'skill_purchase',
	'skill_bundle',
	'subscription',
	'x402_skill_split',
]);

const SETTLEMENTS = new Set(['onchain', 'ledger']);

function toAtomics(value) {
	if (typeof value === 'bigint') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return 0n;
		return BigInt(Math.trunc(value));
	}
	const s = String(value ?? '').trim();
	if (!/^-?\d+$/.test(s)) return 0n;
	return BigInt(s);
}

function invalid(message) {
	return Object.assign(new Error(`platform fee event: ${message}`), { code: 'invalid_platform_fee_event' });
}

/**
 * Validate and shape one fee event into its row. Returns null when there is no
 * fee to record (a zero or negative amount), so callers can pass whatever the
 * fee builder produced without branching. Throws on a malformed event: that is
 * a programming error at the call site, never user input.
 *
 * @param {object} ev
 * @param {string} ev.source         one of PLATFORM_FEE_SOURCES
 * @param {string} ev.sourceRef      the unique id of the fee within its source
 * @param {bigint|number|string} ev.amountAtomics
 * @param {string} ev.asset          'SOL' | 'USDC' | another symbol
 * @param {number} ev.decimals
 * @param {'onchain'|'ledger'} [ev.settlement]
 * @param {string} [ev.chain] [ev.network] [ev.assetMint] [ev.basis] [ev.txSignature]
 * @param {string} [ev.payer] [ev.beneficiary] [ev.userId] [ev.agentId]
 * @param {number} [ev.bps]
 * @param {object} [ev.meta]
 * @param {Date|string} [ev.occurredAt]
 */
export function normalizePlatformFeeEvent(ev) {
	if (!ev || typeof ev !== 'object') throw invalid('event object required');
	const amount = toAtomics(ev.amountAtomics);
	if (amount <= 0n) return null;
	if (!PLATFORM_FEE_SOURCES.includes(ev.source)) throw invalid(`unknown source '${ev.source}'`);
	const sourceRef = ev.sourceRef == null ? '' : String(ev.sourceRef).trim();
	if (!sourceRef || sourceRef.length > 200) throw invalid('sourceRef required (1-200 chars)');
	const settlement = ev.settlement || 'onchain';
	if (!SETTLEMENTS.has(settlement)) throw invalid(`unknown settlement '${settlement}'`);
	const asset = ev.asset ? String(ev.asset) : '';
	if (!asset) throw invalid('asset required');
	const decimals = Number(ev.decimals);
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw invalid('decimals must be an integer 0-18');
	const txSignature = ev.txSignature ? String(ev.txSignature) : null;
	const beneficiary = ev.beneficiary ? String(ev.beneficiary) : null;
	if (settlement === 'onchain' && (!txSignature || !beneficiary)) {
		throw invalid('an onchain fee needs txSignature and beneficiary');
	}
	const bps = ev.bps == null ? null : Number(ev.bps);
	if (bps != null && (!Number.isInteger(bps) || bps < 0 || bps > 10_000)) throw invalid('bps must be an integer 0-10000');
	return {
		source: ev.source,
		source_ref: sourceRef,
		settlement,
		chain: ev.chain || 'solana',
		network: ev.network || 'mainnet',
		asset,
		asset_mint: ev.assetMint || null,
		amount_atomics: amount.toString(),
		decimals,
		bps,
		basis: ev.basis || null,
		tx_signature: txSignature,
		payer: ev.payer ? String(ev.payer) : null,
		beneficiary,
		user_id: ev.userId || null,
		agent_id: ev.agentId || null,
		meta: JSON.stringify(ev.meta && typeof ev.meta === 'object' ? ev.meta : {}),
		occurred_at: ev.occurredAt ? new Date(ev.occurredAt).toISOString() : new Date().toISOString(),
	};
}

/**
 * The insert for one fee event, unexecuted, so it can ride in
 * `sql.transaction([moneyStateChange, platformFeeEventQuery(sql, ev)])`.
 * Returns null when the event carries no fee.
 */
export function platformFeeEventQuery(db, ev) {
	const r = normalizePlatformFeeEvent(ev);
	if (!r) return null;
	return db`
		INSERT INTO platform_fee_events
			(source, source_ref, settlement, chain, network, asset, asset_mint,
			 amount_atomics, decimals, bps, basis, tx_signature, payer, beneficiary,
			 user_id, agent_id, meta, occurred_at)
		VALUES
			(${r.source}, ${r.source_ref}, ${r.settlement}, ${r.chain}, ${r.network}, ${r.asset}, ${r.asset_mint},
			 ${r.amount_atomics}, ${r.decimals}, ${r.bps}, ${r.basis}, ${r.tx_signature}, ${r.payer}, ${r.beneficiary},
			 ${r.user_id}, ${r.agent_id}, ${r.meta}::jsonb, ${r.occurred_at})
		ON CONFLICT (source, source_ref) DO NOTHING
		RETURNING id
	`;
}

/**
 * Run a money-state statement and the fee insert as one transaction. With no
 * fee (null event or zero amount) the statement runs alone. `statement` is an
 * unexecuted tagged-template query from the same `db`.
 *
 * @returns {Promise<{ rows: any[], feeRecorded: boolean }>}
 */
export async function withPlatformFee(db, statement, ev) {
	const feeQuery = ev ? platformFeeEventQuery(db, ev) : null;
	if (!feeQuery) return { rows: await statement, feeRecorded: false };
	const [rows, feeRows] = await db.transaction([statement, feeQuery]);
	return { rows, feeRecorded: feeRows.length > 0 };
}

/**
 * withPlatformFee for a writer whose state row must land even if the fee row
 * cannot (a worker booking a position after its trade already confirmed):
 * the pair runs as one transaction, and only if that transaction fails is the
 * state statement retried alone, with the lost fee paged to ops. `makeStatement`
 * builds a fresh query each call because a tagged-template query runs once.
 *
 * @returns {Promise<{ rows: any[], feeRecorded: boolean }>}
 */
export async function withPlatformFeeOrAlert(db, makeStatement, ev) {
	try {
		return await withPlatformFee(db, makeStatement(), ev);
	} catch (e) {
		if (!ev) throw e;
		const rows = await makeStatement();
		await reportRecordFailure(ev, e);
		return { rows, feeRecorded: false };
	}
}

/**
 * Record one fee on its own. `bestEffort` is for a path where the money has
 * already moved on-chain and the response must not fail over the ledger write:
 * the failure is logged and paged to ops, and the reconciler lists the fee as
 * an unrecorded fee-wallet receipt until it is backfilled.
 *
 * @returns {Promise<{ recorded: boolean, id: number|null, error?: string }>}
 */
export async function recordPlatformFee(ev, { db = defaultSql, bestEffort = false } = {}) {
	try {
		const q = platformFeeEventQuery(db, ev);
		if (!q) return { recorded: false, id: null };
		const rows = await q;
		return { recorded: rows.length > 0, id: rows[0]?.id ?? null };
	} catch (e) {
		if (!bestEffort || e?.code === 'invalid_platform_fee_event') throw e;
		await reportRecordFailure(ev, e);
		return { recorded: false, id: null, error: e?.message || String(e) };
	}
}

/**
 * The failure path shared by every best-effort writer, including a
 * withPlatformFee transaction a caller chose not to let fail its response.
 */
export async function reportRecordFailure(ev, e) {
	console.error('[platform-fee-events] record failed', ev?.source, ev?.sourceRef, e?.message);
	try {
		const { sendOpsAlert } = await import('./alerts.js');
		await sendOpsAlert(
			'Platform fee not recorded',
			`${ev?.source} ${ev?.sourceRef}: ${e?.message || e}. The fee was taken; ` +
				'npm run audit:platform-fees lists it as unrecorded until it is backfilled.',
			{ signature: `platform-fee-record:${ev?.source}`, severity: 'warn' },
		);
	} catch (alertErr) {
		console.error('[platform-fee-events] alert failed', alertErr?.message);
	}
}

/**
 * What a wallet received inside one confirmed, parsed Solana transaction:
 * the lamport delta for SOL, or the summed token-balance delta of the wallet's
 * token accounts for an SPL mint. Never negative; 0 for a failed transaction.
 *
 * @param {object} tx   getParsedTransaction result
 * @param {{ recipient: string, asset: 'SOL'|string, mint?: string|null }} o
 * @returns {bigint}
 */
export function feeReceivedInTx(tx, { recipient, asset, mint = null }) {
	const meta = tx?.meta;
	if (!meta || !recipient || meta.err) return 0n;
	if (asset === 'SOL') {
		const keys = (tx.transaction?.message?.accountKeys || []).map((k) => String(k?.pubkey ?? k));
		const i = keys.indexOf(String(recipient));
		if (i < 0) return 0n;
		const delta = BigInt(meta.postBalances?.[i] ?? 0) - BigInt(meta.preBalances?.[i] ?? 0);
		return delta > 0n ? delta : 0n;
	}
	const sum = (rows) =>
		(rows || [])
			.filter((b) => b.owner === String(recipient) && (!mint || b.mint === mint))
			.reduce((acc, b) => acc + BigInt(b.uiTokenAmount?.amount || '0'), 0n);
	const delta = sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
	return delta > 0n ? delta : 0n;
}

/**
 * The pump trade/launch fee event for a confirmed transaction the user signed.
 * The amount is what the platform fee wallet actually received in that tx, so
 * a transaction built outside three.ws (no fee transfer) yields null.
 *
 * @param {object} o
 * @param {object} o.tx                 parsed confirmed transaction
 * @param {string} o.signature
 * @param {'pump_trade'|'pump_launch'} o.source
 * @param {'mainnet'|'devnet'} o.network
 * @param {string|null} [o.quoteMint]   the SPL quote mint; null for SOL-paired;
 *                                      omitted (undefined) when the pairing is unknown
 * @param {string} o.basis              'buy' | 'sell' | 'launch'
 * @param {string} [o.recipient]        override; defaults to the configured fee wallet
 */
export async function pumpFeeEventFromTx({ tx, signature, source, network, quoteMint, basis, payer = null, userId = null, agentId = null, bps = null, recipient = null, meta = {} }) {
	let to = recipient;
	if (!to) {
		const { pumpFeeRecipient } = await import('./pump-platform-fee.js');
		const pk = await pumpFeeRecipient();
		to = pk ? pk.toBase58() : null;
	}
	if (!to) return null;
	// An unknown pairing (a coin launched elsewhere, so no pump_agent_mints row)
	// is probed: the fee is SOL for a SOL-paired trade, otherwise USDC.
	if (quoteMint === undefined) {
		const solFee = feeReceivedInTx(tx, { recipient: to, asset: 'SOL' });
		if (solFee > 0n) quoteMint = null;
		else {
			quoteMint = network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT;
		}
	}
	const isSol = !quoteMint;
	const amount = feeReceivedInTx(tx, { recipient: to, asset: isSol ? 'SOL' : 'SPL', mint: quoteMint });
	if (amount <= 0n) return null;
	return {
		source,
		sourceRef: signature,
		settlement: 'onchain',
		chain: 'solana',
		network,
		asset: isSol ? 'SOL' : 'USDC',
		assetMint: isSol ? null : quoteMint,
		amountAtomics: amount,
		decimals: isSol ? 9 : 6,
		bps,
		basis,
		txSignature: signature,
		payer,
		beneficiary: to,
		userId,
		agentId,
		meta,
		occurredAt: tx?.blockTime ? new Date(tx.blockTime * 1000) : undefined,
	};
}

/**
 * The fee event for a server-signed trade or launch whose fee block (the
 * `buildPlatformFeeInstructions` disclosure) is known before it is sent.
 * Returns null when no fee was charged.
 *
 * @param {object} o
 * @param {{ bps:number, asset:string, amount:string, recipient:string, basis:string }|null} o.disclosure
 * @param {string} o.signature           the transaction that carried the fee transfer
 * @param {string} [o.sourceRef]         defaults to the signature
 * @param {'agent_trade'|'pump_launch'} o.source
 * @param {string} o.network
 * @param {string|null} [o.quoteMint]
 */
export function feeEventFromDisclosure({ disclosure, signature, sourceRef = null, source, network, quoteMint = null, payer = null, userId = null, agentId = null, meta = {} }) {
	if (!disclosure || !signature) return null;
	const isSol = disclosure.asset === 'SOL';
	return {
		source,
		sourceRef: sourceRef || signature,
		settlement: 'onchain',
		chain: 'solana',
		network,
		asset: disclosure.asset,
		// A USDC fee built without an explicit quote mint used the network's USDC.
		assetMint: isSol ? null : quoteMint || (network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT),
		amountAtomics: disclosure.amount,
		decimals: isSol ? 9 : 6,
		bps: disclosure.bps ?? null,
		basis: disclosure.basis || null,
		txSignature: signature,
		payer: payer ? String(payer) : null,
		beneficiary: disclosure.recipient,
		userId,
		agentId,
		meta,
	};
}
