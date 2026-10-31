// Signature wall data: the browser half of /api/play/signature-wall. No DOM, no three.
//
// Memory stays flat however big the wall grows: this keeps only the newest page
// (`recent`) plus a small LRU of older pages that the canvas cycles through, and
// asks the server for any other page by rank when it is shown.

import { pageSize } from './signature-wall-style.js';

const API = '/api/play/signature-wall';
const RECENT_FETCH = 128; // the densest page, so page 0 is always one request
const OLD_PAGE_CACHE = 6;
const OLD_PAGE_TTL_MS = 60_000;
const SESSION_KEY = 'cc-sigwall-session';
const SIGNED_KEY = 'cc-sigwall-signed';

/** A refusal the panel can route on (err.code), with the server's own wording. */
export class WallClientError extends Error {
	constructor(code, message, extra = {}) {
		super(message);
		this.name = 'WallClientError';
		this.code = code;
		this.existing = extra.existing || null;
		this.retryAfter = extra.retryAfter || 0;
	}
}

function randomId(len = 24) {
	const bytes = new Uint8Array(len);
	crypto.getRandomValues(bytes);
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** A per-tab guest session id (the server allows one guest signature per session). */
export function guestSession() {
	try {
		let s = sessionStorage.getItem(SESSION_KEY);
		if (!s) { s = randomId(); sessionStorage.setItem(SESSION_KEY, s); }
		return s;
	} catch {
		return randomId();
	}
}

/** Remember which signature is ours so the panel can say so after a reload. */
export function rememberSigned(sig) {
	try { sessionStorage.setItem(SIGNED_KEY, JSON.stringify({ id: sig.id, no: sig.no, name: sig.name })); } catch { /* private mode */ }
}
export function recallSigned() {
	try {
		const v = JSON.parse(sessionStorage.getItem(SIGNED_KEY) || 'null');
		return v?.id ? v : null;
	} catch { return null; }
}

export class SignatureWallData {
	/** @param {{ fetchImpl?: typeof fetch }} [opts] */
	constructor({ fetchImpl } = {}) {
		this._fetch = fetchImpl || ((...a) => fetch(...a));
		this.total = 0;
		this.newestNo = 0;
		this.recent = [];          // newest first, up to RECENT_FETCH
		this._old = new Map();     // page index -> { at, sigs }
		this._inflight = null;
		this._lastRefresh = 0;
		this.loaded = false;
		this.more = false;         // the last since-read was full: read again
	}

	async _get(query) {
		let res;
		try {
			res = await this._fetch(`${API}?${query}`, { headers: { accept: 'application/json' } });
		} catch {
			throw new WallClientError('network', 'Could not reach the wall. Check your connection.');
		}
		const body = await res.json().catch(() => null);
		if (!res.ok || !body) throw new WallClientError(body?.error || 'read_failed', body?.error_description || 'Could not load the wall.');
		return body;
	}

	/** First load: the newest page and the total. Safe to call repeatedly. */
	async load() {
		const body = await this._get(`offset=0&limit=${RECENT_FETCH}`);
		this.total = body.total;
		this.recent = body.signatures;
		this.newestNo = this.recent[0]?.no || 0;
		this.loaded = true;
		return this;
	}

	/**
	 * Pull whatever landed since the last read. Coalesces bursts (a room ping fans
	 * out to everyone at once): concurrent callers share one request, and calls
	 * closer than `minGapMs` are skipped. Returns the new signatures, oldest first.
	 */
	async refresh({ minGapMs = 1200 } = {}) {
		if (!this.loaded) { await this.load(); return []; }
		if (this._inflight) return this._inflight;
		if (Date.now() - this._lastRefresh < minGapMs) return [];
		this._lastRefresh = Date.now();
		this._inflight = (async () => {
			try {
				const body = await this._get(`since=${this.newestNo}`);
				this.total = body.total;
				const known = new Set(this.recent.map((s) => s.id));
				const fresh = body.signatures.filter((s) => !known.has(s.id));
				for (const s of body.signatures) if (s.no > this.newestNo) this.newestNo = s.no;
				if (fresh.length) {
					this._mergeRecent(fresh);
					this._old.clear(); // ranks shifted; cached older pages are stale
				}
				this.more = body.signatures.length >= 200;
				return fresh;
			} finally {
				this._inflight = null;
			}
		})();
		return this._inflight;
	}

	_mergeRecent(sigs) {
		const byId = new Map(this.recent.map((s) => [s.id, s]));
		for (const s of sigs) byId.set(s.id, s);
		this.recent = [...byId.values()].sort((a, b) => b.no - a.no).slice(0, RECENT_FETCH);
	}

	/**
	 * Record a signature we just wrote so our own tile does not wait for a poll.
	 * newestNo is deliberately NOT advanced: a stranger may hold a lower number that
	 * the next since-read still has to fetch.
	 */
	adopt(sig, total) {
		this.total = total ?? this.total + 1;
		if (this.recent.some((s) => s.id === sig.id)) return false;
		this._mergeRecent([sig]);
		this._old.clear();
		return true;
	}

	get pageSize() { return pageSize(this.total); }

	/** Signatures of page `p` (0 = newest), newest first. */
	async page(p) {
		const size = this.pageSize;
		if (p === 0) return this.recent.slice(0, size);
		const hit = this._old.get(p);
		if (hit && Date.now() - hit.at < OLD_PAGE_TTL_MS) return hit.sigs;
		const body = await this._get(`offset=${p * size}&limit=${size}`);
		this.total = body.total;
		this._old.delete(p);
		this._old.set(p, { at: Date.now(), sigs: body.signatures });
		while (this._old.size > OLD_PAGE_CACHE) this._old.delete(this._old.keys().next().value);
		return body.signatures;
	}

	/**
	 * Sign the wall. `playPass` (when signed in) makes it permanent per wallet; a
	 * guest is identified by the tab's session id. Throws WallClientError.
	 */
	async sign({ name, line, playPass }) {
		const payload = { name, line };
		if (playPass) payload.playPass = playPass; else payload.session = guestSession();
		let res;
		try {
			res = await this._fetch(API, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify(payload),
			});
		} catch {
			throw new WallClientError('network', 'Could not reach the wall. Check your connection and try again.');
		}
		const body = await res.json().catch(() => null);
		if (res.status === 201 && body?.signature) {
			this.adopt(body.signature, body.total);
			return body;
		}
		throw new WallClientError(
			body?.error || 'sign_failed',
			body?.error_description || 'Could not sign the wall. Try again.',
			{ existing: body?.existing, retryAfter: Number(res.headers?.get?.('retry-after')) || body?.retry_after || 0 },
		);
	}
}
