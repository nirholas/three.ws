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
// File upload — backend R2 (default) or Pinata (if token supplied)
// ---------------------------------------------------------------------------

/**
 * Upload a file blob. Returns the public URL.
 *
 * Without a token: POSTs to /api/erc8004/pin which stores to R2.
 * With a Pinata JWT token: POSTs to Pinata and returns an ipfs:// URL.
 *
 * @param {Blob|File} blob
 * @param {string} [apiToken]  Pinata JWT (optional)
 * @returns {Promise<string>}  Public URL for the uploaded file.
 */
export async function pinFile(blob, apiToken) {
	if (apiToken) {
		const form = new FormData();
		form.append('file', blob, blob.name || 'upload');
		const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiToken}` },
			body: form,
		});
		if (!res.ok) throw new Error(`Pinata upload failed (${res.status})`);
		const data = await res.json();
		return `ipfs://${data.IpfsHash}`;
	}

	const res = await fetch('/api/erc8004/pin', {
		method: 'POST',
		headers: { 'content-type': blob.type || 'application/octet-stream' },
		body: blob,
		credentials: 'include',
	});
	if (!res.ok) {
		const text = await res.text().catch(() => res.status);
		throw new Error(`Upload failed (${res.status}): ${text}`);
	}
	const data = await res.json();
	return data.url;
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
 * @param {string} opts.imageUrl      URL of the 3D GLB model (HTTPS or ipfs://)
 * @param {number} opts.agentId       Token ID from the registry (filled after mint)
 * @param {number} opts.chainId       Chain ID where registered
 * @param {string} opts.registryAddr  Identity Registry contract address
 * @param {string[]} [opts.services]  Additional service objects
 * @returns {object}
 */
export function buildRegistrationJSON({
	name,
	description,
	imageUrl,
	agentId,
	chainId,
	registryAddr,
	services = [],
}) {
	return {
		type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
		name,
		description,
		image: imageUrl,
		active: true,
		services: [
			{
				name: '3D',
				endpoint: `https://3dagent.vercel.app/#model=${encodeURIComponent(imageUrl)}`,
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
 *  1. Upload GLB to storage (R2 or Pinata)
 *  2. Build registration JSON
 *  3. Upload registration JSON to storage
 *  4. Call register(agentURI) on-chain
 *  5. Update agentURI to the final registration JSON
 *
 * @param {object} opts
 * @param {File}   opts.glbFile       The GLB avatar file
 * @param {string} opts.name          Agent name
 * @param {string} opts.description   Agent description
 * @param {string} [opts.apiToken]    Optional Pinata JWT (omit to use built-in storage)
 * @param {Array<{name?:string,type?:string,endpoint:string,version?:string}>} [opts.services]  Extra services to include in registration JSON
 * @param {function} [opts.onStatus]  Callback for progress updates
 * @returns {Promise<{agentId: number, registrationUrl: string, txHash: string}>}
 */
export async function registerAgent({ glbFile, name, description, apiToken, services = [], onStatus }) {
	const log = onStatus || (() => {});

	// 1. Connect wallet
	log('Connecting wallet...');
	const { signer, chainId } = await connectWallet();

	// 2. Upload GLB
	log('Uploading 3D model...');
	const glbUrl = await pinFile(glbFile, apiToken);
	log(`Model uploaded: ${glbUrl}`);

	// 3. Get contract
	const registry = getIdentityRegistry(chainId, signer);

	// 4. Register with GLB URL first to get the agentId
	log('Registering agent on-chain...');
	const tx = await registry['register(string)'](glbUrl);
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
		imageUrl: glbUrl,
		agentId,
		chainId,
		registryAddr: REGISTRY_DEPLOYMENTS[chainId].identityRegistry,
		services,
	});

	// 6. Upload registration JSON
	log('Uploading registration metadata...');
	const jsonBlob = new Blob([JSON.stringify(registrationJSON, null, 2)], {
		type: 'application/json',
	});
	const registrationUrl = await pinFile(jsonBlob, apiToken);
	log(`Registration metadata uploaded: ${registrationUrl}`);

	// 7. Update agentURI on-chain to point at the full registration JSON
	log('Updating agentURI on-chain...');
	const updateTx = await registry.setAgentURI(agentId, registrationUrl);
	await updateTx.wait();
	log('Agent URI updated on-chain.');

	return {
		agentId,
		registrationUrl,
		txHash: tx.hash,
	};
}
