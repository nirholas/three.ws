// The one place this extension talks to the three.ws studio.
//
// Everything goes through POST /api/mcp-studio, the public JSON-RPC endpoint
// behind the free text to 3D lane: no API key, no account, no payment. The
// origin is a setting so the same code drives a local dev server or a preview
// deployment without a rebuild.

/** Tools this extension calls, with the argument each one takes. */
export const TOOLS = Object.freeze({
	model: 'forge_free',
	avatar: 'text_to_avatar',
	rig: 'rig_mesh',
	refine: 'refine_model',
	check: 'check_job',
});

/**
 * Pull the model out of a tools/call result.
 *
 * The studio answers with `structuredContent` when it has a model, and with
 * `content[]` text blocks when it has something to say instead (a refusal, a
 * provider error). Both shapes are handled so a lane change upstream degrades
 * to a readable message rather than "undefined".
 *
 * @param {any} result
 * @returns {{ glbUrl: string, viewerUrl?: string, format?: string, prompt?: string }}
 */
export function readModelResult(result) {
	if (!result || typeof result !== 'object') {
		throw new Error('the studio returned an empty response');
	}
	const structured = result.structuredContent;
	const glbUrl = structured?.glbUrl || structured?.glb_url;
	if (typeof glbUrl === 'string' && /^https?:\/\//.test(glbUrl)) {
		return {
			glbUrl,
			viewerUrl: structured.viewerUrl || structured.viewer_url,
			format: structured.format || 'glb',
			prompt: structured.prompt,
		};
	}
	const text = textOf(result);
	if (result.isError) throw new Error(text || 'the studio refused the request');
	// A successful call with no model is still a failure for the caller; surface
	// whatever the studio said rather than an empty viewer.
	throw new Error(text || 'the studio returned no model URL');
}

/** Join every text block of an MCP result into one message. */
export function textOf(result) {
	const blocks = Array.isArray(result?.content) ? result.content : [];
	return blocks
		.map((b) => (typeof b?.text === 'string' ? b.text.trim() : ''))
		.filter(Boolean)
		.join('\n')
		.slice(0, 2000);
}

/**
 * Read a tools/call result that may be a pending job rather than a model.
 *
 * Since the studio answers a plain JSON call within 40 s, a render that runs
 * longer comes back as a success carrying a job handle, not a model. That handle
 * is collected with check_job; nothing about it is an error.
 *
 * @param {any} result
 * @returns {{ pending: true, jobId: string, stage: string|null, next: string|null, etaSeconds: number|null, watchUrl: string|null, message: string }
 *   | { pending?: false, glbUrl: string, viewerUrl?: string, format?: string, prompt?: string }}
 */
export function readToolResult(result) {
	const structured = result?.structuredContent;
	if (structured?.status === 'pending' && (structured.jobId || structured.job_id)) {
		const eta = Number(structured.etaRemainingSeconds ?? structured.eta_seconds);
		return {
			pending: true,
			jobId: String(structured.jobId || structured.job_id),
			stage: typeof structured.stage === 'string' ? structured.stage : null,
			next: typeof structured.next === 'string' ? structured.next : null,
			etaSeconds: Number.isFinite(eta) && eta > 0 ? Math.round(eta) : null,
			watchUrl: typeof structured.viewer_url === 'string' ? structured.viewer_url : null,
			message: textOf(result).split('\n')[0] || 'still rendering',
		};
	}
	return readModelResult(result);
}

/** How long to wait between check_job calls, and how long a job may run in total. */
const CHECK_POLL_MS = 8000;
const JOB_TIMEOUT_MS = 10 * 60_000;

/**
 * Call one studio tool and return its model, collecting a pending job.
 *
 * `onStatus` hears the studio's own words for every pending state (stage, the
 * live ETA), so a caller can show honest queue status instead of a spinner.
 *
 * @param {string} origin
 * @param {string} name tool name, see TOOLS
 * @param {Record<string, unknown>} args
 * @param {{ signal?: AbortSignal, timeoutMs?: number, pollMs?: number,
 *   onStatus?: (status: { jobId: string, stage: string|null, etaSeconds: number|null, watchUrl: string|null, message: string }) => void }} [opts]
 */
