/**
 * ERC-8004 Registry ABIs.
 *
 * Only the functions needed for agent registration, reputation, and validation.
 * Full spec: https://eips.ethereum.org/EIPS/eip-8004
 */

export const IDENTITY_REGISTRY_ABI = [
	// --- Registration ---
	'function register(string agentURI) external returns (uint256 agentId)',
	'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) external returns (uint256 agentId)',
	'function register() external returns (uint256 agentId)',

	// --- URI ---
	'function setAgentURI(uint256 agentId, string newURI) external',
	'function tokenURI(uint256 agentId) external view returns (string)',

	// --- Wallet ---
	'function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature) external',
	'function getAgentWallet(uint256 agentId) external view returns (address)',
	'function unsetAgentWallet(uint256 agentId) external',
	'function nonces(address owner) external view returns (uint256)',
	'function DOMAIN_SEPARATOR() external view returns (bytes32)',

	// --- Metadata ---
	'function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)',
	'function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external',

	// --- ERC-721 basics ---
	'function ownerOf(uint256 tokenId) external view returns (address)',
	'function balanceOf(address owner) external view returns (uint256)',
	'function totalSupply() external view returns (uint256)',
	'function isAgent(uint256 agentId) external view returns (bool)',

	// --- Events ---
	'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
	'event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)',
	'event WalletSet(uint256 indexed agentId, address indexed wallet)',
	'event WalletUnset(uint256 indexed agentId)',
	'event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)',
	'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

export const REPUTATION_REGISTRY_ABI = [
	// --- Submit ---
	'function submitFeedback(uint256 agentId, int8 score, string uri) external',

	// --- Query ---
	'function getReputation(uint256 agentId) external view returns (int256 avgX100, uint256 count)',
	'function getFeedbackCount(uint256 agentId) external view returns (uint256)',
	'function getFeedback(uint256 agentId, uint256 index) external view returns (tuple(address from, int8 score, uint64 timestamp, string uri))',
	'function getFeedbackRange(uint256 agentId, uint256 offset, uint256 limit) external view returns (tuple(address from, int8 score, uint64 timestamp, string uri)[])',
	'function hasReviewed(uint256 agentId, address reviewer) external view returns (bool)',

	// --- Events ---
	'event FeedbackSubmitted(uint256 indexed agentId, address indexed from, int8 score, string uri)',
];

export const VALIDATION_REGISTRY_ABI = [
	// --- Admin ---
	'function addValidator(address v) external',
	'function removeValidator(address v) external',
	'function isValidator(address v) external view returns (bool)',
	'function owner() external view returns (address)',
	'function transferOwnership(address newOwner) external',

	// --- Record ---
	'function recordValidation(uint256 agentId, bool passed, bytes32 proofHash, string proofURI, string kind) external',

	// --- Query ---
	'function getValidationCount(uint256 agentId) external view returns (uint256)',
	'function getValidation(uint256 agentId, uint256 index) external view returns (tuple(address validator, bool passed, bytes32 proofHash, string proofURI, uint64 timestamp, string kind))',
	'function getLatestByKind(uint256 agentId, string kind) external view returns (tuple(address validator, bool passed, bytes32 proofHash, string proofURI, uint64 timestamp, string kind))',
	'function getValidationRange(uint256 agentId, uint256 offset, uint256 limit) external view returns (tuple(address validator, bool passed, bytes32 proofHash, string proofURI, uint64 timestamp, string kind)[])',

	// --- Events ---
	'event ValidatorAdded(address indexed validator)',
	'event ValidatorRemoved(address indexed validator)',
	'event ValidationRecorded(uint256 indexed agentId, address indexed validator, bool passed, bytes32 proofHash, string kind)',
];

/**
 * Known deployments — add chain-specific addresses here.
 * Format follows agentRegistry spec: eip155:{chainId}:{address}
 */
export const REGISTRY_DEPLOYMENTS = {
	// Base mainnet (chain 8453)
	8453: {
		identityRegistry: '',   // TODO: fill once deployed
		reputationRegistry: '', // TODO: fill once deployed
		validationRegistry: '', // TODO: fill once deployed
	},
	// Base Sepolia testnet (chain 84532)
	84532: {
		identityRegistry: '',   // TODO: fill in from Deploy.s.sol broadcast output
		reputationRegistry: '',
		validationRegistry: '',
	},
	// Ethereum mainnet (chain 1) — if deployed
	1: {
		identityRegistry: '',
		reputationRegistry: '',
		validationRegistry: '',
	},
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
