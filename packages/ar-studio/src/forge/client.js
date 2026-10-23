// Text-to-3D generation for the studio.
//
// Wraps the three.ws 3D Studio MCP connector: the free, keyless pipeline behind
// the ChatGPT 3D Studio) into one promise-shaped call with live progress.
// Create a client with createForgeClient(), then await its generate(prompt,
// { onProgress }) method; onProgress receives each status update.
//   // → { src, title, viewerUrl, arUrl, kind, prompt }
//
// Long jobs are handled the way the protocol intends: the first call either
// returns the finished model or a `pending` job handle, and this client polls the
// connector's own `check_job` tool until it lands. Nothing is faked: no timer
// pretends to be progress, and the ETA shown is the one the API reported.
//
// Point `endpoint` at any MCP server exposing a compatible generate tool and the
// studio generates from your pipeline instead.

import { createMcpClient, unwrapToolResult } from './mcp-http.js';
import { stageNarration, promptTitle } from './narration.js';
import { validatePrompt } from './safety.js';
import { THREE_WS } from '../config.js';

/** Tool name per generation kind, on the three.ws connector. */
export const GENERATE_TOOLS = {
	model: 'forge_free',   // a prop or object
	avatar: 'text_to_avatar', // a character; rigged avatars idle and animate in-scene
	mesh: 'mesh_forge',    // art-directed mesh, prompt refined by a director model first
};

export class ForgeError extends Error {
	constructor(message, code = 'failed') {
		super(message);
		this.name = 'ForgeError';
		this.code = code;
	}
}

/**
 * @param {object} [opts]
 * @param {string} [opts.endpoint]  MCP endpoint. Defaults to the free three.ws connector.
 * @param {'model'|'avatar'|'mesh'} [opts.kind]
 * @param {'draft'|'standard'|'high'} [opts.tier]
 * @param {number} [opts.timeoutMs]  Give up after this long (default 5 min).
 * @param {number} [opts.pollMs]     Gap between check_job polls (default 3 s).
 * @param {Record<string,string>} [opts.headers]
 * @param {Record<string,string>} [opts.tools]  Override the tool name per kind.
 */
export function createForgeClient({
	endpoint = THREE_WS.studioMcp,
	kind = 'model',
	tier = 'standard',
	timeoutMs = 300000,
	pollMs = 3000,
	headers,
	tools = GENERATE_TOOLS,
	fetchImpl,
} = {}) {
	const mcp = createMcpClient({ endpoint, headers, fetchImpl });

	/**
	 * Generate one model.
	 *
	 * @param {string} prompt
	 * @param {object} [opts]
	 * @param {(state: {status: string, message: string, elapsedMs: number, etaSeconds: number|null}) => void} [opts.onProgress]
	 * @param {'model'|'avatar'|'mesh'} [opts.kind]
	 * @param {string} [opts.imageUrl]  Reference image (avatar/mesh kinds).
	 * @param {AbortSignal} [opts.signal]
	 * @returns {Promise<{src:string,title:string,kind:string,prompt:string,viewerUrl:string,arUrl:string,poster:string}>}
	 */
	async function generate(prompt, {
		onProgress, kind: kindOverride, imageUrl = '', signal, tier: tierOverride,
	} = {}) {
		const check = validatePrompt(prompt);
		if (!check.ok) throw new ForgeError(check.reason, check.category || 'invalid_prompt');
		const text = check.prompt;
		const useKind = kindOverride || kind;
		const tool = tools[useKind] || tools.model;
		const started = Date.now();
		let etaSeconds = null;

		const report = (status, extra = {}) => {
			if (!onProgress) return;
			onProgress({
				status,
				message: stageNarration({ status, etaSeconds, ...extra }),
				elapsedMs: Date.now() - started,
				etaSeconds,
			});
		};

		report('submitting');
		const args = useKind === 'model'
			? { prompt: text, ...(tierOverride || tier ? { tier: tierOverride || tier } : {}) }
			: { prompt: text, ...(imageUrl ? { image_url: imageUrl } : {}) };

		let result = unwrapToolResult(await mcp.callTool(tool, args, { signal }));
		if (result.isError) throw new ForgeError(result.structured?.message || result.text || 'Generation failed.');

		// A job that outlives the connector's inline wait budget hands back a poll
		// handle; collect it through the server's own check_job tool.
		let data = result.structured || {};
		while (data.status === 'pending' && data.jobId) {
			if (Date.now() - started > timeoutMs) {
				throw new ForgeError('Generation timed out. Try a simpler, single-object prompt.', 'timeout');
			}
			etaSeconds = Number(data.etaRemainingSeconds) > 0 ? Number(data.etaRemainingSeconds) : null;
			report('queued');
			await delay(pollMs, signal);
			result = unwrapToolResult(await mcp.callTool('check_job', { job_id: data.jobId }, { signal }));
			if (result.isError) throw new ForgeError(result.structured?.message || result.text || 'Generation failed.');
			data = result.structured || {};
		}

		const src = firstString(data.glbUrl, data.glb_url, data.url);
		if (!src) throw new ForgeError(result.text || 'The generator returned no model.', 'no_result');
		report('done');

		return {
			src,
			title: promptTitle(text),
			prompt: text,
			kind: useKind,
			viewerUrl: firstString(data.viewerUrl, ''),
			arUrl: firstString(data.arUrl, ''),
			poster: firstString(data.referenceImageUrl, ''),
			rigged: Boolean(data.rigged),
		};
	}

	return { generate, mcp, endpoint };
}

function firstString(...vals) {
	for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
	return '';
}

function delay(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new ForgeError('Cancelled.', 'aborted'));
		const t = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(t);
			reject(new ForgeError('Cancelled.', 'aborted'));
		}, { once: true });
	});
}
