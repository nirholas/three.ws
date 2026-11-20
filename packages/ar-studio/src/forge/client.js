// Text-to-3D generation for the studio.
//
// Wraps the three.ws 3D Studio MCP connector (the free pipeline behind the
// ChatGPT 3D Studio) into one promise-shaped call with live progress. Making a
// model there needs a free three.ws account: pass a three.ws API key as
// `apiKey` (sent as `Authorization: Bearer <key>`), or point `endpoint` at your
// own server route that adds it. Without one the connector refuses the call and
// generate() rejects with a ForgeError whose code is `sign_in_required`.
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

const API_KEYS_URL = `${THREE_WS.origin}/dashboard/api-keys`;

/** The ForgeError for a tool result, naming the fix when the connector wants an account. */
function resultError(result, fallback) {
	const data = result.structured || {};
	if (data.status === 'sign_in_required') {
		const err = new ForgeError(
			'Making a 3D model needs a free three.ws account, and this studio has no three.ws API key set up. '
			+ 'Pick a ready-made model from Add instead.',
			'sign_in_required',
		);
		err.apiKeysUrl = typeof data.api_keys_url === 'string' && data.api_keys_url ? data.api_keys_url : API_KEYS_URL;
		return err;
	}
	return new ForgeError(data.message || result.text || fallback);
}

/** Call a tool, turning a refused key (HTTP 401) into the same actionable error. */
async function callTool(mcp, name, args, signal) {
	try {
		return unwrapToolResult(await mcp.callTool(name, args, { signal }));
	} catch (err) {
		if (err?.status !== 401) throw err;
		const refused = new ForgeError(
			'This studio\'s three.ws API key was refused. Making a 3D model needs a valid key from a free three.ws account.',
			'sign_in_required',
		);
		refused.apiKeysUrl = API_KEYS_URL;
		throw refused;
	}
}

/**
 * @param {object} [opts]
 * @param {string} [opts.endpoint]  MCP endpoint. Defaults to the free three.ws connector.
 * @param {string} [opts.apiKey]    A three.ws API key, sent as a bearer. Making a model there needs one.
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
	apiKey = '',
	headers,
	tools = GENERATE_TOOLS,
	fetchImpl,
} = {}) {
	const key = typeof apiKey === 'string' ? apiKey.trim() : '';
	const mcp = createMcpClient({
		endpoint,
		headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(headers || {}) },
		fetchImpl,
	});

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

		let result = await callTool(mcp, tool, args, signal);
		if (result.isError) throw resultError(result, 'Generation failed.');

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
			result = await callTool(mcp, 'check_job', { job_id: data.jobId }, signal);
			if (result.isError) throw resultError(result, 'Generation failed.');
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
