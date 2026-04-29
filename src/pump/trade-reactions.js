/**
 * Wire pump.fun live trades into avatar reactions.
 *
 * attachTradeReactions(agent, { mint, intensity })
 *   Subscribes to trades for `mint` via SSE. On significant events:
 *     large buy  → agent.playEmote('cheer')
 *     large sell → agent.playEmote('flinch')
 *     graduation → agent.playEmote('celebrate')
 *   "Significant" = top 10% of trade sizes in a rolling 5-min window.
 *   Returns a detach function.
 */

const FEED_PATH = '/api/agents/pumpfun-feed';
const WINDOW_MS = 5 * 60 * 1000;
const MIN_SAMPLES = 5;

/** 90th-percentile of `amounts`. Returns Infinity when fewer than MIN_SAMPLES. */
function p90(amounts) {
	if (amounts.length < MIN_SAMPLES) return Infinity;
	const sorted = amounts.slice().sort((a, b) => a - b);
	return sorted[Math.floor(0.9 * sorted.length)];
}

/**
 * @param {object} agent — Agent3DElement with a playEmote(name, intensity) method
 * @param {{ mint: string, intensity?: number, _EventSource?: typeof EventSource }} opts
 * @returns {() => void} detach
 */
export function attachTradeReactions(agent, { mint, intensity = 1, _EventSource = globalThis.EventSource } = {}) {
	if (!mint || !_EventSource) return () => {};

	// Rolling buffer of { amount: number, ts: number }
	const buf = [];

	function flush() {
		const cutoff = Date.now() - WINDOW_MS;
		while (buf.length && buf[0].ts < cutoff) buf.shift();
	}

	function onTrade(msg) {
		let data;
		try { data = JSON.parse(msg.data); } catch { return; }

		const amount = data.solAmount ?? data.sol_amount ?? data.amount ?? 0;
		const isBuy =
			data.txType === 'buy' ||
			data.isBuy === true ||
			data.is_buy === true ||
			data.type === 'buy';

		// Threshold is computed from history; then add the current trade.
		flush();
		const threshold = p90(buf.map((e) => e.amount));
		buf.push({ amount, ts: Date.now() });

		if (threshold === Infinity || amount < threshold) return;

		agent.playEmote(isBuy ? 'cheer' : 'flinch', intensity);
	}

	function onGraduation(msg) {
		try { JSON.parse(msg.data); } catch { return; }
		agent.playEmote('celebrate', intensity);
	}

	const params = new URLSearchParams({ kind: 'trades', mint });
	const es = new _EventSource(`${FEED_PATH}?${params}`, { withCredentials: true });
	es.addEventListener('trade', onTrade);
	es.addEventListener('graduation', onGraduation);

	return () => { es.close(); };
}
