/**
 * TokenAdapter — the contract every token-launch backend implements.
 *
 * Parallel to WalletAdapter. The deploy orchestrator and UI talk only to this
 * interface; new launchpads (Zora, Bonfida, Streamflow…) plug in as new
 * adapters without forking the calling code.
 *
 * A "token" here is a fungible asset bound to an agent identity (memecoin on a
 * bonding curve, social token, etc.). Distinct from the agent's *identity* NFT
 * minted via the deploy flow.
 */

/**
 * @typedef {object} LaunchPrep
 * @property {string} prepId
 * @property {string} mint              Mint pubkey (Solana base58, EVM addr, etc.)
 * @property {string} txBase64          Partially-signed unsigned-by-user tx
 * @property {string} metadataUri       Token metadata pointer (ipfs://...)
 * @property {string} family            'solana' | 'evm' | ...
 * @property {string} provider          'pumpfun' | 'zora' | ...
 * @property {string} [cluster]         For Solana
 */

/**
 * @typedef {object} LaunchResult
 * @property {string} mint
 * @property {string} txHash            Tx hash / signature
 * @property {string} provider
 * @property {string} [curve]           Provider-specific curve / pool ID
 */

/**
 * @abstract
 */
export class TokenAdapter {
	/** @returns {string} 'pumpfun' | etc. */
	get provider() {
		throw new Error('not implemented');
	}

	/** @returns {string} 'solana' | 'evm' */
	get family() {
		throw new Error('not implemented');
	}

	/**
	 * Validate that a launch is permitted for the given agent state. Adapters
	 * use this to enforce constraints (Pump.fun is Solana-only, requires the
	 * agent to already have a Solana identity, etc.).
	 *
	 * @param {{ agent: object }} ctx
	 * @returns {{ ok: boolean, reason?: string }}
	 */
	validatePreconditions(_ctx) {
		throw new Error('not implemented');
	}
}
