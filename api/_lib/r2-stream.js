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
//
// When R2 refuses the write for an infrastructure reason (a revoked credential,
// as on 2026-11-14 and 2026-11-21) and STORAGE_FALLBACK_BUCKET is set, the same
// bytes stream into that GCS bucket under the same key instead, exactly as
// putObject() diverts. R2 refuses on the first request, while every byte read
// so far is still held in memory, so nothing has to be fetched again; /cdn/<key>
// reads the fallback bucket, so the URL the caller records works either way.

import { createHash } from 'node:crypto';
import {
	PutObjectCommand,
	CreateMultipartUploadCommand,
	UploadPartCommand,
	CompleteMultipartUploadCommand,
	AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { r2, isStorageInfrastructureError } from './r2.js';
import { env } from './env.js';
import { fallbackBucket, noteFallback } from './storage-fallback.js';
import { getGcpAccessToken } from './gcp-auth.js';

// S3 and R2 require every part but the last to be at least 5 MiB and allow at
// most 10,000 parts. 16 MiB parts cover files up to 156 GiB.
export const PART_BYTES = 16 * 1024 * 1024;

// A fallback upload streams the whole file in one PUT, so it gets the time a
// large splat needs over a slow link, not the 30 s of a small fallback write.
const FALLBACK_TIMEOUT_MS = 15 * 60 * 1000;

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
 * Stream `chunks` into the GCS fallback bucket as one object.
 * @param {{ key: string, chunks: AsyncIterable<Buffer>, contentType: string, metadata: Record<string,string> }} opts
 */
async function toFallback({ key, chunks, contentType, metadata }) {
	const headers = { authorization: `Bearer ${await getGcpAccessToken()}`, 'content-type': contentType };
	for (const [k, v] of Object.entries(metadata || {})) {
		if (v != null) headers[`x-goog-meta-${k.toLowerCase()}`] = String(v);
	}
	const path = key.split('/').map(encodeURIComponent).join('/');
	const res = await fetch(`https://storage.googleapis.com/${fallbackBucket()}/${path}`, {
		method: 'PUT',
		headers,
		body: ReadableStream.from(chunks),
		duplex: 'half',
		signal: AbortSignal.timeout(FALLBACK_TIMEOUT_MS),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`gcs fallback put ${res.status} for ${key}: ${text.slice(0, 160)}`);
	}
	await res.body?.cancel();
}

/**
 * Upload a byte stream to `key`, in R2 or, when R2 refuses, the fallback bucket.
 * @param {{ key: string, stream: AsyncIterable<Uint8Array>, contentType?: string, metadata?: Record<string,string>, partBytes?: number }} opts
 * @returns {Promise<{ key: string, bytes: number, sha256: string, store: 'r2' | 'gcs' }>}
 */
export async function uploadStream({ key, stream, contentType = 'application/octet-stream', metadata = {}, partBytes = PART_BYTES }) {
	const hash = createHash('sha256');
	let bytes = 0;
	async function* counted(source) {
		for await (const part of source) {
			hash.update(part);
			bytes += part.length;
			yield part;
		}
	}
	const parts = counted(fixedParts(stream, partBytes));

	// Read up to two parts before the first request, so a refusal at the first
	// request still holds every byte read so far.
	const held = [];
	for (let i = 0; i < 2; i++) {
		const next = await parts.next();
		if (next.done) break;
		held.push(next.value);
	}
	const state = { streaming: false };
	let store = 'r2';
	try {
		await toR2({ key, held, parts, contentType, metadata, state });
	} catch (err) {
		if (state.streaming || !fallbackBucket() || !isStorageInfrastructureError(err)) throw err;
		await toFallback({ key, contentType, metadata, chunks: (async function* () {
			yield* held;
			yield* parts;
		})() });
		noteFallback('put', key, err);
		store = 'gcs';
	}
	return { key, bytes, sha256: hash.digest('hex'), store };
}

/**
 * The R2 leg: one PutObject for a body of at most one part, else multipart.
 * Sets state.streaming once it pulls parts beyond `held`, after which a
 * failure can no longer be replayed elsewhere.
 */
async function toR2({ key, held, parts, contentType, metadata, state }) {
	const Bucket = env.S3_BUCKET;
	if (held.length < 2) {
		const body = held[0] || Buffer.alloc(0);
		await r2.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }));
		return;
	}
	const { UploadId } = await r2.send(
		new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType, Metadata: metadata }),
	);
	const done = [];
	const sendPart = async (body) => {
		const PartNumber = done.length + 1;
		const out = await r2.send(new UploadPartCommand({ Bucket, Key: key, UploadId, PartNumber, Body: body }));
		done.push({ PartNumber, ETag: out.ETag });
	};
	try {
		for (const part of held) await sendPart(part);
		state.streaming = true;
		for await (const part of parts) await sendPart(part);
		await r2.send(
			new CompleteMultipartUploadCommand({ Bucket, Key: key, UploadId, MultipartUpload: { Parts: done } }),
		);
	} catch (err) {
		await r2.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId })).catch(() => {});
		throw err;
	}
}
