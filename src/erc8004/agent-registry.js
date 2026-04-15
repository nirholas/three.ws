/**
 * ERC-8004 Agent Registry — wallet + contract interaction layer.
 *
 * Handles:
 *  1. Wallet connection (Privy multi-wallet, fallback to injected provider)
 *  2. Uploading GLB + registration JSON to IPFS via web3.storage or Filebase
 *  3. Calling register() on the Identity Registry
 *  4. Building the ERC-8004 registration JSON
 */

import { BrowserProvider, Contract } from 'ethers';
import { IDENTITY_REGISTRY_ABI, REGISTRY_DEPLOYMENTS, agentRegistryId } from './abi.js';
import { isPrivyConfigured, connectWithPrivy } from './privy.js';

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

let _provider = null;
let _signer = null;

/**
 * Connect a wallet.
 *
 * Strategy:
 *  1. If Privy is configured (VITE_PRIVY_APP_ID set), use Privy — gives users
 *     MetaMask, WalletConnect, Coinbase, email-based embedded wallets, etc.
 *  2. Otherwise fall back to window.ethereum (injected provider only).
 *
 * @returns {Promise<{provider: BrowserProvider, signer: import('ethers').Signer, address: string, chainId: number}>}
 */
export async function connectWallet() {
	// Try Privy first — multi-wallet support, embedded wallets, social login
	if (isPrivyConfigured()) {
		try {
			const result = await connectWithPrivy();
			_provider = result.provider;
			_signer = result.signer;
			return result;
		} catch (err) {
			console.warn('[wallet] Privy connect failed, trying injected provider:', err.message);
		}
	}

	// Fallback: raw injected provider (MetaMask, etc.)
	if (!window.ethereum) {
		throw new Error('No wallet detected. Install MetaMask or configure Privy (VITE_PRIVY_APP_ID).');
	}

	_provider = new BrowserProvider(window.ethereum);
	_signer = await _provider.getSigner();
	const address = await _signer.getAddress();
	const network = await _provider.getNetwork();
	const chainId = Number(network.chainId);

	return { provider: _provider, signer: _signer, address, chainId };
}

/**
 * @returns {import('ethers').Signer | null}
 */
export function getSigner() {
	return _signer;
}

// ---------------------------------------------------------------------------
// IPFS upload (via public pinning gateway — swap for Filebase / web3.storage)
// ---------------------------------------------------------------------------

const IPFS_UPLOAD_URL = 'https://api.web3.storage/upload';

/**
 * Pin a blob to IPFS. Returns the CID.
 *
 * Uses web3.storage free tier by default.
 * Set `window.__W3S_TOKEN` or pass `apiToken` for auth.
 *
 * @param {Blob|File} blob
 * @param {string} [apiToken]
 * @returns {Promise<string>}  The IPFS CID.
 */
export async function pinToIPFS(blob, apiToken) {
	const token = apiToken || window.__W3S_TOKEN;
	if (!token) {
		throw new Error(
			'IPFS upload requires an API token. Set window.__W3S_TOKEN or pass one to pinToIPFS().',
		);
	}

	const res = await fetch(IPFS_UPLOAD_URL, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: blob,
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`IPFS upload failed (${res.status}): ${text}`);
	}

	const data = await res.json();
	return data.cid;
}

// ---------------------------------------------------------------------------
// Registration JSON builder
// ---------------------------------------------------------------------------

/**
 * Build an ERC-8004 agent registration JSON.
 *
 * @param {object} opts
 * @param {string} opts.name          Agent display name
 * @param {string} opts.description   Natural-language description
 * @param {string} opts.imageCID      IPFS CID of the 3D GLB model
 * @param {number} opts.agentId       Token ID from the registry (filled after mint)
 * @param {number} opts.chainId       Chain ID where registered
 * @param {string} opts.registryAddr  Identity Registry contract address
 * @param {string[]} [opts.services]  Additional service objects
 * @returns {object}
 */
