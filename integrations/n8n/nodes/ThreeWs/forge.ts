export const DEFAULT_BASE_URL = 'https://three.ws';
export const POLL_INTERVAL_MS = 3000;

export type Tier = 'draft' | 'standard' | 'high';

export interface ForgeJob {
	status?: string;
	glb_url?: string;
	error?: string;
	backend?: string;
	preview_image_url?: string;
}

export interface ForgeSubmission {
	job_id?: string | null;
	status?: string;
	glb_url?: string;
	backend?: string;
}

export interface HttpRequest {
	(options: {
		method: 'GET' | 'POST';
		url: string;
		headers?: Record<string, string>;
		body?: unknown;
		json: true;
		timeout?: number;
	}): Promise<unknown>;
}

export class ForgeFailure extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = 'ForgeFailure';
	}
}

export function normalizeBaseUrl(value: string | undefined): string {
	return (value?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function viewerUrl(baseUrl: string, glbUrl: string): string {
	return `${baseUrl}/viewer?src=${encodeURIComponent(glbUrl)}`;
}

export async function submitForge(
	http: HttpRequest,
	baseUrl: string,
	handle: string,
	prompt: string,
	tier: Tier,
): Promise<ForgeSubmission> {
	const trimmed = prompt.trim();
	if (trimmed.length < 3) {
		throw new ForgeFailure('Describe one subject in at least 3 characters.', 'invalid_prompt');
	}
	const result = (await http({
		method: 'POST',
		url: `${baseUrl}/api/forge`,
		headers: { 'x-forge-client': handle },
		body: { prompt: trimmed, tier, path: 'image', aspect_ratio: '1:1' },
		json: true,
		timeout: 90000,
	})) as ForgeSubmission & { error?: string; message?: string };
	if (result.error) throw new ForgeFailure(result.message || result.error, result.error);
	const cached = result.status === 'done' && Boolean(result.glb_url);
	if (!cached && !result.job_id) throw new ForgeFailure('Forge returned no job id.', 'no_job');
	return { job_id: result.job_id, status: result.status, glb_url: result.glb_url, backend: result.backend };
}

/**
 * Forge answers a prompt it already generated straight from its cache: the
 * submit response carries status done and glb_url with no job id. Otherwise poll.
 */
export async function resolveForge(
	http: HttpRequest,
	baseUrl: string,
	handle: string,
	submission: ForgeSubmission,
	timeoutMs: number,
	sleep: (ms: number) => Promise<void>,
	now: () => number = Date.now,
): Promise<ForgeJob & { glb_url: string }> {
	if (submission.status === 'done' && submission.glb_url) {
		return { status: 'done', glb_url: submission.glb_url, backend: submission.backend };
	}
	return pollForge(http, baseUrl, handle, submission.job_id as string, timeoutMs, sleep, now);
}

export async function pollForge(
	http: HttpRequest,
	baseUrl: string,
	handle: string,
	jobId: string,
	timeoutMs: number,
	sleep: (ms: number) => Promise<void>,
	now: () => number = Date.now,
): Promise<ForgeJob & { glb_url: string }> {
	const start = now();
	for (;;) {
		if (now() - start > timeoutMs) {
			throw new ForgeFailure(
				`Generation timed out after ${Math.round((now() - start) / 1000)}s. The free lane may be busy, try again or use the draft tier.`,
				'timeout',
			);
		}
		let job: ForgeJob | undefined;
		let failure: unknown;
		try {
			job = (await http({
				method: 'GET',
				url: `${baseUrl}/api/forge?job=${encodeURIComponent(jobId)}`,
				headers: { 'x-forge-client': handle },
				json: true,
				timeout: 60000,
			})) as ForgeJob;
		} catch (error) {
			failure = error;
		}
		if (!job) {
			const status =
				(failure as { httpCode?: string })?.httpCode ??
				String((failure as { statusCode?: number })?.statusCode ?? '');
			if (['502', '503', '504'].includes(status)) {
				await sleep(POLL_INTERVAL_MS);
				continue;
			}
			throw new ForgeFailure(
				failure instanceof Error ? failure.message : 'Could not read the Forge job status.',
				'poll_failed',
			);
		}
		if (job.status === 'done' && job.glb_url) return { ...job, glb_url: job.glb_url };
		if (job.status === 'failed') throw new ForgeFailure(job.error || 'Generation failed.', 'failed');
		await sleep(POLL_INTERVAL_MS);
	}
}

export interface McpCallResult {
	content?: Array<{ type: string; text?: string }>;
	structuredContent?: unknown;
	isError?: boolean;
}

export async function callMcpTool(
	http: HttpRequest,
	baseUrl: string,
	tool: string,
	args: Record<string, unknown>,
): Promise<McpCallResult> {
	const response = (await http({
		method: 'POST',
		url: `${baseUrl}/api/mcp-studio`,
		headers: { accept: 'application/json, text/event-stream' },
		body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } },
		json: true,
		timeout: 120000,
	})) as { result?: McpCallResult; error?: { code: number; message: string } };
	if (response.error) throw new ForgeFailure(response.error.message, `mcp_${response.error.code}`);
	if (!response.result) throw new ForgeFailure('The MCP server returned no result.', 'mcp_empty');
	return response.result;
}
