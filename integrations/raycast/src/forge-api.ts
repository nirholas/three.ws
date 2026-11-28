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

export type CatalogKind = 'object' | 'character' | 'animation';

/** One asset as GET /api/catalog lists it. */
export interface CatalogItem {
	id: string;
	kind: CatalogKind;
	title: string;
	categories: string[];
	tags: string[];
	license: string | null;
	/** The CDN GLB, or the clip JSON for an animation. */
	url: string;
	thumb: string | null;
	bytes?: number;
	format?: string;
	duration_seconds?: number;
	rigged?: boolean;
	icon?: string;
}

export interface CatalogPage {
	items: CatalogItem[];
	/** How many assets matched the query in all. */
	matched: number;
	/** Size of the whole catalog. */
	total: number;
	/** True when no asset matched every word and these are the closest partial matches. */
	relaxed: boolean;
	nextOffset: number | null;
}

export interface CatalogSnippet {
	language: string;
	code: string;
	notes?: string[];
}

/** GET /api/catalog?id=: one asset with its links and paste-ready code. */
export interface CatalogDetail {
	item: CatalogItem;
	links: { preview?: string; download?: string; browse?: string; ar?: string };
	/** Frameworks with a snippet, the default for this kind first. */
	frameworks: string[];
	snippets: Record<string, CatalogSnippet>;
}

/** One of the signed-in user's Forge models (GET /api/forge/mine). */
export interface MyModel {
	id: string;
	title: string;
	prompt: string;
	previewImageUrl: string | null;
	visibility: 'public' | 'unlisted' | 'private';
	modelUrl: string;
	createdAt: string;
}

export interface MyModelsPage {
	models: MyModel[];
	/** Pass back as `before` for the next page; null on the last page. */
	nextBefore: string | null;
}

export const CATALOG_PAGE_SIZE = 30;
export const MY_MODELS_PAGE_SIZE = 24;

type Fetch = typeof fetch;

export const API_KEYS_URL = 'https://three.ws/dashboard/api-keys';

export interface ForgeClientOptions {
	baseUrl?: string;
	clientHandle: string;
	/** three.ws API key. Making a model needs a free account; it is sent as a bearer. */
	apiKey?: string;
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
	private readonly apiKey: string;
	private readonly fetchImpl: Fetch;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly now: () => number;

	constructor(options: ForgeClientOptions) {
		this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
		this.handle = options.clientHandle;
		this.apiKey = options.apiKey?.trim() ?? '';
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.sleep = options.sleep ?? defaultSleep;
		this.now = options.now ?? Date.now;
	}

	get hasApiKey(): boolean {
		return this.apiKey.length > 0;
	}

	/** `auth: false` keeps the key off public, account-free routes such as the catalog. */
	private async request(
		path: string,
		init?: RequestInit,
		{ auth = true }: { auth?: boolean } = {},
	): Promise<Record<string, unknown>> {
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.baseUrl}${path}`, {
				...init,
				headers: {
					accept: 'application/json',
					'x-forge-client': this.handle,
					...(auth && this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
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
				(parsed.message as string) ||
				(parsed.error_description as string) ||
				(parsed.error as string) ||
				`HTTP ${response.status}`;
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

	/** Free and public: no account needed, so the key is never sent. */
	async searchCatalog({
		query = '',
		kind,
		offset = 0,
		limit = CATALOG_PAGE_SIZE,
	}: {
		query?: string;
		kind?: CatalogKind;
		offset?: number;
		limit?: number;
	} = {}): Promise<CatalogPage> {
		const params = new URLSearchParams({ limit: String(limit) });
		const q = query.trim();
		if (q) params.set('q', q);
		if (kind) params.set('kind', kind);
		if (offset > 0) params.set('offset', String(offset));
		const result = await this.request(`/api/catalog?${params}`, undefined, { auth: false });
		if (!Array.isArray(result.items)) {
			throw new ForgeError('The catalog returned no item list.', 'bad_response');
		}
		const next = result.next_offset;
		return {
			items: result.items as CatalogItem[],
			matched: Number(result.matched) || 0,
			total: Number(result.total) || 0,
			relaxed: result.relaxed === true,
			nextOffset: typeof next === 'number' ? next : null,
		};
	}

	async catalogItem(id: string): Promise<CatalogDetail> {
		const result = await this.request(`/api/catalog?id=${encodeURIComponent(id)}`, undefined, {
			auth: false,
		});
		if (!result.item || typeof result.item !== 'object') {
			throw new ForgeError(`The catalog has no asset ${id}.`, 'not_found', 404);
		}
		const snippets = (result.snippets as Record<string, CatalogSnippet>) || {};
		const frameworks = Array.isArray(result.frameworks)
			? (result.frameworks as string[]).filter((f) => snippets[f])
			: Object.keys(snippets);
		return {
			item: result.item as CatalogItem,
			links: (result.links as CatalogDetail['links']) || {},
			frameworks,
			snippets,
		};
	}

	/** The key owner's own finished models, newest first, every visibility. */
	async listMyModels({
		before,
		limit = MY_MODELS_PAGE_SIZE,
	}: { before?: string | null; limit?: number } = {}): Promise<MyModelsPage> {
		if (!this.apiKey) {
			throw new ForgeError(
				'Add your three.ws API key to see your models.',
				'sign_in_required',
				401,
			);
		}
		const params = new URLSearchParams({ limit: String(limit) });
		if (before) params.set('before', before);
		const result = await this.request(`/api/forge/mine?${params}`);
		if (!Array.isArray(result.models)) {
			throw new ForgeError('three.ws returned no model list.', 'bad_response');
		}
		return {
			models: result.models as MyModel[],
			nextBefore: typeof result.nextBefore === 'string' ? result.nextBefore : null,
		};
	}
}

/** The key is missing, revoked, or lacks the read scope: the fix is the same. */
export function needsApiKey(error: Error): boolean {
	return (
		error instanceof ForgeError &&
		(error.code === 'sign_in_required' ||
			error.code === 'unauthorized' ||
			error.code === 'insufficient_scope' ||
			error.status === 401 ||
			error.status === 403)
	);
}
