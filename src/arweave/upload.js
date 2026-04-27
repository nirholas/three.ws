/**
 * Arweave permanent storage via ArDrive Turbo.
 *
 * Uploads a Blob/Uint8Array and returns an ar:// URI that resolves forever.
 * Requires an Ethereum signer (e.g. from connectWallet()) — Turbo signs with
 * the same wallet the user already connected for ERC-8004 registration.
 *
 * Usage:
 *   import { uploadToArweave } from '../arweave/upload.js';
 *   const arUri = await uploadToArweave(glbBytes, signer, { name: 'agent.glb' });
 *   // → 'ar://abc123txId'
 */

import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk/web';

/**
 * Upload a blob to Arweave via Turbo and return an ar:// URI.
 *
 * @param {Blob|Uint8Array} data
 * @param {import('ethers').Signer} ethSigner  Connected ethers signer
 * @param {{ name?: string, contentType?: string }} [opts]
 * @returns {Promise<string>}  ar://<txId>
 */
export async function uploadToArweave(data, ethSigner, opts = {}) {
	const { name = 'upload', contentType = 'application/octet-stream' } = opts;

	const privateKey = await _signerToPrivateKey(ethSigner);
	const turboSigner = new EthereumSigner(privateKey);
	const turbo = TurboFactory.authenticated({ signer: turboSigner });

	const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
	const stream = _bytesToStream(bytes);

	const result = await turbo.uploadFile({
		fileStreamFactory: () => stream,
		fileSizeFactory: () => bytes.byteLength,
		signal: opts.signal,
		dataItemOpts: {
			tags: [
				{ name: 'Content-Type', value: contentType },
				{ name: 'App-Name', value: 'three.ws' },
				{ name: 'File-Name', value: name },
			],
		},
	});

	return `ar://${result.id}`;
}

/**
 * Estimate the Turbo credit cost for a given byte size (no wallet needed).
 *
 * @param {number} bytes
 * @returns {Promise<{winc: string}>}  Winston credits needed
 */
export async function estimateUploadCost(bytes) {
	const turbo = TurboFactory.unauthenticated();
	return turbo.getUploadCosts({ bytes: [bytes] });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _bytesToStream(bytes) {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

/**
 * Extract the raw hex private key from an ethers Signer.
 * Works with ethers v6 JsonRpcSigner and Wallet.
 *
 * @param {import('ethers').Signer} signer
 * @returns {Promise<string>}
 */
async function _signerToPrivateKey(signer) {
	// ethers Wallet exposes .privateKey directly
	if (signer.privateKey) return signer.privateKey;

	// JsonRpcSigner (MetaMask etc.) — private key is not exportable from the
	// browser wallet. In that case the caller must pass a raw private key string
	// via signer._privateKey, or use a dedicated Arweave JWK wallet instead.
	if (signer._privateKey) return signer._privateKey;

	throw new Error(
		'uploadToArweave: cannot extract private key from injected wallet signer. ' +
			'Pass an ethers.Wallet instance or set signer._privateKey explicitly.',
	);
}
