// Type definitions for 3d-ar-studio.
//
// Hand-written rather than generated, so the shapes documented here are the ones
// a host actually touches. Everything the studio exposes is plain data.

export interface ModelInput {
	/** https URL of a .glb or .gltf model, or a site-relative path. */
	src: string;
	/** Label shown in the tray and the selection bar. */
	title?: string;
	/** Thumbnail URL. */
	poster?: string;
}

export interface Placement extends Required<Pick<ModelInput, 'src' | 'title'>> {
	id: string;
	/** Metres right of the scene origin. */
	x: number;
	/** Metres forward of the scene origin; negative is further away. */
	z: number;
	/** Rotation about the vertical axis, in radians. */
	yaw: number;
	/** Uniform scale, 0.25 to 4. */
	scale: number;
	/** False for a model placed by someone else in a shared room. */
	mine: boolean;
}

export interface SceneItem {
	src: string;
	title: string;
	x: number;
	z: number;
	yaw: number;
	scale: number;
}

export interface AssetItem {
	src: string;
	title: string;
	poster?: string;
	/** Lower-cased text the tray's filter box matches against. */
	keywords?: string;
}

export interface AssetSource {
	/** Stable key; also the tab's identity. */
	id: string;
	/** Tab label. */
	label?: string;
	/** Line rendered under the search box. */
	hint?: string;
	/** Copy shown when `list()` returns nothing. */
	emptyCopy?: string;
	/** Show a client-side filter box. Defaults to true above 24 items. */
	searchable?: boolean;
	/** Re-read on every open instead of being cached. */
	live?: boolean;
	/** `'link'` renders the paste-a-URL form instead of a grid. */
	kind?: 'link';
	list?(): Promise<AssetItem[]>;
}

export type AssetsOption = string | AssetSource | Array<string | AssetSource>;

export interface GenerateOptions {
	enabled?: boolean;
	/** MCP endpoint exposing a compatible generate tool. */
	endpoint?: string;
	kind?: 'model' | 'avatar' | 'mesh';
	tier?: 'draft' | 'standard' | 'high';
	timeoutMs?: number;
	pollMs?: number;
	headers?: Record<string, string>;
}

export interface StudioOptions {
	assets?: AssetsOption;
	allowUrlOverride?: boolean;
	generate?: GenerateOptions;
	rooms?: { enabled?: boolean; server?: string };
	animations?: { enabled?: boolean; manifestUrl?: string; clip?: string };
	lighting?: { preset?: 'studio' | 'outdoor' | 'sunset' | null; urls?: Record<string, string> };
	branding?: { title?: string; accent?: string; backHref?: string | null; backLabel?: string };
	/** Where share links and QR codes point. Defaults to the hosting page. */
	shareBaseUrl?: string;
	/** Origin used for the hosted "View in your space" launcher and viewer links. */
	origin?: string;
	arLaunchUrl?: string;
	persistKey?: string;
	persist?: boolean;
	maxPlacements?: number;
	/** Render as a fixed full-screen layer. Defaults to true only on `document.body`. */
	fullscreen?: boolean;
	onEvent?(event: StudioEventName, detail: Record<string, unknown>): void;
}

export type StudioEventName =
	| 'add' | 'remove' | 'select' | 'clear'
	| 'generate' | 'generate-error'
	| 'camera' | 'xr' | 'room' | 'share'
	| 'native-ar' | 'native-ar-error' | 'ar-sheet';

export interface GeneratedModel {
	src: string;
	title: string;
	prompt: string;
	kind: string;
	viewerUrl: string;
	arUrl: string;
	poster: string;
	rigged: boolean;
}

export declare class ArStudio {
	constructor(host: HTMLElement, options?: StudioOptions);
	readonly config: Required<StudioOptions> & Record<string, unknown>;
	readonly placements: unknown[];
	readonly roomCode: string;
	on(event: StudioEventName, fn: (detail: any) => void): () => void;
	off(event: StudioEventName, fn: (detail: any) => void): void;
	addModel(model: ModelInput, opts?: Partial<SceneItem> & { announce?: boolean; persist?: boolean }): Promise<Placement | null>;
	clear(): SceneItem[];
	getScene(): SceneItem[];
	setScene(items: SceneItem[]): Promise<void>;
	shareUrl(): string;
	generate(prompt: string): Promise<GeneratedModel | null>;
	viewInYourSpace(src: string, title?: string): string;
	startCamera(): Promise<void>;
	stopCamera(): void;
	toggleImmersive(): Promise<void>;
	/** Enter AR by the best path this device supports. */
	enterAR(): Promise<unknown>;
	/** Open one model in the device's native AR viewer. Defaults to the selection. */
	placeInYourSpace(placement?: unknown): Promise<'quicklook' | 'sceneviewer' | 'none' | null>;
	/** Open the AR hand-off sheet: prepare one model, then open the device viewer from one tap. */
	openArSheet(placement?: unknown): void;
	/** Close the AR hand-off sheet. */
	closeArSheet(): void;
	readonly arMode: ArCapability;
	openRoom(code?: string): Promise<string>;
	leaveRoom(): void;
	destroy(): void;
}

