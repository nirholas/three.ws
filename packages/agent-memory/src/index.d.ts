// Type definitions for @three-ws/agent-memory

export declare class ThreeWsError extends Error {
	name: string;
	code: string;
	status: number | null;
	detail?: string;
	retryAfter?: number;
	body: unknown;
}

/** The README's ergonomic alias for the thrown auth/validation error — same class as `ThreeWsError`. */
export declare class MemoryError extends ThreeWsError {}

export declare class PaymentRequiredError extends ThreeWsError {
	accepts: unknown | null;
}

export declare const DEFAULT_BASE_URL: string;

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
export type MemoryTier = 'working' | 'recall' | 'archival';
export type EntityKind = 'mint' | 'ticker' | 'wallet' | 'person' | 'strategy' | 'topic';
export type RecallMatch = 'semantic' | 'lexical';

/** Realized result of the trades this memory was recalled into. `weight` is bounded to 0.65..1.35 and never zero, so a memory tied to a loss ranks lower but is still returned as a warning. */
export interface MemoryOutcome {
	weight: number;
	samples: number;
	wins: number;
	losses: number;
	netPnlUsd: number;
	lastClosedAt: string | null;
}

export interface Memory {
	id: string;
	agentId: string | null;
	type: MemoryType;
	content: string;
	tags: string[];
	context: Record<string, unknown>;
	salience: number;
	tier: MemoryTier;
	pinned: boolean;
	embedder: string | null;
	hasEmbedding: boolean;
	accessCount: number;
	isPublic: boolean;
	tokens: number;
	createdAt: number | null;
	updatedAt: number | null;
	lastAccessedAt: number | null;
	expiresAt: number | null;
	/** recall() only: cosine similarity (4-dp), or null for a lexical hit. */
	score?: number | null;
	/** recall() only: how the hit was found. */
	match?: RecallMatch;
	/** recall() only: the value hits are ordered by, `score` (or salience for a lexical hit) times `outcome.weight`. */
	rankScore?: number;
	/** recall() only: the realized-outcome weight and the evidence behind it. */
	outcome?: MemoryOutcome;
	/** The raw server payload. */
	raw: unknown;
}

export interface Entity {
	id: string;
	kind: EntityKind;
	label: string;
	salience: number | null;
	mentions: number;
	firstSeenAt: number | null;
	lastSeenAt: number | null;
	meta: Record<string, unknown>;
	raw: unknown;
}

export interface GraphEdge {
	source: string;
	target: string;
	weight: number;
}

export interface MemoryGraph {
	nodes: Entity[];
	edges: GraphEdge[];
	stats: { entities: number; edges: number };
}

export interface Context {
	entries: Memory[];
	/** Estimated tokens in the working core. */
	tokens: number;
	/** The working-core token budget (2000). */
	budget: number;
	/** tokens > budget. */
	overBudget: boolean;
	counts: { total: number; working: number; recall: number; archival: number; embedded: number };
	raw: unknown;
}

export interface RememberOptions {
	type?: MemoryType;
	tags?: string[];
	context?: Record<string, unknown>;
	salience?: number;
	pinned?: boolean;
	tier?: MemoryTier;
	/** Pass to upsert an existing memory idempotently. */
	id?: string;
	createdAt?: number | string;
	updatedAt?: number | string;
	expiresAt?: number | string;
	signal?: AbortSignal;
}

export interface RecallOptions {
	/** Max results, clamped 1..50. Default 8. */
	topK?: number;
	/** Min cosine similarity, 0..1. Default 0.25. */
	minScore?: number;
	/** Restrict to tiers, e.g. ['working', 'recall']. */
	tiers?: MemoryTier[];
	/** Restrict to one memory type. */
	type?: MemoryType;
	signal?: AbortSignal;
}

export interface ListOptions {
	type?: MemoryType;
	/** Only memories created after this epoch-ms timestamp. */
	since?: number;
	/** Max rows, <= 500. Default 200. */
	limit?: number;
	signal?: AbortSignal;
}

export interface EditChanges {
	content?: string;
	tags?: string[];
}

export interface AgentMemoryOptions {
	/** The agent these memories belong to. Required. */
	agentId: string;
	/** Bearer token for writes (server-to-server). */
	token?: string;
	/** Alias for `token`. */
	apiKey?: string;
	baseUrl?: string;
	fetch?: typeof fetch;
	headers?: Record<string, string>;
}

export interface AgentMemoryClient {
	readonly agentId: string;
	remember(content: string | (RememberOptions & { content: string }), opts?: RememberOptions): Promise<Memory>;
	recall(query: string, opts?: RecallOptions): Promise<Memory[]>;
	list(opts?: ListOptions): Promise<Memory[]>;
	graph(opts?: { signal?: AbortSignal }): Promise<MemoryGraph>;
	entities(opts?: { signal?: AbortSignal }): Promise<Entity[]>;
	memoriesFor(entityId: string, opts?: { signal?: AbortSignal }): Promise<Memory[]>;
	context(opts?: { signal?: AbortSignal }): Promise<Context>;
	pin(id: string, opts?: { signal?: AbortSignal }): Promise<Memory>;
	unpin(id: string, opts?: { signal?: AbortSignal }): Promise<Memory>;
	retier(id: string, tier: MemoryTier, opts?: { signal?: AbortSignal }): Promise<Memory>;
	setSalience(id: string, salience: number, opts?: { signal?: AbortSignal }): Promise<Memory>;
	edit(id: string, changes: EditChanges, opts?: { signal?: AbortSignal }): Promise<Memory>;
	merge(memoryIds: string[], opts?: { signal?: AbortSignal }): Promise<{ entry: Memory | null; merged: number }>;
	forget(id: string, opts?: { signal?: AbortSignal }): Promise<{ ok: boolean; id: string }>;
}

export declare function createAgentMemory(options: AgentMemoryOptions): AgentMemoryClient;

export declare class AgentMemory implements AgentMemoryClient {
	constructor(options: AgentMemoryOptions);
	readonly agentId: string;
	remember(content: string | (RememberOptions & { content: string }), opts?: RememberOptions): Promise<Memory>;
	recall(query: string, opts?: RecallOptions): Promise<Memory[]>;
	list(opts?: ListOptions): Promise<Memory[]>;
	graph(opts?: { signal?: AbortSignal }): Promise<MemoryGraph>;
	entities(opts?: { signal?: AbortSignal }): Promise<Entity[]>;
	memoriesFor(entityId: string, opts?: { signal?: AbortSignal }): Promise<Memory[]>;
	context(opts?: { signal?: AbortSignal }): Promise<Context>;
	pin(id: string, opts?: { signal?: AbortSignal }): Promise<Memory>;
	unpin(id: string, opts?: { signal?: AbortSignal }): Promise<Memory>;
	retier(id: string, tier: MemoryTier, opts?: { signal?: AbortSignal }): Promise<Memory>;
	setSalience(id: string, salience: number, opts?: { signal?: AbortSignal }): Promise<Memory>;
	edit(id: string, changes: EditChanges, opts?: { signal?: AbortSignal }): Promise<Memory>;
	merge(memoryIds: string[], opts?: { signal?: AbortSignal }): Promise<{ entry: Memory | null; merged: number }>;
	forget(id: string, opts?: { signal?: AbortSignal }): Promise<{ ok: boolean; id: string }>;
}
