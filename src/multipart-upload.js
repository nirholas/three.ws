// Resumable browser multipart uploader for large capture files (up to 8 GiB).
//
// Speaks the capture-upload API (api/capture-upload/{create,sign,complete,abort}):
//   create   -> { upload_id, key, part_size, part_count }
//   sign     -> { urls: { "<part>": presigned UploadPart URL } }   (<= 100 parts per call)
//   complete -> { source_url, size_bytes }
//   abort    -> { ok: true }
//
// Parts are PUT straight to R2 with four requests in flight. Every part is
// retried with exponential backoff. Each finished part's ETag is read from the
// response and kept in IndexedDB together with the upload id, so reopening the
// page with the same file offers "Resume upload" and signs and sends only the
// parts that are still missing. Progress is real: it is aggregated from the
// per-request upload progress events, not simulated.

export const DEFAULT_API_BASE = '/api/capture-upload';
export const PARALLEL_PARTS = 4;
export const SIGN_BATCH = 100;
export const MAX_PART_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 600;
export const BACKOFF_CAP_MS = 15_000;
export const MAX_UPLOAD_BYTES = 8 * 1024 ** 3;

const SPEED_WINDOW_MS = 6000;
const RECORD_VERSION = 1;
const DB_NAME = 'three-ws-capture-uploads';
const STORE_NAME = 'uploads';

/** An upload failure with a stable machine code the UI maps to copy. */
export class UploadError extends Error {
	constructor(code, message, { status = 0, cause } = {}) {
		super(message);
		this.name = 'UploadError';
		this.code = code;
		this.status = status;
		if (cause) this.cause = cause;
	}
}

/** Split `size` bytes into 1-based parts of `partSize`; the last part holds the remainder. */
export function planParts(size, partSize) {
	if (!Number.isFinite(size) || size <= 0) throw new UploadError('empty_file', 'That file is empty.');
	if (!Number.isFinite(partSize) || partSize <= 0) throw new UploadError('bad_plan', 'The server sent an invalid part size.');
	const count = Math.ceil(size / partSize);
	const parts = [];
	for (let i = 0; i < count; i++) {
		const start = i * partSize;
		parts.push({ partNumber: i + 1, start, end: Math.min(size, start + partSize) });
	}
	return parts;
}

/** Group part numbers into batches of at most `SIGN_BATCH` for the sign endpoint. */
export function batchPartNumbers(partNumbers, size = SIGN_BATCH) {
	const batches = [];
	for (let i = 0; i < partNumbers.length; i += size) batches.push(partNumbers.slice(i, i + size));
	return batches;
}

/** Exponential backoff with full jitter, capped. `attempt` starts at 1. */
export function backoffDelay(attempt, random = Math.random) {
	const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
	return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/** Identity of a local file for resume: same name, size and last-modified time. */
export function fingerprint(file) {
	return `${file.name}|${file.size}|${file.lastModified}`;
}

const wait = (ms, signal) =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortError());
		const t = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(t);
			reject(abortError());
		}
		signal?.addEventListener('abort', onAbort, { once: true });
	});

function abortError() {
	return new UploadError('aborted', 'The upload was cancelled.');
}

// ── persistence ─────────────────────────────────────────────────────────────

/**
 * IndexedDB-backed resume store. Every call is wrapped: a private window, blocked
 * site data or a quota error turns the store into a no-op rather than breaking
 * the upload itself.
 */
export function createIdbStore(idb = globalThis.indexedDB) {
	let dbPromise = null;
	const open = () => {
		if (!idb) return Promise.resolve(null);
		if (!dbPromise) {
			dbPromise = new Promise((resolve) => {
				try {
					const req = idb.open(DB_NAME, 1);
					req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: 'fingerprint' });
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => resolve(null);
					req.onblocked = () => resolve(null);
				} catch {
					resolve(null);
				}
			});
		}
		return dbPromise;
	};
	const run = async (mode, fn) => {
		const db = await open();
		if (!db) return undefined;
		return new Promise((resolve) => {
			try {
				const tx = db.transaction(STORE_NAME, mode);
				const req = fn(tx.objectStore(STORE_NAME));
				tx.oncomplete = () => resolve(req?.result);
				tx.onerror = () => resolve(undefined);
				tx.onabort = () => resolve(undefined);
			} catch {
				resolve(undefined);
			}
		});
	};
	return {
		get: (fp) => run('readonly', (s) => s.get(fp)),
		put: (record) => run('readwrite', (s) => s.put(record)),
		delete: (fp) => run('readwrite', (s) => s.delete(fp)),
	};
}

