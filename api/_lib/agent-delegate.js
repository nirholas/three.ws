import { sql } from './db.js';
import { normalizeLegacyPolicy } from './embed-policy.js';
import { llmComplete } from './llm.js';

export class AgentNotFoundError extends Error {
	constructor(agentId) {
		super('target agent not found');
		this.name = 'AgentNotFoundError';
		this.agentId = agentId;
	}
}

/**
 * Run a single LLM turn AS the target agent: load its manifest (system prompt +
 * configured model) and answer `message`. The delegated turn has no tool access,
 * so it cannot itself delegate — recursion is structurally impossible here.
 *
 * Transport concerns (auth, rate limiting, recursion-depth header) are enforced
 * by callers at their boundary, not in this shared core.
 *
 * @param {{ toAgentId: string, message: string, callerUserId?: string|null }} params
 * @returns {Promise<{ response: string, agentId: string, model: string }>}
 * Unpublished agents are private (their instructions are the system prompt), so
 * only their owner (`callerUserId`) may drive them; anyone else gets the same
 * not-found as a missing agent.
 * @throws {AgentNotFoundError} when no live agent matches `toAgentId`
 * @throws {import('./llm.js').LlmUnavailableError} when no LLM provider is configured
 */
export async function runAgentDelegation({ toAgentId, message, callerUserId = null }) {
	const [agent] = await sql`
		SELECT id, name, description, embed_policy, meta
		FROM agent_identities
		WHERE id = ${toAgentId} AND deleted_at IS NULL
			AND (is_published = true OR user_id = ${callerUserId})
	`;
	if (!agent) throw new AgentNotFoundError(toAgentId);

	const policy = normalizeLegacyPolicy(agent.embed_policy);
	const model = policy?.brain?.model || 'claude-haiku-4-5-20251001';
	const systemPrompt =
		agent.meta?.brain?.instructions ||
		`You are ${agent.name}. ${agent.description || ''}`.trim();

	const result = await llmComplete({
		system: systemPrompt,
		user: message,
		maxTokens: 1024,
		// Free providers serve first; if every one fails, the paid backstop
		// uses the agent's chosen Claude model on the platform key.
		anthropicModel: model,
		track: { agentId: toAgentId, tool: 'agent.delegate' },
	});
	return { response: result.text, agentId: toAgentId, model: result.model };
}
