// Turn a prompt or a photo into a GLB on the three.ws forge lane, then hand the
// URL to the terminal rasterizer. This file stays free of Node builtins so the
// /tty page and the CLI share one client.

export const DEFAULT_ORIGIN = 'https://three.ws';
export const KEYS_URL = 'https://three.ws/dashboard/api-keys';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MIN_PROMPT = 3;
export const MAX_PROMPT = 1000;

const MIN_POLL_MS = 2000;
const MAX_POLL_MS = 15000;
const DEFAULT_WAIT_MS = 8 * 60 * 1000;

export class MakeError extends Error {
	constructor(message, extra = {}) {
		super(message);
		this.name = 'MakeError';
		this.status = extra.status || 0;
		this.code = extra.code || '';
		this.signInUrl = extra.signInUrl || '';
		this.keysUrl = extra.keysUrl || '';
		this.jobId = extra.jobId || '';
	}
}

export function apiKeyFromEnv(env = globalThis.process?.env || {}) {
	return String(env.THREE_WS_API_KEY || '').trim() || null;
}

function endpoint(origin, path) {
	const base = String(origin || '').replace(/\/$/, '');
	return `${base}${path}`;
}

function absolute(origin, path) {
	if (!path) return '';
	try {
		return new URL(path, origin || DEFAULT_ORIGIN).href;
	} catch {
		return path;
	}
}

async function readJson(res) {
	const text = await res.text();
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return { message: text.slice(0, 300) };
	}
}

function glbOf(data) {
	return data?.glb_url || data?.glbUrl || '';
}

function jobOf(data) {
	return data?.job_id || data?.job || '';
}

function pollWait(data) {
	const seconds = Number(data?.retry_after ?? data?.retryAfter);
	const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 4000;
	return Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, ms));
}

/**
 * POST /api/forge and poll until a GLB exists.
 *
 * `imageUrls` reconstructs those photos. A prompt alone is text to 3D. Both
 * together send the words along with the photos. `origin` empty means a
 * same-origin path, which is what the /tty page uses.
 */
export async function forgeModel({
	prompt = '',
	imageUrls = [],
	origin = DEFAULT_ORIGIN,
	apiKey = '',
	credentials,
	fetchImpl = globalThis.fetch,
	onStatus,
	signal,
	maxWaitMs = DEFAULT_WAIT_MS,
	now = () => Date.now(),
	sleep = (ms, s) => new Promise((resolve, reject) => {
		if (s?.aborted) { reject(new MakeError('cancelled', { code: 'cancelled' })); return; }
		const timer = setTimeout(resolve, ms);
		if (s) s.addEventListener('abort', () => { clearTimeout(timer); reject(new MakeError('cancelled', { code: 'cancelled' })); }, { once: true });
	}),
} = {}) {
	const words = String(prompt || '').trim();
	const photos = (Array.isArray(imageUrls) ? imageUrls : []).map((u) => String(u || '').trim()).filter(Boolean);
	if (!photos.length && words.length < MIN_PROMPT) {
		throw new MakeError(`describe one object in at least ${MIN_PROMPT} characters, or pass a photo`);
	}
	if (words.length > MAX_PROMPT) throw new MakeError(`the prompt must be ${MAX_PROMPT} characters or fewer`);

	const headers = { accept: 'application/json', 'content-type': 'application/json' };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const body = { tier: 'draft' };
	if (words) body.prompt = words;
	if (photos.length) body.image_urls = photos;

	onStatus?.({ phase: 'submitting' });
	const started = await call(endpoint(origin, '/api/forge'), {
		method: 'POST',
		headers,
		credentials,
		body: JSON.stringify(body),
		signal,
	}, fetchImpl, origin);

	const immediate = glbOf(started);
	if (started.status === 'done' && immediate) {
		onStatus?.({ phase: 'done' });
		return { glbUrl: immediate, jobId: jobOf(started) || '', backend: started.backend || '' };
	}
	if (started.status === 'failed') {
		throw new MakeError(started.message || 'generation failed', { code: started.error || 'failed' });
	}

	const jobId = jobOf(started);
	if (!jobId) throw new MakeError(started.message || 'the generator did not return a model', { code: started.error || '' });

	const deadline = now() + maxWaitMs;
	let latest = started;
	while (now() < deadline) {
		onStatus?.({ phase: latest.status || 'running', message: latest.message || '' });
		await sleep(pollWait(latest), signal);
		if (signal?.aborted) throw new MakeError('cancelled', { code: 'cancelled' });
		latest = await call(endpoint(origin, `/api/forge?job=${encodeURIComponent(jobId)}`), {
			method: 'GET',
			headers,
			credentials,
			signal,
		}, fetchImpl, origin);
		const glbUrl = glbOf(latest);
		if (latest.status === 'done' && glbUrl) {
			onStatus?.({ phase: 'done' });
			return { glbUrl, jobId, backend: latest.backend || '' };
		}
		if (latest.status === 'failed') {
			throw new MakeError(latest.message || 'generation failed', { code: latest.error || 'failed', jobId });
		}
	}
	throw new MakeError(`still generating after ${Math.round(maxWaitMs / 1000)}s. The job is ${jobId}.`, {
		code: 'timeout',
		jobId,
	});
}

/**
 * Presign a photo, PUT the bytes, and return the public URL forge can read.
 * `bytes` is a Blob, Buffer, or Uint8Array.
 */
export async function uploadImage({
	bytes,
	contentType,
	origin = DEFAULT_ORIGIN,
	apiKey = '',
	credentials,
	fetchImpl = globalThis.fetch,
	signal,
} = {}) {
	const size = Number(bytes?.byteLength ?? bytes?.size ?? 0);
	const type = String(contentType || '').toLowerCase();
	if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
		throw new MakeError('a photo must be a PNG, JPEG, or WebP');
	}
	if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
		throw new MakeError(`a photo must be between 1 byte and ${MAX_IMAGE_BYTES} bytes`);
	}
	const headers = { accept: 'application/json', 'content-type': 'application/json' };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const presign = await call(endpoint(origin, '/api/forge-upload'), {
		method: 'POST',
		headers,
		credentials,
		body: JSON.stringify({ content_type: type, size_bytes: size }),
		signal,
	}, fetchImpl, origin);
	if (!presign.upload_url || !presign.public_url) {
		throw new MakeError(presign.message || 'upload failed', { code: presign.error || '' });
	}
	const put = await fetchImpl(presign.upload_url, {
		method: presign.method || 'PUT',
		headers: { ...(presign.headers || {}), 'content-type': type },
		body: bytes,
		signal,
	});
	if (!put.ok) throw new MakeError(`storage rejected the photo (${put.status})`);
	return presign.public_url;
}

async function call(url, init, fetchImpl, origin) {
	let res;
	try {
		res = await fetchImpl(url, init);
	} catch (err) {
		if (err instanceof MakeError) throw err;
		throw new MakeError(err?.message || 'the generator could not be reached', { code: 'transport' });
	}
	const data = await readJson(res);
	if (res.ok) return data;
	if (res.status === 401 || data.error === 'sign_in_required') {
		const signInUrl = absolute(origin, data.sign_in_url || '/login');
		const keysUrl = absolute(origin, data.api_keys_url || '/dashboard/api-keys');
		throw new MakeError(
			data.message || `Sign in to make a 3D model. A key for the terminal lives at ${keysUrl}.`,
			{ status: 401, code: 'sign_in_required', signInUrl, keysUrl },
		);
	}
	throw new MakeError(data.message || data.error_description || `the generator returned ${res.status}`, {
		status: res.status,
		code: data.error || '',
	});
}
