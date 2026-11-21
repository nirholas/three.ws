'use strict';

const { ApiError, normalise, MESSAGES } = require('./errors');
const { withRetry, runPool } = require('./retry');

const PARALLEL_PARTS = 4;
const SIGN_BATCH = 100;

/** Byte range [start, end) of 1-based part `n`. */
function partRange(n, partSize, size) {
	const start = (n - 1) * partSize;
	return { start, end: Math.min(size, start + partSize) };
}

/** Stable identity of a local file for resume state. */
function resumeKey(file) {
	return `${file.name}|${file.size}|${file.mtimeMs || 0}`;
}

function mapEtag(raw) {
	const etag = typeof raw === 'string' ? raw.trim() : '';
	return etag || '';
}

/**
 * Multipart upload of one local file to R2 through the C4 capture-upload API.
 *
 * - 4 parts in flight, each retried with backoff, a 403 (expired signature) re-signs that part.
 * - Resume: state lives in `store` (the plugin data folder in Premiere). On start the server's
 *   own part list is reconciled with it, so only missing parts are sent.
 * - Cancel: aborts the multipart upload on the server and clears the saved state.
 *
 * `file` = { name, size, mtimeMs, contentType, readRange(start, end) -> Promise<ArrayBuffer> }
 * Returns { source_url, size_bytes, resumed_parts }.
 */
async function uploadFile({ client, file, store, token, onProgress = () => {}, fetchImpl, sleep, concurrency = PARALLEL_PARTS }) {
	const doFetch = fetchImpl || ((...args) => fetch(...args));
	const key = resumeKey(file);

	let state = await store.load(key);
	let resumedParts = 0;

	if (state) {
		try {
			const listed = await client.listParts(state.upload);
			const etags = {};
			for (const p of listed.parts || []) etags[p.part_number] = mapEtag(p.etag);
			state.etags = etags;
			resumedParts = Object.keys(etags).length;
		} catch (err) {
			if (err.code !== 'upload_not_found') throw err;
			await store.remove(key);
			state = null;
		}
	}

	if (!state) {
		const created = await client.createUpload(file);
		state = { upload: created, etags: {}, createdAt: Date.now() };
		await store.save(key, state);
	}

	const { upload } = state;
	const missing = [];
	for (let n = 1; n <= upload.part_count; n++) if (!state.etags[n]) missing.push(n);

	let sentBytes = 0;
	for (let n = 1; n <= upload.part_count; n++) {
		if (state.etags[n]) {
			const r = partRange(n, upload.part_size, file.size);
			sentBytes += r.end - r.start;
		}
	}
	onProgress({ sentBytes, totalBytes: file.size, resumedParts });

	const urls = {};
	const signMany = async (numbers) => {
		for (let i = 0; i < numbers.length; i += SIGN_BATCH) {
			const batch = numbers.slice(i, i + SIGN_BATCH);
			const out = await client.signParts(upload, batch);
			for (const n of batch) {
				if (!out.urls || !out.urls[String(n)]) {
					throw new ApiError('unexpected_response', MESSAGES.unexpected_response);
				}
				urls[n] = out.urls[String(n)];
			}
		}
	};

	let cancelHooked = false;
	const abortOnCancel = async () => {
		await client.abortUpload(upload).catch(() => {});
		await store.remove(key);
	};

	try {
		if (missing.length) await signMany(missing.slice(0, SIGN_BATCH));
		const sendPart = async (n) => {
			token.throwIfCancelled();
			const { start, end } = partRange(n, upload.part_size, file.size);
			let uploaded = false;
			await withRetry(
				async () => {
					if (!urls[n]) await signMany([n]);
					const body = await file.readRange(start, end);
					let res;
					try {
						res = await doFetch(urls[n], { method: 'PUT', body });
					} catch (err) {
						throw normalise(err);
					}
					if (res.status === 403) {
						delete urls[n];
						throw new ApiError('storage_error', MESSAGES.storage_error, { status: 403, retryable: true });
					}
					if (!res.ok) {
						throw new ApiError('storage_error', MESSAGES.storage_error, {
							status: res.status,
							retryable: res.status === 408 || res.status === 429 || res.status >= 500,
						});
					}
					const etag = mapEtag(res.headers && res.headers.get && res.headers.get('etag'));
					if (!etag) throw new ApiError('storage_error', MESSAGES.storage_error, { status: res.status });
					state.etags[n] = etag;
					uploaded = true;
				},
				{ attempts: 5, baseMs: 750, sleep, token },
			);
			if (uploaded) {
				sentBytes += end - start;
				await store.save(key, state);
				onProgress({ sentBytes, totalBytes: file.size, resumedParts });
			}
		};

		const queue = missing.slice();
		// Sign further batches lazily so a 1000-part upload does not sign everything up front.
		const pending = [];
		for (let i = 0; i < queue.length; i += SIGN_BATCH) pending.push(queue.slice(i, i + SIGN_BATCH));
		for (let i = 0; i < pending.length; i++) {
			if (i > 0) await signMany(pending[i]);
			await runPool(pending[i], concurrency, sendPart, token);
		}

		token.throwIfCancelled();
		const parts = Object.keys(state.etags)
			.map(Number)
			.sort((a, b) => a - b)
			.map((n) => ({ part_number: n, etag: state.etags[n] }));
		const done = await client.completeUpload(upload, parts);
		await store.remove(key);
		return { source_url: done.source_url, size_bytes: done.size_bytes, resumed_parts: resumedParts };
	} catch (err) {
		const e = normalise(err);
		if (e.code === 'cancelled' && !cancelHooked) {
			cancelHooked = true;
			await abortOnCancel();
		} else if (e.code === 'upload_not_found' || e.code === 'size_mismatch' || e.code === 'invalid_parts') {
			await store.remove(key);
		}
		throw e;
	}
}

module.exports = { uploadFile, partRange, resumeKey, PARALLEL_PARTS };