/** In-memory store with the same interface (tests, and the fallback when IndexedDB is absent). */
export function createMemoryStore() {
	const map = new Map();
	return {
		get: async (fp) => map.get(fp),
		put: async (record) => void map.set(record.fingerprint, structuredClone(record)),
		delete: async (fp) => void map.delete(fp),
	};
}

function newRecord(file, created) {
	return {
		version: RECORD_VERSION,
		fingerprint: fingerprint(file),
		fileName: file.name,
		size: file.size,
		lastModified: file.lastModified,
		upload_id: created.upload_id,
		key: created.key,
		part_size: created.part_size,
		part_count: created.part_count,
		parts: {},
		updatedAt: Date.now(),
	};
}

function recordMatches(record, file) {
	return (
		record &&
		record.version === RECORD_VERSION &&
		record.fingerprint === fingerprint(file) &&
		record.size === file.size &&
		Number.isFinite(record.part_size) &&
		record.part_size > 0 &&
		typeof record.upload_id === 'string' &&
		typeof record.key === 'string'
	);
}

/** The resumable upload recorded for `file`, or null. Never throws. */
export async function findResumable(file, { store = createIdbStore() } = {}) {
	try {
		const record = await store.get(fingerprint(file));
		if (!recordMatches(record, file)) return null;
		const done = Object.keys(record.parts).length;
		if (!done) return null;
		const planned = planParts(file.size, record.part_size);
		const doneBytes = planned.reduce((sum, p) => (record.parts[p.partNumber] ? sum + (p.end - p.start) : sum), 0);
		return { record, partsDone: done, partCount: planned.length, bytesDone: doneBytes };
	} catch {
		return null;
	}
}

// ── network ─────────────────────────────────────────────────────────────────

async function postJson(fetchImpl, url, body, signal) {
	let res;
	try {
		res = await fetchImpl(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify(body),
			signal,
		});
	} catch (err) {
		if (signal?.aborted) throw abortError();
		throw new UploadError('network', 'The connection dropped.', { cause: err });
	}
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const code = typeof data.error === 'string' ? data.error : `http_${res.status}`;
		throw new UploadError(code, data.message || `The upload service answered ${res.status}.`, { status: res.status });
	}
	return data;
}

/**
 * PUT one part with XMLHttpRequest, because it is the only browser API that reports
 * upload progress. Resolves `{ etag }`. Rejects with a UploadError carrying `status`.
 */
export function xhrPutPart({ url, blob, onProgress, signal }) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		const onAbort = () => xhr.abort();
		signal?.addEventListener('abort', onAbort, { once: true });
		xhr.open('PUT', url);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(e.loaded);
		};
		xhr.onload = () => {
			signal?.removeEventListener('abort', onAbort);
			if (xhr.status >= 200 && xhr.status < 300) {
				const etag = xhr.getResponseHeader('ETag');
				if (!etag) {
					reject(new UploadError('etag_unreadable', 'The browser could not read the upload receipt.', { status: xhr.status }));
					return;
				}
				onProgress(blob.size);
				resolve({ etag });
			} else {
				reject(new UploadError(`part_http_${xhr.status}`, `Storage answered ${xhr.status}.`, { status: xhr.status }));
			}
		};
		xhr.onerror = () => {
			signal?.removeEventListener('abort', onAbort);
			reject(new UploadError('network', 'The connection dropped.'));
		};
		xhr.ontimeout = xhr.onerror;
		xhr.onabort = () => {
			signal?.removeEventListener('abort', onAbort);
			reject(abortError());
		};
		xhr.send(blob);
	});
}

/** Rolling-window speed estimate over the last few seconds of progress samples. */
export function createSpeedMeter(now = () => Date.now(), windowMs = SPEED_WINDOW_MS) {
	const samples = [];
	return {
		push(bytes) {
			const t = now();
			samples.push({ t, bytes });
			while (samples.length > 2 && t - samples[0].t > windowMs) samples.shift();
		},
		bytesPerSecond() {
			if (samples.length < 2) return 0;
			const a = samples[0];
			const b = samples[samples.length - 1];
			const dt = (b.t - a.t) / 1000;
			return dt > 0 ? Math.max(0, (b.bytes - a.bytes) / dt) : 0;
		},
	};
}

