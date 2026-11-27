// src/pump/three-token-data.js
// ---------------------------------------------------------------------------
// Single source of truth for $THREE token data on the client.
//
// Every holder surface (dashboard "your position", token page price header,
// the live HUD) used to fetch the same handful of
// /api/three-token/* endpoints inline and drift apart. This module centralises
// those reads into one subscribable store so each surface renders from one
// snapshot and they never disagree.
//
// It wraps only EXISTING endpoints — no new fetch primitives:
//   GET  /api/three-token/stats          (public, edge-cached)  → protocol + token market
//   GET  /api/three-token/activity                              → recent revenue events
//   GET  /api/three-token/burns                                 → platform burn ledger (empty: the platform never burns)
//   POST /api/wallet/balances {chain:'solana',address}          → the holder's position
//
// Design: a plain subscribable store (this codebase is vanilla JS modules, not
// React). Each top-level field carries its OWN status so a widget can render an
// independent loading / empty / error state without waiting on the others.
//
// Only $THREE is ever referenced here. The mint below is the canonical $THREE
// contract; the store also reads the mint back from /stats so there is a single
// server-authoritative value used to locate the holder's position row.

import { get, post, getMe, ApiError } from '../dashboard-next/api.js';
import { log } from '../shared/log.js';

/** Canonical $THREE mint. The one and only coin. */
export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

// A Solana address is base58, 32–44 chars. Used to ignore an EVM (0x…) primary
// wallet when resolving which address to read a Solana balance for.
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DEFAULT_POLL_MS = 30_000;
const MIN_POLL_MS = 10_000;

function errInfo(err) {
	if (err instanceof ApiError) return { status: err.status, code: err.code, message: err.message };
	return { status: 0, code: 'network_error', message: err?.message || 'request failed' };
}

function freshState() {
	return {
		protocol:     { status: 'loading', token: null, protocol: null, buyback: null, source: null, updatedAt: null, error: null },
		activity:     { status: 'loading', events: [], error: null },
		burns:        { status: 'loading', burns: [], total_burned: null, burn_per_deploy: null, error: null },
		// position is `idle` until a wallet is known. Statuses:
		//   idle | loading | unauthenticated | no_wallet | zero | ok | error
		position:     { status: 'idle', wallet: null, amount: null, usd: null, pctOfSupply: null, price: null, error: null },
	};
}

/**
 * Create a $THREE data store.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.pollMs=30000]   Poll cadence for protocol + activity (min 10s).
 * @param {string}  [opts.wallet]         Explicit Solana address for the position
 *                                        (e.g. the connected wallet the UI already
 *                                        knows). When omitted, the store resolves it
 *                                        from the signed-in user.
 * @param {Element} [opts.anchorEl]       When the node leaves the DOM, the store
 *                                        tears itself down automatically.
 * @param {boolean} [opts.autoStart=true] Kick an initial refresh + position fetch and
 *                                        start polling immediately.
 * @returns {{
 *   getState: () => object,
 *   subscribe: (fn: (state: object) => void) => (() => void),
 *   refresh: () => Promise<void>,
 *   refreshPosition: () => Promise<void>,
 *   setWallet: (address: string|null) => void,
 *   destroy: () => void,
 * }}
 */
