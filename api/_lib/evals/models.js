// Which model an eval runs on, pinned.
//
// The platform chain (providerChain) fails over across lanes, which is right
// for serving users and wrong for measuring: a score attributed to model A
// that was actually produced by model B after a throttle is a lie. An eval
// therefore runs on exactly ONE rung. A lane failure is an infrastructure
// error for that task (retried, then reported as `errored`), never a silent
// switch to another model.
//
// Model ids are MODEL_CATALOG ids (GET /api/v1/models), plus `vertex/<id>` for
// Gemini on Vertex AI, which is billed to the platform's GCP credits.

import { MODEL_CATALOG } from '../chat-models.js';
import { modelRung } from '../llm-tool-chain.js';
import { isFreeLane } from '../llm-pricing.js';
import { vertexGeminiAvailable, vertexGeminiChatUrl, vertexGeminiHeaders } from '../vertex-gemini.js';

const VERTEX_PREFIX = 'vertex/';
const VERTEX_MODELS = ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite', 'google/gemini-2.5-pro'];

export class ModelUnavailableError extends Error {
	constructor(model, reason) {
		super(`Model "${model}" cannot run evals here: ${reason}`);
		this.name = 'ModelUnavailableError';
		this.status = 400;
		this.code = 'model_unavailable';
		this.model = model;
	}
}

/**
 * The single provider rung serving `model`, or throw ModelUnavailableError.
 * @param {string} model
 */
export function evalRung(model) {
	if (typeof model !== 'string' || !model) throw new ModelUnavailableError(String(model), 'no model given');
	if (model.startsWith(VERTEX_PREFIX)) {
		const id = model.slice(VERTEX_PREFIX.length);
		if (!VERTEX_MODELS.includes(id)) throw new ModelUnavailableError(model, `Vertex models are ${VERTEX_MODELS.map((m) => VERTEX_PREFIX + m).join(', ')}`);
		if (!vertexGeminiAvailable()) throw new ModelUnavailableError(model, 'GOOGLE_CLOUD_PROJECT is not set');
		return { name: 'vertex-gemini', url: vertexGeminiChatUrl(), key: null, model: id, catalogModel: id, getHeaders: vertexGeminiHeaders };
	}
	const meta = MODEL_CATALOG[model];
	if (!meta) throw new ModelUnavailableError(model, 'not in the model catalog (GET /api/v1/models)');
	if (!meta.tools) throw new ModelUnavailableError(model, 'the model does not support tool calling');
	const rung = modelRung(model);
	if (!rung) throw new ModelUnavailableError(model, `no ${meta.provider} key is configured`);
	return rung;
}

/** Whether a run on this rung costs the platform nothing, or only GCP credits. */
export function isCreditSafe(rung) {
	return rung.name === 'vertex-gemini' || isFreeLane(rung.name, rung.model);
}

/**
 * Every model an eval can run on in this process: catalog tool models with a
 * configured key, then the Vertex models. `free` marks lanes that cost the
 * platform nothing; `credits` marks Vertex (GCP credits).
 */
export function listEvalModels() {
	const out = [];
	for (const [id, meta] of Object.entries(MODEL_CATALOG)) {
		if (!meta.tools || meta.moderationGated) continue;
		const rung = modelRung(id);
		if (!rung) continue;
		out.push({ id, provider: meta.provider, free: isFreeLane(rung.name, rung.model), credits: false });
	}
	if (vertexGeminiAvailable()) {
		for (const id of VERTEX_MODELS) out.push({ id: VERTEX_PREFIX + id, provider: 'vertex-gemini', free: false, credits: true });
	}
	return out;
}

/**
 * Whether a lane error is infrastructure (throttle, outage, auth, network) as
 * opposed to something the agent did. Infrastructure errors are retried and
 * reported as `errored`, never scored as a failure of the configuration.
 */
export function isInfraError(err) {
	const msg = String(err?.message || err || '');
	return /\b(4(0[13]|04|08|29)|5\d\d)\b|rate.?limit|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|socket|fetch failed|No LLM provider|credentials/i.test(msg);
}
