/**
 * Live log subscription on the PumpFees program with an explicit watchdog.
 *
 * `Connection.onLogs` holds its own WebSocket and reconnects at the transport
 * layer, but a silently stuck subscription (socket open, server stopped
 * pushing) looks identical to "no claims happened" from here -- and claims
 * are rare enough that silence is the normal case. So liveness is judged by
 * a periodic lightweight RPC call (`getSlot`), not by claim volume: a missed
 * heartbeat means the connection, not the claim rate, and only repeated
 * misses force a resubscribe. On a forced resubscribe, `onReconnect` fires so
 * the caller can gap-fill whatever the dead window missed.
 */

import { PublicKey } from '@solana/web3.js';
import { PUMP_FEE_PROGRAM_ID } from '../../api/_lib/solana/programs.js';

// Connection.onLogs's filter param must be a PublicKey instance (it wraps it
// as {mentions: [pubkey.toBase58()]} internally) or the literal strings
// 'all'/'allWithVotes'. A bare program-id string is neither: the RPC node
// rejects it with "unknown variant <id>, expected one of all, allWithVotes,
// mentions" because the client sends the string through as-is instead of a
// mentions filter. Build the PublicKey once at module load, not per-call.
const PUMP_FEE_PROGRAM_KEY = new PublicKey(PUMP_FEE_PROGRAM_ID);

const HEARTBEAT_MS = 30_000;
const MAX_MISSED_HEARTBEATS = 3;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const RESUBSCRIBE_BACKOFF_BASE_MS = 2_000;
const RESUBSCRIBE_BACKOFF_MAX_MS = 60_000;

export class ClaimListener {
	/**
	 * @param {object} opts
	 * @param {import('@solana/web3.js').Connection} [opts.connection]
	 * @param {Function} [opts.logSubscriber] Injectable override matching
	 *   Connection.onLogs's signature `(programId, handler, commitment) => subId`,
	 *   used by tests to inject a fake subscription. `connection` is still used
	 *   for the heartbeat probe when both are provided.
	 * @param {number} [opts.heartbeatMs]
	 * @param {number} [opts.maxMissedHeartbeats]
	 * @param {number} [opts.heartbeatTimeoutMs]
	 */
	constructor({
		connection,
		logSubscriber,
		heartbeatMs = HEARTBEAT_MS,
		maxMissedHeartbeats = MAX_MISSED_HEARTBEATS,
		heartbeatTimeoutMs = HEARTBEAT_TIMEOUT_MS,
	} = {}) {
		this._conn = connection;
		this._logSubscriber = logSubscriber;
		this._heartbeatMs = heartbeatMs;
		this._maxMissed = maxMissedHeartbeats;
		this._heartbeatTimeoutMs = heartbeatTimeoutMs;
		this._subId = null;
		this._missed = 0;
		this._backoffAttempt = 0;
		this._heartbeatTimer = null;
		this._stopped = true;
		this._onEntry = null;
		this._onReconnect = null;
	}

	/**
	 * @param {(entry: {signature: string, logs?: string[], err?: unknown}, context?: {slot: number}) => void} onEntry
	 * @param {() => void} [onReconnect] Called after every forced resubscribe.
	 */
	start(onEntry, onReconnect) {
		this._onEntry = onEntry;
		this._onReconnect = onReconnect || null;
		this._stopped = false;
		this._subscribe();
		this._heartbeatTimer = setInterval(() => this._heartbeatTick(), this._heartbeatMs);
		this._heartbeatTimer.unref?.();
	}

	stop() {
		this._stopped = true;
		if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
		this._heartbeatTimer = null;
		this._teardown();
	}

	get missedHeartbeats() {
		return this._missed;
	}

	_subscribe() {
		const handler = (entry, context) => {
			this._missed = 0;
			this._onEntry?.(entry, context);
		};
		try {
			this._subId = this._logSubscriber
				? this._logSubscriber(PUMP_FEE_PROGRAM_KEY, handler, 'confirmed')
				: this._conn.onLogs(PUMP_FEE_PROGRAM_KEY, handler, 'confirmed');
			this._backoffAttempt = 0;
		} catch (err) {
			console.error('[pump-claims] subscribe failed:', err?.message || err);
			this._scheduleResubscribe();
		}
	}

	_teardown() {
		if (this._conn && this._subId != null) {
			try {
				this._conn.removeOnLogsListener(this._subId);
			} catch {
				/* best effort: a dead connection cannot remove its own listener */
			}
		}
		this._subId = null;
	}

	_scheduleResubscribe() {
		const delay = Math.min(
			RESUBSCRIBE_BACKOFF_MAX_MS,
			RESUBSCRIBE_BACKOFF_BASE_MS * 2 ** this._backoffAttempt,
		);
		this._backoffAttempt += 1;
		const t = setTimeout(() => {
			if (!this._stopped) this._subscribe();
		}, delay);
		t.unref?.();
	}

	/** Exercised directly by tests; also wired to the real heartbeat interval. */
	async _heartbeatTick() {
		if (this._stopped) return;
		try {
			await this._probe();
			this._missed = 0;
		} catch {
			this._missed += 1;
			if (this._missed >= this._maxMissed) {
				this._missed = 0;
				console.warn('[pump-claims] heartbeat missed %d times, resubscribing', this._maxMissed);
				this._teardown();
				this._subscribe();
				this._onReconnect?.();
			}
		}
	}

	async _probe() {
		let timer;
		try {
			await new Promise((resolve, reject) => {
				timer = setTimeout(() => reject(new Error('heartbeat timeout')), this._heartbeatTimeoutMs);
				this._conn.getSlot('confirmed').then(resolve, reject);
			});
		} finally {
			clearTimeout(timer);
		}
	}
}
