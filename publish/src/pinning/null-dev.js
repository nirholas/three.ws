/**
 * Null / dev pinner — no network calls, no credentials needed.
 *
 * Hashes the blob with SHA-256 and returns a fake CID in the form
 * `bafkdev<hex>`. Content is kept in an in-memory Map for the session,
 * so nullDevFetch(cid) resolves the round-trip in tests and dev.
 *
 * CIDs produced here are NOT valid IPFS CIDs and will NOT resolve on
 * public IPFS gateways. Use a real provider in production.
 */

/** @type {Map<string, Uint8Array>} */
const _store = new Map();

async function _sha256Hex(bytes) {
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function _toBytes(blob) {
	return blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
}

export class NullDevPinner {
	/**
	 * @param {Blob|Uint8Array} blob
	 * @returns {Promise<{cid: string, size: number}>}
	 */
	async pinBlob(blob, _opts = {}) {
		const bytes = await _toBytes(blob);
		const hex = await _sha256Hex(bytes);
		const cid = `bafkdev${hex.slice(0, 40)}`;
		_store.set(cid, bytes);
		return { cid, size: bytes.length };
	}

	/**
	 * Stores each file under its path and creates an index entry keyed by dirCid.
	 * Resolve individual files with nullDevFetch(dirCid, 'path/to/file').
	 *
	 * @param {Array<{path: string, data: Blob|Uint8Array}>} files
	 * @returns {Promise<{cid: string, size: number}>}
	 */
	async pinDirectory(files, _opts = {}) {
		const index = {};
		let totalSize = 0;

		for (const { path, data } of files) {
			const bytes = await _toBytes(data);
			const hex = await _sha256Hex(bytes);
			const fileCid = `bafkdev${hex.slice(0, 40)}`;
			_store.set(fileCid, bytes);
			index[path] = fileCid;
			totalSize += bytes.length;
		}

		const indexBytes = new TextEncoder().encode(JSON.stringify(index));
		const hex = await _sha256Hex(indexBytes);
		const dirCid = `bafkdevdir${hex.slice(0, 36)}`;
		// Store index under a magic suffix so nullDevFetch can locate it
		_store.set(dirCid + '/\x00index', indexBytes);
		return { cid: dirCid, size: totalSize };
	}

	/**
	 * Remove pinned content from the in-memory store.
	 * @param {string} cid
	 */
	async unpin(cid) {
		_store.delete(cid);
		_store.delete(cid + '/\x00index');
	}
}

/**
 * Fetch content pinned by NullDevPinner.
 *
 * @param {string} cid        A CID returned by pinBlob or pinDirectory
 * @param {string} [path]     File path within a pinned directory
 * @returns {Uint8Array|null}
 */
export function nullDevFetch(cid, path) {
	if (!path) return _store.get(cid) ?? null;

	const indexBytes = _store.get(cid + '/\x00index');
	if (!indexBytes) return null;
	const index = JSON.parse(new TextDecoder().decode(indexBytes));
	const fileCid = index[path];
	return fileCid ? (_store.get(fileCid) ?? null) : null;
}

/** Wipe the entire in-memory store (useful between tests). */
export function nullDevClear() {
	_store.clear();
}
