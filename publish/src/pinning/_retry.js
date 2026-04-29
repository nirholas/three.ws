/**
 * Shared retry + XHR-with-progress helpers.
 */

/**
 * Retry an async operation with exponential backoff.
 * 4xx responses fail fast; 5xx and network errors retry up to maxAttempts.
 *
 * @param {function(): Promise<*>} fn
 * @param {number} [maxAttempts=3]
 * @returns {Promise<*>}
 */
export async function withRetry(fn, maxAttempts = 3) {
	let lastError;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			// Preserve provider error bodies on 4xx — don't retry
			if (err.status !== undefined && err.status < 500) throw err;
			lastError = err;
			if (attempt < maxAttempts - 1) {
				await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
			}
		}
	}
	throw lastError;
}

/**
 * Fetch wrapper that emits upload progress for blobs >1MB via onProgress(pct).
 * Falls back to plain fetch when onProgress is not provided or blob is small.
 *
 * @param {string} url
 * @param {RequestInit & {onProgress?: function(number): void}} opts
 * @returns {Promise<Response>}
 */
export function fetchWithProgress(url, opts = {}) {
	const { onProgress, body, ...fetchOpts } = opts;
	const size = body instanceof Blob ? body.size : body instanceof Uint8Array ? body.length : 0;

	if (!onProgress || size <= 1024 * 1024) {
		return fetch(url, { ...fetchOpts, body });
	}

	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(fetchOpts.method || 'POST', url);
		for (const [k, v] of Object.entries(fetchOpts.headers || {})) {
			xhr.setRequestHeader(k, v);
		}
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
		};
		xhr.onload = () => {
			// Wrap in a minimal Response-like object so callers can use .ok / .json()
			const status = xhr.status;
			const responseText = xhr.responseText;
			resolve({
				ok: status >= 200 && status < 300,
				status,
				headers: { get: (h) => xhr.getResponseHeader(h) },
				text: () => Promise.resolve(responseText),
				json: () => Promise.resolve(JSON.parse(responseText)),
			});
		};
		xhr.onerror = () => reject(new Error('Network error during upload'));
		xhr.send(body);
	});
}

/**
 * Build a StatusError with the status code attached.
 * @param {number} status
 * @param {string} message
 */
export function statusError(status, message) {
	const err = new Error(message);
	err.status = status;
	return err;
}
