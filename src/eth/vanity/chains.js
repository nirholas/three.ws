/**
 * EVM chain registry for the CREATE2 vanity flow.
 *
 * The killer feature of CREATE2 is "deploy at the same address on every
 * chain that has the factory deployed." For factories like the Arachnid
 * deterministic-deployment-proxy this is most major chains.
 *
 * Each entry has:
 *   id        EIP-155 chain ID
 *   name      human label
 *   shortName chain shortName (matches eip155 chain registry)
 *   rpc       public RPC endpoint
 *   explorer  base URL (no trailing slash)
 *   currency  native token symbol
 *   factories set of factory address presence flags (lowercase keys)
 */

export const ARACHNID_PROXY = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
export const CREATEX        = '0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed';
export const SAFE_FACTORY   = '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67';
export const COINBASE_SW    = '0x0ba5ed0c6aa8c49038f819e587e2633c4a9f428a';

/** @typedef {{ id: number, name: string, shortName: string, rpc: string, explorer: string, currency: string, testnet?: boolean, factories: Record<string, boolean> }} ChainMeta */

/** @type {ChainMeta[]} */
export const CHAINS = [
	{
		id: 1, name: 'Ethereum', shortName: 'eth',
		rpc: 'https://cloudflare-eth.com',
		explorer: 'https://etherscan.io',
		currency: 'ETH',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true, [SAFE_FACTORY]: true, [COINBASE_SW]: true },
	},
	{
		id: 8453, name: 'Base', shortName: 'base',
		rpc: 'https://mainnet.base.org',
		explorer: 'https://basescan.org',
		currency: 'ETH',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true, [SAFE_FACTORY]: true, [COINBASE_SW]: true },
	},
	{
		id: 10, name: 'Optimism', shortName: 'oeth',
		rpc: 'https://mainnet.optimism.io',
		explorer: 'https://optimistic.etherscan.io',
		currency: 'ETH',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true, [SAFE_FACTORY]: true },
	},
	{
		id: 42161, name: 'Arbitrum', shortName: 'arb1',
		rpc: 'https://arb1.arbitrum.io/rpc',
		explorer: 'https://arbiscan.io',
		currency: 'ETH',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true, [SAFE_FACTORY]: true },
	},
	{
		id: 137, name: 'Polygon', shortName: 'matic',
		rpc: 'https://polygon-rpc.com',
		explorer: 'https://polygonscan.com',
		currency: 'POL',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true, [SAFE_FACTORY]: true },
	},
	{
		id: 56, name: 'BNB Chain', shortName: 'bnb',
		rpc: 'https://bsc-dataseed.bnbchain.org',
		explorer: 'https://bscscan.com',
		currency: 'BNB',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true, [SAFE_FACTORY]: true },
	},
	{
		id: 43114, name: 'Avalanche', shortName: 'avax',
		rpc: 'https://api.avax.network/ext/bc/C/rpc',
		explorer: 'https://snowtrace.io',
		currency: 'AVAX',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true },
	},
	{
		id: 11155111, name: 'Sepolia', shortName: 'sep', testnet: true,
		rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
		explorer: 'https://sepolia.etherscan.io',
		currency: 'ETH',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true, [SAFE_FACTORY]: true },
	},
	{
		id: 84532, name: 'Base Sepolia', shortName: 'basesep', testnet: true,
		rpc: 'https://sepolia.base.org',
		explorer: 'https://sepolia.basescan.org',
		currency: 'ETH',
		factories: { [ARACHNID_PROXY]: true, [CREATEX]: true, [SAFE_FACTORY]: true },
	},
];

/** @returns {ChainMeta | undefined} */
export function getChain(chainId) {
	return CHAINS.find((c) => c.id === Number(chainId));
}

/**
 * Chains where a given factory address is deployed (lowercase deployer).
 * @param {string} deployer
 * @returns {ChainMeta[]}
 */
export function chainsWithFactory(deployer) {
	const key = String(deployer).toLowerCase();
	return CHAINS.filter((c) => c.factories[key]);
}

/** Build a tx URL for an explorer. */
export function txUrl(chainId, txHash) {
	const c = getChain(chainId);
	return c ? `${c.explorer}/tx/${txHash}` : null;
}

/** Build an address URL for an explorer. */
export function addrUrl(chainId, address) {
	const c = getChain(chainId);
	return c ? `${c.explorer}/address/${address}` : null;
}
