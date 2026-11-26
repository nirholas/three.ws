// Real HTTP access to the public Forge pipeline on three.ws (/api/forge).
//
// Making a model on three.ws needs an account, so every three.ws API call
// (submit, poll, reference-image presign) sends THREE_WS_API_KEY as a bearer,
// and generation refuses before any request when the key is unset. The key
// never goes to the CDN that serves the GLB or to a presigned storage URL. The
// default image lane (FLUX to TRELLIS) costs nothing on a free account; the
// geometry lane (Meshy/Tripo) is bring-your-own-key and that key travels as a
// request header, never in a body or a URL.
//
// The contract mirrored here is the same one the three.ws Blender add-on and
// ComfyUI nodes speak (integrations/_pyclient/three_ws_client.py).

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import { FORGE_PROVIDER_KEY, THREE_WS_API_KEY, THREE_WS_BASE, USER_AGENT } from '../config.js';

const POLL_INTERVAL_MS = 2500;
const REQUEST_TIMEOUT_MS = 30000;

const CLIENT_HANDLE = randomUUID().replace(/-/g, '');

function headers(extra) {
	return {
		accept: 'application/json',
		'x-forge-client': CLIENT_HANDLE,
		'user-agent': USER_AGENT,
		...(FORGE_PROVIDER_KEY ? { 'x-forge-provider-key': FORGE_PROVIDER_KEY } : {}),
		...extra,
	};
}

const KEYS_URL = `${THREE_WS_BASE}/dashboard/api-keys`;

// The answer for a missing or refused key, with exactly what to set.
function signInRequired() {
	return Object.assign(
		new Error(
			THREE_WS_API_KEY
				? `three.ws refused THREE_WS_API_KEY. Check the key, or create a new one, at ${KEYS_URL}.`
				: `Making a model on three.ws needs a free account. Create an API key at ${KEYS_URL} and set THREE_WS_API_KEY in this server's env.`,
		),
		{ code: 'sign_in_required', status: 401 },
	);
}

function requireApiKey() {
	if (!THREE_WS_API_KEY) throw signInRequired();
}

async function forgeRequest(pathname, { method = 'GET', query, body, auth = THREE_WS_API_KEY } = {}) {
	const url = new URL(`${THREE_WS_BASE}${pathname}`);
	for (const [key, value] of Object.entries(query || {})) {
		if (value === undefined || value === null || value === '') continue;
		url.searchParams.set(key, String(value));
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	let res;
	try {
		res = await fetch(url, {
			method,
			headers: headers({
				...(body !== undefined ? { 'content-type': 'application/json' } : {}),
				...(auth ? { authorization: `Bearer ${auth}` } : {}),
			}),
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});
	} catch (err) {
		clearTimeout(timer);
		if (err?.name === 'AbortError') {
			throw Object.assign(new Error(`three.ws ${pathname} timed out after ${REQUEST_TIMEOUT_MS}ms`), { code: 'timeout' });
		}
		throw Object.assign(new Error(`three.ws ${pathname} request failed: ${err?.message || err}`), {
			code: 'network_error',
		});
	}
	clearTimeout(timer);

	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { raw: text };
	}
	if (res.status === 401) throw signInRequired();
	if (!res.ok) {
		const message = data?.message || data?.error || `three.ws ${pathname} returned HTTP ${res.status}`;
		throw Object.assign(new Error(message), { code: 'upstream_error', status: res.status, body: data });
	}
	return data;
}

/** Live tier / backend / cost matrix for this deployment. */
export async function catalog() {
	return forgeRequest('/api/forge', { query: { catalog: '1' } });
}

const CONTENT_TYPES = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
};

/**
 * Presign, upload, and return the public URL of a local reference image.
 *
 * The bytes go straight to object storage on a presigned PUT, so the image
 * never travels through the API and never through this conversation. A
 * deployment without storage configured says so, and the caller can pass a
 * public URL instead.
 *
 * @param {string} filePath  Local PNG, JPEG, or WebP.
 * @returns {Promise<{url: string, bytes: number, content_type: string}>}
 */
