export interface ModelAnimation {
	name: string;
	duration: number;
	channels: unknown[];
}

export interface Model {
	nodes: unknown[];
	primitives: unknown[];
	animations: ModelAnimation[];
	bounds: { min: number[]; max: number[] };
	triangleCount: number;
	skinned: boolean;
	poseStamp: number;
}

export type ColorModeValue = 'truecolor' | 'ansi256' | 'mono';

export interface RendererOptions {
	/** Character columns. Default 96. */
	width?: number;
	/** Character rows. One row is two vertical pixels. Default 48. */
	height?: number;
	/** Clip name, index, or false to hold the rest pose. Default: the first clip. */
	animation?: string | number | boolean | null;
	mode?: ColorModeValue;
	/** Background rgb in 0..1, painted where nothing was drawn. */
	background?: [number, number, number];
	/** Leave uncovered cells as plain spaces instead of painting the background. */
	transparent?: boolean;
	/** Turntable speed, radians per second. Default 1. */
	spin?: number;
	/** Starting azimuth in radians. Default 0. `frame` adds `time * spin` to this. */
	yaw?: number;
	pitch?: number;
	zoom?: number;
	/**
	 * half (default), density, braille, ascii, points, or matrix.
	 * points plots vertices. matrix tints the frame green. braille uses a 2x4 dot cell.
	 */
	style?: 'half' | 'density' | 'braille' | 'ascii' | 'points' | 'matrix';
	/** Pixel radius when style is points. Default 0 (one pixel). */
	pointRadius?: number;
	tint?: [number, number, number];
}

export interface Orbit {
	yaw: number;
	pitch: number;
	zoom: number;
}

export interface Renderer {
	model: Model;
	animation: ModelAnimation | null;
	framing: { halfHeight: number; halfWidth: number };
	width: number;
	height: number;
	readonly orbit: Orbit;
	setOrbit(next: Partial<Orbit>): Orbit;
	/** Terminal-ready text for the frame at `time` seconds. No trailing newline. */
	frame(time?: number): string;
}

export interface LoadOptions {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

/** Load from a file path, an http(s) URL, or raw GLB bytes. */
export function loadModel(source: string | Uint8Array | ArrayBuffer, options?: LoadOptions): Promise<Model>;
export function loadModelFromFile(path: string): Promise<Model>;
export function loadModelFromBytes(bytes: Uint8Array | ArrayBuffer): Promise<Model>;

export function createRenderer(model: Model, options?: RendererOptions): Renderer;
export function renderOnce(source: string | Uint8Array | ArrayBuffer, options?: RendererOptions & LoadOptions & { time?: number }): Promise<string>;

export function selectAnimation(model: Model, wanted?: string | number | boolean | null): ModelAnimation | null;
export function describeModel(model: Model): {
	triangles: number;
	primitives: number;
	nodes: number;
	skinned: boolean;
	animations: Array<{ name: string; duration: number }>;
};

export const SCENE_NAMES: readonly string[];
export const STYLE_NAMES: readonly string[];
export const GLYPH_STYLES: readonly string[];

export function isScene(name: string): boolean;
export function normalizeStyle(value?: string): 'half' | 'density' | 'braille' | 'ascii' | 'points' | 'matrix';
export function cleanBalloon(text: string, fallback?: string): string;

export interface Scene {
	name: string;
	label: string;
	/** Honest banner text: triangle count, bird count, or point count. */
	detail: string;
	width: number;
	height: number;
	/** Framebuffer written by the most recent `frame` call. */
	buffer: {
		width: number;
		height: number;
		color: Float32Array;
		depth: Float32Array;
		coverage: Uint8Array;
	};
	readonly orbit: Orbit;
	setOrbit(next: Partial<Orbit> & { spin?: number }): Orbit & { spin: number };
	frame(time?: number): string;
}

export interface SceneOptions extends RendererOptions {
	/** Words drawn above the walker when the scene is `say`. */
	text?: string;
	/** Directory that contains public/avatars. Defaults to the process cwd. */
	cwd?: string;
}

export function createScene(name: string, options?: SceneOptions): Promise<Scene>;

export function detectColorMode(env?: NodeJS.ProcessEnv, stream?: NodeJS.WriteStream): ColorModeValue;
export function detectTerminalColor(env?: NodeJS.ProcessEnv, stream?: NodeJS.WriteStream): ColorModeValue;
export function toAnsi256(r: number, g: number, b: number): number;

export const ColorMode: { TRUECOLOR: 'truecolor'; ANSI256: 'ansi256'; MONO: 'mono' };
export const ansi: {
	hideCursor: string;
	showCursor: string;
	clearScreen: string;
	home: string;
	up(n: number): string;
};

export const DEFAULT_ORIGIN: string;
export const KEYS_URL: string;

export class MakeError extends Error {
	status: number;
	code: string;
	signInUrl: string;
	keysUrl: string;
	jobId: string;
}

export function apiKeyFromEnv(env?: NodeJS.ProcessEnv): string | null;

export function forgeModel(options?: {
	prompt?: string;
	imageUrls?: string[];
	origin?: string;
	apiKey?: string;
	credentials?: RequestCredentials;
	fetchImpl?: typeof fetch;
	onStatus?: (ev: { phase: string; message?: string }) => void;
	signal?: AbortSignal;
	maxWaitMs?: number;
	now?: () => number;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<{ glbUrl: string; jobId: string; backend: string }>;

export function uploadImage(options: {
	bytes: Blob | Uint8Array;
	contentType: string;
	origin?: string;
	apiKey?: string;
	credentials?: RequestCredentials;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}): Promise<string>;
