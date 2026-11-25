// CoinGecko exchange catalogs: re-key fallback Markets rows to CoinGecko
// exchange ids, and tell a dead exchange id from a throttled one.
//
// The /exchange/:id page is addressed by CoinGecko exchange id. When the
// /coin/:id Markets table falls back to CoinPaprika or DexScreener, each row
// carries that source's own venue id, which CoinGecko often spells differently
// or does not have at all. Linked as-is, a visitor's click opened a profile
// that 404'd upstream in both namespaces and, when the second lookup was
// throttled, answered 502 (about 60 a day by 2026-11-25).
//
// CoinGecko's /exchanges/list is the whole catalog (id + name, ~1,500 venues,
// one keyless call), so it is read once a day and kept in the shared cache for
// a week: a throttled CoinGecko still leaves every instance a recent catalog.
//
// Matching is conservative. An id CoinGecko already has wins. Otherwise the
// venue's name is compared on normalized keys (letters and digits only, then
// without a parenthetical qualifier, then without a trailing "exchange"); the
// first key with any hit decides, and only a single hit counts. An ambiguous or
// missing venue gets `id: null`, which the table renders as plain text: an
// unlinked name is honest, a link to the wrong venue is not.
//
// The derivatives catalog (/derivatives/exchanges/list) backs the other half:
// /api/coin/exchange asks it whether an id that 404'd in the spot namespace is
// a derivatives venue at all, so a dead link answers 404 even while the
// derivatives lookup itself is throttled.

import { geckoFetch } from './coingecko.js';
import { cacheGet, cacheSet, cacheDel } from './cache.js';

// Spot venues and derivatives venues are separate CoinGecko namespaces, each
// with its own catalog.
const CATALOGS = {
	spot: { path: '/exchanges/list', key: 'gecko:exchange-catalog:v1' },
	derivatives: { path: '/derivatives/exchanges/list', key: 'gecko:derivatives-catalog:v1' },
};
const CATALOG_SHARED_TTL_S = 7 * 86_400;
const CATALOG_FRESH_MS = 24 * 3600_000;
// After a failed read with nothing cached, wait this long before asking again,
// so a cold instance facing a throttled CoinGecko does not retry per request.
const CATALOG_RETRY_MS = 60_000;

const _state = new Map(); // kind -> { memo: { at, index | null } | null, inflight }

const norm = (s) =>
	String(s ?? '')
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');

/** Lookup keys for a venue name, most specific first, de-duplicated. */
export function exchangeNameKeys(name) {
	const raw = String(name ?? '');
	const bare = raw.replace(/\([^)]*\)/g, ' ');
	const out = [];
	for (const k of [norm(raw), norm(raw).replace(/exchange$/, ''), norm(bare), norm(bare).replace(/exchange$/, '')]) {
		if (k && !out.includes(k)) out.push(k);
	}
	return out;
}

/** Build the lookup index from [{ id, name }] or [[id, name]] rows. */
export function buildExchangeIndex(list) {
	const ids = new Set();
	const byKey = new Map();
	for (const entry of list || []) {
		const id = Array.isArray(entry) ? entry[0] : entry?.id;
		const name = Array.isArray(entry) ? entry[1] : entry?.name;
		if (typeof id !== 'string' || !id) continue;
		ids.add(id);
		for (const k of exchangeNameKeys(name)) {
			if (!byKey.has(k)) byKey.set(k, new Set());
			byKey.get(k).add(id);
		}
	}
	return ids.size ? { ids, byKey } : null;
}

/** The CoinGecko id for a venue, or null when there is no single match. */
export function matchGeckoExchange(index, { id, name } = {}) {
	if (id && index.ids.has(id)) return id;
	for (const k of exchangeNameKeys(name)) {
		const hits = index.byKey.get(k);
		if (hits) return hits.size === 1 ? [...hits][0] : null;
	}
	return null;
}

async function loadCatalog({ path, key }) {
	try {
		const list = await geckoFetch(path, { ttlMs: CATALOG_FRESH_MS });
		const index = Array.isArray(list) ? buildExchangeIndex(list) : null;
		if (index) {
			const compact = list.filter((e) => e?.id).map((e) => [e.id, e.name ?? '']);
			cacheSet(key, compact, CATALOG_SHARED_TTL_S).catch(() => {});
			return index;
		}
	} catch {
		// Throttled or down: the shared copy below is the answer.
	}
	const shared = await cacheGet(key).catch(() => null);
	return Array.isArray(shared) ? buildExchangeIndex(shared) : null;
}

/** A catalog's index ('spot' or 'derivatives'), or null when it has never been readable. */
export async function geckoExchangeIndex(kind = 'spot', now = Date.now()) {
	const catalog = CATALOGS[kind];
	if (!catalog) throw new Error(`unknown exchange catalog "${kind}"`);
	const st = _state.get(kind) || { memo: null, inflight: null };
	_state.set(kind, st);
	if (st.memo) {
		const age = now - st.memo.at;
		if (st.memo.index ? age < CATALOG_FRESH_MS : age < CATALOG_RETRY_MS) return st.memo.index;
	}
	if (!st.inflight) {
		st.inflight = loadCatalog(catalog)
			.then((index) => {
				// A failed refresh keeps the previous index rather than dropping it.
				st.memo = { at: Date.now(), index: index || st.memo?.index || null };
				return st.memo.index;
			})
			.finally(() => {
				st.inflight = null;
			});
	}
	return st.inflight;
}

/**
 * Whether CoinGecko lists `id` as a derivatives venue: true, false, or null
 * when the derivatives catalog cannot be read.
 */
export async function isGeckoDerivativesVenue(id) {
	const index = await geckoExchangeIndex('derivatives');
	return index ? index.ids.has(id) : null;
}

/**
 * Rewrite each row's `exchange.id` to its CoinGecko id (null when unmatched).
 * Rows are returned unchanged when the catalog has never been readable, since
 * then there is nothing to judge a match against.
 */
export async function linkGeckoExchanges(rows) {
	if (!Array.isArray(rows) || !rows.length) return rows;
	const index = await geckoExchangeIndex('spot');
	if (!index) return rows;
	return rows.map((r) => ({ ...r, exchange: { ...r.exchange, id: matchGeckoExchange(index, r.exchange || {}) } }));
}

/** Test-only hook. */
export async function resetGeckoExchangeCatalog() {
	_state.clear();
	for (const { key } of Object.values(CATALOGS)) await cacheDel(key).catch(() => {});
}
