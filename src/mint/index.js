/**
 * Mint flow — the full pipeline for creating a permanent onchain agent.
 *
 * Steps:
 *  1. Embed agent manifest into GLB extras (the file becomes self-describing)
 *  2. Pin the GLB to IPFS (hot, fast access)
 *  3. Upload the GLB to Arweave (permanent backup)
 *  4. Build ERC-8004 registration JSON referencing both URIs
 *  5. Register onchain via Identity Registry
 *
 * None of this is wired to any UI or nav yet — call mintAgent() directly.
 *
 * Usage:
 *   import { mintAgent } from '../mint/index.js';
 *   const result = await mintAgent({ glbBlob, manifest, signer, chainId, onLog });
 */

import { embedAgentExtras } from '../erc8004/gltf-extras.js';
import { uploadToArweave } from '../arweave/upload.js';
import { getPinner } from '../pinning/index.js';
import { buildRegistrationJSON, registerAgent } from '../erc8004/agent-registry.js';

/**
 * @typedef {object} MintOptions
 * @property {Blob}   glbBlob   Original GLB file
 * @property {object} manifest  agent-manifest/0.1 shaped object
 * @property {import('ethers').Signer} signer  Connected ethers signer
 * @property {number} chainId
 * @property {string} [registryAddr]   Override default registry address
 * @property {function(string): void} [onLog]  Progress callback
 * @property {boolean} [skipArweave]   Skip Arweave upload (dev/test)
 */

/**
 * @typedef {object} MintResult
 * @property {string} agentId
 * @property {string} ipfsUri     ipfs:// URI of the GLB
 * @property {string|null} arUri  ar:// URI of the GLB (null if skipArweave)
 * @property {string} registrationUrl
 * @property {string} txHash
 * @property {number} chainId
 */

/**
 * Run the full mint pipeline.
 *
 * @param {MintOptions} opts
 * @returns {Promise<MintResult>}
 */
export async function mintAgent(opts) {
	const { glbBlob, manifest, signer, chainId, registryAddr, onLog, skipArweave = false } = opts;
	const log = onLog ?? (() => {});

	// 1. Embed manifest into GLB extras
	log('Embedding agent manifest into GLB...');
	const originalBytes = new Uint8Array(await glbBlob.arrayBuffer());
	const enrichedBytes = await embedAgentExtras(originalBytes, manifest);
	const enrichedBlob = new Blob([enrichedBytes], { type: 'model/gltf-binary' });

	// 2. Pin to IPFS
	log('Pinning GLB to IPFS...');
	const pinner = getPinner();
	const { cid } = await pinner.pinBlob(enrichedBlob, { name: `${manifest.name ?? 'agent'}.glb` });
	const ipfsUri = `ipfs://${cid}`;
	log(`IPFS: ${ipfsUri}`);

	// 3. Upload to Arweave (permanent backup)
	let arUri = null;
	if (!skipArweave) {
		log('Uploading GLB to Arweave (permanent)...');
		try {
			arUri = await uploadToArweave(enrichedBytes, signer, {
				name: `${manifest.name ?? 'agent'}.glb`,
				contentType: 'model/gltf-binary',
			});
			log(`Arweave: ${arUri}`);
		} catch (err) {
			// Arweave failure is non-fatal — IPFS still works
			log(`Arweave upload failed (non-fatal): ${err.message}`);
		}
	}

	// 4 + 5. Build registration JSON and register onchain
	// glbUrl points to IPFS; arUri stored as an additional service entry
	const services = arUri
		? [{ name: 'avatar-arweave', endpoint: arUri, version: 'gltf-2.0' }]
		: [];

	log('Registering agent onchain...');
	const result = await registerAgent({
		name: manifest.name,
		description: manifest.description,
		glbUrl: ipfsUri,
		imageUrl: manifest.image ?? '',
		signer,
		chainId,
		registryAddr,
		services,
		animations: manifest.animations,
		onLog: log,
	});

	return {
		agentId: result.agentId,
		ipfsUri,
		arUri,
		registrationUrl: result.registrationUrl,
		txHash: result.txHash,
		chainId: result.chainId,
	};
}
