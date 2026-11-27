// Settled $THREE proofs the Forge has not spent yet, kept across reloads.
//
// A pay-per-use payment (High generation, keep a model, Game-Ready) settles first
// and is redeemed by a second request. When that second request fails, or the
// tab reloads in between, an in-memory proof is gone and the next click would
// charge again for something already paid. The pay sheet records every settled
// proof here, reuses an unspent one for the same action and price, and the
// caller forgets it once the server has taken it.
//
// Holds only { paymentId, refId }: useless without the matching server records,
// and each pair is single-use on the server, so a stale entry can at worst be
// refused (payment_already_used), never spent twice.

const STORE_KEY = 'forge:settled-proofs:v1';
// The server honors a settled proof for 24 hours; stop offering one a little
// before that so a reused proof is never refused as expired mid-flow.
export const PROOF_TTL_MS = 23 * 60 * 60 * 1000;
const MAX_PROOFS = 12;

function storage() {
	try {
		return typeof localStorage !== 'undefined' ? localStorage : null;
	} catch {
		return null;
	}
}

function readAll() {
	const store = storage();
	if (!store) return [];
	try {
		const list = JSON.parse(store.getItem(STORE_KEY) || '[]');
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

function writeAll(list) {
	const store = storage();
	if (!store) return;
	try {
		if (list.length) store.setItem(STORE_KEY, JSON.stringify(list.slice(-MAX_PROOFS)));
		else store.removeItem(STORE_KEY);
	} catch {
		// Storage full or blocked: the proof still reaches the caller in memory.
	}
}

const sameAction = (p, kind, usd) => p.kind === kind && Math.abs(Number(p.usd) - Number(usd)) < 0.005;
const fresh = (p, now) => now - Number(p.savedAt) < PROOF_TTL_MS;

/** Record a proof that just settled. */
export function rememberPaidProof({ kind, usd, paymentId, refId }) {
	if (!kind || !paymentId || !refId) return;
	const now = Date.now();
	const list = readAll().filter((p) => fresh(p, now) && p.paymentId !== paymentId);
	list.push({ kind, usd: Number(usd), paymentId, refId, savedAt: now });
	writeAll(list);
}

/** The newest unspent proof for this action and price, or null. */
export function unspentPaidProof({ kind, usd }) {
	const now = Date.now();
	const list = readAll();
	const live = list.filter((p) => fresh(p, now));
	if (live.length !== list.length) writeAll(live);
	const hit = live.filter((p) => sameAction(p, kind, usd)).pop();
	return hit ? { paymentId: hit.paymentId, refId: hit.refId } : null;
}

/** Drop a proof the server has redeemed or refused. */
export function forgetPaidProof(paymentId) {
	if (!paymentId) return;
	const list = readAll();
	const next = list.filter((p) => p.paymentId !== paymentId);
	if (next.length !== list.length) writeAll(next);
}
