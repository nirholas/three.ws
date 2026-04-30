/**
 * ERC-8004 Registry ABIs & canonical deployments.
 *
 * Contract addresses below are the canonical ERC-8004 reference deployments
 * shared across every EVM chain (deployed via CREATE2). Source:
 * https://github.com/nirholas/erc8004-agents
 *
 * ValidationRegistry mainnet deployment is pending. After running
 * contracts/script/deploy-validation-registry.sh, fill in the address
 * produced by computeAddress(DEPLOYER_ADDRESS) in MAINNET.validationRegistry.
 */

export const IDENTITY_REGISTRY_ABI = [
	// --- Registration ---
	'function register() external returns (uint256 agentId)',
	'function register(string agentURI) external returns (uint256 agentId)',
	'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) external returns (uint256 agentId)',

	// --- URI ---
	'function setAgentURI(uint256 agentId, string newURI) external',
	'function tokenURI(uint256 tokenId) external view returns (string)',

	// --- Metadata ---
	'function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external',
	'function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)',

	// --- Wallet ---
	'function getAgentWallet(uint256 agentId) external view returns (address)',

	// --- ERC-721 basics ---
	'function ownerOf(uint256 tokenId) external view returns (address)',
	'function balanceOf(address owner) external view returns (uint256)',
	'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
	'function totalSupply() external view returns (uint256)',
	'function name() external view returns (string)',
	'function symbol() external view returns (string)',
	'function getVersion() external pure returns (string)',

	// --- ERC-721 transfer ---
	'function transferFrom(address from, address to, uint256 tokenId) external',
	'function safeTransferFrom(address from, address to, uint256 tokenId) external',
	'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data) external',
	'function approve(address to, uint256 tokenId) external',
	'function setApprovalForAll(address operator, bool approved) external',

	// --- Events ---
	'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
	'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

export const REPUTATION_REGISTRY_ABI = [
	'function submitReputation(uint256 agentId, uint8 score, string comment) external',
	'function getReputation(uint256 agentId) external view returns (uint256 totalScore, uint256 count)',
	'event ReputationSubmitted(uint256 indexed agentId, address indexed submitter, uint8 score, string comment)',
];

/**
 * Validation Registry ABI — best-effort; may need updating once the canonical
 * interface is published. Mainnet has no Validation Registry deployed yet.
 */
export const VALIDATION_REGISTRY_ABI = [
	'function recordValidation(uint256 agentId, bool passed, bytes32 proofHash, string proofURI, string kind) external',
	'function getValidationCount(uint256 agentId) external view returns (uint256)',
	'event ValidationRecorded(uint256 indexed agentId, address indexed validator, bool passed, bytes32 proofHash, string kind)',
];

// ---------------------------------------------------------------------------
// Canonical deployments (same address on every chain)
// ---------------------------------------------------------------------------

const TESTNET = {
	identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
	reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
	validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
};

const MAINNET = {
	identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
	reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
	validationRegistry: '', // not yet deployed on mainnet
};

/**
 * Known deployments keyed by chainId.
 */
export const REGISTRY_DEPLOYMENTS = {
	// Mainnets
	1: MAINNET, // Ethereum
	10: MAINNET, // Optimism
	56: MAINNET, // BSC
	100: MAINNET, // Gnosis
	137: MAINNET, // Polygon
	250: MAINNET, // Fantom
	324: MAINNET, // zkSync Era
	1284: MAINNET, // Moonbeam
	5000: MAINNET, // Mantle
	8453: MAINNET, // Base
	42161: MAINNET, // Arbitrum One
	42220: MAINNET, // Celo
	43114: MAINNET, // Avalanche
	59144: MAINNET, // Linea
	534352: MAINNET, // Scroll

	// Testnets
	97: TESTNET, // BSC Testnet
	11155111: TESTNET, // Ethereum Sepolia
	84532: TESTNET, // Base Sepolia
	421614: TESTNET, // Arbitrum Sepolia
	11155420: TESTNET, // Optimism Sepolia
	80002: TESTNET, // Polygon Amoy
	43113: TESTNET, // Avalanche Fuji
};

/**
 * Build the agentRegistry string per spec.
 * @param {number} chainId
 * @param {string} registryAddress
 * @returns {string}  e.g. "eip155:8453:0x742..."
 */
export function agentRegistryId(chainId, registryAddress) {
	return `eip155:${chainId}:${registryAddress}`;
}
