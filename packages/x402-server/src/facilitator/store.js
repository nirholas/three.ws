// Settlement stores. The pending store implements the x402 PendingSettlementStore
// shape (get / set / delete) so a retry of a payload the facilitator already
// broadcast re-awaits that signature instead of signing and sending a second
// transaction. The in-memory default is for a single process; run more than one
// replica and pass a shared implementation (the three.ws API passes Postgres).

import { createHash } from 'node:crypto';

// Wire value. Matches @x402/core exactly: buyer SDKs key their automatic retry on
// this string, so it is a protocol constant.
export const SETTLEMENT_PENDING_REASON = 'settlement_pending';
// Returned INSTEAD of pending when the store write fails. Terminal on purpose.
export const SETTLEMENT_PENDING_UNRECORDABLE_REASON = 'settlement_pending_unrecordable';
// A stored entry is live this long; a Solana blockhash is dead after about 90s.
export const PENDING_SETTLEMENT_TTL_MS = 10 * 60_000;

/** Deterministic key for a payment payload: sha256 of the signed transaction. */
export function pendingSettlementKey(txBase64) {
	if (!txBase64) return null;
	return createHash('sha256').update(String(txBase64), 'utf8').digest('hex');
}

/**
 * Persist `signature` under `key` and return the `settlement_pending` settle
 * response, or a terminal failure carrying the same signature when the persist
 * fails. Answering pending without a record would turn an unknown outcome into a
 * double send on retry.
 */
export async function recordPendingOrTerminal({
	store,
	key,
	signature,
	network,
	payer,
	meta = {},
	pendingReason = SETTLEMENT_PENDING_REASON,
	terminalReason = SETTLEMENT_PENDING_UNRECORDABLE_REASON,
	cause,
}) {
	const detail = cause ? String(cause?.message || cause).slice(0, 200) : '';
	const recorded = store
		? await store.set(key, signature, { ...meta, network, payer, lastError: detail })
		: false;
	if (!recorded) {
		return {
			success: false,
			reason: detail ? `${terminalReason}:${detail}` : terminalReason,
			transaction: signature,
			network,
			payer,
			pending: false,
		};
	}
	return {
		success: false,
		reason: pendingReason,
		transaction: signature,
		network,
		payer,
		pending: true,
		pendingDetail: detail || null,
	};
}

/** In-memory pending store with a TTL. */
export class MemoryPendingStore {
	constructor({ ttlMs = PENDING_SETTLEMENT_TTL_MS, clock = Date.now } = {}) {
		this.ttlMs = ttlMs;
		this.clock = clock;
		this.rows = new Map();
	}
	async get(key) {
		const row = this.rows.get(key);
		if (!row) return undefined;
		if (this.clock() - row.at > this.ttlMs) {
			this.rows.delete(key);
			return undefined;
		}
		return row.signature;
	}
	async set(key, signature, meta = {}) {
		if (!key || !signature) return false;
		this.rows.set(key, { signature, meta, at: this.clock() });
		return true;
	}
	async delete(key) {
		this.rows.delete(key);
	}
}

/**
 * In-memory decision log: a bounded ring of verify and settle decisions with
 * machine-readable refusal reasons, plus counters for the metrics route.
 */
export class MemoryDecisionLog {
	constructor({ capacity = 5000, clock = Date.now } = {}) {
		this.capacity = capacity;
		this.clock = clock;
		this.entries = [];
	}
	/** @param {{action:'verify'|'settle', ok:boolean, reason?:string|null}} entry */
	log(entry) {
		this.entries.push({ at: this.clock(), ...entry });
		if (this.entries.length > this.capacity) this.entries.shift();
	}
	recent(limit = 100) {
		return this.entries.slice(-limit).reverse();
	}
	/** Refusal reasons are `class:detail`; group on the class. */
	summary() {
		const out = { verifies: 0, settles: 0, settled: 0, pending: 0, refusals: {}, feeLamports: 0 };
		for (const e of this.entries) {
			if (e.action === 'verify') out.verifies += 1;
			if (e.action === 'settle') out.settles += 1;
			if (e.ok && e.action === 'settle') {
				out.settled += 1;
				out.feeLamports += Number(e.feeLamports) || 0;
			} else if (e.pending) out.pending += 1;
			else if (!e.ok) {
				const cls = String(e.reason || 'unknown').split(':')[0];
				out.refusals[cls] = (out.refusals[cls] || 0) + 1;
			}
		}
		return out;
	}
}
