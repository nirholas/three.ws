/**
 * Sell-all ("liquidate") planning and execution for an agent wallet.
 *
 * An agent that trades on its own (the sniper fleet, strategies, the copilot)
 * can leave a wallet full of coins. The owner needs one action that gets them
 * out of everything. This module is the shared core behind every "Sell all"
 * button (the wallet hub Trade + Portfolio tabs and the sniper dashboard):
 *
 *   planLiquidation()  : pure. Turns the wallet's real token holdings plus the
 *                        agent's open sniper positions into one sell per coin,
 *                        routed to the right endpoint.
 *   runLiquidation()   : sells the plan one coin at a time through a caller-
 *                        supplied `sellOne`, waits out a 429 instead of failing
 *                        the row, and stops cleanly when the owner hits Stop.
 *   summarizeLiquidation() : pure. Counts and SOL received, for the result line.
 *
 * Routing: a coin the sniper still holds as an OPEN position is closed through
 * POST /api/sniper/close, which claims the position row (so the worker cannot
 * fire a second sell for the same bag) and books realized PnL on the position.
 * Everything else is a plain wallet sell through POST /api/agents/:id/solana/trade.
 * A position the sniper is already opening or closing is marked busy and left
 * alone: selling it underneath the worker would race its own transaction.
 *
 * Sells run sequentially on purpose. Each one is a real, separately guarded,
 * idempotent request (one server call cannot confirm N transactions inside the
 * function time cap), and serial order keeps the per-user trade rate limit and
 * the wallet's fee headroom predictable. Coin-agnostic: it sells whatever mints
 * the wallet actually holds; nothing here names a token.
 */

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Sniper position statuses that mean the worker is mid-transaction on the coin. */
const BUSY_STATUSES = new Set(['opening', 'closing']);

/** Default wait when a 429 arrives without a usable retry-after. */
const DEFAULT_RETRY_AFTER_S = 10;

function toBig(v) {
	try {
		const s = String(v ?? '0');
		return /^\d+$/.test(s) ? BigInt(s) : 0n;
	} catch {
		return 0n;
	}
}

function rawToUi(raw, decimals) {
	const d = Number.isInteger(decimals) && decimals >= 0 ? decimals : 6;
	return Number(toBig(raw)) / 10 ** d;
}

/**
 * Build the sell plan.
 *
 * @param {object} p
 * @param {Array<{ mint: string, amount_raw: string, decimals?: number, ui_amount?: number, is_usdc?: boolean }>} p.holdings
 *        Real token balances (GET /api/agents/:id/solana/holdings `tokens`).
 * @param {Array<{ id: string, mint: string, status: string, base_amount?: string|null, symbol?: string|null, name?: string|null }>} [p.sniperPositions]
 *        The agent's live sniper positions (GET /api/sniper/close).
 * @param {Record<string, { symbol?: string|null, name?: string|null, usd_value?: number|null, image?: string|null }>} [p.meta]
 *        Optional per-mint display enrichment (symbol, name, live USD value).
 * @returns {Array<object>} one item per coin, highest value first.
 */
export function planLiquidation({ holdings = [], sniperPositions = [], meta = {} } = {}) {
	const posByMint = new Map();
	for (const p of sniperPositions || []) {
		if (!p?.mint) continue;
		const prev = posByMint.get(p.mint);
		// An open position wins over a busy one for the same mint: it is the one
		// that still holds tokens the owner can close.
		if (!prev || (prev.status !== 'open' && p.status === 'open')) posByMint.set(p.mint, p);
	}

	const items = [];
	const seen = new Set();

	for (const h of holdings || []) {
		if (!h?.mint || h.is_usdc || h.mint === WSOL_MINT || seen.has(h.mint)) continue;
		const amountRaw = toBig(h.amount_raw);
		if (amountRaw <= 0n) continue;
		seen.add(h.mint);
		items.push(makeItem({
			mint: h.mint,
			amountRaw: amountRaw.toString(),
			decimals: Number.isInteger(h.decimals) ? h.decimals : 6,
			uiAmount: Number.isFinite(Number(h.ui_amount)) ? Number(h.ui_amount) : null,
			position: posByMint.get(h.mint) || null,
			meta: meta[h.mint],
		}));
	}

	// An open sniper position the balance read did not return (a partial read, or
	// an RPC that lagged the buy) is still a real position the owner wants out of.
	for (const p of posByMint.values()) {
		if (seen.has(p.mint) || p.status !== 'open') continue;
		const amountRaw = toBig(p.base_amount);
		if (amountRaw <= 0n) continue;
		seen.add(p.mint);
		items.push(makeItem({
			mint: p.mint,
			amountRaw: amountRaw.toString(),
			decimals: 6,
			uiAmount: null,
			position: p,
			meta: meta[p.mint],
		}));
	}

	items.sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1) || (b.uiAmount ?? 0) - (a.uiAmount ?? 0));
	return items;
}

