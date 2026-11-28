// three.ws Forge client for the Supabase Edge Function. Plain fetch, no
// runtime-specific APIs, so the same file runs in Deno (Supabase) and in Node
// (the integration's tests).
//
// Every call resolves to one of four outcomes the sweep acts on:
//   done     the GLB is ready (a cached prompt answers this on submit)
//   pending  the job is still generating; poll again later
//   retry    a transient refusal (busy lane, rate limit, timeout); try again later
//   fatal    the request can never succeed as sent; fail the row

export const DEFAULT_BASE_URL = 'https://three.ws';
export const API_KEYS_URL = 'https://three.ws/dashboard/api-keys';
export const MAX_GLB_BYTES = 50 * 1024 * 1024;

export type Tier = 'draft' | 'standard' | 'high';

export type ForgeOutcome =
	| { kind: 'done'; glbUrl: string; jobId?: string; backend?: string; previewImageUrl?: string }
	| { kind: 'pending'; jobId: string; status: string; backend?: string }
	| { kind: 'retry'; code: string; message: string; retryAfterS: number; until?: string; quota?: boolean }
	| { kind: 'fatal'; code: string; message: string };

export interface ForgeConfig {
	apiKey: string;
	baseUrl?: string;
	fetch?: typeof fetch;
	/** Sent as x-forge-client; identifies this integration's requests. */
	client?: string;
	submitTimeoutMs?: number;
	pollTimeoutMs?: number;
}

type Json = Record<string, unknown>;

const SIGN_IN_MESSAGE = `three.ws rejected the API key. Create a free key at ${API_KEYS_URL} and save it as the THREE_WS_API_KEY secret.`;

