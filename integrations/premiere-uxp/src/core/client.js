'use strict';

const { ApiError, fromResponse, normalise, MESSAGES } = require('./errors');
const { withRetry } = require('./retry');

const DEFAULT_ORIGIN = 'https://three.ws';

/**
 * Thin client over the three.ws capture API (contract C4). `fetchImpl` and
 * `sleep` are injected so the same code runs inside Premiere Pro (UXP fetch)
 * and under `node --test` against a local server.
 */
function createClient({ origin = DEFAULT_ORIGIN, getKey, fetchImpl, sleep, token } = {}) {
	const doFetch = fetchImpl || ((...args) => fetch(...args));
	const base = String(origin).replace(/\/+$/, '');

	async function authHeaders(extra) {
		const key = typeof getKey === 'function' ? await getKey() : '';
		if (!key) throw new ApiError('missing_key', MESSAGES.missing_key);
		return { Authorization: `Bearer ${key}`, Accept: 'application/json', ...extra };
	}

	async function request(method, path, body) {
		const headers = await authHeaders(body === undefined ? {} : { 'Content-Type': 'application/json' });
		let res;
		try {
			res = await doFetch(`${base}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		} catch (err) {
			throw normalise(err);
		}
		let payload = null;
		try {
			payload = await res.json();
		} catch {
			payload = null;
		}
		if (!res.ok) throw fromResponse(res.status, payload);
		if (payload === null || typeof payload !== 'object') {
			throw new ApiError('unexpected_response', MESSAGES.unexpected_response, { status: res.status });
		}
		return payload;
	}

	/** Reads are safe to retry; writes are retried only where the caller says so. */
	const read = (path) => withRetry(() => request('GET', path), { attempts: 3, sleep, token });
	const write = (method, path, body, { retry = false } = {}) =>
		retry
			? withRetry(() => request(method, path, body), { attempts: 3, sleep, token })
			: request(method, path, body);

	return {
		origin: base,
		absolute(url) {
			if (!url) return '';
			return /^https?:\/\//i.test(url) ? url : `${base}${url.startsWith('/') ? '' : '/'}${url}`;
		},
		createUpload: (file) =>
			write('POST', '/api/capture-upload/create', {
				filename: file.name,
				content_type: file.contentType,
				size_bytes: file.size,
				kind: 'pano',
			}),
		signParts: (upload, partNumbers) =>
			write('POST', '/api/capture-upload/sign', { upload_id: upload.upload_id, key: upload.key, part_numbers: partNumbers }, { retry: true }),
		listParts: (upload) =>
			write('POST', '/api/capture-upload/parts', { upload_id: upload.upload_id, key: upload.key }, { retry: true }),
		completeUpload: (upload, parts) =>
			write('POST', '/api/capture-upload/complete', { upload_id: upload.upload_id, key: upload.key, parts }, { retry: true }),
		abortUpload: (upload) =>
			write('POST', '/api/capture-upload/abort', { upload_id: upload.upload_id, key: upload.key }, { retry: true }),
		startCapture: (body) => write('POST', '/api/pano-capture', body),
		getCapture: (jobId) => read(`/api/pano-capture?job=${encodeURIComponent(jobId)}`),
		listCaptures: () => read('/api/pano-capture?mine=1'),
		cancelCapture: (jobId) => write('DELETE', `/api/pano-capture?job=${encodeURIComponent(jobId)}`, undefined, { retry: true }),
		startScene: (body) => write('POST', '/api/pano-scene', body),
		getScene: (jobId) => read(`/api/pano-scene?job=${encodeURIComponent(jobId)}`),
	};
}

module.exports = { createClient, DEFAULT_ORIGIN };
