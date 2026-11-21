'use strict';

const { ApiError, MESSAGES } = require('./errors');

/**
 * Write an HTTP response body to disk chunk by chunk so a 500 MB scene.ply never sits in memory.
 *
 * `sink` hides the file API (UXP `fs` in Premiere, Node `fs/promises` in tests):
 *   open(path) -> handle, write(handle, Uint8Array) -> void, close(handle) -> void, remove(path) -> void
 *
 * Falls back to `arrayBuffer()` when the runtime has no readable body stream.
 * A partial file is removed on failure so a retry never imports a truncated scene.
 */
async function streamToFile({ response, sink, path, token, onBytes = () => {} }) {
	if (!response.ok) {
		throw new ApiError('download_failed', MESSAGES.download_failed, {
			status: response.status,
			retryable: response.status === 408 || response.status === 429 || response.status >= 500,
		});
	}
	const total = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0;
	const handle = await sink.open(path);
	let written = 0;
	let ok = false;
	try {
		const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
		if (reader) {
			for (;;) {
				if (token) token.throwIfCancelled();
				const { done, value } = await reader.read();
				if (done) break;
				if (value && value.byteLength) {
					await sink.write(handle, value);
					written += value.byteLength;
					onBytes(written, total);
				}
			}
		} else {
			const buf = new Uint8Array(await response.arrayBuffer());
			await sink.write(handle, buf);
			written = buf.byteLength;
			onBytes(written, total);
		}
		if (total && written !== total) {
			throw new ApiError('download_failed', MESSAGES.download_failed, { retryable: true });
		}
		ok = true;
	} finally {
		await sink.close(handle);
		if (!ok) await sink.remove(path).catch(() => {});
	}
	return { path, bytes: written };
}

module.exports = { streamToFile };
