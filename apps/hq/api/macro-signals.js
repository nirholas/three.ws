export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

const CACHE_TTL = 300;
let cachedResponse = null;
let cacheTimestamp = 0;

async function fetchJSON(url, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

function rateOfChange(prices, days) {
  if (!prices || prices.length < days + 1) return null;
  const recent = prices[prices.length - 1];
  const past = prices[prices.length - 1 - days];
  if (!past || past === 0) return null;
  return ((recent - past) / past) * 100;
}

function sma(prices, period) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function extractClosePrices(chart) {
  try {
    const result = chart?.chart?.result?.[0];
    return result?.indicators?.quote?.[0]?.close?.filter(p => p != null) || [];
  } catch {
    return [];
  }
}

function extractVolumes(chart) {
  try {
    const result = chart?.chart?.result?.[0];
    return result?.indicators?.quote?.[0]?.volume?.filter(v => v != null) || [];
  } catch {
    return [];
  }
}

function extractAlignedPriceVolume(chart) {
  try {
    const result = chart?.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const volumes = result?.indicators?.quote?.[0]?.volume || [];
    const pairs = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null && volumes[i] != null) {
        pairs.push({ price: closes[i], volume: volumes[i] });
      }
    }
    return pairs;
  } catch {
    return [];
  }
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    verdict: 'UNKNOWN',
    bullishCount: 0,
    totalCount: 0,
    signals: {
      liquidity: { status: 'UNKNOWN', value: null, sparkline: [] },
      flowStructure: { status: 'UNKNOWN', btcReturn5: null, qqqReturn5: null },
      macroRegime: { status: 'UNKNOWN', qqqRoc20: null, xlpRoc20: null },
      technicalTrend: {
        status: 'UNKNOWN',
        btcPrice: null,
        sma50: null,
        sma200: null,
        vwap30d: null,
        mayerMultiple: null,
        sparkline: [],
      },
      hashRate: { status: 'UNKNOWN', change30d: null },
      miningCost: { status: 'UNKNOWN' },
      fearGreed: { status: 'UNKNOWN', value: null, history: [] },
    },
    meta: { qqqSparkline: [] },
    unavailable: true,
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: cors });
    }
    return new Response(null, { status: 204, headers: cors });
  }
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  }

  try {
    const yahooBase = 'https://query1.finance.yahoo.com/v8/finance/chart';
    const [jpyChart, btcChart, qqqChart, xlpChart, fearGreed, mempoolHash] = await Promise.allSettled([
      fetchJSON(`${yahooBase}/JPY=X?range=1y&interval=1d`),
      fetchJSON(`${yahooBase}/BTC-USD?range=1y&interval=1d`),
      fetchJSON(`${yahooBase}/QQQ?range=1y&interval=1d`),
      fetchJSON(`${yahooBase}/XLP?range=1y&interval=1d`),
      fetchJSON('https://api.alternative.me/fng/?limit=30&format=json'),
      fetchJSON('https://mempool.space/api/v1/mining/hashrate/1m'),
    ]);

    const jpyPrices = jpyChart.status === 'fulfilled' ? extractClosePrices(jpyChart.value) : [];
    const btcPrices = btcChart.status === 'fulfilled' ? extractClosePrices(btcChart.value) : [];
    const btcVolumes = btcChart.status === 'fulfilled' ? extractVolumes(btcChart.value) : [];
    const btcAligned = btcChart.status === 'fulfilled' ? extractAlignedPriceVolume(btcChart.value) : [];
    const qqqPrices = qqqChart.status === 'fulfilled' ? extractClosePrices(qqqChart.value) : [];
    const xlpPrices = xlpChart.status === 'fulfilled' ? extractClosePrices(xlpChart.value) : [];

    // 1. Liquidity Signal (JPY 30d ROC)
    const jpyRoc30 = rateOfChange(jpyPrices, 30);
    const liquidityStatus = jpyRoc30 !== null
      ? (jpyRoc30 < -2 ? 'SQUEEZE' : 'NORMAL')
      : 'UNKNOWN';

    // 2. Flow Structure (BTC vs QQQ 5d return)
    const btcReturn5 = rateOfChange(btcPrices, 5);
    const qqqReturn5 = rateOfChange(qqqPrices, 5);
    let flowStatus = 'UNKNOWN';
    if (btcReturn5 !== null && qqqReturn5 !== null) {
      const gap = btcReturn5 - qqqReturn5;
      flowStatus = Math.abs(gap) > 5 ? 'PASSIVE GAP' : 'ALIGNED';
    }

    // 3. Macro Regime (QQQ/XLP 20d ROC)
    const qqqRoc20 = rateOfChange(qqqPrices, 20);
    const xlpRoc20 = rateOfChange(xlpPrices, 20);
    let regimeStatus = 'UNKNOWN';
    if (qqqRoc20 !== null && xlpRoc20 !== null) {
      regimeStatus = qqqRoc20 > xlpRoc20 ? 'RISK-ON' : 'DEFENSIVE';
    }

    // 4. Technical Trend (BTC vs SMA50 + VWAP)
    const btcSma50 = sma(btcPrices, 50);
    const btcSma200 = sma(btcPrices, 200);
    const btcCurrent = btcPrices.length > 0 ? btcPrices[btcPrices.length - 1] : null;

    // Compute VWAP from aligned price/volume pairs (30d)
    let btcVwap = null;
    if (btcAligned.length >= 30) {
      const last30 = btcAligned.slice(-30);
      let sumPV = 0, sumV = 0;
      for (const { price, volume } of last30) {
        sumPV += price * volume;
        sumV += volume;
      }
      if (sumV > 0) btcVwap = +(sumPV / sumV).toFixed(0);
    }

    let trendStatus = 'UNKNOWN';
    let mayerMultiple = null;
    if (btcCurrent && btcSma50) {
      const aboveSma = btcCurrent > btcSma50 * 1.02;
      const belowSma = btcCurrent < btcSma50 * 0.98;
      const aboveVwap = btcVwap ? btcCurrent > btcVwap : null;
      if (aboveSma && aboveVwap !== false) trendStatus = 'BULLISH';
      else if (belowSma && aboveVwap !== true) trendStatus = 'BEARISH';
      else trendStatus = 'NEUTRAL';
    }
    if (btcCurrent && btcSma200) {
      mayerMultiple = +(btcCurrent / btcSma200).toFixed(2);
    }

    // 5. Hash Rate
    let hashStatus = 'UNKNOWN';
    let hashChange = null;
    if (mempoolHash.status === 'fulfilled') {
      const hr = mempoolHash.value?.hashrates || mempoolHash.value;
      if (Array.isArray(hr) && hr.length >= 2) {
        const recent = hr[hr.length - 1]?.avgHashrate || hr[hr.length - 1];
        const older = hr[0]?.avgHashrate || hr[0];
        if (recent && older && older > 0) {
          hashChange = +((recent - older) / older * 100).toFixed(1);
          hashStatus = hashChange > 3 ? 'GROWING' : hashChange < -3 ? 'DECLINING' : 'STABLE';
        }
      }
    }

    // 6. Mining Cost (hashrate-based model)
    let miningStatus = 'UNKNOWN';
    if (btcCurrent && hashChange !== null) {
      miningStatus = btcCurrent > 60000 ? 'PROFITABLE' : btcCurrent > 40000 ? 'TIGHT' : 'SQUEEZE';
    }

    // 7. Fear & Greed
    let fgValue = null;
    let fgLabel = 'UNKNOWN';
    let fgHistory = [];
    if (fearGreed.status === 'fulfilled' && fearGreed.value?.data) {
      const data = fearGreed.value.data;
      const parsed = parseInt(data[0]?.value, 10);
      fgValue = Number.isFinite(parsed) ? parsed : null;
      fgLabel = data[0]?.value_classification || 'UNKNOWN';
      fgHistory = data.slice(0, 30).map(d => ({
        value: parseInt(d.value, 10),
        date: new Date(parseInt(d.timestamp, 10) * 1000).toISOString().slice(0, 10),
      })).reverse();
    }

    // Sparkline data
    const btcSparkline = btcPrices.slice(-30);
    const qqqSparkline = qqqPrices.slice(-30);
    const jpySparkline = jpyPrices.slice(-30);

    // Overall Verdict
    let bullishCount = 0;
    let totalCount = 0;
    const signals = [
      { name: 'Liquidity', status: liquidityStatus, bullish: liquidityStatus === 'NORMAL' },
      { name: 'Flow Structure', status: flowStatus, bullish: flowStatus === 'ALIGNED' },
      { name: 'Macro Regime', status: regimeStatus, bullish: regimeStatus === 'RISK-ON' },
      { name: 'Technical Trend', status: trendStatus, bullish: trendStatus === 'BULLISH' },
      { name: 'Hash Rate', status: hashStatus, bullish: hashStatus === 'GROWING' },
      { name: 'Mining Cost', status: miningStatus, bullish: miningStatus === 'PROFITABLE' },
      { name: 'Fear & Greed', status: fgLabel, bullish: fgValue !== null && fgValue > 50 },
    ];

    for (const s of signals) {
      if (s.status !== 'UNKNOWN') {
        totalCount++;
        if (s.bullish) bullishCount++;
      }
    }

    const verdict = totalCount === 0 ? 'UNKNOWN' : (bullishCount / totalCount >= 0.57 ? 'BUY' : 'CASH');

    const result = {
      timestamp: new Date().toISOString(),
      verdict,
      bullishCount,
      totalCount,
      signals: {
        liquidity: { status: liquidityStatus, value: jpyRoc30 !== null ? +jpyRoc30.toFixed(2) : null, sparkline: jpySparkline },
        flowStructure: { status: flowStatus, btcReturn5: btcReturn5 !== null ? +btcReturn5.toFixed(2) : null, qqqReturn5: qqqReturn5 !== null ? +qqqReturn5.toFixed(2) : null },
        macroRegime: { status: regimeStatus, qqqRoc20: qqqRoc20 !== null ? +qqqRoc20.toFixed(2) : null, xlpRoc20: xlpRoc20 !== null ? +xlpRoc20.toFixed(2) : null },
        technicalTrend: { status: trendStatus, btcPrice: btcCurrent, sma50: btcSma50 ? +btcSma50.toFixed(0) : null, sma200: btcSma200 ? +btcSma200.toFixed(0) : null, vwap30d: btcVwap, mayerMultiple, sparkline: btcSparkline },
        hashRate: { status: hashStatus, change30d: hashChange },
        miningCost: { status: miningStatus },
        fearGreed: { status: fgLabel, value: fgValue, history: fgHistory },
      },
      meta: { qqqSparkline },
    };

    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
    });
  } catch (err) {
    const fallback = cachedResponse || buildFallbackResult();
    cachedResponse = fallback;
    cacheTimestamp = now;
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=30' },
    });
  }
}