/** Mount a studio into an element (or CSS selector). Defaults to `document.body`. */
export declare function createArStudio(host?: HTMLElement | string, options?: StudioOptions): ArStudio;
export default createArStudio;

// ── Sources ─────────────────────────────────────────────────────────────────
export declare function manifestSource(opts: {
	url: string;
	id?: string;
	label?: string;
	hint?: string;
	searchable?: boolean;
	map?: (entry: any) => AssetItem | null;
	rewriteUrl?: (url: string) => string;
	fetchOptions?: RequestInit;
}): AssetSource;
export declare function staticSource(opts: { items: any[]; id?: string; label?: string; hint?: string; searchable?: boolean }): AssetSource;
export declare function recentSource(cfg?: { recentKey?: string }): AssetSource;
export declare function threeWsObjectsSource(cfg?: Record<string, unknown>): AssetSource;
export declare function threeWsCommunitySource(cfg?: Record<string, unknown>): AssetSource;
export declare function resolveSources(assets: AssetsOption, cfg?: Record<string, unknown>): AssetSource[];
export declare function normalizeCatalogue(data: unknown, opts?: { map?: Function; rewriteUrl?: Function }): AssetItem[];
export declare function catalogueItems(data: unknown): any[];
export declare function filenameTitle(url: string): string;
export declare function readRecents(key?: string): Array<{ src: string; title: string; poster: string; ts: number }>;
export declare function rememberRecent(model: ModelInput, key?: string): void;
export declare function cdnUrl(url: string, origin?: string): string;
export declare const LINK_SOURCE: AssetSource;