const isRetryable = (err) => {
	if (err.code === 'aborted' || err.code === 'etag_unreadable') return false;
	if (err.code === 'network') return true;
	return err.status === 408 || err.status === 429 || err.status >= 500;
};

/**
 * Upload `file` through the capture-upload API.
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {string} [opts.apiBase]      default `/api/capture-upload`
 * @param {Function} [opts.fetchImpl]  default `fetch`
 * @param {Function} [opts.putPart]    `({url, blob, onProgress, signal}) => {etag}`, default XHR
 * @param {object} [opts.store]        resume store, default IndexedDB
 * @param {AbortSignal} [opts.signal]  aborts in flight parts and the multipart upload
 * @param {Function} [opts.onProgress] `({loaded, total, fraction, bytesPerSecond, secondsRemaining, partsDone, partCount, resumed})`
 * @param {Function} [opts.onRetry]    `({partNumber, attempt, delayMs, error})`
 * @param {Function} [opts.sleep]      `(ms, signal) => Promise`, injectable for tests
 * @param {number} [opts.parallel]     concurrent PUTs, default 4
 * @param {string} [opts.kind]         create-endpoint `kind`, default `pano`
 * @param {boolean} [opts.resume]      reuse a recorded upload for this file, default true
 * @returns {Promise<{source_url:string, size_bytes:number, key:string, upload_id:string, resumed:boolean}>}
 */
export async function uploadFile(file, opts = {}) {
	const {
		apiBase = DEFAULT_API_BASE,
		fetchImpl = (...a) => globalThis.fetch(...a),
		putPart = xhrPutPart,
		store = createIdbStore(),
		signal,
		onProgress = () => {},
		onRetry = () => {},
		sleep = wait,
		parallel = PARALLEL_PARTS,
		kind = 'pano',
		resume = true,
	} = opts;

	if (!file || !file.size) throw new UploadError('empty_file', 'That file is empty.');
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new UploadError('file_too_large', 'Files up to 8 GB can be uploaded.');
	}
	if (signal?.aborted) throw abortError();

	const api = (name, body) => postJson(fetchImpl, `${apiBase}/${name}`, body, signal);
	const fp = fingerprint(file);

	let record = null;
	let resumed = false;
	if (resume) {
		const found = await findResumable(file, { store });
		if (found) {
			record = found.record;
			resumed = true;
		}
	}
	if (!record) {
		const created = await api('create', {
			filename: file.name,
			content_type: file.type || 'application/octet-stream',
			size_bytes: file.size,
			kind,
		});
		record = newRecord(file, created);
		await store.put(record);
	}

	const run = () => transferParts({ file, record, api, putPart, store, signal, onProgress, onRetry, sleep, parallel, resumed });

	let outcome;
	try {
		try {
			outcome = await run();
		} catch (err) {
			// A recorded upload can be gone server-side (expired or aborted). Start over once,
			// from scratch, so a stale record never traps the file in a resume loop.
			const stale = resumed && err instanceof UploadError && [403, 404].includes(err.status);
			if (!stale) throw err;
			await store.delete(fp);
			const created = await api('create', {
				filename: file.name,
				content_type: file.type || 'application/octet-stream',
				size_bytes: file.size,
				kind,
			});
			record = newRecord(file, created);
			resumed = false;
			await store.put(record);
			outcome = await run();
		}
	} catch (err) {
		if (err.code === 'aborted') await abortUpload({ apiBase, fetchImpl, record, store, fp });
		throw err;
	}

	const parts = planParts(file.size, record.part_size).map((p) => ({
		part_number: p.partNumber,
		etag: record.parts[p.partNumber],
	}));
	const done = await api('complete', { upload_id: record.upload_id, key: record.key, parts });
	await store.delete(fp);
	return { source_url: done.source_url, size_bytes: done.size_bytes, key: record.key, upload_id: record.upload_id, resumed: outcome.resumed };
}

async function abortUpload({ apiBase, fetchImpl, record, store, fp }) {
	try {
		await store.delete(fp);
		await postJson(fetchImpl, `${apiBase}/abort`, { upload_id: record.upload_id, key: record.key });
	} catch {
		/* the bucket lifecycle rule reclaims an orphaned multipart upload */
	}
}

