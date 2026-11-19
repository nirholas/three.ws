// Pipeline engine — the stage registry + poll-driven state machine behind
// POST /api/x402/pipeline (the "asset factory": one paid call runs a validated
// chain of stages and returns a game-ready GLB).
//
// Design constraints that shape everything here:
//   • Vercel functions are stateless and there is NO background worker. A chain
//     of slow GPU stages (generate → rig → optimize) therefore cannot run inline
//     after the response. Instead the chain is a STATE MACHINE advanced by the
//     free poll route: each GET /api/forge?job=<pipeline-token> poll checks the
//     current running stage and, when it finishes, submits the next one. The
//     buyer polls for free until the last stage delivers.
//   • Every stage ultimately submits to the same provider modules the standalone
//     forge routes use (NVIDIA/Replicate/GCP Cloud Run workers), so we call those
//     provider modules directly rather than the HTTP wrapper routes — this module
//     does not depend on any x402 wrapper route existing.
//   • Only stages whose backing module is actually configured are offered. The
//     grammar (the set of valid stage ids) is computed from env per request, so a
//     deployment missing GCP_STYLIZE_URL simply doesn't advertise `stylize`.
//
// Failure semantics: a stage failing mid-chain marks the job `failed` at that
// stage while the already-completed stages' outputs stay in the record (partial
// value, honestly labeled). Anything checkable up front — grammar, inputs, and
// per-stage lane availability — is rejected by validateChain BEFORE any payment,
// and the first stage is submitted BEFORE settlement so a dead first lane never
// charges (see api/x402/pipeline.js).

import { json } from './http.js';
import { priceFor } from './x402-prices.js';
import { resolveTier } from './forge-tiers.js';
import { CANONICAL_ORDER, PIPELINE_OPTIONS_SCHEMA, optionValue } from './pipeline-listing.js';
import { decodeJobToken } from './forge-job-token.js';
import { sanitizeJobError } from './provider-job-error.js';
import { createRegenProvider as createGcpProvider } from '../_providers/gcp.js';
import { createRegenProvider as createReplicateProvider } from '../_providers/replicate.js';
import {
	getPipelineJob,
	savePipelineJob,
	acquireAdvanceLock,
	isTerminal,
	publicView,
} from './pipeline-store.js';

// Canonical stage order (defined in pipeline-listing.js). A requested chain
// must be a SUBSEQUENCE of this list, and that single rule enforces "generate is
// first" and rejects nonsensical orders (e.g. rig before generate, stylize
// before rig) without a bespoke check per pair.
export { CANONICAL_ORDER };

// Each stage's option leaves (enum or range plus default), shared with the
// published input schema so the listing cannot advertise a range the engine
// does not apply.
const OPT = PIPELINE_OPTIONS_SCHEMA.properties;

function envSet(name) {
	const v = process.env?.[name];
	return typeof v === 'string' && v.trim() !== '';
}

function nowIso() {
	return new Date().toISOString();
}

// Normalize a submitGeneration() response (which may be inline-done or a forge
// poll token) into the uniform stage handle the state machine understands.
function normalizeForgeResponse(resp) {
	if (resp?.status === 'done' && resp.glb_url) {
		return { done: true, glbUrl: resp.glb_url };
	}
	const jobId = resp?.job_id;
	if (!jobId) {
		throw Object.assign(new Error('Generation returned no job handle.'), {
			status: 502,
			code: 'submit_failed',
		});
	}
	// A signed forge token encodes {provider, taskId}; a bare id is a Replicate
	// prediction. Either way we get a (provider, upstream id) the poller can check.
	const token = decodeJobToken(jobId);
	if (token) return { done: false, provider: token.provider, extJobId: token.taskId, kind: token.kind };
	return { done: false, provider: 'replicate', extJobId: jobId };
}

