// One-shot text completion over the shared tool-calling provider chain
// (../llm-tool-chain.js): free lanes first, the credits-funded Vertex anchor
// last. Used for session summaries and skill drafts, both of which are
// background work that must never fail a user request, so this returns null
// when every rung fails instead of throwing.

import { providerChain, streamRound } from '../llm-tool-chain.js';

/** Remove reasoning blocks some open models emit ahead of the answer. */
export function stripReasoning(text) {
	return String(text || '')
		.replace(/<think>[\s\S]*?<\/think>/gi, '')
		.replace(/^<think>[\s\S]*$/i, '')
		.trim();
}

/**
 * @param {Array<{role:string, content:string}>} messages
 * @param {{ temperature?: number, chain?: Array<object> }} [opts]
 * @returns {Promise<{ text: string, provider: string, model: string } | null>}
 */
export async function completeText(messages, { temperature = 0.2, chain = providerChain() } = {}) {
	for (const provider of chain) {
		try {
			const out = await streamRound(provider, { messages, tools: [], temperature });
			const text = stripReasoning(out.content);
			if (text) return { text, provider: provider.name, model: provider.catalogModel || provider.model };
		} catch (err) {
			console.warn(`[agent-learning] ${provider.name} completion failed`, String(err?.message || err).slice(0, 160));
		}
	}
	return null;
}
