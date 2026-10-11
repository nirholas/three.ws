// Type definitions for @three-ws/glb-tools/lod (Node.js-only entry point)

export type LodLevelInput =
	| number
	| {
			name?: string;
			ratio: number;
			error?: number;
			screenCoverage?: number;
	  };

export interface LodLevelResult {
	name: string;
	ratio: number;
	error: number;
	screenCoverage: number | null;
	triangleCount: number;
	vertexCount: number;
	/** Standalone GLB for this level alone (no MSFT_lod, just the decimated mesh). */
	glb: Uint8Array;
}

export interface LodChainResult {
	source: { triangleCount: number; vertexCount: number };
	levels: LodLevelResult[];
	/** A single GLB with every level merged in and MSFT_lod wired to switch between them. */
	combined: Uint8Array;
}

export declare const DEFAULT_LOD_LEVELS: ReadonlyArray<{
	name: string;
	ratio: number;
	error?: number;
	screenCoverage: number;
}>;

export declare const MSFT_LOD_EXTENSION_NAME: 'MSFT_lod';

export declare function buildLodChain(
	glb: Uint8Array | ArrayBuffer,
	options?: { levels?: LodLevelInput[] },
): Promise<LodChainResult>;

export declare function countDocumentGeometry(doc: unknown): { triangles: number; vertices: number };
