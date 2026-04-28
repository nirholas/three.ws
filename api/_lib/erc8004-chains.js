/**
 * Server-side mirror of src/erc8004/abi.js REGISTRY_DEPLOYMENTS + chain metadata.
 * Duplicated (rather than importing from src/) so the serverless bundle stays
 * lean and the crawler is insulated from client-only imports in src/erc8004/.
 *
 * Identity Registry deployment: CREATE2-deterministic, same address on every
 * chain — one address per network class (mainnet vs. testnet).
 */

export const IDENTITY_REGISTRY_MAINNET = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const IDENTITY_REGISTRY_TESTNET = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

/**
 * Chains where the ERC-8004 Identity Registry is deployed. Ordered so the most
 * active chains are crawled first when the cron has a time budget.
 */
export const CHAINS = [
	{
		id: 8453,
		name: 'Base',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://basescan.org',
		rpcUrl: 'https://mainnet.base.org',
	},
	{
		id: 42161,
		name: 'Arbitrum One',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://arbiscan.io',
		rpcUrl: 'https://arb1.arbitrum.io/rpc',
	},
	{
		id: 56,
		name: 'BNB Chain',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://bscscan.com',
		rpcUrl: 'https://bsc-dataseed1.binance.org',
	},
	{
		id: 1,
		name: 'Ethereum',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://etherscan.io',
		rpcUrl: 'https://eth.llamarpc.com',
	},
	{
		id: 10,
		name: 'Optimism',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://optimistic.etherscan.io',
		rpcUrl: 'https://mainnet.optimism.io',
	},
	{
		id: 137,
		name: 'Polygon',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://polygonscan.com',
		rpcUrl: 'https://polygon-rpc.com',
	},
	{
		id: 43114,
		name: 'Avalanche',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://snowtrace.io',
		rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
	},
	{
		id: 100,
		name: 'Gnosis',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://gnosisscan.io',
		rpcUrl: 'https://rpc.gnosischain.com',
	},
	{
		id: 250,
		name: 'Fantom',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://ftmscan.com',
		rpcUrl: 'https://rpc.ankr.com/fantom',
	},
	{
		id: 42220,
		name: 'Celo',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://celoscan.io',
		rpcUrl: 'https://forno.celo.org',
	},
	{
		id: 59144,
		name: 'Linea',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://lineascan.build',
		rpcUrl: 'https://rpc.linea.build',
	},
	{
		id: 534352,
		name: 'Scroll',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://scrollscan.com',
		rpcUrl: 'https://rpc.scroll.io',
	},
	{
		id: 5000,
		name: 'Mantle',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://explorer.mantle.xyz',
		rpcUrl: 'https://rpc.mantle.xyz',
	},
	{
		id: 324,
		name: 'zkSync Era',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://explorer.zksync.io',
		rpcUrl: 'https://mainnet.era.zksync.io',
	},
	{
		id: 1284,
		name: 'Moonbeam',
		testnet: false,
		registry: IDENTITY_REGISTRY_MAINNET,
		explorer: 'https://moonbeam.moonscan.io',
		rpcUrl: 'https://rpc.api.moonbeam.network',
	},
	{
		id: 97,
		name: 'BSC Testnet',
		testnet: true,
		registry: IDENTITY_REGISTRY_TESTNET,
		explorer: 'https://testnet.bscscan.com',
		rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
	},
	{
		id: 84532,
		name: 'Base Sepolia',
		testnet: true,
		registry: IDENTITY_REGISTRY_TESTNET,
		explorer: 'https://sepolia.basescan.org',
		rpcUrl: 'https://sepolia.base.org',
	},
	{
		id: 421614,
		name: 'Arbitrum Sepolia',
		testnet: true,
		registry: IDENTITY_REGISTRY_TESTNET,
		explorer: 'https://sepolia.arbiscan.io',
		rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
	},
	{
		id: 11155111,
		name: 'Ethereum Sepolia',
		testnet: true,
		registry: IDENTITY_REGISTRY_TESTNET,
		explorer: 'https://sepolia.etherscan.io',
		rpcUrl: 'https://rpc2.sepolia.org',
	},
	{
		id: 11155420,
		name: 'Optimism Sepolia',
		testnet: true,
		registry: IDENTITY_REGISTRY_TESTNET,
		explorer: 'https://sepolia-optimism.etherscan.io',
		rpcUrl: 'https://sepolia.optimism.io',
	},
	{
		id: 80002,
		name: 'Polygon Amoy',
		testnet: true,
		registry: IDENTITY_REGISTRY_TESTNET,
		explorer: 'https://amoy.polygonscan.com',
		rpcUrl: 'https://rpc-amoy.polygon.technology',
	},
	{
		id: 43113,
		name: 'Avalanche Fuji',
		testnet: true,
		registry: IDENTITY_REGISTRY_TESTNET,
		explorer: 'https://testnet.snowtrace.io',
		rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
	},
];

export const CHAIN_BY_ID = Object.fromEntries(CHAINS.map((c) => [c.id, c]));

export function tokenExplorerUrl(chainId, agentId) {
	const c = CHAIN_BY_ID[chainId];
	if (!c) return null;
	return `${c.explorer}/token/${c.registry}?a=${agentId}`;
}

export function addressExplorerUrl(chainId, address) {
	const c = CHAIN_BY_ID[chainId];
	if (!c) return null;
	return `${c.explorer}/address/${address}`;
}
