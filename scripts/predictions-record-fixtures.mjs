#!/usr/bin/env node
// Record prediction-market fixtures from the live venue for the unit tests.
//
//   node scripts/predictions-record-fixtures.mjs
//
// Writes raw, unmodified venue responses to tests/fixtures/predictions/ so the
// normalizers in api/_lib/predictions/solana-venue.js and the order-book math
// in api/_lib/predictions/book.js are tested against the real wire format.
// Positions come from the first recent public trader on the venue whose
// positions are non-empty: positions are public per owner, and a recent buyer
// is the owner most likely to hold both open and settled ones.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'tests/fixtures/predictions');
const BASE = (process.env.PREDICTIONS_API_BASES || 'https://prediction-market-api.jup.ag/api/v1').split(',')[0].trim();
const HISTORY = 'https://clob.polymarket.com/prices-history';
const CANDLES = 'https://api.elections.kalshi.com/trade-api/v2';

async function get(url) {
	const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
	if (!res.ok) throw new Error(`${res.status} from ${url}`);
	return res.json();
}

function save(name, data) {
	writeFileSync(resolve(OUT, name), `${JSON.stringify(data, null, '\t')}\n`);
	console.log(`wrote ${name}`);
}

mkdirSync(OUT, { recursive: true });

const events = await get(`${BASE}/events?includeMarkets=true&includeCount=true&start=0&end=2&sortBy=volume&sortDirection=desc`);
save('events.json', events);

const lead = events.data[0];
save('event.json', await get(`${BASE}/events/${encodeURIComponent(lead.eventId)}?includeMarkets=true`));

const market = lead.markets.find((m) => m.status === 'open') || lead.markets[0];
save('market.json', await get(`${BASE}/markets/${encodeURIComponent(market.marketId)}`));
save('orderbook.json', await get(`${BASE}/orderbook/${encodeURIComponent(market.marketId)}`));
save('categories.json', await get(`${BASE}/events/categories`));

const trades = await get(`${BASE}/trades?start=0&end=40`);
let owner = null;
let positions = null;
for (const pk of [...new Set(trades.data.map((t) => t.ownerPubkey))]) {
	const res = await get(`${BASE}/positions?ownerPubkey=${pk}&includePrices=true&start=0&end=6`);
	if (res.data?.length >= 2) {
		owner = pk;
		positions = res;
		break;
	}
}
if (!owner) throw new Error('No recent trader holds two or more positions; rerun in a minute.');
save('positions.json', positions);
save('fills.json', await get(`${BASE}/history?ownerPubkey=${owner}&start=0&end=6`));

if (Array.isArray(market.clobTokenIds) && market.clobTokenIds[0]) {
	save('history-book-a.json', await get(`${HISTORY}?market=${market.clobTokenIds[0]}&interval=1w&fidelity=60`));
}

const series = await get(`${CANDLES}/markets?limit=1&status=open&series_ticker=KXHIGHNY`);
const ticker = series.markets?.[0]?.ticker;
if (ticker) {
	const now = Math.floor(Date.now() / 1000);
	save('history-book-b.json', await get(`${CANDLES}/series/KXHIGHNY/markets/${ticker}/candlesticks?start_ts=${now - 86_400}&end_ts=${now}&period_interval=60`));
}

save('recorded.json', { recorded_at: new Date().toISOString(), base: BASE, event_id: lead.eventId, market_id: market.marketId });
