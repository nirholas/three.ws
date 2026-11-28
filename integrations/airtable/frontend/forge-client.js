// Client for the public Forge API (POST /api/forge, GET /api/forge?job=).
//
// Same contract as the Raycast extension's client (integrations/raycast/src/forge-api.ts),
// written as plain ESM so the Airtable bundler and `node --test` both load it unchanged.
// fetch, sleep and the clock are injectable so the tests can replay recorded production
// exchanges; the extension itself always uses the browser's real fetch.

export const DEFAULT_BASE_URL = 'https://three.ws';
export const API_KEYS_URL = 'https://three.ws/dashboard/api';
export const CLIENT_HANDLE = 'airtable-extension';
export const POLL_INTERVAL_MS = 3000;
export const POLL_TIMEOUT_MS = 6 * 60 * 1000;
export const MAX_RATE_LIMIT_RETRIES = 3;
export const TIERS = ['draft', 'standard', 'high'];

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.glb(?:$|\?)/i;

export class ForgeError extends Error {
	constructor(message, code = '', status = 0) {
		super(message);
		this.name = 'ForgeError';
		this.code = code;
		this.status = status;
	}

	/** True when the API key is missing, revoked or lacks access: the fix is a new key. */
	get isAuth() {
		return (
			this.status === 401 ||
			this.status === 403 ||
			['sign_in_required', 'unauthorized', 'invalid_token', 'insufficient_scope'].includes(this.code)
		);
	}
}

export class AbortedError extends Error {
	constructor() {
		super('Stopped.');
		this.name = 'AbortedError';
	}
}

/**
 * The public page for a model. Forge gives a creation id for every new generation; a
 * cached answer carries none, but its GLB is stored under the creation id, so it is
 * recovered from the file name. Without either, the GLB opens in the plain viewer.
 */
export function modelPageUrl(baseUrl, glbUrl, creationId) {
	const id = creationId || (UUID.exec(glbUrl || '') || [])[1];
	if (id) return `${baseUrl}/m/${id}`;
	return `${baseUrl}/viewer?src=${encodeURIComponent(glbUrl)}`;
}

/**
 * A thumbnail for a stored model. Forge keeps a poster image for each creation and
 * /api/forge/<id>/og redirects to it (404 when there is none), so a GLB stored by an
 * earlier session still gets a picture even though Airtable cannot thumbnail a GLB.
 */
export function posterUrl(baseUrl, glbUrl) {
	const id = (UUID.exec(glbUrl || '') || [])[1];
	return id ? `${baseUrl}/api/forge/${id}/og` : null;
}

function defaultSleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new AbortedError());
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(new AbortedError());
		}
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function retryAfterMs(headerValue) {
	const seconds = Number(headerValue);
	if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 60) * 1000;
	return 15000;
}

