// Conversational refinement: carry a model forward with a described change.
//
// refine_model re-generates anchored to the parent (its prompt is folded into
// the new one) and records every version in a lineage the client passes back,
// so a sequence of refinements in the editor is one history the user can walk.

import { TOOLS, rpc, sleep, textOf, toolCall } from './studio.js';

/** The studio holds a generation open this long before it answers "pending". */
const CHECK_POLL_MS = 8000;
const CHECK_TIMEOUT_MS = 6 * 60_000;

/**
 * @typedef {object} LineageVersion
 * @property {number} index
 * @property {number|null} parentIndex
 * @property {string} glbUrl
 * @property {string|null} prompt
 * @property {string|null} instruction
 */

/**
 * @param {string} origin
 * @param {{ glbUrl: string, instruction: string, parentPrompt?: string|null, lineage?: LineageVersion[]|null }} args
 * @param {{ signal?: AbortSignal, onStatus?: (message: string) => void }} [opts]
 * @returns {Promise<{ glbUrl: string, prompt: string|null, instruction: string, lineage: LineageVersion[] }>}
 */
export async function refineModel(origin, { glbUrl, instruction, parentPrompt, lineage }, opts = {}) {
	const args = { glb_url: glbUrl, instruction };
	if (parentPrompt) args.parent_prompt = parentPrompt;
	if (Array.isArray(lineage) && lineage.length) args.parent_lineage = lineage;

	let payload = await rpc(origin, toolCall(TOOLS.refine, args), { signal: opts.signal });
	let result = readRefineResult(payload.result);

	// A slow generation comes back pending; check_job collects it once done.
	const deadline = Date.now() + CHECK_TIMEOUT_MS;
	while (result.pending) {
		if (Date.now() > deadline) throw new Error('the refinement did not finish within six minutes');
		opts.onStatus?.('still generating the new version…');
		await sleep(CHECK_POLL_MS, opts.signal);
		// The refine object goes back unchanged so the finished model joins the lineage.
		const check = result.refine ? { job_id: result.jobId, refine: result.refine } : { job_id: result.jobId };
		payload = await rpc(origin, toolCall(TOOLS.check, check), { signal: opts.signal });
		result = readRefineResult(payload.result);
	}
	return result;
}

/**
 * Pull the refined model and its lineage out of a tools/call result.
 * @param {any} result
 */
export function readRefineResult(result) {
	const structured = result?.structuredContent;
	if (structured?.status === 'pending' && structured.jobId) {
		return { pending: true, jobId: String(structured.jobId), refine: structured.refine && typeof structured.refine === 'object' ? structured.refine : null };
	}
	const glbUrl = structured?.glbUrl || structured?.glb_url;
	if (typeof glbUrl === 'string' && /^https?:\/\//.test(glbUrl)) {
		const lineage = Array.isArray(structured.lineage)
			? structured.lineage.map((v, i) => ({
					index: Number.isInteger(v.index) ? v.index : i,
					parentIndex: v.parentIndex ?? (i > 0 ? i - 1 : null),
					glbUrl: String(v.glbUrl || ''),
					prompt: v.prompt || null,
					instruction: v.instruction || null,
				}))
			: [];
		return {
			pending: false,
			glbUrl,
			prompt: typeof structured.prompt === 'string' ? structured.prompt : null,
			instruction: typeof structured.instruction === 'string' ? structured.instruction : '',
			lineage,
		};
	}
	const text = textOf(result);
	throw new Error(text || (result?.isError ? 'the studio refused the refinement' : 'the studio returned no model'));
}
