// The one function every agent-turn surface asks "which brain answers for this
// agent, and what chain serves it".
//
// api/_lib/agent-model.js decides the model (per-message override, the agent's
// saved brain, else the platform chain) and builds a provider chain for it. This
// module adds the owner's side of it: when the chosen brain is a Grok model, the
// agent's owner key (Account, AI Provider Keys) leads, then the server's xAI key,
// then the default free-first chain, so the agent always answers.
//
// It also names the rung that actually served a turn (`brainBadge`), which is
// what the agent page shows: the real lane and key source from the response,
// plus whether the answer came from a failover rung instead of the chosen brain.
//
// Surfaces on this function: the profile copilot (api/agents/copilot.js), the
// chat gateways (api/_lib/gateway/conversation.js), the agent message API and
// MCP call_agent (api/_lib/agent-message.js), v1 runs (agents-v1/runs.js) and the
// strategy loop tick. The public X reply brain plugs in the same way.

import { sql } from './db.js';
import { MODEL_CATALOG, XAI_CHAT_COMPLETIONS_URL, routableGrokModelId } from './chat-models.js';
import { loadUserProviderKeys } from './provider-keys.js';
import { resolveMessageModel, modelChain, ModelChoiceError } from './agent-model.js';

/** Whether a catalog model id is served by xAI. */
export function isGrokModel(model) {
	return Boolean(model && MODEL_CATALOG[model]?.provider === 'grok');
}

/**
 * The owner's saved xAI key, or null. A read failure answers null so the chain
 * simply continues to the server key.
 * @param {string|null|undefined} userId
 */
export async function ownerGrokKey(userId) {
	if (!userId) return null;
	try {
		const [row] = await sql`SELECT provider_keys FROM users WHERE id = ${userId}`;
		const keys = await loadUserProviderKeys(row?.provider_keys);
		return typeof keys.grok === 'string' && keys.grok ? keys.grok : null;
	} catch {
		return null;
	}
}

/** Tag every rung with where its credential comes from: the owner, the server, or the platform chain. */
function tagKeySource(chain, model) {
	return chain.map((rung) => {
		if (rung.keySource) return rung;
		const serverGrok = rung.name === 'grok' && rung.catalogModel === model;
		return { ...rung, keySource: serverGrok ? 'server' : 'platform' };
	});
}

/**
 * Build the chain for a resolved model. Grok: owner key, server key, default
 * chain. Any other model: its own routes, then the default chain.
 * @param {string|null} model catalog id or null for the platform chain
 * @param {{ ownerKey?: string|null }} [o]
 * @returns {{ chain: object[], tools: boolean }}
 */
export function brainChain(model, { ownerKey = null } = {}) {
	const base = modelChain(model);
	let chain = tagKeySource(base.chain, model);
	if (isGrokModel(model) && ownerKey && base.tools) {
		const owned = {
			name: 'grok',
			url: XAI_CHAT_COMPLETIONS_URL,
			key: ownerKey,
			model: routableGrokModelId(model),
			catalogModel: model,
			keySource: 'owner',
		};
		chain = [owned, ...chain];
	}
	return { chain, tools: base.tools };
}

/**
 * Decide the brain for one agent turn.
 *
 * @param {object} o
 * @param {{ id?: string, user_id?: string|null, meta?: object }} o.agent
 * @param {string|null} [o.requested]  per-message override
 * @param {'chat'|'run'} [o.purpose]
 * @param {boolean} [o.signedIn]       false clamps paid models away (and the owner key is not used)
 * @param {boolean} [o.lenient]        true: an agent default that cannot run tools falls back to the platform chain instead of throwing
 * @returns {Promise<{ model: string|null, source: 'message'|'agent'|'platform', tools: boolean, chain: object[] }>}
 * @throws {ModelChoiceError} an explicit override the caller has to fix
 */
export async function resolveAgentBrain({ agent, requested = null, purpose = 'chat', signedIn = true, lenient = false }) {
	let choice;
	try {
		choice = resolveMessageModel({ requested, agentMeta: agent?.meta, purpose, signedIn });
	} catch (e) {
		const fixable = lenient && !requested && e instanceof ModelChoiceError && e.code === 'model_lacks_tools';
		if (!fixable) throw e;
		choice = { model: null, source: 'platform', tools: true };
	}
	const ownerKey = signedIn && isGrokModel(choice.model) ? await ownerGrokKey(agent?.user_id) : null;
	const { chain, tools } = brainChain(choice.model, { ownerKey });
	return { model: choice.model, source: choice.source, tools: purpose === 'run' ? choice.tools : tools, chain };
}

/**
 * What the agent page shows for a served turn.
 * @param {{ model: string|null }} chosen the resolved brain
 * @param {{ provider?: string, name?: string, model?: string, catalogModel?: string, keySource?: string }|null} served the rung that answered
 * @returns {{ chosen: string|null, served: string|null, lane: string|null, keySource: string|null, failover: boolean }}
 */
export function brainBadge(chosen, served) {
	const lane = served?.provider || served?.name || null;
	const servedModel = served?.catalogModel || served?.model || null;
	const wanted = chosen?.model || null;
	return {
		chosen: wanted,
		served: servedModel,
		lane,
		keySource: served?.keySource || null,
		failover: Boolean(wanted && served && served.catalogModel !== wanted),
	};
}