// ── Generation ──────────────────────────────────────────────────────────────
export declare class ForgeError extends Error { code: string }
export declare function createForgeClient(opts?: GenerateOptions & { tools?: Record<string, string>; fetchImpl?: typeof fetch }): {
	generate(prompt: string, opts?: {
		onProgress?(state: { status: string; message: string; elapsedMs: number; etaSeconds: number | null }): void;
		kind?: 'model' | 'avatar' | 'mesh';
		tier?: 'draft' | 'standard' | 'high';
		imageUrl?: string;
		signal?: AbortSignal;
	}): Promise<GeneratedModel>;
	mcp: ReturnType<typeof createMcpClient>;
	endpoint: string;
};
export declare function createMcpClient(opts: { endpoint: string; headers?: Record<string, string>; fetchImpl?: typeof fetch }): {
	rpc(method: string, params?: unknown, opts?: { signal?: AbortSignal }): Promise<any>;
	listTools(opts?: { signal?: AbortSignal }): Promise<any[]>;
	callTool(name: string, args?: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<any>;
	readonly sessionId: string;
};
export declare class McpError extends Error { code?: number; status?: number; detail?: string }
export declare function unwrapToolResult(result: any): { structured: any; text: string; isError: boolean };
export declare function checkPromptSafety(prompt: string): { allowed: boolean; category?: string; message?: string; matched?: string };
export declare function validatePrompt(prompt: string): { ok: boolean; prompt?: string; reason?: string; category?: string };
export declare function stageNarration(state: Record<string, unknown>): string;
export declare function promptTitle(prompt: string, max?: number): string;
export declare function laneLabel(id: string): string | null;
export declare const GENERATE_TOOLS: Record<string, string>;

// ── AR routing ──────────────────────────────────────────────────────────────
export type ArTarget = 'ios' | 'android' | 'desktop';
export interface ArPlan {
	target: ArTarget;
	action: 'redirect' | 'page';
	asset: string;
	viewerUrl: string;
	sceneViewerUrl: string;
	launchUrl: string;
	live: boolean;
}
export declare class ArUrlError extends Error { code: 'invalid_url' | 'not_https' | 'not_glb' }
export declare function planArLaunch(p: { glbUrl: string; userAgent?: string; origin?: string; title?: string; live?: boolean }): ArPlan;
export declare function assertArAssetUrl(glbUrl: unknown): string;
export declare function detectArTarget(userAgent?: string): ArTarget;
export declare function buildArLaunchUrl(origin: string, glbUrl: string, title?: string, opts?: { live?: boolean; endpoint?: string }): string;
export declare function buildSceneViewerUrl(glbUrl: string, opts?: { title?: string; fallbackUrl?: string }): string;
export declare function buildViewerUrl(origin: string, glbUrl: string, title?: string): string;
export type ArCapability = 'webxr' | 'quicklook' | 'sceneviewer' | 'none';
/** The best AR path this device can actually deliver, best first. */
export declare function arCapability(): Promise<ArCapability>;
/** Open one model in the device's own AR viewer (Quick Look / Scene Viewer). */
export declare function placeInYourSpace(
	model: NativeArModel,
	opts?: NativeArOptions,
): Promise<'quicklook' | 'sceneviewer' | 'none'>;

export interface NativeArModel {
	src?: string;
	title?: string;
	/** A ready-made USDZ, skipping conversion entirely. */
	usdz?: string;
	/** Cache identity for the converted USDZ. Defaults to `src`. */
	key?: string;
	/** Produce the USDZ without refetching the GLB (export from a live scene). */
	build?: () => Promise<Blob>;
}

export interface NativeArOptions {
	onProgress?: (stage: 'download' | 'parse' | 'convert' | 'open') => void;
	fallbackUrl?: string;
	signal?: AbortSignal;
}

export interface NativeArHandoff {
	viewer: 'quicklook' | 'sceneviewer';
	href: string;
	/** Call this synchronously from a real tap: iOS opens Quick Look only while the gesture is live. */
	open(opts?: { onBannerTap?: () => void }): void;
}

/**
 * Prepare the device AR hand-off WITHOUT opening it, so the tap that opens it
 * stays inside the user gesture Safari requires. Resolves null on a device with
 * no native AR viewer.
 */
export declare function prepareNativeAr(
	model: NativeArModel,
	opts?: NativeArOptions,
): Promise<NativeArHandoff | null>;

/** Convert once per key and hand back a `blob:` URL Quick Look can open. */
export declare function cachedUsdzUrl(key: string, build: () => Promise<Blob>): Promise<string>;
/** Is a Quick Look asset for this key already converted and ready to open? */
export declare function isQuickLookReady(key: string): boolean;
/** Drop one cached USDZ and revoke its object URL. */
export declare function releaseQuickLook(key: string): boolean;
/** Drop every cached USDZ and release the memory behind it. */
export declare function clearQuickLookCache(): void;
/**
 * Append Quick Look checkout-banner fields to a USDZ URL. Returns the URL
 * unchanged unless `callToAction` is present: Quick Look renders the banner
 * only as a complete set, and a title alone yields a banner with a dead button.
 */
export declare function withQuickLookBanner(url: string, fields?: { title?: string; subtitle?: string; callToAction?: string }): string;
/** Fetch a GLB and convert it to a USDZ blob, on the device. */
export declare function glbUrlToUsdzBlob(glbUrl: string, opts?: { signal?: AbortSignal; onProgress?: (stage: string) => void }): Promise<Blob>;
/** Convert an object already standing in a live scene to USDZ: no refetch, current pose and size. */
export declare function objectToUsdzBlob(object: any): Promise<Blob>;
export declare function sceneToUsdzBlob(scene: any, options?: Record<string, unknown>): Promise<Blob>;
export declare function bakeSkinnedMeshes(scene: any): void;
export declare function coerceMaterialsToStandard(scene: any): void;
export declare function ensureNormals(scene: any): void;
export declare function canUseQuickLook(): boolean;
export declare function canUseSceneViewer(): boolean;
/**
 * Open a USDZ in Quick Look.
 *
 * When `usdzUrl` is a `blob:` URL the anchor is given `download="<name>.usdz"`,
 * because Safari decides whether a URL is an AR asset from its file extension:
 * without it Quick Look opens in Object mode with AR unavailable.
 */
export declare function openQuickLook(usdzUrl: string, opts?: { onBannerTap?: () => void; name?: string }): void;
/** A filesystem-safe `<slug>.usdz` name for a model title. */
export declare function usdzFilename(title?: string): string;
export declare function openSceneViewer(glbUrl: string, opts?: { title?: string; link?: string; fallbackUrl?: string }): void;
export declare function isIOS(): boolean;
export declare function isAndroid(): boolean;
export declare const QUICK_LOOK_BANNER_TAPPED: string;
export declare const DEFAULT_ORIGIN: string;

// ── Scene math and links ────────────────────────────────────────────────────
export declare function fitTransform(box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }, opts?: { skinned?: boolean }): { scale: number; yOffset: number };
export declare function spawnPointInFront(camPos: { x: number; y: number; z: number }, camForward: { x: number; y: number; z: number }, distance?: number): { x: number; z: number };
export declare function normalizeGlbUrl(raw: unknown): string | null;
export declare function serializeScene(placements: SceneItem[]): string;
export declare function deserializeScene(json: string | null | undefined): SceneItem[];
export declare function sceneToHashParam(placements: SceneItem[]): string;
export declare function sceneFromHashParam(raw: string | null | undefined): SceneItem[];
export declare function studioSceneUrl(baseUrl: string, placements: SceneItem[], maxUrlLength?: number): string;
export declare function studioShareUrl(baseUrl: string, placements: Array<{ src: string; title?: string }>, max?: number): string;
export declare function roomLightFromPixels(data: Uint8ClampedArray | number[]): { intensity: number; tint: { r: number; g: number; b: number } };
export declare function twistDelta(startAngle: number, nowAngle: number): number;
export declare function touchAngle(touches: TouchList | Touch[]): number;
export declare function generateRoomCode(rand?: () => number): string;
export declare function normalizeRoomCode(raw: unknown): string;
export declare function roomShareUrl(baseUrl: string, code: string): string;
export declare function roomKeyForCode(code: string): string;
export declare function localToShared(t: { x: number; z: number; yaw: number; scale?: number; height?: number }): { relEast: number; relNorth: number; yawDeg: number; scale: number; height: number };
export declare function sharedToLocal(s: { relEast: number; relNorth: number; yawDeg: number; scale?: number }): { x: number; z: number; yaw: number; scale: number };
export declare function normDeg(d: number): number;
export declare function normRad(a: number): number;
export declare function renderQRToSVG(text: string, opts?: { scale?: number; margin?: number; dark?: string; light?: string }): string;
export declare function renderQRToCanvas(text: string, canvas: HTMLCanvasElement, opts?: Record<string, unknown>): void;
export declare function generateQR(text: string): { size: number; modules: boolean[][] };
export declare const MAX_PLACEMENTS: number;
export declare const SCALE_MIN: number;
export declare const SCALE_MAX: number;
export declare const SPAWN_DISTANCE_M: number;
export declare const AVATAR_TARGET_HEIGHT_M: number;
export declare const PROP_TARGET_SIZE_M: number;