export async function callTool(origin, name, args, opts = {}) {
	const { signal, timeoutMs, pollMs = CHECK_POLL_MS, onStatus } = opts;
	const payload = await rpc(origin, toolCall(name, args), { signal, timeoutMs });
	let result = readToolResult(payload.result);
	const deadline = Date.now() + JOB_TIMEOUT_MS;
	while (result.pending) {
		onStatus?.(statusOf(result));
		if (Date.now() > deadline) {
			throw new Error(`the job is still rendering after ten minutes; it keeps running at ${result.watchUrl || 'three.ws'}`);
		}
		await sleep(pollMs, signal);
		result = await checkOnce(origin, result, { signal, pollMs });
	}
	return result;
}

/** One check_job round trip; a check that failed while the job is fine stays pending. */
async function checkOnce(origin, pending, { signal, pollMs }) {
	const payload = await rpc(origin, toolCall(TOOLS.check, { job_id: pending.jobId }), { signal });
	const structured = payload.result?.structuredContent;
	if (payload.result?.isError && structured?.retryable) {
		const wait = Number(structured.retry_after) > 0 ? Number(structured.retry_after) * 1000 : pollMs;
		await sleep(Math.min(wait, 30_000), signal);
		return { ...pending, message: 'checking on the job again' };
	}
	return readToolResult(payload.result);
}

function statusOf(pending) {
	return {
		jobId: pending.jobId,
		stage: pending.stage,
		etaSeconds: pending.etaSeconds,
		watchUrl: pending.watchUrl,
		message: pending.message,
	};
}

/** A tools/call request body. */
export function toolCall(name, args) {
	return { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } };
}

/** Resolve after `ms`, or reject with "cancelled" when the signal aborts first. */
export function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new Error('cancelled'));
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error('cancelled'));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/** Raw JSON-RPC call with a timeout, an abort hook, and readable errors. */
export async function rpc(origin, body, { signal, timeoutMs = 6 * 60_000 } = {}) {
	const url = new URL('/api/mcp-studio', normalizeOrigin(origin)).href;
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (signal) {
		if (signal.aborted) controller.abort();
		else signal.addEventListener('abort', onAbort, { once: true });
	}
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let res;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch (err) {
		if (controller.signal.aborted && !signal?.aborted) {
			throw new Error(`the studio did not answer within ${Math.round(timeoutMs / 1000)}s`);
		}
		throw new Error(`could not reach ${url}: ${err?.message || err}`);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}

	const text = await res.text();
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error(`the studio returned ${res.status} with a non-JSON body`);
	}
	if (payload.error) {
		throw new Error(payload.error.message || `the studio returned error ${payload.error.code}`);
	}
	if (!res.ok) {
		throw new Error(`the studio returned HTTP ${res.status}`);
	}
	return payload;
}

/** Trim a trailing slash and reject anything that is not an http(s) origin. */
export function normalizeOrigin(raw) {
	const origin = String(raw || '').trim().replace(/\/+$/, '');
	if (!/^https?:\/\//.test(origin)) {
		throw new Error(`threews3d.origin must be an http(s) origin, got "${raw}"`);
	}
	return origin;
}

/** A short, honest progress line for a pending job, from the studio's own facts. */
export function describeStatus(status) {
	if (/waking up/i.test(status?.message || '')) {
		return 'the GPU worker is waking up; rendering starts the moment it answers';
	}
	const what = status?.stage === 'rig' ? 'rigging the mesh' : 'rendering the mesh';
	return status?.etaSeconds ? `${what}, about ${status.etaSeconds}s to go` : `${what} (heavier models take a few minutes)`;
}
