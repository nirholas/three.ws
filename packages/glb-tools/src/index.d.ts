// Type definitions for @three-ws/glb-tools

export declare class ThreeWsError extends Error {
	name: string;
	code: string;
	status: number | null;
	detail?: string;
	retryAfter?: number;
	body: unknown;
}

export declare class PaymentRequiredError extends ThreeWsError {
	accepts: unknown | null;
}

export declare const DEFAULT_BASE_URL: string;

export type PayWith = 'x402' | 'credits';
export type Severity = 'info' | 'warn' | 'critical';

export interface TextureInfo {
	name: string | null;
	mimeType: string | null;
	width: number;
	height: number;
	byteSize: number;
}

export interface MaterialInfo {
	name: string | null;
	alphaMode: string;
	doubleSided: boolean;
	hasBaseColorTexture: boolean;
	hasNormalTexture: boolean;
	hasMetallicRoughnessTexture: boolean;
	hasEmissiveTexture: boolean;
	hasOcclusionTexture: boolean;
}

export interface ModelCounts {
	scenes: number;
	nodes: number;
	meshes: number;
	materials: number;
	textures: number;
	animations: number;
	/** A non-zero value means the model is rigged. */
	skins: number;
	totalVertices: number;
	totalTriangles: number;
	indexedPrimitives: number;
	nonIndexedPrimitives: number;
}

export interface ModelInfo {
	fileSize: number;
	container: 'glb' | 'gltf';
	generator: string | null;
	version: string | null;
	copyright: string | null;
	extensionsUsed: string[];
	extensionsRequired: string[];
	counts: ModelCounts;
	primitiveModes: number[];
	textures: TextureInfo[];
	materials: MaterialInfo[];
}

export interface Suggestion {
	id: string;
	severity: Severity;
	message: string;
	estimate?: string;
}

export interface InspectReport {
	url: string | null;
	fetchedBytes: number;
	model: ModelInfo | null;
	suggestions: Suggestion[];
	raw: unknown;
}

export interface InspectOptions {
	/** Billing lane for the x402 model-check endpoint. */
	payWith?: PayWith;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export interface ThemedMesh {
	mint: string | null;
	theme: {
		name: string | null;
		symbol: string | null;
		/** RGB triplet in [0,1] — the baseColorFactor hashed from the mint. */
		color: [number, number, number] | null;
		imageUrl: string | null;
		hasImage: boolean;
	};
	/** Decoded GLB bytes (from the response's base64). */
	bytes: Uint8Array;
	glb: {
		mimeType: 'model/gltf-binary' | string;
		/** GLB size in bytes. */
		bytes: number;
	};
	raw: unknown;
}

export interface ThemeOptions {
	/** Billing lane for the x402 mint-to-mesh endpoint. */
	payWith?: PayWith;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export interface Appearance {
	/** Outfit preset id — applies its morph bindings. */
	outfit?: string | null;
	/** Bone-mounted accessory preset ids (hats, glasses…). */
	accessories?: string[];
	/** Tint material slots (`skin`, `hair`, `outfit`, `glasses`) by hex. */
	colors?: Record<string, string>;
	/** Raw morph-target overrides (0..1) — win over preset bindings. */
	morphs?: Record<string, number>;
	/** Slots to hide, exposing the base body. */
	hidden?: string[];
}

export interface BakeResult {
	avatarId: string | null;
	bakedStorageKey: string | null;
	appearanceHash: string | null;
	sizeBytes: number | null;
	/** True when an empty/cleared appearance dropped the cached baked GLB. */
	cleared: boolean;
	bakeError: string | null;
	raw: unknown;
}

export interface BakeOptions {
	/** Owner bearer token (overrides a client-level apiKey for this call). */
	token?: string;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export interface GlbToolsClientOptions {
	baseUrl?: string;
	fetch?: typeof fetch;
	/** Bearer token attached to every call (e.g. the avatar owner token for bake). */
	apiKey?: string;
	headers?: Record<string, string>;
}

export interface GlbToolsClient {
	inspect(url: string, opts?: InspectOptions): Promise<InspectReport>;
	theme(mint: string, opts?: ThemeOptions): Promise<ThemedMesh>;
	bake(avatarId: string, appearance: Appearance | null, opts?: BakeOptions): Promise<BakeResult>;
}

export declare function createGlbTools(options?: GlbToolsClientOptions): GlbToolsClient;
export declare function inspect(url: string, opts?: InspectOptions): Promise<InspectReport>;
export declare function theme(mint: string, opts?: ThemeOptions): Promise<ThemedMesh>;
export declare function bake(avatarId: string, appearance: Appearance | null, opts?: BakeOptions): Promise<BakeResult>;

export type { LodLevelInput, LodLevelResult, LodChainResult } from './lod.js';
/** Node.js-only. See './lod.js' for the full contract and README.md#buildlodchain. */
export declare function buildLodChain(
	glb: Uint8Array | ArrayBuffer,
	options?: { levels?: import('./lod.js').LodLevelInput[] },
): Promise<import('./lod.js').LodChainResult>;
