// Smart-money / KOL wallet list.
//
// Minimum P&L threshold rule: wallets here must have realised ≥$10 000
// cumulative profit on Solana meme-token trades.
// TODO: replace stub with a dynamic source (on-chain P&L indexer, Dune, Birdeye)

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
