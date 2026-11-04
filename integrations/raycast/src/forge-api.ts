export const DEFAULT_BASE_URL = 'https://three.ws';
export const POLL_INTERVAL_MS = 3000;
export const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export type Tier = 'draft' | 'standard' | 'high';

export class ForgeError extends Error {
	code: string;
	status: number;
	constructor(message: string, code = '', status = 0) {
		super(message);
		this.name = 'ForgeError';
		this.code = code;
		this.status = status;
	}
}

export interface ForgeSubmission {
	/** Absent when Forge answered from its cache; the GLB is then already in glb_url. */
	job_id?: string | null;
	glb_url?: string;
	status: string;
	backend?: string;
	tier?: string;
}

export interface ForgeJob {
	status: string;
	glb_url?: string;
	error?: string;
	backend?: string;
}

export interface ForgeResult {
	glbUrl: string;
	viewerUrl: string;
	backend?: string;
}

type Fetch = typeof fetch;

export interface ForgeClientOptions {
	baseUrl?: string;
	clientHandle: string;
	fetchImpl?: Fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function viewerUrlFor(baseUrl: string, glbUrl: string): string {
	return `${baseUrl}/viewer?src=${encodeURIComponent(glbUrl)}`;
}

export class ForgeClient {
	readonly baseUrl: string;
	private readonly handle: string;
	private readonly fetchImpl: Fetch;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly now: () => number;

	constructor(options: ForgeClientOptions) {
		this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
		this.handle = options.clientHandle;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.sleep = options.sleep ?? defaultSleep;
		this.now = options.now ?? Date.now;
	}

	private async request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.baseUrl}${path}`, {
				...init,
				headers: {
					accept: 'application/json',
					'x-forge-client': this.handle,
					...(init?.body ? { 'content-type': 'application/json' } : {}),
				},
			});
		} catch (error) {
			throw new ForgeError(
				`Could not reach ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
				'unreachable',
			);
		}
		const text = await response.text();
		let parsed: Record<string, unknown> = {};
		try {
			parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
		} catch {
			parsed = {};
		}
		if (!response.ok) {
			const message =
				(parsed.message as string) || (parsed.error as string) || `HTTP ${response.status}`;
			throw new ForgeError(message, (parsed.error as string) || '', response.status);
		}
		return parsed;
	}

	async submit(prompt: string, tier: Tier): Promise<ForgeSubmission> {
		const trimmed = prompt.trim();
		if (trimmed.length < 3) {
			throw new ForgeError(
				'Describe one subject in at least 3 characters.',
				'invalid_prompt',
			);
		}
		const result = await this.request('/api/forge', {
			method: 'POST',
			body: JSON.stringify({ prompt: trimmed, tier, path: 'image', aspect_ratio: '1:1' }),
		});
		if (typeof result.error === 'string') {
			throw new ForgeError((result.message as string) || result.error, result.error);
		}
		const cached = result.status === 'done' && typeof result.glb_url === 'string';
		if (!cached && (typeof result.job_id !== 'string' || !result.job_id)) {
			throw new ForgeError('Forge returned no job id.', 'no_job');
		}
		return result as unknown as ForgeSubmission;
	}

	async poll(
		jobId: string,
		onStatus?: (status: string, elapsedMs: number) => void,
	): Promise<ForgeResult> {
		const start = this.now();
		for (;;) {
			const elapsed = this.now() - start;
			if (elapsed > POLL_TIMEOUT_MS) {
				throw new ForgeError(
					`Generation timed out after ${Math.round(elapsed / 1000)}s.`,
					'timeout',
				);
			}
			let job: ForgeJob;
			try {
				job = (await this.request(
					`/api/forge?job=${encodeURIComponent(jobId)}`,
				)) as unknown as ForgeJob;
			} catch (error) {
				if (error instanceof ForgeError && [502, 503, 504].includes(error.status)) {
					await this.sleep(POLL_INTERVAL_MS);
					continue;
				}
				throw error;
			}
			const status = job.status || 'running';
			onStatus?.(status, elapsed);
			if (status === 'done' && job.glb_url) {
				return {
					glbUrl: job.glb_url,
					viewerUrl: viewerUrlFor(this.baseUrl, job.glb_url),
					backend: job.backend,
				};
			}
			if (status === 'failed') {
				throw new ForgeError(job.error || 'Generation failed.', 'failed');
			}
			await this.sleep(POLL_INTERVAL_MS);
		}
	}

	async generate(
		prompt: string,
		tier: Tier,
		onStatus?: (status: string, elapsedMs: number) => void,
	): Promise<ForgeResult> {
		const submission = await this.submit(prompt, tier);
		if (submission.status === 'done' && submission.glb_url) {
			return {
				glbUrl: submission.glb_url,
				viewerUrl: viewerUrlFor(this.baseUrl, submission.glb_url),
				backend: submission.backend,
			};
		}
		return this.poll(submission.job_id as string, onStatus);
	}
}