export function normalizeBaseUrl(value: string | undefined): string {
	return (value?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function retryAfterSeconds(body: Json, headers: Headers | undefined, fallback: number): number {
	const fromBody = Number(body.retry_after);
	if (Number.isFinite(fromBody) && fromBody > 0) return Math.min(fromBody, 3600);
	const fromHeader = Number(headers?.get('retry-after'));
	if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.min(fromHeader, 3600);
	return fallback;
}

/**
 * Turn one Forge HTTP answer into an outcome. Pure, so the mapping from every
 * status and error code the API documents is tested on its own.
 */
export function classify(httpStatus: number, body: Json, headers?: Headers): ForgeOutcome {
	const error = str(body.error);
	const message = str(body.message) ?? str(body.detail) ?? error ?? `three.ws answered HTTP ${httpStatus}.`;
	const glb = str(body.glb_url);
	const jobId = str(body.job_id) ?? str(body.id);

	// On a 2xx the status field decides: a failed poll is a 200 whose `error`
	// holds the reason as prose, not a code.
	if (httpStatus >= 200 && httpStatus < 300 && (!error || body.status === 'failed')) {
		const status = str(body.status) ?? (glb ? 'done' : 'pending');
		if (status === 'done' && glb) {
			return {
				kind: 'done',
				glbUrl: glb,
				jobId,
				backend: str(body.backend),
				previewImageUrl: str(body.preview_image_url),
			};
		}
		if (status === 'failed') {
			return { kind: 'fatal', code: 'generation_failed', message: str(body.error) ?? 'three.ws could not generate this model.' };
		}
		if (jobId) return { kind: 'pending', jobId, status, backend: str(body.backend) };
		return { kind: 'retry', code: 'no_job', message: 'three.ws accepted the request but returned no job id.', retryAfterS: 15 };
	}

	if (httpStatus === 401 || httpStatus === 403 || error === 'sign_in_required') {
		return { kind: 'fatal', code: 'sign_in_required', message: SIGN_IN_MESSAGE };
	}
	if (httpStatus === 429) {
		const until = str(body.reset_at);
		const quota = Boolean(until) && body.limit === 'generation_daily';
		const wait = quota
			? Math.max(60, Math.ceil((Date.parse(until as string) - Date.now()) / 1000))
			: retryAfterSeconds(body, headers, 60);
		return { kind: 'retry', code: error ?? 'rate_limited', message, retryAfterS: wait, until, quota };
	}
	if (httpStatus === 409 && error === 'idempotency_in_progress') {
		return { kind: 'retry', code: error, message, retryAfterS: retryAfterSeconds(body, headers, 5) };
	}
	if (httpStatus === 408 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
		// generation_failed is a 502 from a lane that ran and failed; retrying
		// gives the failover chain another pass, which often lands.
		return { kind: 'retry', code: error ?? `http_${httpStatus}`, message, retryAfterS: retryAfterSeconds(body, headers, 30) };
	}
	return { kind: 'fatal', code: error ?? `http_${httpStatus}`, message };
}

async function call(
	config: ForgeConfig,
	method: 'GET' | 'POST',
	path: string,
	timeoutMs: number,
	extraHeaders: Record<string, string> = {},
	body?: Json,
): Promise<ForgeOutcome> {
	const doFetch = config.fetch ?? fetch;
	const url = `${normalizeBaseUrl(config.baseUrl)}${path}`;
	let response: Response;
	try {
		response = await doFetch(url, {
			method,
			headers: {
				authorization: `Bearer ${config.apiKey}`,
				accept: 'application/json',
				'x-forge-client': config.client ?? 'supabase',
				...(body ? { 'content-type': 'application/json' } : {}),
				...extraHeaders,
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
		return {
			kind: 'retry',
			code: timedOut ? 'timeout' : 'network',
			message: timedOut
				? `three.ws did not answer within ${Math.round(timeoutMs / 1000)}s.`
				: `Could not reach three.ws: ${err instanceof Error ? err.message : String(err)}`,
			retryAfterS: 10,
		};
	}
	let parsed: Json = {};
	const text = await response.text();
	if (text) {
		try {
			const value = JSON.parse(text);
			if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Json;
		} catch {
			parsed = { message: `three.ws answered HTTP ${response.status} with a non-JSON body.` };
		}
	}
	return classify(response.status, parsed, response.headers);
}

/**
 * Start a generation. The row id is the Idempotency-Key, so a sweep that dies
 * after submitting and is retried collects the same job instead of paying for
 * a second generation.
 */
export function submitModel(config: ForgeConfig, row: { id: string; prompt: string; tier: Tier }): Promise<ForgeOutcome> {
	const prompt = row.prompt.trim();
	if (prompt.length < 3) {
		return Promise.resolve({ kind: 'fatal', code: 'invalid_prompt', message: 'Describe one subject in at least 3 characters.' });
	}
	return call(
		config,
		'POST',
		'/api/forge',
		config.submitTimeoutMs ?? 100_000,
		{ 'idempotency-key': `supabase-${row.id}` },
		{ prompt, tier: row.tier, path: 'image', aspect_ratio: '1:1' },
	);
}

export function pollModel(config: ForgeConfig, jobId: string): Promise<ForgeOutcome> {
	return call(config, 'GET', `/api/forge?job=${encodeURIComponent(jobId)}`, config.pollTimeoutMs ?? 30_000);
}

export class GlbDownloadError extends Error {
	retryable: boolean;
	constructor(message: string, retryable: boolean) {
		super(message);
		this.name = 'GlbDownloadError';
		this.retryable = retryable;
	}
}

/** Fetch the finished GLB, checking its size and its binary glTF header. */
export async function downloadGlb(config: ForgeConfig, glbUrl: string): Promise<Uint8Array> {
	const doFetch = config.fetch ?? fetch;
	const url = new URL(glbUrl, normalizeBaseUrl(config.baseUrl)).toString();
	let response: Response;
	try {
		response = await doFetch(url, { signal: AbortSignal.timeout(90_000) });
	} catch (err) {
		throw new GlbDownloadError(`Could not download the model: ${err instanceof Error ? err.message : String(err)}`, true);
	}
	if (!response.ok) {
		throw new GlbDownloadError(`Downloading the model answered HTTP ${response.status}.`, response.status >= 500 || response.status === 429);
	}
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_GLB_BYTES) {
		throw new GlbDownloadError(`The model is ${Math.round(declared / 1048576)} MB, over the 50 MB bucket limit.`, false);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > MAX_GLB_BYTES) {
		throw new GlbDownloadError(`The model is ${Math.round(bytes.byteLength / 1048576)} MB, over the 50 MB bucket limit.`, false);
	}
	if (bytes.byteLength < 12 || bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) {
		throw new GlbDownloadError('The downloaded file is not a binary glTF (GLB).', false);
	}
	return bytes;
}
