// Accepts either the raw gmgn API response ({ data: { rank|wallets|list: [...] } })
// or scrape-smart-wallets normalized output ({ meta, smartMoney, kol, ... }).
// Throws if the format is not recognizable.

/**
 * @param {object|string} rawJson
 * @returns {{ wallet: string, label?: string, pnlUsd?: number, winRate?: number, source: 'gmgn' }[]}
 */
export function parseGmgnSmartWallets(rawJson) {
	const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

	// Raw gmgn API: { data: { rank|wallets|list: [...] } }
	if (data && data.data && typeof data.data === 'object') {
		const list = data.data.rank ?? data.data.wallets ?? data.data.list;
		if (Array.isArray(list)) {
			return list.map(mapEntry).filter(Boolean);
		}
	}

	// scrape-smart-wallets normalized: { meta, smartMoney?, kol?, ... }
	if (data && data.meta && (data.smartMoney || data.kol)) {
		const entries = [];
		addFromWalletsMap(data.smartMoney?.wallets, entries);
		addFromWalletsMap(data.kol?.wallets, entries);
		return entries;
	}

	// Flat array: [{ address|wallet_address, ... }]
	if (Array.isArray(data)) {
		const mapped = data.map(mapEntry).filter(Boolean);
		if (mapped.length > 0 || data.length === 0) return mapped;
	}

	throw new Error(
		'Unrecognized gmgn dump format. Expected { data: { rank: [...] } } or { meta, smartMoney, ... }.',
	);
}

function mapEntry(entry) {
	const wallet = entry.wallet_address || entry.address;
	if (!wallet) return null;

	const result = { wallet, source: 'gmgn' };

	const label = entry.twitter_name || entry.name || entry.ens;
	if (label) result.label = label;

	const pnlUsd = entry.pnl_7d ?? entry.realized_profit_7d ?? entry.pnl_30d ?? entry.realized_profit_30d;
	if (pnlUsd != null) result.pnlUsd = pnlUsd;

	const winRate = entry.winrate ?? entry.win_rate;
	if (winRate != null) result.winRate = winRate;

	return result;
}

function addFromWalletsMap(walletsMap, out) {
	if (!walletsMap || typeof walletsMap !== 'object') return;
	for (const group of Object.values(walletsMap)) {
		if (!Array.isArray(group)) continue;
		for (const entry of group) {
			const mapped = mapEntry(entry);
			if (mapped) out.push(mapped);
		}
	}
}
