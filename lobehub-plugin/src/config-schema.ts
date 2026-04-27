/**
 * Plugin settings schema for LobeHub configuration UI.
 */

export interface PluginSettings {
	agentId: string;
	apiOrigin: string;
}

export const DEFAULT_API_ORIGIN = 'https://3dagent.vercel.app';

export const settingsSchema = {
	agentId: {
		type: 'string' as const,
		title: 'Agent ID',
		description: 'The ID of the three.ws to render',
		placeholder: 'e.g., agent-xyz-123',
		required: true,
	},
	apiOrigin: {
		type: 'string' as const,
		title: 'API Origin',
		description: 'Base URL of the three.ws server',
		default: DEFAULT_API_ORIGIN,
		placeholder: DEFAULT_API_ORIGIN,
		required: false,
	},
};
