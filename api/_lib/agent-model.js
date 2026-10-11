// Which model answers one message or run, and the provider chain that serves it.
//
// Every surface that talks to an agent (the v1 messages API, the MCP call_agent
// tool, the agent-screen concierge, the chat gateways, v1 runs) asks this module
// the same two questions, so a model picked in one place means the same thing
// everywhere:
//
//   1. Which model? A per-message override wins, then the agent's default, then
//      the platform's free-first chain (no model named).
//   2. Which chain? The chosen model's own routes first (model-roster.js routes
//      for an open model, its single lane otherwise), then the platform chain
//      behind them, so a dead route degrades to another model's answer instead
//      of an error.
//
// A model without tool calling is refused for runs (a run IS a tool loop) and
// allowed for chat, where the turn simply runs without tools.
//
// An agent's default model can live in three places, written by different
// surfaces over the years. They are read in this order:
//   meta.runtime.model   the v1 Agents API and the agent editor's picker
//   meta.brain.provider  the MCP create_agent tool and the brain picker
//   meta.brain.model     the old Library brain tab
// Only an id the model catalog knows counts; anything else (a retired brain
// key, a raw upstream id) is ignored and the platform chain answers.

import { MODEL_CATALOG, resolveModelId, isPaidModel } from './chat-models.js';
import { providerChain, providerChainFor } from './llm-tool-chain.js';
import { rosterTransports } from './model-routes.js';

/** A model choice the caller has to fix: unknown id, no tools for a run, sign-in needed. */
export class ModelChoiceError extends Error {
	/**
	 * @param {number} status
	 * @param {string} code
	 * @param {string} message
	 */
	constructor(status, code, message) {
		super(message);
		this.name = 'ModelChoiceError';
		this.status = status;
		this.code = code;
		this.expose = true;
	}
}

/** The catalog id for `id` (a retired id maps forward), or null when the catalog does not know it. */
export function catalogModelId(id) {
	if (typeof id !== 'string' || !id.trim()) return null;
	const resolved = resolveModelId(id.trim());
	return MODEL_CATALOG[resolved] ? resolved : null;
}

/** Whether a catalog model can call tools. */
export function modelHasTools(id) {
	const model = catalogModelId(id);
	return Boolean(model && MODEL_CATALOG[model].tools);
}

/**
 * The agent's default model, or null when it has none the catalog knows.
 * @param {object|null|undefined} meta agent_identities.meta
 */
export function agentDefaultModel(meta) {
	const m = meta && typeof meta === 'object' ? meta : {};
	for (const candidate of [m.runtime?.model, m.brain?.provider, m.brain?.model]) {
		const id = catalogModelId(candidate);
		if (id) return id;
	}
	return null;
}

/**
 * Decide the model for one message or run.
 *
 * @param {object} o
 * @param {string|null} [o.requested]   per-message (or per-run) override
 * @param {object|null} [o.agentMeta]   the agent's meta, for its default
 * @param {'chat'|'run'} [o.purpose]
 * @param {boolean} [o.signedIn]        false clamps paid models away
 * @returns {{ model: string|null, source: 'message'|'agent'|'platform', tools: boolean }}
 * @throws {ModelChoiceError}
 */
export function resolveMessageModel({ requested = null, agentMeta = null, purpose = 'chat', signedIn = true } = {}) {
	if (requested != null && requested !== '') {
		const model = catalogModelId(requested);
		if (!model) {
			throw new ModelChoiceError(400, 'unknown_model', `Unknown model "${String(requested).slice(0, 80)}". Pick an id from GET /api/models.`);
		}
		const tools = MODEL_CATALOG[model].tools === true;
		if (purpose === 'run' && !tools) {
			throw new ModelChoiceError(400, 'model_lacks_tools', `${model} has no tool calling, so it can chat but cannot run a task. Pick a model with tool support for runs.`);
		}
		if (!signedIn && isPaidModel(model)) {
			throw new ModelChoiceError(401, 'sign_in_required', `${model} is a paid model. Sign in to use it, or pick a free model.`);
		}
		return { model, source: 'message', tools };
	}

	const fallback = agentDefaultModel(agentMeta);
	if (fallback) {
		const tools = MODEL_CATALOG[fallback].tools === true;
		if (purpose === 'run' && !tools) {
			throw new ModelChoiceError(400, 'model_lacks_tools', `This agent's default model (${fallback}) has no tool calling, so it cannot run a task. Name a tool-capable model for this run, or change the agent's default.`);
		}
		// A signed-out visitor never spends the platform's paid keys, even on an
		// agent whose owner picked a paid default: the free chain answers them.
		if (!signedIn && isPaidModel(fallback)) return { model: null, source: 'platform', tools: true };
		return { model: fallback, source: 'agent', tools };
	}
	return { model: null, source: 'platform', tools: true };
}

/**
 * The provider chain for a resolved model, and whether the turn may offer tools.
 * A chat-only model leads with its own routes and runs without tools; the
 * platform chain stays behind it (also without tools for that turn) so the
 * message is still answered when every route of the model is down.
 * @param {string|null} model a catalog id, or null for the platform chain
 * @returns {{ chain: object[], tools: boolean }}
 */
export function modelChain(model) {
	if (!model) return { chain: providerChain(), tools: true };
	if (MODEL_CATALOG[model]?.tools) return { chain: providerChainFor(model), tools: true };
	const own = MODEL_CATALOG[model]?.provider === 'roster' ? rosterTransports(model) : [];
	const seen = new Set(own.map((r) => `${r.name}|${r.model}`));
	return { chain: [...own, ...providerChain().filter((p) => !seen.has(`${p.name}|${p.model}`))], tools: false };
}
