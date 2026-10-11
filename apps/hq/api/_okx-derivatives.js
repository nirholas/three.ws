/**
 * Shared OKX public derivatives lane.
 *
 * Binance (`fapi.binance.com`) and Bybit both refuse requests from US egress
 * IPs, which is where Cloud Run runs. That left funding rates and open
 * interest on Hyperliquid alone, and long/short ratio and liquidations with
 * no working source at all. OKX's public v5 API needs no key, is not
 * geo-blocked, and covers all four datasets, so it serves as the shared
 * failover rung.
 *
 * Every function resolves to an empty array on failure so a dead lane can
 * never take down a route.
 */

const OKX_BASE = 'https://www.okx.com';

/** OKX quotes its USDT-margined perpetuals as `<BASE>-USDT-SWAP`. */
function swapInstId(symbol) {
  return `${symbol}-USDT-SWAP`;
}

/** Base asset from an OKX instrument id (`BTC-USDT-SWAP` -> `BTC`). */
export function baseFromInstId(instId) {
  return (instId || '').split('-')[0];
}

/**
 * Derive the long/short account split from a long/short ratio.
 * OKX publishes only the ratio, while the panel renders percentages.
 * A ratio of 2 means two long accounts per short account, so longs are 2/3.
 */
export function deriveAccountSplit(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return { longAccount: ratio / (1 + ratio), shortAccount: 1 / (1 + ratio) };
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Map over items with bounded concurrency and a pause between batches.
 * OKX's Rubik statistics endpoints reject bursts with error 50011
 * ("Too Many Requests"), so firing one request per symbol in parallel
 * silently loses most of the board.
 */
async function mapThrottled(items, fn, { concurrency = 2, spacingMs = 300 } = {}) {
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    if (i > 0) await sleep(spacingMs);
    out.push(...await Promise.all(items.slice(i, i + concurrency).map(fn)));
  }
  return out;
}

/** OKX's rate-limit rejection code. */
const OKX_RATE_LIMITED = '50011';

