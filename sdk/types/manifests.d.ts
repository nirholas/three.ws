export interface AgentRegistrationOptions {
	name: string;
	description: string;
	endpoint: string;
	image?: string;
	services?: unknown[];
	registrations?: unknown[];
}
export declare function agentRegistration(opts: AgentRegistrationOptions): object;

export interface AgentCardOptions {
	name: string;
	description: string;
	url: string;
	version?: string;
	org?: string;
	skills?: unknown[];
}
export declare function agentCard(opts: AgentCardOptions): object;

export interface AiPluginOptions {
	name: string;
	description: string;
	openapiUrl: string;
	logoUrl?: string;
	contactEmail?: string;
	legalUrl?: string;
}
export declare function aiPlugin(opts: AiPluginOptions): object;
