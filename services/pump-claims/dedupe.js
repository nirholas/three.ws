/**
 * Bounded signature dedupe, same shape as services/pump-graduations's
 * SeenSignatures: a WS resubscribe or a gap-fill replay can hand this
 * listener the same signature twice, and an unbounded Set would grow for the
 * life of the process.
 *
 * Drops the oldest quarter when full rather than clearing outright, so a
 * signature seen one event ago still dedupes right after a trim.
 */
export class SeenSignatures {
	constructor(limit = 5000) {
		this._limit = limit;
		this._sigs = new Set();
	}

	/** @returns {boolean} true the first time a signature is offered. */
	add(signature) {
		if (!signature || this._sigs.has(signature)) return false;
		this._sigs.add(signature);
		if (this._sigs.size > this._limit) {
			const drop = Math.floor(this._limit / 4);
			const it = this._sigs.values();
			for (let i = 0; i < drop; i++) this._sigs.delete(it.next().value);
		}
		return true;
	}

	/** Cheap pre-check, e.g. to skip an RPC fetch before `add` would reject it anyway. */
	has(signature) {
		return this._sigs.has(signature);
	}

	get size() {
		return this._sigs.size;
	}
}