// ── Rendering + capture ─────────────────────────────────────────────────────
export declare function applyCinematicDefaults(renderer: any, opts?: { exposure?: number; tier?: 'high' | 'medium' | 'mobile' }): { pixelRatioCap: number; shadows: boolean; hdri: boolean };
export declare function detectQualityTier(env?: Record<string, unknown>): 'high' | 'medium' | 'mobile';
export declare function loadEnvironment(renderer: any, scene: any, preset?: string | null, opts?: { urls?: Record<string, string> }): Promise<any>;
export declare function updateGroundContactShadow(scene: any, target: any, existing?: any, opacity?: number): any;
export declare function captureComposite(opts: { canvas: HTMLCanvasElement; video?: HTMLVideoElement; isAR?: boolean }): Promise<Blob | null>;
export declare function shareOrDownload(blob: Blob, opts?: { filename?: string; title?: string }): Promise<'shared' | 'downloaded'>;
export declare function shareUrlOrCopy(url: string, opts?: { title?: string; text?: string }): Promise<'shared' | 'copied'>;
export declare function sharedGLTFLoader(): any;
export declare function setDracoPath(path: string): void;
export declare function mountIdle(model: any, opts?: { manifestUrl?: string; clip?: string; sourceUrl?: string }): Promise<any | null>;
export declare function getIdleClipJson(opts?: { manifestUrl?: string; clip?: string }): Promise<object | null>;
export declare const QUALITY_TIERS: Record<string, { pixelRatioCap: number; shadows: boolean; hdri: boolean }>;
export declare const DEFAULT_DRACO_PATH: string;

// ── Config ──────────────────────────────────────────────────────────────────
export declare const DEFAULTS: StudioOptions;
export declare const THREE_WS: Record<string, any>;
export declare function mergeConfig<T>(base: T, patch: Partial<T>): T;
export declare function resolveConfig(options?: StudioOptions, search?: URLSearchParams | string): StudioOptions & { urlModels: ModelInput[]; urlRoom: string; urlPrompt: string };
export declare function safeUrl(raw: unknown): string | null;
export declare function createLogger(tag: string): Record<'error' | 'warn' | 'info' | 'debug' | 'log', (...args: unknown[]) => void>;
export declare function setVerbose(on: boolean): void;
export declare function isVerbose(): boolean;
