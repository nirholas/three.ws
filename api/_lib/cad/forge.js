// CAD Forge: sentence → build123d program → real B-rep part.
//
// The loop text-to-cad popularised, run server-side: a model writes the
// program, workers/cad-forge builds it in a sandbox, and when the kernel
// rejects it the real error (kind, message, failing line) goes back to the
// model for a repair round. A design only ever reaches the user once the
// geometry kernel has accepted it, so nothing shown is a guess.
//
// The program writer is the CAD model ladder (api/_lib/cad/writer.js), which
// ends in the platform LLM chain. The builder is the worker at
// GCP_CAD_FORGE_URL.

import { writeCad } from './writer.js';
import { parseDesign } from '../../../src/cad/params.js';
import { CAD_SYSTEM, extractProgram, generateMessage, refineMessage, repairMessage } from './prompt.js';

export const MAX_REPAIRS = 3;
const BUILD_TIMEOUT_MS = 95_000;
// The whole design (every write and build) must finish inside one request.
export const FORGE_BUDGET_MS = 270_000;

export class CadForgeError extends Error {
	constructor(code, message, status = 502, detail = null) {
		super(message);
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}

export function cadWorkerConfigured() {
	return Boolean(process.env.GCP_CAD_FORGE_URL && workerKey());
}

function workerKey() {
	return process.env.CAD_FORGE_KEY || process.env.GCP_RECONSTRUCTION_KEY || '';
}

/**
 * Build a program on the worker. Resolves to the worker's verdict: either
 * { ok:true, metrics, artifacts } or { ok:false, error }. Throws CadForgeError
 * only when the worker itself is unreachable or misconfigured.
 */
export async function buildProgram(code, { fetchImpl = fetch } = {}) {
	if (!cadWorkerConfigured()) {
		throw new CadForgeError('unconfigured', 'The CAD builder is not configured on this deployment.', 503);
	}
	const base = process.env.GCP_CAD_FORGE_URL.replace(/\/+$/, '');
	let res;
	try {
		res = await fetchImpl(`${base}/build`, {
			method: 'POST',
			headers: { authorization: `Bearer ${workerKey()}`, 'content-type': 'application/json' },
			body: JSON.stringify({ code }),
			signal: AbortSignal.timeout(BUILD_TIMEOUT_MS),
		});
	} catch (err) {
		throw new CadForgeError('builder_unreachable', 'The CAD builder did not respond. Try again in a moment.', 503, err?.message);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new CadForgeError('builder_failed', 'The CAD builder could not run this build. Try again in a moment.', 503, `${res.status} ${text.slice(0, 200)}`);
	}
	return res.json();
}

async function writeProgram({ user, track, deadline }) {
	let completion;
	try {
		completion = await writeCad({ system: CAD_SYSTEM, user, deadline, track });
	} catch (err) {
		if (err?.status === 429) throw new CadForgeError('rate_limited', err.message, 429);
		throw new CadForgeError('writer_unavailable', 'The CAD program writer is busy. Try again in a moment.', 503, err?.message);
	}
	const code = extractProgram(completion?.text);
	return { code, model: completion?.model || null, provider: completion?.provider || null };
}

/**
 * Write, build and repair until the kernel accepts the design.
 *
 * @param {object} opts
 * @param {string} opts.prompt           what the user asked for
 * @param {string} [opts.baseCode]       an existing program to refine
 * @param {(event: object) => void} [opts.onEvent]  progress: writing, building, repairing
 * @param {object} [opts.track]          spend-ledger attribution
 * @returns {Promise<{ code, title, summary, params, build, attempts, model, provider }>}
 */
export async function forgeDesign({ prompt, baseCode = null, onEvent = () => {}, track = {}, buildImpl = buildProgram, writeImpl = writeProgram, budgetMs = FORGE_BUDGET_MS }) {
	const deadline = Date.now() + budgetMs;
	onEvent({ stage: 'writing', attempt: 1 });
	let written = await writeImpl({ user: baseCode ? refineMessage(prompt, baseCode) : generateMessage(prompt), track, deadline });
	const attempts = [];

	for (let attempt = 1; attempt <= MAX_REPAIRS + 1; attempt++) {
		if (!written.code) {
			attempts.push({ attempt, error: { kind: 'writer', message: 'The writer returned no program.' } });
		} else {
			onEvent({ stage: 'building', attempt });
			const build = await buildImpl(written.code);
			if (build?.ok) {
				const meta = parseDesign(written.code);
				onEvent({ stage: 'built', attempt });
				return {
					code: written.code,
					title: meta.title || titleFromPrompt(prompt),
					summary: meta.summary,
					params: meta.params,
					build,
					attempts: [...attempts, { attempt, ok: true }],
					model: written.model,
					provider: written.provider,
				};
			}
			attempts.push({ attempt, error: build?.error || { kind: 'unknown', message: 'Build failed.' } });
		}
		// A repair needs a write and a build; without ~40 s left it cannot land.
		if (attempt > MAX_REPAIRS || deadline - Date.now() < 40_000) break;
		const last = attempts[attempts.length - 1].error;
		onEvent({ stage: 'repairing', attempt: attempt + 1, error: last });
		written = written.code
			? await writeImpl({ user: repairMessage({ request: prompt, code: written.code, error: last }), track, deadline })
			: await writeImpl({ user: baseCode ? refineMessage(prompt, baseCode) : generateMessage(prompt), track, deadline });
	}

	const last = attempts[attempts.length - 1]?.error;
	throw new CadForgeError(
		'design_failed',
		'The part could not be built after several attempts. Try describing it more concretely (shape, key dimensions, features).',
		422,
		{ attempts, lastError: last },
	);
}

function titleFromPrompt(prompt) {
	const words = String(prompt).trim().split(/\s+/).slice(0, 5).join(' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}