// ── Stage registry ──────────────────────────────────────────────────────────
// Each stage declares: how to price it, whether its lane is configured, why it's
// off (for the storefront copy), whether it needs an input GLB, and how to submit
// it. submit() returns a uniform handle — { done:true, glbUrl } for a synchronous
// lane, or { done:false, provider, extJobId } for an async one — and THROWS on a
// submit failure so the pre-settlement first-stage submit can avoid charging.
export const STAGES = {
	generate: {
		id: 'generate',
		label: 'Generate (text → 3D)',
		priceSlug: 'pipeline-stage-generate',
		defaultAtomics: '50000', // $0.05 — matches the draft forge tier
		needsInputGlb: false,
		available() {
			return envSet('NVIDIA_API_KEY') || envSet('HF_TOKEN') || envSet('REPLICATE_API_TOKEN');
		},
		reason() {
			return 'set NVIDIA_API_KEY or HF_TOKEN (free lanes) or REPLICATE_API_TOKEN';
		},
		async submit({ prompt, options }) {
			const tier = resolveTier(options?.tier).id;
			const aspect = optionValue(OPT.aspect_ratio, options?.aspect_ratio);
			// Lazy import: the generate lane reuses the paid forge route's free-first
			// multi-lane submit, which transitively pulls in the payment SDK. Loading
			// it on demand keeps the engine module (grammar/pricing/rig/optimize) free
			// of that dependency so a chain without a generate stage never touches it.
			const { submitGeneration } = await import('../x402/forge.js');
			const resp = await submitGeneration({ prompt, imageUrls: [], isImageMode: false, aspect, tier });
			return normalizeForgeResponse(resp);
		},
	},

	rig: {
		id: 'rig',
		label: 'Auto-rig (skeleton + skin weights)',
		priceSlug: 'pipeline-stage-rig',
		defaultAtomics: '100000', // $0.10
		needsInputGlb: true,
		available() {
			return (
				(envSet('GCP_RECONSTRUCTION_KEY') && envSet('GCP_RECONSTRUCTION_URL')) ||
				(envSet('REPLICATE_API_TOKEN') && envSet('REPLICATE_RERIG_MODEL'))
			);
		},
		reason() {
			return 'set GCP_RECONSTRUCTION_URL + GCP_RECONSTRUCTION_KEY, or REPLICATE_RERIG_MODEL';
		},
		async submit({ glbUrl, options }) {
			// GCP UniRig first (self-host /rig endpoint), Replicate rerig as fallback —
			// mirrors the resolution the standalone /api/forge?action=rig route uses.
			let provider = null;
			let providerName = null;
			if (envSet('GCP_RECONSTRUCTION_KEY') && envSet('GCP_RECONSTRUCTION_URL')) {
				try {
					const gcp = createGcpProvider();
					if (gcp.supportsMode('rerig')) {
						provider = gcp;
						providerName = 'gcp';
					}
				} catch {
					/* fall through to Replicate */
				}
			}
			if (!provider && envSet('REPLICATE_API_TOKEN') && envSet('REPLICATE_RERIG_MODEL')) {
				const rep = createReplicateProvider();
				if (rep.supportsMode('rerig')) {
					provider = rep;
					providerName = 'replicate';
				}
			}
			if (!provider) {
				throw Object.assign(new Error('Auto-rigging is not configured on this deployment.'), {
					status: 501,
					code: 'stage_unconfigured',
				});
			}
			const job = await provider.submit({
				mode: 'rerig',
				sourceUrl: glbUrl,
				params: { rig_type: options?.rig?.rig_type || OPT.rig.properties.rig_type.default },
			});
			return { done: false, provider: providerName, extJobId: job.extJobId };
		},
	},

	remesh: {
		id: 'remesh',
		label: 'Remesh (retopology + PBR bake)',
		priceSlug: 'pipeline-stage-remesh',
		defaultAtomics: '80000', // $0.08
		needsInputGlb: true,
		available() {
			return envSet('GCP_REMESH_URL') && envSet('GCP_RECONSTRUCTION_KEY');
		},
		reason() {
			return 'set GCP_REMESH_URL + GCP_RECONSTRUCTION_KEY';
		},
		async submit({ glbUrl, options }) {
			const gcp = createGcpProvider();
			const o = options?.remesh || {};
			const spec = OPT.remesh.properties;
			const job = await gcp.submit({
				mode: 'remesh',
				sourceUrl: glbUrl,
				params: {
					remesh_mode: optionValue(spec.remesh_mode, o.remesh_mode),
					operation: optionValue(spec.operation, o.operation),
					target_faces: optionValue(spec.target_faces, o.target_faces),
					texture_size: optionValue(spec.texture_size, o.texture_size),
					output_format: 'glb',
				},
			});
			return { done: false, provider: 'gcp', extJobId: job.extJobId };
		},
	},

	gameready: {
		id: 'gameready',
		label: 'Game-ready (engine-budget retopo + bake)',
		priceSlug: 'pipeline-stage-gameready',
		defaultAtomics: '120000', // $0.12
		needsInputGlb: true,
		available() {
			return envSet('GCP_REMESH_URL') && envSet('GCP_RECONSTRUCTION_KEY');
		},
		reason() {
			return 'set GCP_REMESH_URL + GCP_RECONSTRUCTION_KEY';
		},
		async submit({ glbUrl, options }) {
			// Game-ready runs on the same remesh worker with an engine poly budget:
			// quad → field-aligned QuadriFlow retopo, tri → silhouette low-poly.
			const gcp = createGcpProvider();
			const o = options?.gameready || {};
			const spec = OPT.gameready.properties;
			const remeshMode = optionValue(spec.topology, o.topology) === 'tri' ? 'lowpoly' : 'quad';
			const job = await gcp.submit({
				mode: 'remesh',
				sourceUrl: glbUrl,
				params: {
					remesh_mode: remeshMode,
					operation: 'full',
					target_faces: optionValue(spec.poly_budget, o.poly_budget),
					texture_size: optionValue(spec.texture_size, o.texture_size),
					output_format: 'glb',
				},
			});
			return { done: false, provider: 'gcp', extJobId: job.extJobId };
		},
	},

	stylize: {
		id: 'stylize',
		label: 'Stylize (geometric filter)',
		priceSlug: 'pipeline-stage-stylize',
		defaultAtomics: '60000', // $0.06
		needsInputGlb: true,
		available() {
			return envSet('GCP_STYLIZE_URL') && envSet('GCP_RECONSTRUCTION_KEY');
		},
		reason() {
			return 'set GCP_STYLIZE_URL + GCP_RECONSTRUCTION_KEY';
		},
		async submit({ glbUrl, options }) {
			const gcp = createGcpProvider();
			const o = options?.stylize || {};
			const job = await gcp.submit({
				mode: 'stylize',
				sourceUrl: glbUrl,
				params: {
					style: optionValue(OPT.stylize.properties.style, o.style),
					resolution: Number.isFinite(Number(o.resolution)) ? Number(o.resolution) : null,
					output_format: 'glb',
				},
			});
			return { done: false, provider: 'gcp', extJobId: job.extJobId };
		},
	},
};