export function createThreeTokenData(opts = {}) {
	const pollMs = Math.max(MIN_POLL_MS, Number(opts.pollMs) || DEFAULT_POLL_MS);
	const autoStart = opts.autoStart !== false;

	let state = freshState();
	const subs = new Set();
	let timer = null;
	let observer = null;
	let destroyed = false;
	let walletOverride = (opts.wallet && SOL_ADDRESS_RE.test(opts.wallet)) ? opts.wallet : null;

	function getState() {
		return state;
	}

	function emit() {
		for (const fn of subs) {
			try { fn(state); } catch (err) { log.error('[three-token-data] subscriber threw', err); }
		}
	}

	// Replace one field immutably so subscribers can cheaply diff by reference.
	function patch(key, partial) {
		if (destroyed) return;
		state = { ...state, [key]: { ...state[key], ...partial } };
		emit();
	}

	async function loadProtocol() {
		try {
			const data = await get('/api/three-token/stats');
			patch('protocol', {
				status: 'ok',
				token: data?.token ?? null,
				protocol: data?.protocol ?? null,
				buyback: data?.buyback ?? null,
				source: data?.token?.source ?? null,
				updatedAt: Date.now(),
				error: null,
			});
		} catch (err) {
			patch('protocol', { status: 'error', error: errInfo(err) });
		}
	}

	async function loadActivity() {
		try {
			const data = await get('/api/three-token/activity');
			patch('activity', { status: 'ok', events: Array.isArray(data?.events) ? data.events : [], error: null });
		} catch (err) {
			patch('activity', { status: 'error', error: errInfo(err) });
		}
	}

	async function loadBurns() {
		try {
			const data = await get('/api/three-token/burns');
			patch('burns', {
				status: 'ok',
				burns: Array.isArray(data?.burns) ? data.burns : [],
				total_burned: data?.total_burned ?? null,
				burn_per_deploy: data?.burn_per_deploy ?? null,
				error: null,
			});
		} catch (err) {
			patch('burns', { status: 'error', error: errInfo(err) });
		}
	}

	// Resolve which Solana address to read the position for. Returns a base58
	// address string, or a sentinel describing why there isn't one.
	async function resolveWallet() {
		if (walletOverride) return walletOverride;
		let me;
		try {
			me = await getMe();
		} catch (err) {
			return { error: errInfo(err) };
		}
		if (!me) return { unauthenticated: true };
		const candidates = [me.solana_address, me.sol_address, me.solana, me.wallet_address];
		for (const c of candidates) {
			if (typeof c === 'string' && SOL_ADDRESS_RE.test(c)) return c;
		}
		return { noWallet: true };
	}

	async function loadPosition() {
		patch('position', { status: 'loading', error: null });
		const resolved = await resolveWallet();

		if (resolved && resolved.unauthenticated) {
			patch('position', { status: 'unauthenticated', wallet: null, amount: null, usd: null, pctOfSupply: null });
			return;
		}
		if (resolved && resolved.noWallet) {
			patch('position', { status: 'no_wallet', wallet: null, amount: null, usd: null, pctOfSupply: null });
			return;
		}
		if (resolved && resolved.error) {
			patch('position', { status: 'error', error: resolved.error });
			return;
		}

		const wallet = resolved;
		const mint = state.protocol.token?.mint || THREE_MINT;
		const price = state.protocol.token?.price_usd ?? null;
		const supply = Number(state.protocol.token?.supply) || null;

		try {
			const bal = await post('/api/wallet/balances', { chain: 'solana', address: wallet });
			const row = (bal?.tokens || []).find((t) => t && t.mint === mint);
			const amount = row ? Number(row.amount) || 0 : 0;

			if (amount <= 0) {
				patch('position', { status: 'zero', wallet, amount: 0, usd: 0, pctOfSupply: 0, price });
				return;
			}

			const usd = row.usd != null && Number.isFinite(Number(row.usd))
				? Number(row.usd)
				: (price != null ? amount * Number(price) : null);
			const pctOfSupply = supply ? amount / supply : null;
			patch('position', { status: 'ok', wallet, amount, usd, pctOfSupply, price, error: null });
		} catch (err) {
			patch('position', { status: 'error', wallet, error: errInfo(err) });
		}
	}

	// ── Public operations ────────────────────────────────────────────────────

	async function refresh() {
		await Promise.all([loadProtocol(), loadActivity(), loadBurns()]);
	}

	async function refreshPosition() {
		// Position depends on the latest protocol snapshot (mint + supply + price).
		// If protocol hasn't loaded yet, pull it first so % of supply / USD resolve.
		if (state.protocol.status !== 'ok') await loadProtocol();
		await loadPosition();
	}

	function setWallet(address) {
		const next = (address && SOL_ADDRESS_RE.test(address)) ? address : null;
		if (next === walletOverride) return;
		walletOverride = next;
		if (!destroyed) void refreshPosition();
	}

	function subscribe(fn) {
		if (typeof fn !== 'function') return () => {};
		subs.add(fn);
		// Push the current snapshot immediately so late subscribers aren't blank.
		try { fn(state); } catch (err) { log.error('[three-token-data] subscriber threw', err); }
		return () => subs.delete(fn);
	}

	function destroy() {
		if (destroyed) return;
		destroyed = true;
		if (timer) { clearInterval(timer); timer = null; }
		if (observer) { observer.disconnect(); observer = null; }
		subs.clear();
	}

	// Tear down automatically when the anchor element leaves the DOM, so a store
	// tied to a page section can't keep polling after the section is gone.
	function watchAnchor(el) {
		if (!el || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
		observer = new MutationObserver(() => {
			if (!el.isConnected) destroy();
		});
		observer.observe(document.body, { childList: true, subtree: true });
	}

	if (opts.anchorEl) watchAnchor(opts.anchorEl);

	if (autoStart) {
		void refresh();
		void refreshPosition();
		if (typeof setInterval !== 'undefined') {
			timer = setInterval(() => {
				if (destroyed) return;
				// Poll only the live protocol + activity surfaces. Position is on
				// demand (after sign-in / a trade) so we don't hammer the balances RPC.
				void loadProtocol();
				void loadActivity();
			}, pollMs);
		}
	}

	return { getState, subscribe, refresh, refreshPosition, setWallet, destroy };
}

export default createThreeTokenData;
