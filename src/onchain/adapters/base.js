/**
 * WalletAdapter — the contract every chain family implements.
 *
 * The deploy orchestrator only ever sees this interface. New chains plug in by
 * adding a new adapter; the UI stays family-agnostic.
 */

/**
 * @typedef {object} ConnectResult
 * @property {string} address     User's wallet address (hex for EVM, base58 for Solana).
 * @property {import('../chain-ref.js').ChainRef} ref  Chain the wallet is currently on.
 */

/**
 * @typedef {object} PrepResponse
 * @property {string} prepId
 * @property {string} metadataUri          // ipfs:// or https:// pointing at the manifest
 * @property {string} [contractAddress]    // EVM: identity-registry address
 * @property {string} [txBase64]           // Solana: serialized unsigned tx
 * @property {string} [assetPubkey]        // Solana: mint pubkey
 * @property {string} [chainCaip2]
 */

/**
 * @typedef {object} SignResult
 * @property {string} txHash               // EVM tx hash or Solana signature
 * @property {string} [onchainId]          // Optional family-specific ID (EVM agentId, Solana asset)
 */

/**
 * @abstract
 */
export class WalletAdapter {
	/** @returns {string} 'evm' | 'solana' */
	get family() {
		throw new Error('not implemented');
	}

	/** @returns {boolean} Whether an injected provider is detectable. */
	isAvailable() {
		throw new Error('not implemented');
	}

	/** @returns {string} URL to install a typical wallet for this family. */
	installUrl() {
		throw new Error('not implemented');
	}

	/**
	 * Connect (and on-Solana, optionally SIWS-link) the user's wallet.
	 * Implementations must throw on user rejection with `err.code === 'USER_REJECTED'`.
	 * @param {{ ensureLinked?: boolean, csrfToken?: string }} [opts]
	 * @returns {Promise<ConnectResult>}
	 */
	async connect(_opts) {
		throw new Error('not implemented');
	}

	/**
	 * Switch the wallet to the given ChainRef. EVM wallets prompt the user;
	 * Solana wallets typically have no concept of switching — adapters return
	 * silently if already on the right cluster, or throw if mismatched.
	 * @param {import('../chain-ref.js').ChainRef} ref
	 */
	async switchTo(_ref) {
		throw new Error('not implemented');
	}

	/**
	 * Sign and submit the prep transaction returned by the server.
	 * @param {PrepResponse} prep
	 * @param {import('../chain-ref.js').ChainRef} ref
	 * @returns {Promise<SignResult>}
	 */
	async signAndSend(_prep, _ref) {
		throw new Error('not implemented');
	}
}

/** Helper: classify a thrown error as a user rejection across providers. */
export function isUserRejection(err) {
	if (!err) return false;
	if (err.code === 'USER_REJECTED') return true;
	if (err.code === 4001) return true;
	if (err.code === 'ACTION_REJECTED') return true;
	const msg = String(err.message || err).toLowerCase();
	return /user rejected|user denied|rejected by user|user cancel|signature cancel|connection cancel/.test(
		msg,
	);
}
