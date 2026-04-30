// Smart-money / KOL wallet list.
//
// Minimum P&L threshold rule: wallets here must have realised ≥$10 000
// cumulative profit on Solana meme-token trades.
// Live P&L is fetched from /api/kol/wallets (Birdeye proxy) via getKolWalletsPnl().

export const KOL_WALLETS = [
	{ address: 'Hxk8X7rXhWoJfhbJL8C6kA3mZVJH6P2n5hpwJzE9K1s', label: 'kol-alpha', tags: ['kol'] },
	{ address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', label: 'smart-money-1', tags: ['smart-money'] },
	{ address: 'ART5dr4bDic2sQVZoFheEmUxwQq5VyaSuwY4aiNXMxdA', label: 'whale-desk', tags: ['whale'] },
];

const _index = new Map(KOL_WALLETS.map((w) => [w.address, w]));

export function isSmartMoney(address) {
	return _index.has(address);
}

export function getWalletMeta(address) {
	return _index.get(address) || null;
}

/**
 * Fetch live P&L for all KOL_WALLETS from the Birdeye proxy endpoint.
 * Each entry is merged with its label/tags from the static list.
 *
 * @param {{ baseUrl?: string }} opts
 * @returns {Promise<Array<{ address, label, tags, realizedPnl, unrealizedPnl, winRate, totalTrades, topToken }>>}
 */
export async function getKolWalletsPnl({ baseUrl = '' } = {}) {
	const addresses = KOL_WALLETS.map((w) => w.address).join(',');
	const res = await fetch(`${baseUrl}/api/kol/wallets?addresses=${encodeURIComponent(addresses)}`);
	if (!res.ok) {
		const j = await res.json().catch(() => ({}));
		throw Object.assign(new Error(j.error_description ?? `kol/wallets ${res.status}`), { status: res.status, code: j.error });
	}
	const { data } = await res.json();
	return data.map((entry) => {
		const meta = _index.get(entry.address) ?? {};
		return { label: meta.label ?? null, tags: meta.tags ?? [], ...entry };
	});
}