async function okxJson(path, controller, attempt = 0) {
  try {
    const res = await fetch(`${OKX_BASE}${path}`, {
      signal: controller?.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    // A throttled call is a timing problem, not a missing-data problem:
    // back off once rather than dropping the symbol from the board.
    if (json.code === OKX_RATE_LIMITED && attempt === 0 && !controller?.signal?.aborted) {
      await sleep(500);
      return okxJson(path, controller, attempt + 1);
    }
    if (json.code !== '0' || !Array.isArray(json.data)) return null;
    return json.data;
  } catch (err) {
    console.warn(`[okx] ${path} failed:`, err?.message ?? err);
    return null;
  }
}

/**
 * Mark prices for every SWAP instrument, keyed by base asset.
 * One call covers the whole board.
 */
export async function fetchOkxMarkPrices(controller) {
  const data = await okxJson('/api/v5/public/mark-price?instType=SWAP', controller);
  const map = new Map();
  if (!data) return map;
  for (const d of data) {
    if (!d.instId?.endsWith('-USDT-SWAP')) continue;
    const px = parseFloat(d.markPx);
    if (Number.isFinite(px)) map.set(baseFromInstId(d.instId), px);
  }
  return map;
}

/**
 * Funding rates for the given symbols. OKX has no bulk funding endpoint, so
 * this issues one request per symbol in parallel.
 * Returns `[{ symbol, exchange, fundingRate (percent), markPrice, nextFundingTime }]`.
 */
export async function fetchOkxFunding(symbols, controller) {
  const marks = await fetchOkxMarkPrices(controller);
  const results = await mapThrottled(symbols, async sym => {
    const data = await okxJson(`/api/v5/public/funding-rate?instId=${swapInstId(sym)}`, controller);
    const d = data?.[0];
    if (!d) return null;
    const rate = parseFloat(d.fundingRate);
    if (!Number.isFinite(rate)) return null;
    return {
      symbol: sym,
      exchange: 'OKX',
      fundingRate: rate * 100,
      markPrice: marks.get(sym) ?? null,
      nextFundingTime: d.fundingTime ? parseInt(d.fundingTime) : null,
    };
  }, { concurrency: 4, spacingMs: 150 });
  return results.filter(Boolean);
}

/**
 * Open interest for the given symbols, in contracts and USD.
 * One bulk call plus one mark-price call.
 */
export async function fetchOkxOpenInterest(symbols, controller) {
  const [data, marks] = await Promise.all([
    okxJson('/api/v5/public/open-interest?instType=SWAP', controller),
    fetchOkxMarkPrices(controller),
  ]);
  if (!data) return [];
  const wanted = new Set(symbols);
  const results = [];
  for (const d of data) {
    if (!d.instId?.endsWith('-USDT-SWAP')) continue;
    const symbol = baseFromInstId(d.instId);
    if (!wanted.has(symbol)) continue;
    const oiCcy = parseFloat(d.oiCcy);
    const oiUsd = parseFloat(d.oiUsd);
    if (!Number.isFinite(oiCcy)) continue;
    const markPrice = marks.get(symbol) ?? null;
    results.push({
      symbol,
      exchange: 'OKX',
      openInterest: oiCcy,
      markPrice,
      oiValue: Number.isFinite(oiUsd) ? oiUsd : (markPrice ? oiCcy * markPrice : 0),
    });
  }
  return results;
}

/**
 * Long/short account ratio per asset from OKX's Rubik stats.
 * OKX returns `[[timestamp, ratio], ...]` newest-first and exposes only the
 * ratio, so the long/short account split is derived from it.
 * Returns `[{ symbol, longAccount, shortAccount, longShortRatio, timestamp, prevRatio, change, source }]`.
 */
export async function fetchOkxLongShort(symbols, controller, period = '1H') {
  const results = await mapThrottled(symbols, async sym => {
    const data = await okxJson(
      `/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${sym}&period=${period}`,
      controller,
    );
    if (!data?.length) return null;
    const ratio = parseFloat(data[0]?.[1]);
    const split = deriveAccountSplit(ratio);
    if (!split) return null;
    const prevRatio = data.length > 1 ? parseFloat(data[1]?.[1]) : null;
    return {
      symbol: sym,
      longAccount: split.longAccount,
      shortAccount: split.shortAccount,
      longShortRatio: Math.round(ratio * 100) / 100,
      timestamp: parseInt(data[0]?.[0]) || Date.now(),
      prevRatio: Number.isFinite(prevRatio) ? prevRatio : null,
      change: Number.isFinite(prevRatio) ? ratio - prevRatio : 0,
      source: 'okx',
    };
    // OKX's Rubik statistics endpoints allow only a few requests per second
    // per IP. One at a time with a pause keeps the whole board intact;
    // anything faster silently drops symbols to 50011.
  }, { concurrency: 1, spacingMs: 450 });
  return results.filter(Boolean);
}

/**
 * Recent filled liquidation orders for the given symbols.
 *
 * OKX rejects `instType=SWAP` on its own with error 50015 ("Either parameter
 * uly or instFamily is required"), so this queries per instrument family.
 * Returns `[{ symbol, exchange, side, price, qty, value, time }]`.
 */
export async function fetchOkxLiquidations(symbols, controller, limitPerSymbol = 100) {
  const results = await mapThrottled(symbols, async sym => {
    const data = await okxJson(
      `/api/v5/public/liquidation-orders?instType=SWAP&state=filled&instFamily=${sym}-USDT&limit=${limitPerSymbol}`,
      controller,
    );
    if (!data?.length) return [];
    const out = [];
    for (const item of data) {
      for (const d of item.details || []) {
        const price = parseFloat(d.bkPx);
        const qty = parseFloat(d.sz);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
        out.push({
          symbol: sym,
          exchange: 'OKX',
          // A liquidation filled by a buy closes a short position.
          side: d.side === 'buy' ? 'SHORT' : 'LONG',
          price,
          qty,
          value: price * qty,
          time: parseInt(d.ts) || Date.now(),
        });
      }
    }
    return out;
  }, { concurrency: 6, spacingMs: 120 });
  return results.flat();
}
