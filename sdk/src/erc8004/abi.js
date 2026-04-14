/**
 * ERC-8004 Identity Registry — minimal ABI.
 * Full spec: https://eips.ethereum.org/EIPS/eip-8004
 */

export const IDENTITY_REGISTRY_ABI = [
	'function register(string agentURI) external returns (uint256 agentId)',
	'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) external returns (uint256 agentId)',
	'function register() external returns (uint256 agentId)',
	'function setAgentURI(uint256 agentId, string newURI) external',
	'function tokenURI(uint256 agentId) external view returns (string)',
	'function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature) external',
	'function getAgentWallet(uint256 agentId) external view returns (address)',
	'function unsetAgentWallet(uint256 agentId) external',
	'function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)',
	'function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external',
	'function ownerOf(uint256 tokenId) external view returns (address)',
	'function balanceOf(address owner) external view returns (uint256)',
	'function totalSupply() external view returns (uint256)',
	'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
	'event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)',
	'event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)',
	'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

/**
 * Known deployments — fill with your contract addresses.
 * Format: eip155:{chainId}:{address}
 */
export const REGISTRY_DEPLOYMENTS = {
	8453: { identityRegistry: '' },   // Base mainnet
	84532: { identityRegistry: '' },  // Base Sepolia
	1: { identityRegistry: '' },      // Ethereum mainnet
};

/**
 * Build the agentRegistry identifier per spec.
 * @param {number} chainId
 * @param {string} registryAddress
 * @returns {string}  e.g. "eip155:8453:0x742..."
 */
export function agentRegistryId(chainId, registryAddress) {
	return `eip155:${chainId}:${registryAddress}`;
}
