/**
 * Data layer for the three.ws SharePoint components.
 *
 * Every call goes to the public, CORS-open three.ws API with no credentials:
 *   GET /api/agents/public?q=&limit=   agent directory search
 *   GET /api/agents/:id                one agent (card and web part header)
 *   GET /api/search?type=model&q=      Forge model search (prompt, caption, tags)
 *   GET /api/forge-creation?id=        one Forge model
 *
 * The functions here are framework-free so the property pane, the web parts,
 * the Viva Connections card and the unit tests all share one implementation.
 */

export const THREE_WS_ORIGIN = 'https://three.ws';

export type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}>;

export interface RequestOptions {
	signal?: AbortSignal;
	fetchImpl?: FetchLike;
	origin?: string;
}

export interface AgentSummary {
	id: string;
	name: string;
	description: string;
	thumbnailUrl: string;
	modelUrl: string;
	pageUrl: string;
	chatCount: number;
	lastActiveAt: string;
	hasBody: boolean;
}

export interface ModelSummary {
	id: string;
	title: string;
	description: string;
	thumbnailUrl: string;
	glbUrl: string;
	pageUrl: string;
	tags: string[];
}

export class ThreeWsApiError extends Error {
	public readonly status: number;
	public constructor(message: string, status: number) {
		super(message);
		// SPFx compiles to ES5, where extending Error loses the subclass prototype.
		Object.setPrototypeOf(this, ThreeWsApiError.prototype);
		this.name = 'ThreeWsApiError';
		this.status = status;
	}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a three.ws agent or creation id (a UUID). */
export function isThreeWsId(value: string): boolean {
	return UUID_RE.test((value || '').trim());
}

/**
 * Accepts only absolute https URLs ending in .glb or .gltf (query strings
 * allowed). Anything else is refused before it reaches the viewer, so a site
 * owner cannot point the web part at a script or a page.
 */
export function normalizeModelUrl(value: string): string {
	const raw = (value || '').trim();
	if (!raw) return '';
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return '';
	}
	if (url.protocol !== 'https:') return '';
	if (!/\.(glb|gltf)$/i.test(url.pathname)) return '';
	return url.toString();
}

/**
 * Pulls a three.ws id out of what a site owner pasted: a bare id, an agent
 * page URL (/agents/<id>), or a model page URL (/m/<id>, /forge/m/<id>).
 */
export function extractThreeWsId(value: string): string {
	const raw = (value || '').trim();
	if (isThreeWsId(raw)) return raw.toLowerCase();
	const match = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
	if (!match) return '';
	try {
		const url = new URL(raw);
		if (url.hostname !== 'three.ws' && !url.hostname.endsWith('.three.ws')) return '';
	} catch {
		return '';
	}
	return match[0].toLowerCase();
}