/** Abort the multipart upload for a recorded resume (the "discard" action). */
export async function discardUpload(file, { apiBase = DEFAULT_API_BASE, fetchImpl = (...a) => globalThis.fetch(...a), store = createIdbStore() } = {}) {
	const found = await findResumable(file, { store });
	await store.delete(fingerprint(file));
	if (!found) return;
	try {
		await postJson(fetchImpl, `${apiBase}/abort`, { upload_id: found.record.upload_id, key: found.record.key });
	} catch {
		/* already gone */
	}
}

async function transferParts({ file, record, api, putPart, store, signal, onProgress, onRetry, sleep, parallel, resumed }) {
	const plan = planParts(file.size, record.part_size);
	const loaded = new Map();
	for (const p of plan) if (record.parts[p.partNumber]) loaded.set(p.partNumber, p.end - p.start);
	const missing = plan.filter((p) => !record.parts[p.partNumber]);
	const meter = createSpeedMeter();
	const total = file.size;

	const sumLoaded = () => {
		let n = 0;
		for (const v of loaded.values()) n += v;
		return n;
	};
	const report = () => {
		const bytes = sumLoaded();
		meter.push(bytes);
		const bps = meter.bytesPerSecond();
		onProgress({
			loaded: bytes,
			total,
			fraction: bytes / total,
			bytesPerSecond: bps,
			secondsRemaining: bps > 0 ? (total - bytes) / bps : null,
			partsDone: Object.keys(record.parts).length,
			partCount: plan.length,
			resumed,
		});
	};
	report();
	if (!missing.length) return { resumed };

	// Sign lazily, one batch at a time, for the parts that still need sending.
	const urls = new Map();
	const batches = batchPartNumbers(missing.map((p) => p.partNumber));
	let batchIdx = 0;
	let signing = null;
	const ensureSigned = async (partNumber) => {
		while (!urls.has(partNumber)) {
			if (!signing) {
				const batch = batches[batchIdx++];
				if (!batch) throw new UploadError('sign_failed', 'The upload service did not sign every part.');
				signing = api('sign', { upload_id: record.upload_id, key: record.key, part_numbers: batch })
					.then((r) => {
						for (const n of batch) {
							const u = r.urls?.[String(n)];
							if (!u) throw new UploadError('sign_failed', 'The upload service did not sign every part.');
							urls.set(n, u);
						}
					})
					.finally(() => {
						signing = null;
					});
			}
			await signing;
		}
		return urls.get(partNumber);
	};

	const sendPart = async (p) => {
		const blob = file.slice(p.start, p.end);
		let lastErr;
		for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt++) {
			if (signal?.aborted) throw abortError();
			try {
				const url = await ensureSigned(p.partNumber);
				const { etag } = await putPart({
					url,
					blob,
					signal,
					onProgress: (n) => {
						loaded.set(p.partNumber, Math.min(n, p.end - p.start));
						report();
					},
				});
				record.parts[p.partNumber] = etag;
				record.updatedAt = Date.now();
				loaded.set(p.partNumber, p.end - p.start);
				await store.put(record);
				report();
				return;
			} catch (err) {
				lastErr = err instanceof UploadError ? err : new UploadError('network', 'The connection dropped.', { cause: err });
				loaded.set(p.partNumber, 0);
				// A presigned URL that was refused has expired: sign this part again.
				if (lastErr.status === 403) {
					urls.delete(p.partNumber);
					if (attempt < 2) {
						const r = await api('sign', { upload_id: record.upload_id, key: record.key, part_numbers: [p.partNumber] });
						if (r.urls?.[String(p.partNumber)]) urls.set(p.partNumber, r.urls[String(p.partNumber)]);
						continue;
					}
				}
				if (!isRetryable(lastErr) || attempt === MAX_PART_ATTEMPTS) break;
				const delayMs = backoffDelay(attempt);
				onRetry({ partNumber: p.partNumber, attempt, delayMs, error: lastErr });
				await sleep(delayMs, signal);
			}
		}
		throw lastErr;
	};

	// A small worker pool: each worker takes the next unsent part.
	let next = 0;
	let failure = null;
	const worker = async () => {
		while (!failure) {
			const p = missing[next++];
			if (!p) return;
			try {
				await sendPart(p);
			} catch (err) {
				failure = failure || err;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(parallel, missing.length) }, worker));
	if (failure) throw failure;
	return { resumed };
}
