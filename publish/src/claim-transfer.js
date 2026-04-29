/**
 * Claim / transfer flow for ERC-8004 agents.
 *
 * Uses standard ERC-721 safeTransferFrom — no custom claim entry point needed.
 * The IdentityRegistry inherits ERC-721 transfer mechanics verbatim.
 */

import { BrowserProvider, Contract, Interface } from 'ethers';
import { IDENTITY_REGISTRY_ABI, REGISTRY_DEPLOYMENTS } from './erc8004/abi.js';

// ---------------------------------------------------------------------------
// ClaimError
// ---------------------------------------------------------------------------

export class ClaimError extends Error {
	/**
	 * @param {string} message
	 * @param {'wrong-owner'|'already-claimed'|'user-rejected'|'network'|'unsupported-chain'} code
	 */
	constructor(message, code) {
		super(message);
		this.name = 'ClaimError';
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @returns {{ identityRegistry: string }} */
function _deployment(chainId) {
	const dep = REGISTRY_DEPLOYMENTS[chainId];
	if (!dep || !dep.identityRegistry) {
		throw new ClaimError(
			`No IdentityRegistry deployment for chain ${chainId}`,
			'unsupported-chain',
		);
	}
	return dep;
}

/**
 * Ask the wallet to switch to `chainId` (EIP-3326).
 * No-ops when the wallet is already on the right chain.
 */
async function _ensureChain(chainId) {
	if (!window.ethereum) return;
	const hexId = '0x' + chainId.toString(16);
	try {
		await window.ethereum.request({
			method: 'wallet_switchEthereumChain',
			params: [{ chainId: hexId }],
		});
	} catch (err) {
		// 4902 = chain not added to wallet — surface as network error
		throw new ClaimError(`Wallet chain switch failed (${err.message})`, 'network');
	}
}

/** Wrap ethers user-rejection errors into ClaimError. */
function _wrapTxError(err) {
	const msg = err?.message || String(err);
	if (
		err?.code === 'ACTION_REJECTED' ||
		msg.includes('user rejected') ||
		msg.includes('User denied')
	) {
		return new ClaimError('User rejected the transaction', 'user-rejected');
	}
	return new ClaimError(msg, 'network');
}

// ---------------------------------------------------------------------------
// claimAgent
// ---------------------------------------------------------------------------

/**
 * Execute the on-chain ownership transfer for an ERC-8004 agent.
 *
 * `signer` must be either the current owner (fromAddress) or an address that
 * the owner has approved via `approve()` / `setApprovalForAll()`.
 *
 * Steps emitted via `onStep`:
 *   permit   — validating ownership + chain
 *   sign     — waiting for wallet signature
 *   broadcast — tx submitted, waiting for inclusion
 *   confirm  — tx confirmed
 *
 * @param {object} opts
 * @param {number|string} opts.agentId
 * @param {string}        opts.fromAddress  Current owner (ops/mint wallet)
 * @param {string}        opts.toAddress    Claimer address
 * @param {import('ethers').Signer} opts.signer
 * @param {(step: {step: string, pct: number, txHash?: string}) => void} [opts.onStep]
 * @returns {Promise<{ok: true, txHash: string, blockNumber: number}>}
 */
export async function claimAgent({ agentId, fromAddress, toAddress, signer, onStep }) {
	const step = (s, pct, txHash) => onStep?.({ step: s, pct, ...(txHash ? { txHash } : {}) });

	step('permit', 0);

	// Resolve chain from the signer's provider
	const network = await signer.provider.getNetwork();
	const chainId = Number(network.chainId);

	_deployment(chainId); // throws 'unsupported-chain' if unknown

	await _ensureChain(chainId);

	const dep = _deployment(chainId);
	const registry = new Contract(dep.identityRegistry, IDENTITY_REGISTRY_ABI, signer);

	// Validate current ownership
	let currentOwner;
	try {
		currentOwner = await registry.ownerOf(agentId);
	} catch (err) {
		throw new ClaimError(
			`Could not fetch owner for agentId ${agentId}: ${err.message}`,
			'network',
		);
	}

	const normalize = (a) => a.toLowerCase();

	if (normalize(currentOwner) !== normalize(fromAddress)) {
		throw new ClaimError(
			`Agent ${agentId} is owned by ${currentOwner}, not ${fromAddress}`,
			'wrong-owner',
		);
	}

	if (normalize(currentOwner) === normalize(toAddress)) {
		throw new ClaimError(
			`Agent ${agentId} is already owned by ${toAddress}`,
			'already-claimed',
		);
	}

	step('sign', 25);

	let tx;
	try {
		tx = await registry['safeTransferFrom(address,address,uint256)'](
			fromAddress,
			toAddress,
			agentId,
		);
	} catch (err) {
		throw _wrapTxError(err);
	}

	step('broadcast', 60, tx.hash);

	let receipt;
	try {
		receipt = await tx.wait();
	} catch (err) {
		throw _wrapTxError(err);
	}

	step('confirm', 100, tx.hash);

	return { ok: true, txHash: tx.hash, blockNumber: receipt.blockNumber };
}

// ---------------------------------------------------------------------------
// buildClaimPayload
// ---------------------------------------------------------------------------

/**
 * Build a raw `eth_sendTransaction` payload for a claim transfer.
 * Pure function — no wallet connection required.
 *
 * Useful when the signing step is split from the payload build (e.g. the
 * server builds the call data, the client signs and sends it).
 *
 * @param {object} opts
 * @param {number|string} opts.agentId
 * @param {string}        opts.toAddress    Recipient address
 * @param {number}        opts.chainId
 * @param {string}        opts.fromAddress  Current owner (required for safeTransferFrom calldata)
 * @returns {{ to: string, data: string, value: string }}
 */
export function buildClaimPayload({ agentId, toAddress, chainId, fromAddress }) {
	const dep = _deployment(chainId); // throws 'unsupported-chain' if unknown

	const iface = new Interface(IDENTITY_REGISTRY_ABI);
	const data = iface.encodeFunctionData('safeTransferFrom(address,address,uint256)', [
		fromAddress,
		toAddress,
		agentId,
	]);

	return {
		to: dep.identityRegistry,
		data,
		value: '0x0',
	};
}
