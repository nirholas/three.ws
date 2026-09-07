// Pure derivations behind the Hood Desk (/markets/robinhood/desk).
//
// Everything here is arithmetic over data the callers already fetched from a
// real upstream (Chainlink multicall, DexScreener, Blockscout, the chain RPC).
// No I/O, no clock reads beyond what the caller passes in, so every rule the
// desk renders is unit-testable in isolation. The two endpoints that use it
// (api/v1/robinhood/desk.js, api/v1/robinhood/wallet.js) own the fetching.

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Lowercased 0x-address, or null when the input is not one. */
export function normalizeAddress(value) {
	const a = String(value || '').trim().toLowerCase();
	return /^0x[0-9a-f]{40}$/.test(a) ? a : null;
}

/** Raw atomic integer string to a human unit amount, tolerant of junk input. */
export function toUnits(raw, decimals) {
	// Number(null) is 0, which is finite: a null `decimals` (what the indexer
	// reports for an unverified token) would otherwise divide by 10^0 and print
	// the raw atomic balance as if it were the real one.
	if (raw == null || decimals == null) return null;
	const d = Number(decimals);
	const n = Number(raw);
	if (!Number.isFinite(n) || !Number.isFinite(d) || d < 0 || d > 36) return null;
	return n / 10 ** d;
}

/**
 * Liquidity-depth ridge of the Stock Token premium distribution.
 *
 * Each layer re-computes the same premium histogram over a progressively
 * deeper liquidity floor, so the layered ridge answers a real trading question
 * ("does the NAV spread tighten once you only count pools you can actually
 * size into?") instead of being a decorative stack of copies. Bins are
 * symmetric around 0% premium and the tails are clamped into the edge bins so
 * one broken pool cannot flatten the whole chart.
 */
export function premiumRidge(rows, { bins = 41, span = null, layers = 10 } = {}) {
	const priced = (Array.isArray(rows) ? rows : []).filter(
		(r) => r && Number.isFinite(r.premiumPct),
	);
	// The axis is fitted to the day's actual dispersion rather than pinned to a
	// constant: Robinhood Chain's Stock Token pools usually sit inside 3% of
	// NAV, and a fixed wide axis renders every real spread as one spike in the
	// middle of an empty chart.
	const widest = priced.reduce((m, r) => Math.max(m, Math.abs(r.premiumPct)), 0);
	const fitted = Math.min(10, Math.max(1, Math.ceil(widest * 1.3 * 2) / 2));
	const axis = Number.isFinite(span) && span > 0 ? span : fitted;
	const width = (axis * 2) / bins;
	const edges = Array.from({ length: bins }, (_, i) => {
		const from = -axis + i * width;
		return { from, to: from + width, center: from + width / 2 };
	});
	const binOf = (pct) => {
		const idx = Math.floor((pct + axis) / width);
		return Math.min(bins - 1, Math.max(0, idx));
	};

	const liquidities = priced
		.map((r) => (Number.isFinite(r.liquidityUsd) ? r.liquidityUsd : 0))
		.sort((a, b) => a - b);
	const top = liquidities.length ? liquidities[liquidities.length - 1] : 0;
	// Floors climb geometrically: liquidity on this chain spans several orders
	// of magnitude, so linear floors would put every layer in the bottom decile.
	const floors = Array.from({ length: layers }, (_, i) => {
		if (i === 0 || top <= 0) return 0;
		return top * (i / layers) ** 3;
	});

	const layerRows = floors.map((minLiquidityUsd) => {
		const kept = priced.filter(
			(r) => (Number.isFinite(r.liquidityUsd) ? r.liquidityUsd : 0) >= minLiquidityUsd,
		);
		const density = new Array(bins).fill(0);
		for (const r of kept) density[binOf(r.premiumPct)] += 1;
		return { minLiquidityUsd, count: kept.length, density };
	});

	const values = priced.map((r) => r.premiumPct).sort((a, b) => a - b);
	const pick = (q) => (values.length ? values[Math.min(values.length - 1, Math.floor(q * values.length))] : null);
	const symbols = edges.map((_, i) =>
		priced.filter((r) => binOf(r.premiumPct) === i).map((r) => r.symbol).slice(0, 12),
	);

	return {
		bins: edges,
		layers: layerRows,
		symbols,
		stats: {
			priced: priced.length,
			total: Array.isArray(rows) ? rows.length : 0,
			min: values.length ? values[0] : null,
			max: values.length ? values[values.length - 1] : null,
			median: pick(0.5),
			p10: pick(0.1),
			p90: pick(0.9),
			spanPct: axis,
		},
	};
}

/**
 * The widest NAV dislocations that are actually tradeable: a premium is only
 * an opportunity if there is a pool deep enough to take size, so rows with no
 * DEX pair (or a dust pool) are dropped rather than ranked first.
 */
