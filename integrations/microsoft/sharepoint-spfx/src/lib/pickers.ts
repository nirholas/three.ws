/**
 * Turns three.ws search results into picker rows, and pasted ids or URLs into
 * directly selectable rows, for the agent and model pickers.
 */
import type { PickerItem } from './SearchPickerField';
import { AgentSummary, ModelSummary, extractThreeWsId, normalizeModelUrl, searchAgents, searchModels } from './threeWsApi';

export function agentItem(agent: AgentSummary): PickerItem {
	const conversations = agent.chatCount ? `${agent.chatCount} conversation${agent.chatCount === 1 ? '' : 's'}` : '';
	const body = agent.hasBody ? '' : 'Default avatar';
	return {
		value: agent.id,
		title: agent.name,
		subtitle: [agent.description, conversations, body].filter(Boolean).join(' · '),
		thumbnailUrl: agent.thumbnailUrl,
	};
}

export function modelItem(model: ModelSummary): PickerItem {
	return {
		value: model.id,
		title: model.title,
		subtitle: model.tags.length ? model.tags.slice(0, 4).join(', ') : model.description,
		thumbnailUrl: model.thumbnailUrl,
	};
}

export function searchAgentItems(query: string, signal: AbortSignal): Promise<PickerItem[]> {
	return searchAgents(query, { signal, limit: 20 }).then((agents) => agents.map(agentItem));
}

export function searchModelItems(query: string, signal: AbortSignal): Promise<PickerItem[]> {
	return searchModels(query, { signal, limit: 20 }).then((models) => models.map(modelItem));
}

export function resolveTypedAgent(query: string): PickerItem | undefined {
	const id = extractThreeWsId(query);
	if (!id) return undefined;
	return { value: id, title: 'Use this agent id', subtitle: id, thumbnailUrl: '' };
}

/** A pasted GLB/glTF URL or a three.ws model id or page URL. */
export function resolveTypedModel(query: string): PickerItem | undefined {
	const glb = normalizeModelUrl(query);
	if (glb) return { value: glb, title: 'Use this GLB URL', subtitle: glb, thumbnailUrl: '' };
	const id = extractThreeWsId(query);
	if (id) return { value: id, title: 'Use this three.ws model', subtitle: id, thumbnailUrl: '' };
	return undefined;
}
