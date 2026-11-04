// v1 market intelligence routes. Thin adapters over the trading tool library
// the /radar, /coin-intel and /fade surfaces and the MCP trading tools already
// use (api/_lib/trading-tools), so an API number is the same number the pages
// show. Indicators are computed server-side from the OHLCV the charts pull,
// with the `trading-signals` library.
//
//   GET /intel/price?mint=                                   live USD and SOL price
//   GET /intel/top-movers?window=&board=&limit=              launch inflow, smart money, conviction, graduations
//   GET /intel/indicators?mint=&indicators=rsi,ema&interval= RSI, EMA, SMA, MACD, Bollinger
//   GET /intel/signals?mint=                                 launchpad, momentum and Oracle conviction read
//   GET /intel/anomalies?window=                             ecosystem anomalies with z-scores
//   GET /intel/macro?window=                                 launch rate, graduation rate, net SOL flow
//
// A mint with no market answers with the tool's typed refusal (no_market,
// price_unavailable, no_candles), never a fabricated value.

import { apiError, intParam } from '../http.js';
import { describeToolError } from '../../trading-tools/context.js';
import { getPrice, getIndicators, getMarketSignals, INDICATORS, INDICATOR_INTERVALS } from '../../trading-tools/market.js';
import { getEcosystemSignals, ECOSYSTEM_WINDOWS } from '../../trading-tools/ecosystem.js';

const BOARDS = Object.freeze(['launch_inflow', 'smart_money', 'high_conviction', 'graduations']);

/** Run a tool call and turn a designed refusal into the matching API error. */
async function guarded(fn) {
	try {
		return await fn();
	} catch (err) {
		const d = describeToolError(err);
		if (d) throw apiError(d.status, d.code, d.message, d.detail);
		throw err;
	}
}

function required(query, name) {
	const v = typeof query[name] === 'string' ? query[name].trim() : '';
	if (!v) throw apiError(400, 'invalid_parameter', `${name} is required.`, { parameter: name });
	return v;
}

function windowParam(query) {
	const w = query.window ?? query.timeframe ?? '1h';
	if (!ECOSYSTEM_WINDOWS[w]) {
		throw apiError(400, 'invalid_parameter', `window must be one of ${Object.keys(ECOSYSTEM_WINDOWS).join(', ')}.`, { parameter: 'window' });
	}
	return w;
}

const R = (path, name, summary, handler) => ({ method: 'GET', path, name, auth: 'required', scope: 'agents:read', summary, handler });

export const ROUTES = [
	R('/intel/price', 'v1.intel.price', 'Live USD and SOL price for a mint.', ({ query }) =>
		guarded(() => getPrice({ mint: required(query, 'mint') })),
	),
	R('/intel/top-movers', 'v1.intel.topMovers', 'Top movers across the Solana launch feed: launch inflow, smart money, Oracle conviction and graduations.', ({ query }) =>
		guarded(async () => {
			const window = windowParam(query);
			const limit = intParam(query.limit, { name: 'limit', min: 1, max: 50, fallback: 10 });
			const board = query.board;
			if (board && !BOARDS.includes(board)) {
				throw apiError(400, 'invalid_parameter', `board must be one of ${BOARDS.join(', ')}.`, { parameter: 'board' });
			}
			const eco = await getEcosystemSignals({ window, sections: ['movers'] });
			const movers = {};
			for (const [key, list] of Object.entries(eco.movers || {})) {
				if (board && key !== board) continue;
				movers[key] = { ...list, items: (list.items || []).slice(0, limit) };
			}
			return { scope: eco.scope, chain: eco.chain, window, as_of: eco.as_of, movers };
		}),
	),
	R('/intel/indicators', 'v1.intel.indicators', 'RSI, EMA, SMA, MACD and Bollinger bands computed server-side from OHLCV.', ({ query }) =>
		guarded(() => {
			const interval = query.interval || '1h';
			if (!INDICATOR_INTERVALS.includes(interval)) {
				throw apiError(400, 'invalid_parameter', `interval must be one of ${INDICATOR_INTERVALS.join(', ')}.`, { parameter: 'interval' });
			}
			const indicators = query.indicators ? String(query.indicators).split(',').map((s) => s.trim()).filter(Boolean) : INDICATORS;
			return getIndicators({ mint: required(query, 'mint'), indicators, interval, period: query.period });
		}),
	),
	R('/intel/signals', 'v1.intel.signals', 'The live signal read for one token: launchpad state, momentum and Oracle conviction.', ({ query }) =>
		guarded(() => getMarketSignals({ mint: required(query, 'mint') })),
	),
	R('/intel/anomalies', 'v1.intel.anomalies', 'Ecosystem anomalies with z-scores against their baselines.', ({ query }) =>
		guarded(async () => {
			const window = windowParam(query);
			const eco = await getEcosystemSignals({ window, sections: ['anomalies'] });
			return { scope: eco.scope, chain: eco.chain, window, as_of: eco.as_of, anomalies: eco.anomalies ?? null };
		}),
	),
	R('/intel/macro', 'v1.intel.macro', 'Macro readings: launch rate, graduation rate, net SOL flow and active wallets against baselines.', ({ query }) =>
		guarded(async () => {
			const window = windowParam(query);
			const eco = await getEcosystemSignals({ window, sections: ['macro'] });
			return { scope: eco.scope, chain: eco.chain, window, as_of: eco.as_of, macro: eco.macro ?? null };
		}),
	),
];