export function buildRegistrationJSON({
	name,
	description,
	imageCID,
	agentId,
	chainId,
	registryAddr,
	services = [],
}) {
	return {
		type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
		name,
		description,
		image: `ipfs://${imageCID}`,
		active: true,
		services: [
			{
				name: '3D',
				endpoint: `https://3dagent.vercel.app/#model=ipfs://${imageCID}`,
				version: '1.0',
			},
			...services,
		],
		registrations: [
			{
				agentId,
				agentRegistry: agentRegistryId(chainId, registryAddr),
			},
		],
		supportedTrust: ['reputation'],
	};
}

// ---------------------------------------------------------------------------
// On-chain registration
// ---------------------------------------------------------------------------

/**
 * Get the Identity Registry contract for the connected chain.
 * @param {number} chainId
 * @param {import('ethers').Signer} signer
 * @returns {Contract}
 */
export function getIdentityRegistry(chainId, signer) {
	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	if (!deployment || !deployment.identityRegistry) {
		throw new Error(`No Identity Registry deployment configured for chain ${chainId}.`);
	}
	return new Contract(deployment.identityRegistry, IDENTITY_REGISTRY_ABI, signer);
}

/**
 * Full registration flow:
 *  1. Upload GLB to IPFS
 *  2. Build registration JSON
 *  3. Upload registration JSON to IPFS
 *  4. Call register(agentURI) on-chain
 *  5. Update registration JSON with agentId, re-pin, call setAgentURI
 *
 * @param {object} opts
 * @param {File}   opts.glbFile       The GLB avatar file
 * @param {string} opts.name          Agent name
 * @param {string} opts.description   Agent description
 * @param {string} [opts.apiToken]    IPFS pinning API token
 * @param {function} [opts.onStatus]  Callback for progress updates
 * @returns {Promise<{agentId: number, registrationCID: string, txHash: string}>}
 */
export async function registerAgent({ glbFile, name, description, apiToken, onStatus }) {
	const log = onStatus || (() => {});

	// 1. Connect wallet
	log('Connecting wallet...');
	const { signer, address, chainId } = await connectWallet();

	// 2. Upload GLB to IPFS
	log('Uploading 3D model to IPFS...');
	const glbCID = await pinToIPFS(glbFile, apiToken);
	log(`Model pinned: ipfs://${glbCID}`);

	// 3. Get contract
	const registry = getIdentityRegistry(chainId, signer);

	// 4. Register with a placeholder URI first to get the agentId
	log('Registering agent on-chain...');
	const tx = await registry['register(string)'](`ipfs://${glbCID}`);
	log(`Transaction submitted: ${tx.hash}`);
	const receipt = await tx.wait();

	// Parse agentId from the Registered event
	const registeredEvent = receipt.logs
		.map((l) => { try { return registry.interface.parseLog(l); } catch { return null; } })
		.find((e) => e && e.name === 'Registered');

	if (!registeredEvent) {
		throw new Error('Registration transaction succeeded but Registered event not found.');
	}

	const agentId = Number(registeredEvent.args.agentId);
	log(`Agent minted! agentId = ${agentId}`);

	// 5. Build final registration JSON with the agentId
	const registrationJSON = buildRegistrationJSON({
		name,
		description,
		imageCID: glbCID,
		agentId,
		chainId,
		registryAddr: REGISTRY_DEPLOYMENTS[chainId].identityRegistry,
	});

	// 6. Pin registration JSON to IPFS
	log('Pinning registration metadata to IPFS...');
	const jsonBlob = new Blob([JSON.stringify(registrationJSON, null, 2)], {
		type: 'application/json',
	});
	const registrationCID = await pinToIPFS(jsonBlob, apiToken);
	log(`Registration JSON pinned: ipfs://${registrationCID}`);

	// 7. Update agentURI on-chain to point at the full registration JSON
	log('Updating agentURI on-chain...');
	const updateTx = await registry.setAgentURI(agentId, `ipfs://${registrationCID}`);
	await updateTx.wait();
	log('Agent URI updated on-chain.');

	return {
		agentId,
		registrationCID,
		txHash: tx.hash,
	};
}