export const STAGE_IDS = Object.keys(STAGES);

// The stages this deployment can actually run, in canonical order.
export function availableStages() {
	return CANONICAL_ORDER.filter((id) => STAGES[id].available());
}

// A machine- and human-readable description of the grammar: which stages are
// live, which are excluded and why. Feeds the storefront description + GET.
export function stageGrammar() {
	const available = [];
	const excluded = [];
	for (const id of CANONICAL_ORDER) {
		const s = STAGES[id];
		const entry = { id, label: s.label, price_usdc: priceUsdcForStage(id) };
		if (s.available()) available.push(entry);
		else excluded.push({ ...entry, reason: s.reason() });
	}
	return {
		order: CANONICAL_ORDER,
		available,
		excluded,
		grammar: 'stages is an ordered subsequence of ' + JSON.stringify(CANONICAL_ORDER) +
			'. generate must be first and requires prompt; without generate, glb_url is required.',
	};
}

// ── Pricing ─────────────────────────────────────────────────────────────────
export function priceAtomicsForStage(id) {
	const s = STAGES[id];
	return priceFor(s.priceSlug, s.defaultAtomics);
}

function atomicsToUsdc(atomics) {
	// USDC has 6 decimals. Format without floating error.
	const n = BigInt(atomics);
	const whole = n / 1000000n;
	let frac = (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
	// Always show at least cents (0.1 → 0.10, whole dollars → .00).
	if (frac.length < 2) frac = frac.padEnd(2, '0');
	return `${whole}.${frac}`;
}

export function priceUsdcForStage(id) {
	return atomicsToUsdc(priceAtomicsForStage(id));
}

// Total price for a chain = sum of its stages' prices. Returns BigInt-safe
// atomics string + a display USDC string.
export function priceForChain(stages) {
	let total = 0n;
	for (const id of stages) total += BigInt(priceAtomicsForStage(id));
	const atomics = total.toString();
	return { atomics, usdc: atomicsToUsdc(atomics) };
}

// ── Grammar validation ──────────────────────────────────────────────────────
// Validates a requested chain against the live grammar. Returns { ok, stages }
// or { ok:false, status, code, message }. Pure — no I/O, so it's safe to run
// before any payment.
export function validateChain(rawStages, { hasPrompt, hasGlb } = {}) {
	if (!Array.isArray(rawStages) || rawStages.length === 0) {
		return bad('invalid_stages', 'stages must be a non-empty array of stage ids.');
	}
	if (rawStages.length > CANONICAL_ORDER.length) {
		return bad('invalid_stages', `A chain has at most ${CANONICAL_ORDER.length} stages.`);
	}
	const stages = [];
	const seen = new Set();
	for (const raw of rawStages) {
		if (typeof raw !== 'string' || !STAGE_IDS.includes(raw)) {
			return bad(
				'unknown_stage',
				`Unknown stage "${raw}". Valid stages: ${availableStages().join(', ') || '(none configured)'}.`,
			);
		}
		if (seen.has(raw)) return bad('duplicate_stage', `Stage "${raw}" is listed more than once.`);
		if (!STAGES[raw].available()) {
			return bad(
				'stage_unavailable',
				`Stage "${raw}" is not available on this deployment (${STAGES[raw].reason()}).`,
			);
		}
		seen.add(raw);
		stages.push(raw);
	}
	// Order must be a subsequence of the canonical order.
	let cursor = -1;
	for (const id of stages) {
		const at = CANONICAL_ORDER.indexOf(id);
		if (at <= cursor) {
			return bad(
				'invalid_order',
				`Invalid stage order. Stages must follow ${JSON.stringify(CANONICAL_ORDER)} (generate first).`,
			);
		}
		cursor = at;
	}
	// Input requirements.
	const first = stages[0];
	if (first === 'generate') {
		if (!hasPrompt) return bad('missing_prompt', 'The generate stage requires a `prompt`.');
	} else if (!hasGlb) {
		return bad('missing_glb_url', 'Without a generate stage, a `glb_url` input is required.');
	}
	return { ok: true, stages };

	function bad(code, message) {
		return { ok: false, status: 400, code, message };
	}
}

// ── Stage submit / poll ─────────────────────────────────────────────────────
// Raw submit for one stage. THROWS on failure (used pre-settlement for the first
// stage so a dead lane never charges).
export async function submitStage(stageId, { prompt, glbUrl, options }) {
	return STAGES[stageId].submit({ prompt, glbUrl, options });
}

// Poll one stage's async handle via the provider that owns it. Returns the
// provider's status result ({ status, resultGlbUrl?, error? }).
async function pollHandle(handle) {
	if (!handle?.provider) return { status: 'failed', error: 'missing stage handle' };
	switch (handle.provider) {
		case 'gcp': {
			return createGcpProvider().status(handle.extJobId);
		}
		case 'nvidia': {
			const { createNvidiaProvider } = await import('../_providers/nvidia.js');
			return createNvidiaProvider().status({ taskId: handle.extJobId });
		}
		case 'replicate':
		default: {
			return createReplicateProvider().status(handle.extJobId);
		}
	}
}

// ── State machine ─────────────────────────────────────────────────────────────
// Submit stage `idx` and record the result on the job. On a submit failure the
// job is marked failed at that stage (partial-failure semantics: prior stages'
// outputs are preserved). A synchronous stage completion chains straight into
// the next stage. Mutates and returns `job`.
export async function submitStageInto(job, idx) {
	const stage = job.stages[idx];
	const inputGlb = idx === 0 ? job.input_glb_url : job.stages[idx - 1].output_url;
	stage.started_at = stage.started_at || nowIso();
	let handle;
	try {
		handle = await submitStage(stage.id, { prompt: job.prompt, glbUrl: inputGlb, options: job.options });
	} catch (err) {
		stage.status = 'failed';
		stage.finished_at = nowIso();
		stage.error = sanitizeJobError(err?.message) || 'This stage could not start.';
		stage.handle = null;
		job.status = 'failed';
		return job;
	}
	if (handle.done && handle.glbUrl) {
		stage.status = 'done';
		stage.finished_at = nowIso();
		stage.output_url = handle.glbUrl;
		stage.handle = null;
		job.result_glb_url = handle.glbUrl;
		if (idx + 1 >= job.stages.length) {
			job.status = 'done';
			return job;
		}
		job.status = 'running';
		return submitStageInto(job, idx + 1);
	}
	stage.status = 'running';
	stage.handle = handle;
	job.status = 'running';
	return job;
}

// Advance the pipeline by one tick: poll the current running stage and, when it
// finishes, kick the next. Mutates and returns `job`. Safe to call repeatedly;
// terminal jobs are returned unchanged.
export async function advancePipeline(job) {
	if (isTerminal(job.status)) return job;
	const idx = job.stages.findIndex((s) => s.status !== 'done' && s.status !== 'failed');
	if (idx === -1) {
		job.status = 'done';
		return job;
	}
	const stage = job.stages[idx];

	// A queued stage whose input is ready but hasn't been submitted yet.
	if (stage.status === 'queued' && !stage.handle) {
		return submitStageInto(job, idx);
	}

	// A running stage — poll it.
	let result;
	try {
		result = await pollHandle(stage.handle);
	} catch {
		// Transient poll error: leave the stage running so the next poll retries.
		return job;
	}

	if (result.status === 'done' && result.resultGlbUrl) {
		stage.status = 'done';
		stage.finished_at = nowIso();
		stage.output_url = result.resultGlbUrl;
		stage.handle = null;
		job.result_glb_url = result.resultGlbUrl;
		if (idx + 1 >= job.stages.length) {
			job.status = 'done';
			return job;
		}
		job.status = 'running';
		return submitStageInto(job, idx + 1);
	}
	if (result.status === 'failed') {
		stage.status = 'failed';
		stage.finished_at = nowIso();
		stage.error = sanitizeJobError(result.error) || 'This stage failed — the prior stage output is still available.';
		stage.handle = null;
		job.status = 'failed';
		return job;
	}
	// Still queued/running upstream.
	stage.status = 'running';
	job.status = 'running';
	return job;
}

// ── Free poll route handler ───────────────────────────────────────────────────
// Wired into GET /api/forge?job=<pipeline-token>. Loads the job, advances it one
// tick under a best-effort lock (so concurrent polls don't double-submit), and
// returns the public view + the poll url the caller keeps hitting.
export async function pollPipeline(res, id, token) {
	const job = await getPipelineJob(id);
	if (!job) {
		return json(res, 404, {
			error: 'job_not_found',
			message: 'No pipeline job for that token (it may have expired after 2 hours).',
		});
	}
	if (!isTerminal(job.status)) {
		const locked = await acquireAdvanceLock(id);
		if (locked) {
			try {
				await advancePipeline(job);
				await savePipelineJob(job);
			} catch {
				// Advance failed transiently — return the last-known snapshot; the next
				// poll retries. Never fail a poll over an advance hiccup.
			}
		}
	}
	const view = publicView(job);
	return json(res, 200, {
		...view,
		poll_url: token ? `/api/forge?job=${encodeURIComponent(token)}` : null,
	});
}
