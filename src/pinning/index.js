/**
 * Pluggable IPFS pinning abstraction.
 *
 * @typedef {object} Pinner
 * @property {function(Blob|Uint8Array, {name?: string, wrapInDir?: boolean, onProgress?: function(number): void}=): Promise<{cid: string, size: number}>} pinBlob
 * @property {function(Array<{path: string, data: Blob|Uint8Array}>, {onProgress?: function(number): void}=): Promise<{cid: string, size: number}>} pinDirectory
 * @property {function(string): Promise<void>} unpin
 */

import { Web3StoragePinner } from './web3-storage.js';
import { FilebasePinner } from './filebase.js';
import { PinataPinner } from './pinata.js';
import { NullDevPinner } from './null-dev.js';

const PROVIDERS = ['web3-storage', 'filebase', 'pinata', 'null-dev'];

/** @type {Pinner|null} */
let _defaultPinner = null;

/**
 * Build a Pinner from a config object.
 *
 * @param {object} config
 * @param {'web3-storage'|'filebase'|'pinata'|'null-dev'} [config.provider='web3-storage']
 * @param {string} [config.token]         API key / JWT for web3-storage or pinata
 * @param {string} [config.accessKeyId]   Filebase S3 access key
 * @param {string} [config.secretAccessKey] Filebase S3 secret key
 * @param {string} [config.bucket]        Filebase bucket name
 * @returns {Pinner}
 */
export function createPinner(config = {}) {
	const { provider = 'web3-storage', ...opts } = config;
	switch (provider) {
		case 'web3-storage':
			return new Web3StoragePinner(opts);
		case 'filebase':
			return new FilebasePinner(opts);
		case 'pinata':
			return new PinataPinner(opts);
		case 'null-dev':
			return new NullDevPinner(opts);
		default:
			throw new Error(
				`Unknown pinning provider "${provider}". Supported: ${PROVIDERS.join(', ')}`,
			);
	}
}

/**
 * Get the process-wide default pinner.
 *
 * Initialisation order:
 *  1. Explicitly set via setPinner()
 *  2. window.__agent3dPinner (Pinner instance or config object)
 *  3. null-dev (safe fallback — fake CIDs, in-memory storage)
 *
 * @returns {Pinner}
 */
export function getPinner() {
	if (_defaultPinner) return _defaultPinner;

	if (typeof window !== 'undefined' && window.__agent3dPinner) {
		const cfg = window.__agent3dPinner;
		_defaultPinner =
			typeof cfg.pinBlob === 'function' ? cfg : createPinner(cfg);
		return _defaultPinner;
	}

	_defaultPinner = new NullDevPinner();
	return _defaultPinner;
}

/**
 * Set the process-wide default pinner.
 * @param {Pinner} pinner
 */
export function setPinner(pinner) {
	_defaultPinner = pinner;
}

export { Web3StoragePinner, FilebasePinner, PinataPinner, NullDevPinner };
