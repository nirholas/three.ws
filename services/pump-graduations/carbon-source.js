/**
 * Carbon-backed graduation source.
 * Drop-in alternative to the legacy conn.onLogs subscription in index.js.
 *
 * Interface contract:
 *   const src = new CarbonGraduationSource({ connection });
 *   src.start((ev) => { /* ev: { mint, signature, ts, marketCapUsd } *\/ });
 *   src.stop();
 *
 * The `logSubscriber` constructor option overrides the Solana subscription
 * call and is used exclusively by tests to inject a mock stream.
 *
 * Env (inherited from parent service — no separate env needed):
 *   SOLANA_RPC_URL / SOLANA_WS_URL are consumed by index.js before this
 *   source is instantiated.
 */

import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Anchor "event" CPI emit discriminator: sha256("event:CompleteEvent")[..8]
const COMPLETE_EVENT_DISCRIMINATOR = Buffer.from([95, 114, 97, 156, 212, 46, 152, 8]);

export class CarbonGraduationSource {
	/**
	 * @param {object} opts
	 * @param {import('@solana/web3.js').Connection} [opts.connection]
	 *   Solana Connection instance (used by the production path).
	 * @param {Function} [opts.logSubscriber]
	 *   Injectable log-subscription function matching Connection.onLogs's
	 *   signature: (programId, handler, commitment) => subscriptionId.
	 *   When provided, `connection` is ignored for subscribing (but may still
	 *   be used externally for enrichment).
	 */
	constructor({ connection, logSubscriber } = {}) {
		this._conn = connection;
		this._logSubscriber = logSubscriber;
		this._subId = null;
		this._seen = new Set();
	}

	start(onGraduation) {
		const handler = (entry) => this._handle(entry, onGraduation);
		if (this._logSubscriber) {
			this._subId = this._logSubscriber(PUMP_PROGRAM_ID, handler, 'confirmed');
		} else {
			this._subId = this._conn.onLogs(PUMP_PROGRAM_ID, handler, 'confirmed');
		}
	}

	stop() {
		if (this._conn && this._subId != null) {
			this._conn.removeOnLogsListener(this._subId);
			this._subId = null;
		}
	}

	_handle(entry, onGraduation) {
		if (entry.err) return;
		const sig = entry.signature;
		if (this._seen.has(sig)) return;
		if (!entry.logs?.some((l) => l.includes('Program data:'))) return;

		const ev = parseGraduation(sig, entry.logs);
		if (!ev) return;

		this._seen.add(sig);
		if (this._seen.size > 5000) this._seen.clear();

		onGraduation(ev);
	}
}

/**
 * Parse a CompleteEvent from raw program logs.
 * Returns { mint, signature, ts, marketCapUsd } or null.
 */
function parseGraduation(sig, logs) {
	for (const line of logs) {
		const m = line.match(/^Program data: (.+)$/);
		if (!m) continue;
		let data;
		try { data = Buffer.from(m[1], 'base64'); } catch { continue; }
		if (data.length < 8) continue;
		if (!data.subarray(0, 8).equals(COMPLETE_EVENT_DISCRIMINATOR)) continue;

		// CompleteEvent layout: discriminator(8) user(32) mint(32) bondingCurve(32) timestamp(i64)
		if (data.length < 8 + 32 + 32 + 32 + 8) continue;
		let off = 8 + 32; // skip discriminator + user
		const mint = bs58.encode(data.subarray(off, off + 32)); off += 32;
		off += 32; // skip bondingCurve
		const ts = Number(data.readBigInt64LE(off));

		return { mint, signature: sig, ts, marketCapUsd: null };
	}
	return null;
}