export class ForgeClient {
	constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl, sleep, now } = {}) {
		this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
		this.apiKey = String(apiKey || '').trim();
		this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
		this.sleep = sleep || defaultSleep;
		this.now = now || Date.now;
	}

	async request(path, { method = 'GET', body, signal } = {}) {
		if (signal?.aborted) throw new AbortedError();
		const headers = { accept: 'application/json', 'x-forge-client': CLIENT_HANDLE };
		if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
		if (body !== undefined) headers['content-type'] = 'application/json';
		let response;
		try {
			response = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal,
			});
		} catch (error) {
			if (signal?.aborted || error?.name === 'AbortError') throw new AbortedError();
			throw new ForgeError(
				`Could not reach three.ws (${error?.message || error}). Check your connection and try again.`,
				'unreachable',
			);
		}
		const text = await response.text();
		let parsed = {};
		try {
			parsed = text ? JSON.parse(text) : {};
		} catch {
			parsed = {};
		}
		if (!response.ok) {
			const error = new ForgeError(
				parsed.message || parsed.error_description || parsed.error || `three.ws answered HTTP ${response.status}.`,
				parsed.error || '',
				response.status,
			);
			error.retryAfterMs = retryAfterMs(response.headers?.get?.('retry-after'));
			error.details = parsed;
			throw error;
		}
		return parsed;
	}

	/** Start a generation. Resolves to the submission, which is already done when Forge had it cached. */
	async submit(prompt, tier = 'draft', { signal, onStatus } = {}) {
		const trimmed = String(prompt || '').trim();
		if (trimmed.length < 3) {
			throw new ForgeError('The prompt needs at least 3 characters describing one object.', 'invalid_prompt');
		}
		if (!this.apiKey) {
			throw new ForgeError('Add your three.ws API key to generate models.', 'sign_in_required', 401);
		}
		const body = { prompt: trimmed.slice(0, 1000), tier: TIERS.includes(tier) ? tier : 'draft', path: 'image', aspect_ratio: '1:1' };
		const start = this.now();
		let throttled = 0;
		for (;;) {
			try {
				const result = await this.request('/api/forge', { method: 'POST', body, signal });
				const cached = result.status === 'done' && typeof result.glb_url === 'string';
				if (!cached && (typeof result.job_id !== 'string' || !result.job_id)) {
					throw new ForgeError(result.message || 'Forge did not return a job.', result.error || 'no_job');
				}
				return result;
			} catch (error) {
				if (!(error instanceof ForgeError)) throw error;
				const elapsed = this.now() - start;
				// A place in Forge's waiting line (429 forge_queued) is held by submitting again
				// when told to; it is a normal wait, bounded only by the overall time limit.
				if (error.status === 429 && error.code === 'forge_queued' && elapsed < POLL_TIMEOUT_MS) {
					const { position = null, eta_seconds: etaSeconds = null } = error.details || {};
					onStatus?.('in_line', elapsed, error.retryAfterMs, { position, etaSeconds });
					await this.sleep(error.retryAfterMs, signal);
					continue;
				}
				// A rate limit or a full line (503 forge_full) gets a few patient retries.
				const busy = error.status === 429 || (error.status === 503 && error.code === 'forge_full');
				if (busy && throttled < MAX_RATE_LIMIT_RETRIES) {
					throttled++;
					onStatus?.('rate_limited', elapsed, error.retryAfterMs);
					await this.sleep(error.retryAfterMs, signal);
					continue;
				}
				throw error;
			}
		}
	}

	/**
	 * Poll a job until it is done. `onStatus(status, elapsedMs, retryInMs)` reports each answer,
	 * and "rate_limited" with the wait whenever three.ws asks the client to slow down.
	 */
	async poll(jobId, { onStatus, signal, creationId } = {}) {
		const start = this.now();
		for (;;) {
			const elapsed = this.now() - start;
			if (elapsed > POLL_TIMEOUT_MS) {
				throw new ForgeError(`Generation took longer than ${Math.round(POLL_TIMEOUT_MS / 60000)} minutes. Try again.`, 'timeout');
			}
			let job;
			try {
				job = await this.request(`/api/forge?job=${encodeURIComponent(jobId)}`, { signal });
			} catch (error) {
				if (error instanceof ForgeError && [429, 502, 503, 504].includes(error.status)) {
					if (error.status === 429) onStatus?.('rate_limited', elapsed, error.retryAfterMs);
					await this.sleep(error.status === 429 ? error.retryAfterMs : POLL_INTERVAL_MS, signal);
					continue;
				}
				throw error;
			}
			const status = job.status || 'running';
			onStatus?.(status, elapsed);
			if (status === 'done' && job.glb_url) return this.result(job, creationId);
			if (status === 'failed' || status === 'error') {
				throw new ForgeError(job.error || job.message || 'Generation failed. Try again or reword the prompt.', 'failed');
			}
			await this.sleep(POLL_INTERVAL_MS, signal);
		}
	}

	result(payload, creationId) {
		const id = payload.creation_id || creationId || null;
		return {
			glbUrl: payload.glb_url,
			pageUrl: modelPageUrl(this.baseUrl, payload.glb_url, id),
			previewImageUrl: typeof payload.preview_image_url === 'string' ? payload.preview_image_url : null,
			creationId: id,
			backend: payload.backend || null,
			cached: Boolean(payload.cached),
		};
	}

	async generate(prompt, tier, { onStatus, signal } = {}) {
		const submission = await this.submit(prompt, tier, { signal, onStatus });
		if (submission.status === 'done' && submission.glb_url) return this.result(submission);
		onStatus?.(submission.status || 'queued', 0);
		return this.poll(submission.job_id, { onStatus, signal, creationId: submission.creation_id });
	}
}
