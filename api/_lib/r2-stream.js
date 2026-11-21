// Stream an HTTP response body into the bucket without holding the file in
// memory.
//
// putObject() in r2.js takes a Buffer, which is right for a GLB or a thumbnail
// and wrong for a Gaussian splat PLY that can pass 1 GB: buffering that on a
// Cloud Run instance is an out-of-memory crash. This reads the body in
// PART_BYTES chunks and sends each one as a multipart UploadPart, so peak
// memory is one part no matter how large the file is. A body that fits in one
// part goes up as a single PutObject. A failed upload is aborted so no orphaned
// parts are billed.
//
// The SHA-256 of what was written is computed on the way through, so a caller
// can record it and anyone can verify the stored copy byte for byte.

import { createHash } from 'node:crypto';
import {
	PutObjectCommand,
	CreateMultipartUploadCommand,
	UploadPartCommand,
	CompleteMultipartUploadCommand,
	AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { r2 } from './r2.js';
import { env } from './env.js';

// S3 and R2 require every part but the last to be at least 5 MiB and allow at
// most 10,000 parts. 16 MiB parts cover files up to 156 GiB.
export const PART_BYTES = 16 * 1024 * 1024;

/**
 * Collect chunks from a byte stream into fixed-size parts.
 * @param {AsyncIterable<Uint8Array>} stream
 * @param {number} partBytes
 */
async function* fixedParts(stream, partBytes) {
	let pending = [];
	let size = 0;
	for await (const chunk of stream) {
		let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		while (buf.length) {
			const take = Math.min(partBytes - size, buf.length);
			pending.push(buf.subarray(0, take));
			size += take;
			buf = buf.subarray(take);
			if (size === partBytes) {
				yield Buffer.concat(pending, size);
				pending = [];
				size = 0;
			}
		}
	}
	if (size > 0 || pending.length) yield Buffer.concat(pending, size);
}

/**
 * Upload a byte stream to `key`.
 * @param {{ key: string, stream: AsyncIterable<Uint8Array>, contentType?: string, metadata?: Record<string,string>, partBytes?: number }} opts
 * @returns {Promise<{ key: string, bytes: number, sha256: string }>}
 */
export async function uploadStream({ key, stream, contentType = 'application/octet-stream', metadata = {}, partBytes = PART_BYTES }) {
	const Bucket = env.S3_BUCKET;
	const hash = createHash('sha256');
	const parts = fixedParts(stream, partBytes);

	const first = await parts.next();
	const firstBuf = first.done ? Buffer.alloc(0) : first.value;
	hash.update(firstBuf);
	const second = first.done ? { done: true } : await parts.next();

	if (second.done) {
		await r2.send(new PutObjectCommand({ Bucket, Key: key, Body: firstBuf, ContentType: contentType, Metadata: metadata }));
		return { key, bytes: firstBuf.length, sha256: hash.digest('hex') };
	}

	const { UploadId } = await r2.send(
		new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType, Metadata: metadata }),
	);
	const done = [];
	let bytes = 0;
	const sendPart = async (body) => {
		const PartNumber = done.length + 1;
		const out = await r2.send(new UploadPartCommand({ Bucket, Key: key, UploadId, PartNumber, Body: body }));
		done.push({ PartNumber, ETag: out.ETag });
		bytes += body.length;
	};
	try {
		await sendPart(firstBuf);
		hash.update(second.value);
		await sendPart(second.value);
		for await (const part of parts) {
			hash.update(part);
			await sendPart(part);
		}
		await r2.send(
			new CompleteMultipartUploadCommand({ Bucket, Key: key, UploadId, MultipartUpload: { Parts: done } }),
		);
	} catch (err) {
		await r2.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId })).catch(() => {});
		throw err;
	}
	return { key, bytes, sha256: hash.digest('hex') };
}
