/**
 * @nirholas/agent-kit — TypeScript definitions
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ServiceEntry {
	name: string;
	endpoint: string;
	version?: string;
}

export interface SkillDefinition {
	id: string;
	name: string;
	description: string;
	tags?: string[];
	examples?: string[];
}

export interface RegistrationRecord {
	agentId: number;
	agentRegistry: string;
}

export interface RegistrationResult {
	agentId: number;
	registrationCID: string;
	txHash: string;
}

export type StatusCallback = (message: string) => void;
export type MessageHandler = (text: string) => string | Promise<string>;

// ---------------------------------------------------------------------------
// AgentPanel
// ---------------------------------------------------------------------------

export interface AgentPanelOptions {
	title?: string;
	welcome?: string;
	placeholder?: string;
	onMessage?: MessageHandler;
	voice?: boolean;
}

export class AgentPanel {
	constructor(options?: AgentPanelOptions);
	mount(container: HTMLElement): this;
	open(): void;
	close(): void;
	addMessage(role: 'ak-agent' | 'ak-user' | string, text: string): void;
	dispose(): void;
}

// ---------------------------------------------------------------------------
// AgentKit — the primary API
// ---------------------------------------------------------------------------

export interface AgentKitOptions {
	/** Agent display name (required) */
	name: string;
	/** Agent public URL (required) */
	endpoint: string;
	/** What the agent does */
	description?: string;
	/** Public URL to logo/avatar */
	image?: string;
	/** Semver version string */
	version?: string;
	/** Organization name for agent-card.json */
	org?: string;
	/** A2A skill definitions */
	skills?: SkillDefinition[];
	/** Extra service entries */
	services?: ServiceEntry[];
	/** async response handler */
	onMessage?: MessageHandler;
	/** Panel welcome message */
	welcome?: string;
	/** Enable text-to-speech on replies */
	voice?: boolean;
}

export interface RegisterOptions {
	imageFile?: File;
	services?: ServiceEntry[];
	ipfsToken?: string;
	onStatus?: StatusCallback;
}

export interface ManifestsOptions {
	openapiUrl?: string;
	registrations?: RegistrationRecord[];
}

export interface ManifestsResult {
	agentRegistration: AgentRegistrationDocument;
	agentCard: AgentCardDocument;
	aiPlugin: AiPluginDocument;
}

export class AgentKit {
	constructor(options: AgentKitOptions);
	mount(container?: HTMLElement): this;
	open(): this;
	close(): this;
	addMessage(role: string, text: string): this;
	register(options?: RegisterOptions): Promise<RegistrationResult>;
	manifests(options?: ManifestsOptions): ManifestsResult;
	dispose(): void;
}

// ---------------------------------------------------------------------------
// Manifest document shapes
// ---------------------------------------------------------------------------

export interface AgentRegistrationDocument {
	type: string;
	name: string;
	description?: string;
	image?: string;
	active: boolean;
	services: ServiceEntry[];
	registrations: RegistrationRecord[];
	supportedTrust: string[];
}

export interface AgentCardDocument {
	name: string;
	description?: string;
	url: string;
	provider: { organization: string; url: string };
	version: string;
	capabilities: {
		streaming: boolean;
		pushNotifications: boolean;
		stateTransitionHistory: boolean;
	};
	authentication: { schemes: string[]; credentials: null };
	defaultInputModes: string[];
	defaultOutputModes: string[];
	skills: SkillDefinition[];
}

export interface AiPluginDocument {
	schema_version: 'v1';
	name_for_human: string;
	name_for_model: string;
	description_for_human: string;
	description_for_model: string;
	auth: { type: 'none' };
	api: { type: 'openapi'; url: string };
	logo_url: string;
	contact_email: string;
	legal_info_url: string;
}

// ---------------------------------------------------------------------------
// Manifest generators (low-level)
// ---------------------------------------------------------------------------

export function agentRegistration(opts: {
	name: string;
	description?: string;
	endpoint: string;
	image?: string;
	services?: ServiceEntry[];
	registrations?: RegistrationRecord[];
}): AgentRegistrationDocument;

export function agentCard(opts: {
	name: string;
	description?: string;
	url: string;
	version?: string;
	org?: string;
	skills?: SkillDefinition[];
}): AgentCardDocument;

export function aiPlugin(opts: {
	name: string;
	description?: string;
	openapiUrl: string;
	logoUrl?: string;
	contactEmail?: string;
	legalUrl?: string;
}): AiPluginDocument;

// ---------------------------------------------------------------------------
// ERC-8004 low-level
// ---------------------------------------------------------------------------

export interface ConnectWalletResult {
	provider: unknown;
	signer: unknown;
	address: string;
	chainId: number;
}

export function connectWallet(): Promise<ConnectWalletResult>;

export function pinToIPFS(blob: Blob | File, apiToken?: string): Promise<string>;

export function buildRegistrationJSON(opts: {
	name: string;
	description?: string;
	imageCID?: string | null;
	agentId: number;
	chainId: number;
	registryAddr: string;
	services?: ServiceEntry[];
}): AgentRegistrationDocument;

export function getIdentityRegistry(chainId: number, signer: unknown): unknown;

export function registerAgent(opts: {
	name: string;
	description?: string;
	endpoint: string;
	imageFile?: File;
	services?: ServiceEntry[];
	apiToken?: string;
	onStatus?: StatusCallback;
}): Promise<RegistrationResult>;

export const IDENTITY_REGISTRY_ABI: readonly string[];
export const REPUTATION_REGISTRY_ABI: readonly string[];
export const VALIDATION_REGISTRY_ABI: readonly string[];

export interface RegistryDeployment {
	identityRegistry: string;
	reputationRegistry?: string;
	validationRegistry?: string;
}

export const REGISTRY_DEPLOYMENTS: Record<number, RegistryDeployment>;

export function agentRegistryId(chainId: number, registryAddress: string): string;