export function arbLeaders(rows, { limit = 6, minLiquidityUsd = 2000 } = {}) {
	return (Array.isArray(rows) ? rows : [])
		.filter(
			(r) =>
				r &&
				Number.isFinite(r.premiumPct) &&
				Number.isFinite(r.liquidityUsd) &&
				r.liquidityUsd >= minLiquidityUsd,
		)
		.sort((a, b) => Math.abs(b.premiumPct) - Math.abs(a.premiumPct))
		.slice(0, limit)
		.map((r) => ({
			symbol: r.symbol,
			name: r.name,
			address: r.address,
			premiumPct: r.premiumPct,
			navPriceUsd: r.navPriceUsd,
			dexPriceUsd: r.dexPriceUsd,
			liquidityUsd: r.liquidityUsd,
			volume24hUsd: r.volume24hUsd,
			side: r.premiumPct > 0 ? 'dex-rich' : 'dex-cheap',
		}));
}

/**
 * Blockscout coin-balance points to an ascending native-balance series.
 *
 * Blockscout returns newest-first and its `value` is the balance AFTER the
 * transaction, in wei. Series points carry both the native amount and its USD
 * valuation at the price the caller passes in (a single current price: the
 * chain exposes no historical ETH price feed, and the client labels the axis
 * accordingly rather than implying a marked-to-time curve).
 */
export function balanceSeries(items, { ethPriceUsd = null, limit = 240 } = {}) {
	const points = (Array.isArray(items) ? items : [])
		.map((p) => {
			const t = Date.parse(p?.block_timestamp || p?.date || '');
			const eth = toUnits(p?.value, 18);
			if (!Number.isFinite(t) || eth == null) return null;
			return {
				t,
				eth,
				usd: Number.isFinite(ethPriceUsd) ? eth * ethPriceUsd : null,
				block: p?.block_number ?? null,
			};
		})
		.filter(Boolean)
		// Ties broken by block: several transfers can land inside one 101ms block
		// timestamp, and the later block carries the balance that is still true.
		.sort((a, b) => a.t - b.t || (a.block ?? 0) - (b.block ?? 0));
	// Deduplicate points that share a timestamp (several transfers inside one
	// 101ms block), keeping the last balance recorded for that instant.
	const deduped = [];
	for (const p of points) {
		if (deduped.length && deduped[deduped.length - 1].t === p.t) deduped[deduped.length - 1] = p;
		else deduped.push(p);
	}
	return deduped.slice(-limit);
}

/**
 * One continuous balance curve from the two series Blockscout exposes.
 *
 * The per-transaction feed only reaches back ~50 balance-changing transactions
 * (minutes, for an active wallet), and the by-day feed only keeps ~10 daily
 * closes. Neither alone is a usable chart: the daily closes carry the older
 * shape, the per-transaction points carry the live edge, and a daily close is
 * plotted at the END of its day (or at `now` for today) because that is when
 * the balance it reports was true.
 */
export function mergeBalanceHistory(daily, intraday, { now = Date.now() } = {}) {
	const intra = Array.isArray(intraday) ? intraday : [];
	const firstIntraT = intra.length ? intra[0].t : Infinity;
	const DAY_MS = 86_400_000;
	const days = (Array.isArray(daily) ? daily : [])
		.map((p) => ({ ...p, t: Math.min(p.t + DAY_MS - 1000, now) }))
		.filter((p) => p.t < firstIntraT);
	return [...days, ...intra];
}

/** Start/end/delta of a balance series, or nulls when it cannot be measured. */
export function seriesChange(series) {
	const s = Array.isArray(series) ? series : [];
	if (s.length < 2) return { startEth: s[0]?.eth ?? null, endEth: s[s.length - 1]?.eth ?? null, deltaEth: null, pct: null, fromT: s[0]?.t ?? null, toT: s[s.length - 1]?.t ?? null };
	const startEth = s[0].eth;
	const endEth = s[s.length - 1].eth;
	const deltaEth = endEth - startEth;
	return {
		startEth,
		endEth,
		deltaEth,
		pct: startEth > 0 ? (deltaEth / startEth) * 100 : null,
		fromT: s[0].t,
		toT: s[s.length - 1].t,
	};
}

const SWAP_METHODS = /^(swap|exactinput|exactoutput|multicall|execute)/i;
const CLAIM_METHODS = /^(claim|mint|redeem)/i;

/** Human label + class for one wallet-scoped transaction. */
export function classifyTransaction(tx, owner) {
	const me = normalizeAddress(owner);
	const from = normalizeAddress(tx?.from?.hash);
	const to = normalizeAddress(tx?.to?.hash);
	const method = String(tx?.method || '').trim();
	const value = toUnits(tx?.value, 18) || 0;
	const types = Array.isArray(tx?.transaction_types) ? tx.transaction_types : [];

	let kind = 'call';
	if (!to && tx?.created_contract) kind = 'deploy';
	else if (SWAP_METHODS.test(method) || (types.includes('token_transfer') && types.includes('contract_call'))) kind = 'swap';
	else if (/^approve/i.test(method)) kind = 'approve';
	else if (CLAIM_METHODS.test(method)) kind = 'claim';
	else if (!method && value > 0) kind = from === me ? 'send' : 'receive';

	const counterparty = from === me ? to : from;
	return {
		hash: tx?.hash || null,
		timestamp: tx?.timestamp || null,
		kind,
		method: method || (kind === 'send' || kind === 'receive' ? 'transfer' : null),
		direction: from === me ? 'out' : 'in',
		counterparty,
		counterpartyName: (from === me ? tx?.to?.name : tx?.from?.name) || null,
		valueEth: value || null,
		feeEth: toUnits(tx?.fee?.value, 18),
		status: tx?.result === 'success' || tx?.status === 'ok' ? 'ok' : tx?.result || 'pending',
		block: tx?.block_number ?? tx?.block ?? null,
	};
}

