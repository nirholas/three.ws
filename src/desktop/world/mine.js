// Gem mining client. Progress is the real time the player spends holding the
// dig key at a vein (advanced by the frame loop's dt), and the gem itself is
// rolled by the server, which also enforces the cadence. Visitors mine under
// the same stable browser id the walk pages use, so their gems move onto the
// account when they sign in.

import { DIG_SECONDS, GEM_BY_ID, GEMS } from '../../../api/_lib/world-gems.js';

const ANON_KEY = 'twx_walk_anon';

export { DIG_SECONDS, GEMS, GEM_BY_ID };

export function anonId() {
	try {
		let id = localStorage.getItem(ANON_KEY);
		if (!id) {
			id = `anon_${crypto.randomUUID()}`;
			localStorage.setItem(ANON_KEY, id);
		}
		return id;
	} catch {
		if (!anonId._mem) anonId._mem = `anon_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
		return anonId._mem;
	}
}

/**
 * @param {{ onBalance?: (b: object) => void, fetchFn?: typeof fetch }} [o]
 */
export function createMiner({ onBalance, fetchFn = fetch } = {}) {
	let balance = { gems: {}, points: 0, total: 0, miner: null };
	let progress = 0;
	let activeVein = null;
	let inflight = null;

	async function refresh() {
		try {
			const r = await fetchFn(`/api/world/gems?anonId=${encodeURIComponent(anonId())}`, { credentials: 'include', headers: { accept: 'application/json' } });
			if (!r.ok) throw new Error(`gems ${r.status}`);
			const b = await r.json();
			balance = b;
			onBalance?.(b);
			return b;
		} catch (err) {
			balance = { ...balance, offline: true, error: err.message };
			onBalance?.(balance);
			return balance;
		}
	}

	/**
	 * Advance the dig. Call every frame with whether the dig key is held and
	 * which vein (if any) is in reach. Resolves the server call when the hold
	 * completes. Returns the 0..1 progress for the HUD.
	 */
	function tick(dt, holding, veinId) {
		if (!holding || !veinId || inflight) {
			if (!inflight) progress = Math.max(0, progress - dt * 1.5);
			if (!veinId) activeVein = null;
			return progress;
		}
		if (activeVein !== veinId) {
			activeVein = veinId;
			progress = 0;
		}
		progress = Math.min(1, progress + dt / DIG_SECONDS);
		return progress;
	}

	/** True when the hold has completed and a dig should be submitted. */
	const ready = () => progress >= 1 && !inflight;

	async function dig(veinId) {
		if (inflight) return inflight;
		progress = 0;
		inflight = (async () => {
			try {
				const r = await fetchFn('/api/world/gems', {
					method: 'POST',
					credentials: 'include',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ node: veinId, anonId: anonId() }),
				});
				const body = await r.json().catch(() => ({}));
				if (!r.ok) return { ok: false, error: body.error || `http_${r.status}`, message: body.error_description || 'The vein did not yield.', retryIn: body.retry_in_sec };
				balance = body;
				onBalance?.(body);
				return { ok: true, mined: body.mined, balance: body };
			} catch (err) {
				return { ok: false, error: 'offline', message: `The gem ledger is unreachable (${err.message}).` };
			} finally {
				inflight = null;
			}
		})();
		return inflight;
	}

	return {
		refresh,
		tick,
		ready,
		dig,
		get progress() {
			return progress;
		},
		get balance() {
			return balance;
		},
		get busy() {
			return !!inflight;
		},
	};
}
