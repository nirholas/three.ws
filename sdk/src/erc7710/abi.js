/**
 * ERC-7710 / MetaMask Delegation Toolkit ABIs and addresses.
 *
 * Caveat enforcer addresses and DelegationManager deployments.
 * Source: https://github.com/MetaMask/delegation-framework
 */

export const DELEGATION_MANAGER_ABI = [
	'function disableDelegation(bytes32 delegationHash) external',
	'function isDelegationDisabled(bytes32 delegationHash) external view returns (bool)',
	'event DisabledDelegation(bytes32 indexed delegationHash)',
];

/** Known DelegationManager addresses keyed by chainId. */
export const DELEGATION_MANAGER_DEPLOYMENTS = {
	1: '0x0000000000000000000000000000000000000000', // Ethereum mainnet — update when deployed
	11155111: '0x0000000000000000000000000000000000000000', // Sepolia — update when deployed
};

/**
 * Caveat enforcer contract addresses keyed by chainId.
 * Each enforcer restricts what a delegation can do.
 */
export const CAVEAT_ENFORCERS = {
	AllowedTargetsEnforcer: {
		1: '0x0000000000000000000000000000000000000000',
		11155111: '0x0000000000000000000000000000000000000000',
	},
	ERC20LimitEnforcer: {
		1: '0x0000000000000000000000000000000000000000',
		11155111: '0x0000000000000000000000000000000000000000',
	},
	TimestampEnforcer: {
		1: '0x0000000000000000000000000000000000000000',
		11155111: '0x0000000000000000000000000000000000000000',
	},
};

/**
 * ABI-encode an array of caveat objects into bytes.
 * @param {Array<{enforcer: string, terms: string, args: string}>} caveats
 * @returns {string} hex-encoded bytes
 */
export function encodeCaveats(caveats) {
	// Minimal placeholder — real implementation uses ethers ABI encoding.
	return '0x' + caveats.map((c) => c.enforcer.slice(2)).join('');
}