export async function uploadReferenceImage(filePath) {
	const extension = path.extname(filePath).toLowerCase();
	const contentType = CONTENT_TYPES[extension];
	if (!contentType) {
		throw Object.assign(
			new Error(`Unsupported image type "${extension}". Use PNG, JPEG, or WebP.`),
			{ code: 'invalid_content_type' },
		);
	}

	// Uploading a photo needs a three.ws account like every creation call; a
	// missing key is refused here, before the file is read or anything is sent.
	requireApiKey();
	const bytes = await readFile(filePath);
	if (bytes.length === 0) {
		throw Object.assign(new Error(`${filePath} is empty.`), { code: 'invalid_size' });
	}

	const presign = await forgeRequest('/api/forge-upload', {
		method: 'POST',
		body: {
			content_type: contentType,
			size_bytes: bytes.length,
			checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
		},
	});
	if (!presign.upload_url || !presign.public_url) {
		throw Object.assign(
			new Error(
				presign.message ||
					'This deployment has no object storage configured for image upload. Pass a public https image URL instead.',
			),
			{ code: 'presign_failed' },
		);
	}

	const put = await fetch(presign.upload_url, {
		method: 'PUT',
		headers: presign.headers || { 'content-type': contentType },
		body: bytes,
	});
	if (!put.ok) {
		// The presigned PUT goes straight to object storage, so a failure here is
		// the deployment's storage, not the caller's file. Naming the way around
		// it matters: image-to-3D still works from a public URL, and a bare HTTP
		// status would leave the caller thinking the whole lane is down.
		throw Object.assign(
			new Error(
				`Uploading the reference image to the deployment's object storage failed with HTTP ${put.status}. ` +
					'Pass a public https image as "image_url" instead, which does not use the upload path.',
			),
			{ code: 'upload_failed', status: put.status },
		);
	}
	return { url: presign.public_url, bytes: bytes.length, content_type: contentType };
}

/**
 * Submit reference images for image-to-3D and return the queued job.
 * @returns {Promise<{job_id: string, backend?: string}>}
 */
export async function submitImageTo3d({ imageUrls, prompt = '', tier = 'standard', backend, lane = 'image' }) {
	requireApiKey();
	const urls = imageUrls.filter((url) => typeof url === 'string' && url.startsWith('https://'));
	if (urls.length === 0) {
		throw Object.assign(new Error('Image-to-3D needs at least one public https image URL.'), {
			code: 'invalid_image_urls',
		});
	}
	const body = { image_urls: urls, tier, path: lane };
	if (prompt.trim()) body.prompt = prompt.trim();
	if (backend) body.backend = backend;
	return submitted(await forgeRequest('/api/forge', { method: 'POST', body }));
}

/**
 * Submit a text prompt for generation and return the queued job.
 * @returns {Promise<{job_id: string, backend?: string}>}
 */
export async function submitTextTo3d({ prompt, tier = 'standard', backend, aspect_ratio = '1:1', lane = 'image' }) {
	requireApiKey();
	const body = { prompt, tier, path: lane, aspect_ratio };
	if (backend) body.backend = backend;
	return submitted(await forgeRequest('/api/forge', { method: 'POST', body }));
}

function submitted(result) {
	if (result.error === 'needs_key') {
		throw Object.assign(
			new Error(
				'The Meshy/Tripo geometry lane needs your own provider key. Set THREE_WS_FORGE_PROVIDER_KEY, ' +
					'or use the free image lane (lane: "image").',
			),
			{ code: 'needs_key' },
		);
	}
	if (result.error) {
		throw Object.assign(new Error(result.message || result.error), { code: result.error });
	}
	if (!result.job_id) {
		throw Object.assign(new Error('Forge accepted the prompt but returned no job id.'), { code: 'no_job' });
	}
	return result;
}

/**
 * Poll a generation to completion.
 * @returns {Promise<{glb_url: string, backend?: string, elapsed_ms: number, polls: number}>}
 */
export async function waitForGlb(jobId, { timeoutMs, onProgress } = {}) {
	const started = Date.now();
	let polls = 0;
	for (;;) {
		const result = await forgeRequest('/api/forge', { query: { job: jobId } });
		polls += 1;
		const status = result.status || 'running';
		if (onProgress) onProgress(status, Date.now() - started);
		if (status === 'done' && result.glb_url) {
			return { ...result, elapsed_ms: Date.now() - started, polls };
		}
		if (status === 'failed') {
			throw Object.assign(new Error(result.error || 'Generation failed.'), { code: 'generation_failed' });
		}
		if (Date.now() - started > timeoutMs) {
			throw Object.assign(
				new Error(`Generation ${jobId} was still "${status}" after ${Math.round((Date.now() - started) / 1000)}s.`),
				{ code: 'timeout', job_id: jobId },
			);
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}

/** Stream a generated GLB to disk and return its absolute path and size. */
export async function downloadGlb(url, destination) {
	const target = path.resolve(destination);
	await mkdir(path.dirname(target), { recursive: true });
	const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
	if (!res.ok || !res.body) {
		throw Object.assign(new Error(`Downloading the generated GLB failed with HTTP ${res.status}.`), {
			code: 'download_failed',
			status: res.status,
		});
	}
	await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
	const { size } = await stat(target);
	return { path: target, bytes: size };
}