function absolute(origin: string, value: unknown): string {
	if (typeof value !== 'string' || !value) return '';
	if (/^https:\/\//i.test(value)) return value;
	if (value.startsWith('/')) return origin + value;
	return '';
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export function toAgentSummary(raw: Record<string, unknown>, origin: string = THREE_WS_ORIGIN): AgentSummary | undefined {
	const id = text(raw.id);
	if (!isThreeWsId(id)) return undefined;
	const modelUrl = absolute(origin, raw.avatar_model_url);
	return {
		id,
		name: text(raw.name) || 'Untitled agent',
		description: text(raw.description),
		thumbnailUrl: absolute(origin, raw.avatar_thumbnail_url) || absolute(origin, raw.avatar_thumbnail),
		modelUrl,
		pageUrl: absolute(origin, raw.home_url) || `${origin}/agents/${id}`,
		chatCount: typeof raw.chat_count === 'number' ? raw.chat_count : 0,
		lastActiveAt: text(raw.last_action_at),
		hasBody: !!modelUrl,
	};
}

export function toModelSummary(raw: Record<string, unknown>, origin: string = THREE_WS_ORIGIN): ModelSummary | undefined {
	const id = text(raw.id);
	const glbUrl = normalizeModelUrl(absolute(origin, raw.glbUrl) || absolute(origin, raw.web_glb_url) || absolute(origin, raw.glb_url));
	if (!isThreeWsId(id) || !glbUrl) return undefined;
	const prompt = text(raw.title) || text(raw.prompt);
	const description = text(raw.description) || text(raw.caption);
	// Image-to-3D creations carry the literal prompt "image-to-3d"; the
	// Florence-2 caption is the better human label for those.
	const title = prompt && prompt !== 'image-to-3d' ? prompt : description || 'Untitled model';
	return {
		id,
		title,
		description: description === title ? '' : description,
		thumbnailUrl: absolute(origin, raw.image) || absolute(origin, raw.preview_image_url) || absolute(origin, raw.poster_url),
		glbUrl,
		pageUrl: absolute(origin, raw.assetUrl) || `${origin}/m/${id}`,
		tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string').slice(0, 8) : [],
	};
}

async function getJson(path: string, opts: RequestOptions): Promise<Record<string, unknown>> {
	const origin = opts.origin || THREE_WS_ORIGIN;
	const doFetch: FetchLike = opts.fetchImpl || ((input, init) => fetch(input, init));
	let res: Awaited<ReturnType<FetchLike>>;
	try {
		res = await doFetch(origin + path, { signal: opts.signal, headers: { accept: 'application/json' } });
	} catch (err) {
		if ((err as Error)?.name === 'AbortError') throw err;
		throw new ThreeWsApiError('three.ws could not be reached. Check the network connection and try again.', 0);
	}
	if (res.status === 404) throw new ThreeWsApiError('Not found on three.ws. It may have been deleted or made private.', 404);
	if (res.status === 429) throw new ThreeWsApiError('three.ws is rate limiting this network. Wait a minute and try again.', 429);
	if (!res.ok) throw new ThreeWsApiError(`three.ws answered ${res.status}. Try again in a moment.`, res.status);
	const body = await res.json();
	if (!body || typeof body !== 'object') throw new ThreeWsApiError('three.ws returned an unexpected response.', res.status);
	return body as Record<string, unknown>;
}

function asRecords(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [];
}

/** Agents with a 3D body first, then the rest; a body-less agent renders the default avatar. */
export async function searchAgents(query: string, opts: RequestOptions & { limit?: number } = {}): Promise<AgentSummary[]> {
	const limit = Math.min(Math.max(opts.limit || 12, 1), 50);
	const params = new URLSearchParams({ limit: String(limit) });
	const q = (query || '').trim();
	if (q) params.set('q', q);
	const body = await getJson(`/api/agents/public?${params.toString()}`, opts);
	const origin = opts.origin || THREE_WS_ORIGIN;
	const agents = asRecords(body.agents)
		.map((a) => toAgentSummary(a, origin))
		.filter((a): a is AgentSummary => !!a);
	return agents.filter((a) => a.hasBody).concat(agents.filter((a) => !a.hasBody));
}

export async function getAgent(id: string, opts: RequestOptions = {}): Promise<AgentSummary> {
	if (!isThreeWsId(id)) throw new ThreeWsApiError('That is not a three.ws agent id.', 400);
	const body = await getJson(`/api/agents/${encodeURIComponent(id)}`, opts);
	const agent = body.agent && typeof body.agent === 'object' ? toAgentSummary(body.agent as Record<string, unknown>, opts.origin) : undefined;
	if (!agent) throw new ThreeWsApiError('three.ws returned an agent this component cannot read.', 200);
	return agent;
}

/** Forge models matching `query`; an empty query lists the newest community models. */
export async function searchModels(query: string, opts: RequestOptions & { limit?: number } = {}): Promise<ModelSummary[]> {
	const limit = Math.min(Math.max(opts.limit || 12, 1), 50);
	const q = (query || '').trim();
	const origin = opts.origin || THREE_WS_ORIGIN;
	if (!q) {
		const body = await getJson(`/api/forge-gallery?scope=community&limit=${limit}`, opts);
		return asRecords(body.creations)
			.map((c) => toModelSummary(c, origin))
			.filter((m): m is ModelSummary => !!m);
	}
	const params = new URLSearchParams({ q, type: 'model', limit: String(limit) });
	const body = await getJson(`/api/search?${params.toString()}`, opts);
	return asRecords(body.items)
		.map((m) => toModelSummary(m, origin))
		.filter((m): m is ModelSummary => !!m);
}

export async function getModel(id: string, opts: RequestOptions = {}): Promise<ModelSummary> {
	if (!isThreeWsId(id)) throw new ThreeWsApiError('That is not a three.ws model id.', 400);
	const body = await getJson(`/api/forge-creation?id=${encodeURIComponent(id)}`, opts);
	const raw = (body.creation && typeof body.creation === 'object' ? body.creation : body) as Record<string, unknown>;
	const model = toModelSummary(raw, opts.origin);
	if (!model) throw new ThreeWsApiError('That three.ws model has no viewable GLB yet.', 200);
	return model;
}

/**
 * Human status line for an agent card: recent activity when the agent has
 * acted, otherwise how many conversations it has had.
 */
export function agentStatus(agent: Pick<AgentSummary, 'lastActiveAt' | 'chatCount'>, now: number = Date.now()): string {
	const at = agent.lastActiveAt ? Date.parse(agent.lastActiveAt) : NaN;
	if (Number.isFinite(at)) {
		const minutes = Math.max(0, Math.round((now - at) / 60000));
		if (minutes < 2) return 'Active now';
		if (minutes < 60) return `Active ${minutes} min ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `Active ${hours} h ago`;
		const days = Math.round(hours / 24);
		if (days < 30) return `Active ${days} d ago`;
	}
	if (agent.chatCount > 0) return `Ready to chat · ${agent.chatCount} conversation${agent.chatCount === 1 ? '' : 's'}`;
	return 'Ready to chat';
}

/**
 * Trailing-edge debounce that also cancels the in-flight request of the
 * previous call, so a fast typist never sees results for an older query.
 */
export function debouncedSearch<T>(
	run: (query: string, signal: AbortSignal) => Promise<T>,
	onResult: (result: { query: string; value?: T; error?: Error }) => void,
	waitMs: number = 300,
): { (query: string): void; cancel(): void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	const cancel = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		controller?.abort();
		controller = undefined;
	};
	const trigger = (query: string): void => {
		cancel();
		timer = setTimeout(() => {
			timer = undefined;
			const ctrl = new AbortController();
			controller = ctrl;
			run(query, ctrl.signal).then(
				(value) => {
					if (!ctrl.signal.aborted) onResult({ query, value });
				},
				(error: Error) => {
					if (!ctrl.signal.aborted && error?.name !== 'AbortError') onResult({ query, error });
				},
			);
		}, waitMs);
	};
	return Object.assign(trigger, { cancel });
}