function makeItem({ mint, amountRaw, decimals, uiAmount, position, meta }) {
	const busy = !!position && BUSY_STATUSES.has(position.status);
	const route = position && position.status === 'open' ? 'sniper' : 'wallet';
	return {
		mint,
		symbol: meta?.symbol || position?.symbol || null,
		name: meta?.name || position?.name || null,
		image: meta?.image || null,
		amountRaw,
		decimals,
		uiAmount: uiAmount ?? rawToUi(amountRaw, decimals),
		usdValue: Number.isFinite(meta?.usd_value) ? meta.usd_value : null,
		route,
		positionId: route === 'sniper' ? position.id : null,
		busy,
		busyReason: busy
			? (position.status === 'opening' ? 'The agent is still buying this coin.' : 'The agent is already selling this coin.')
			: null,
		selected: !busy,
		state: busy ? 'busy' : 'queued',
		solOut: null,
		explorer: null,
		simulated: false,
		error: null,
		errorCode: null,
		waitSeconds: null,
	};
}

/** Seconds to wait on a rate-limit error, from whatever shape the caller threw. */
export function retryAfterSeconds(err) {
	const candidates = [err?.retryAfter, err?.retry_after, err?.detail?.retry_after];
	for (const c of candidates) {
		const n = Number(c);
		if (Number.isFinite(n) && n > 0) return Math.min(120, Math.ceil(n));
	}
	return DEFAULT_RETRY_AFTER_S;
}

function abortableSleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const t = setTimeout(done, ms);
		function done() {
			clearTimeout(t);
			signal?.removeEventListener?.('abort', done);
			resolve();
		}
		signal?.addEventListener?.('abort', done, { once: true });
	});
}

/**
 * Sell every selected, non-busy item in order.
 *
 * `sellOne(item)` performs one real sell and resolves `{ solOut, explorer, simulated }`
 * or throws an error carrying `code` (and, for a 429, a retry-after). Items are
 * mutated in place and `onUpdate(item)` fires on every state change, so the UI
 * can re-render one row at a time.
 *
 * @param {object} p
 * @param {Array<object>} p.items                 planLiquidation() output
 * @param {(item: object) => Promise<{ solOut?: number|null, explorer?: string|null, simulated?: boolean }>} p.sellOne
 * @param {(item: object) => void} [p.onUpdate]
 * @param {AbortSignal} [p.signal]                abort = Stop: the current sell finishes, the rest are skipped
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [p.sleep]
 * @param {number} [p.maxRateRetries]
 * @returns {Promise<ReturnType<typeof summarizeLiquidation>>}
 */
export async function runLiquidation({ items, sellOne, onUpdate = () => {}, signal, sleep = abortableSleep, maxRateRetries = 4 }) {
	for (const item of items) {
		if (!item.selected || item.busy) continue;
		if (item.state === 'sold') continue;
		if (signal?.aborted) {
			item.state = 'skipped';
			onUpdate(item);
			continue;
		}

		let attempts = 0;
		for (;;) {
			item.state = 'selling';
			item.error = null;
			item.errorCode = null;
			item.waitSeconds = null;
			onUpdate(item);
			try {
				const out = (await sellOne(item)) || {};
				item.state = 'sold';
				item.solOut = Number.isFinite(out.solOut) ? out.solOut : null;
				item.explorer = out.explorer || null;
				item.simulated = !!out.simulated;
				onUpdate(item);
				break;
			} catch (err) {
				const code = err?.code || 'error';
				if (code === 'rate_limited' && attempts < maxRateRetries && !signal?.aborted) {
					attempts += 1;
					item.state = 'waiting';
					item.waitSeconds = retryAfterSeconds(err);
					onUpdate(item);
					await sleep(item.waitSeconds * 1000, signal);
					if (signal?.aborted) {
						item.state = 'skipped';
						item.waitSeconds = null;
						onUpdate(item);
						break;
					}
					continue;
				}
				item.state = 'failed';
				item.errorCode = code;
				item.error = err?.message || 'The sell did not complete.';
				onUpdate(item);
				break;
			}
		}
	}
	return summarizeLiquidation(items);
}

/** Totals for the result line. Pure. */
export function summarizeLiquidation(items = []) {
	let sold = 0;
	let failed = 0;
	let skipped = 0;
	let busy = 0;
	let pending = 0;
	let solOut = 0;
	let solOutKnown = false;
	for (const it of items) {
		if (it.state === 'sold') {
			sold += 1;
			if (Number.isFinite(it.solOut)) { solOut += it.solOut; solOutKnown = true; }
		} else if (it.state === 'failed') failed += 1;
		else if (it.state === 'skipped') skipped += 1;
		else if (it.state === 'busy') busy += 1;
		else if (it.selected && (it.state === 'queued' || it.state === 'selling' || it.state === 'waiting')) pending += 1;
	}
	return { sold, failed, skipped, busy, pending, solOut: solOutKnown ? solOut : null };
}