/** Human label + class for one wallet-scoped ERC-20/721 transfer. */
export function classifyTransfer(tr, owner) {
	const me = normalizeAddress(owner);
	const from = normalizeAddress(tr?.from?.hash);
	const to = normalizeAddress(tr?.to?.hash);
	const decimals = tr?.total?.decimals ?? tr?.token?.decimals ?? 18;
	const amount = toUnits(tr?.total?.value ?? tr?.value, decimals);
	const direction = from === me ? 'out' : 'in';
	let kind = direction === 'out' ? 'send' : 'receive';
	if (from === ZERO_ADDRESS) kind = 'mint';
	else if (to === ZERO_ADDRESS) kind = 'burn';

	return {
		hash: tr?.transaction_hash || tr?.tx_hash || null,
		timestamp: tr?.timestamp || null,
		kind,
		direction,
		counterparty: direction === 'out' ? to : from,
		counterpartyName: (direction === 'out' ? tr?.to?.name : tr?.from?.name) || null,
		token: {
			address: normalizeAddress(tr?.token?.address_hash || tr?.token?.address),
			symbol: tr?.token?.symbol || null,
			name: tr?.token?.name || null,
		},
		amount,
		method: tr?.method || null,
		status: 'ok',
		block: tr?.block_number ?? null,
	};
}

/**
 * One time-ordered tape from the transaction and token-transfer feeds.
 *
 * A swap shows up in both feeds (one contract call plus its transfers), so
 * transfers are folded onto the transaction that produced them instead of
 * printing the same trade twice.
 */
export function mergeActivity(transactions, transfers, owner, { limit = 40 } = {}) {
	const txs = (Array.isArray(transactions) ? transactions : []).map((t) => classifyTransaction(t, owner));
	const trs = (Array.isArray(transfers) ? transfers : []).map((t) => classifyTransfer(t, owner));
	const byHash = new Map();
	for (const tx of txs) {
		if (tx.hash) byHash.set(tx.hash, { ...tx, tokens: [] });
	}
	const orphans = [];
	for (const tr of trs) {
		const parent = tr.hash ? byHash.get(tr.hash) : null;
		const leg = { symbol: tr.token.symbol, address: tr.token.address, amount: tr.amount, direction: tr.direction };
		if (parent) {
			if (parent.tokens.length < 4) parent.tokens.push(leg);
		} else {
			orphans.push({ ...tr, tokens: [leg] });
		}
	}
	return [...byHash.values(), ...orphans]
		.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0))
		.slice(0, limit);
}

/**
 * Counterparty flow: who this wallet actually trades against, ranked by how
 * many legs crossed between them. Feeds the flow arcs on the desk.
 */
export function counterpartyFlow(events, { limit = 8 } = {}) {
	const map = new Map();
	for (const ev of Array.isArray(events) ? events : []) {
		const addr = normalizeAddress(ev?.counterparty);
		if (!addr || addr === ZERO_ADDRESS) continue;
		const row = map.get(addr) || { address: addr, name: ev.counterpartyName || null, inCount: 0, outCount: 0, kinds: {} };
		if (ev.direction === 'out') row.outCount += 1;
		else row.inCount += 1;
		row.kinds[ev.kind] = (row.kinds[ev.kind] || 0) + 1;
		if (!row.name && ev.counterpartyName) row.name = ev.counterpartyName;
		map.set(addr, row);
	}
	return [...map.values()]
		.map((r) => ({ ...r, total: r.inCount + r.outCount }))
		.sort((a, b) => b.total - a.total)
		.slice(0, limit);
}

/** Book totals + per-position share of book, highest value first. */
export function rollupBook(nativeUsd, positions) {
	const rows = (Array.isArray(positions) ? positions : []).filter(Boolean);
	const tokensUsd = rows.reduce((sum, p) => sum + (Number.isFinite(p.valueUsd) ? p.valueUsd : 0), 0);
	const native = Number.isFinite(nativeUsd) ? nativeUsd : 0;
	const total = native + tokensUsd;
	const withShare = rows
		.map((p) => ({ ...p, sharePct: total > 0 && Number.isFinite(p.valueUsd) ? (p.valueUsd / total) * 100 : null }))
		.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
	return {
		bookValueUsd: total,
		nativeUsd: native,
		tokensUsd,
		nativeSharePct: total > 0 ? (native / total) * 100 : null,
		positions: withShare,
		positionCount: withShare.length,
		pricedCount: withShare.filter((p) => Number.isFinite(p.valueUsd)).length,
	};
}
