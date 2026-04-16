/**
 * web3.storage pinning backend.
 *
 * HTTP API v1 — https://web3.storage/docs/reference/http-api/
 * Single file:  POST https://api.web3.storage/upload  (raw body, Authorization: Bearer)
 * Response:     { cid: string }
 *
 * Directory pinning requires CAR format (not implemented here). Use pinata when
 * directory-wrapped CIDs are needed.
 */

import { withRetry, fetchWithProgress, statusError } from './_retry.js';

const UPLOAD_URL = 'https://api.web3.storage/upload';

export class Web3StoragePinner {
	/**
	 * @param {object} opts
	 * @param {string} opts.token  web3.storage API token
	 */
	constructor({ token } = {}) {
		this._token = token || '';
	}

	/**
	 * @param {Blob|Uint8Array} blob
	 * @param {{name?: string, onProgress?: function(number): void}=} opts
	 * @returns {Promise<{cid: string, size: number}>}
	 */
	async pinBlob(blob, opts = {}) {
		const { name, onProgress } = opts;
		const headers = {
			Authorization: `Bearer ${this._token}`,
			'Content-Type': blob.type || 'application/octet-stream',
		};
		if (name) headers['X-NAME'] = name;

		const size = blob instanceof Uint8Array ? blob.length : blob.size;

		const res = await withRetry(() =>
			fetchWithProgress(UPLOAD_URL, {
				method: 'POST',
				headers,
				body: blob,
				onProgress,
			}).then(async (r) => {
				if (!r.ok) {
					const body = await r.text().catch(() => '');
					throw statusError(r.status, `web3.storage upload failed (${r.status}): ${body}`);
				}
				return r;
			}),
		);

		const { cid } = await res.json();
		return { cid, size };
	}

	/**
	 * Directory pinning via web3.storage requires CAR format; not supported here.
	 * Use Pinata for directory-wrapped CIDs.
	 */
	async pinDirectory(_files, _opts = {}) {
		throw statusError(
			501,
			'web3.storage pinDirectory requires CAR format — use Pinata for directory-wrapped CIDs',
		);
	}

	/**
	 * web3.storage does not expose an HTTP unpin endpoint in v1.
	 */
	async unpin(_cid) {
		throw statusError(501, 'web3.storage HTTP API v1 does not support unpin');
	}
}
