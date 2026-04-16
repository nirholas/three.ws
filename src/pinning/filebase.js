/**
 * Filebase S3-compatible IPFS pinning backend.
 *
 * Filebase exposes an S3 API at https://s3.filebase.com.
 * After a PutObject, the IPFS CID is available via HeadObject in
 * the x-amz-meta-cid response header.
 *
 * The @aws-sdk/client-s3 is dynamically imported so non-Filebase users
 * do not pay the bundle cost.
 *
 * pinDirectory: uploads each file under a common key prefix, then returns the
 * CID of the first file as a best-effort root. Note: Filebase does not expose
 * a true directory-wrapped IPFS CID via S3; for proper directory CIDs use Pinata.
 */

import { withRetry, statusError } from './_retry.js';

export class FilebasePinner {
	/**
	 * @param {object} opts
	 * @param {string} opts.accessKeyId      Filebase S3 access key ID
	 * @param {string} opts.secretAccessKey  Filebase S3 secret access key
	 * @param {string} opts.bucket           Target bucket name
	 * @param {string} [opts.region='us-east-1']
	 */
	constructor({ accessKeyId, secretAccessKey, bucket, region = 'us-east-1' } = {}) {
		this._creds = { accessKeyId, secretAccessKey };
		this._bucket = bucket;
		this._region = region;
		this._client = null;
	}

	async _getClient() {
		if (this._client) return this._client;
		const { S3Client } = await import('@aws-sdk/client-s3');
		this._client = new S3Client({
			region: this._region,
			endpoint: 'https://s3.filebase.com',
			credentials: this._creds,
			// Path-style required by Filebase
			forcePathStyle: true,
		});
		return this._client;
	}

	/**
	 * @param {Blob|Uint8Array} blob
	 * @param {{name?: string, onProgress?: function(number): void}=} opts
	 * @returns {Promise<{cid: string, size: number}>}
	 */
	async pinBlob(blob, opts = {}) {
		const { name = `upload-${Date.now()}` } = opts;
		const { PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
		const client = await this._getClient();

		const body = blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
		const size = body.length;

		await withRetry(async () => {
			const res = await client.send(
				new PutObjectCommand({
					Bucket: this._bucket,
					Key: name,
					Body: body,
					ContentType: blob instanceof Blob ? blob.type : 'application/octet-stream',
				}),
			);
			if (res.$metadata?.httpStatusCode >= 500) {
				throw statusError(res.$metadata.httpStatusCode, 'Filebase PutObject failed');
			}
		});

		const head = await withRetry(async () => {
			return client.send(new HeadObjectCommand({ Bucket: this._bucket, Key: name }));
		});

		const cid = head.Metadata?.cid;
		if (!cid) throw new Error('Filebase did not return an IPFS CID in x-amz-meta-cid');

		return { cid, size };
	}

	/**
	 * Uploads each file under a shared prefix. Returns the CID of the first file.
	 * Not a true directory-wrapped CID — use Pinata for {cid}/{path} resolution.
	 *
	 * @param {Array<{path: string, data: Blob|Uint8Array}>} files
	 * @param {{name?: string, onProgress?: function(number): void}=} opts
	 * @returns {Promise<{cid: string, size: number}>}
	 */
	async pinDirectory(files, opts = {}) {
		const { name = `dir-${Date.now()}` } = opts;
		let firstCid = null;
		let totalSize = 0;

		for (const { path, data } of files) {
			const key = `${name}/${path}`;
			const { cid, size } = await this.pinBlob(data, { name: key });
			totalSize += size;
			if (!firstCid) firstCid = cid;
		}

		if (!firstCid) throw new Error('No files provided to pinDirectory');
		return { cid: firstCid, size: totalSize };
	}

	/**
	 * Delete the S3 object — Filebase will eventually GC the underlying IPFS pin.
	 * @param {string} key  The S3 key (not CID) used at upload time
	 */
	async unpin(key) {
		const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
		const client = await this._getClient();
		await withRetry(() =>
			client.send(new DeleteObjectCommand({ Bucket: this._bucket, Key: key })),
		);
	}
}
