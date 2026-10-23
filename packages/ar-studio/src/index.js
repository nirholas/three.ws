// 3D AR Studio: drop a full augmented-reality studio into any web page.
//
//   import { createArStudio } from '3d-ar-studio'
// Call createArStudio with the element to mount into (usually document.body).
//
// That is the whole integration. It mounts a camera-backed 3D scene, a model
// browser wired to a public CC0 library, a prompt box that generates new models,
// WebXR placement on devices that support it, shareable scene links, QR hand-off
// to a phone, and live shared rooms.
//
// Point it somewhere else with one option:
//
//   createArStudio(el, { assets: 'https://your.cdn/models.json' })
//
// See README.md for the full option list, and src/config.js for the defaults.

export { ArStudio } from './studio/studio.js';
export { DEFAULTS, THREE_WS, mergeConfig, resolveConfig, safeUrl } from './config.js';
export { createLogger, log, setVerbose, isVerbose } from './log.js';

// Sources: bring your own catalogue.
export {
	resolveSources, manifestSource, staticSource, recentSource,
	threeWsObjectsSource, threeWsCommunitySource, LINK_SOURCE,
} from './sources/index.js';
export { normalizeCatalogue, catalogueItems, filenameTitle } from './sources/manifest.js';
export { readRecents, rememberRecent } from './sources/recents.js';
export { cdnUrl } from './sources/three-ws.js';

// Generation: the free, keyless text-to-3D pipeline (or your own MCP server).
export { createForgeClient, GENERATE_TOOLS, ForgeError } from './forge/client.js';
export { createMcpClient, unwrapToolResult, McpError } from './forge/mcp-http.js';
export { checkPromptSafety, validatePrompt } from './forge/safety.js';
export { stageNarration, promptTitle, laneLabel } from './forge/narration.js';

// "View in your space": device-aware AR routing (also safe to import in Node).
export {
	planArLaunch, assertArAssetUrl, detectArTarget, buildArLaunchUrl,
	buildSceneViewerUrl, buildViewerUrl, ArUrlError, DEFAULT_ORIGIN,
} from './ar-launch.js';
export {
	arCapability, prepareNativeAr, placeInYourSpace, withQuickLookBanner,
	canUseQuickLook, canUseSceneViewer, openQuickLook, openSceneViewer, usdzFilename,
	cachedUsdzUrl, isQuickLookReady, releaseQuickLook, clearQuickLookCache,
	isIOS, isAndroid, QUICK_LOOK_BANNER_TAPPED,
} from './studio/native-ar.js';
export {
	glbUrlToUsdzBlob, objectToUsdzBlob, sceneToUsdzBlob, bakeSkinnedMeshes,
	coerceMaterialsToStandard, ensureNormals, usdzExportRoot, groundOnFloor, fitToRoomScale,
	clampToPlaceableSize, MAX_AR_FOOTPRINT_M, MAX_AR_HEIGHT_M,
} from './studio/usdz.js';

// Scene math and links: useful for building your own UI on top.
export {
	fitTransform, spawnPointInFront, normalizeGlbUrl, serializeScene, deserializeScene,
	sceneToHashParam, sceneFromHashParam, studioSceneUrl, studioShareUrl,
	roomLightFromPixels, twistDelta, touchAngle,
	MAX_PLACEMENTS, SCALE_MIN, SCALE_MAX, SPAWN_DISTANCE_M,
	AVATAR_TARGET_HEIGHT_M, PROP_TARGET_SIZE_M,
} from './studio/scene-math.js';
export {
	generateRoomCode, normalizeRoomCode, roomShareUrl, roomKeyForCode,
	localToShared, sharedToLocal, normDeg, normRad,
} from './studio/coords.js';
export { renderQRToSVG, renderQRToCanvas, generateQR } from './qr.js';

// Rendering + capture, for hosts building adjacent 3D surfaces.
export {
	applyCinematicDefaults, detectQualityTier, loadEnvironment,
	updateGroundContactShadow, QUALITY_TIERS,
} from './studio/render.js';
export { captureComposite, shareOrDownload, shareUrlOrCopy } from './studio/capture.js';
export { sharedGLTFLoader, setDracoPath, DEFAULT_DRACO_PATH } from './studio/loaders.js';
export { mountIdle, getIdleClipJson } from './studio/idle.js';

import { ArStudio } from './studio/studio.js';

/**
 * Mount a studio.
 *
 * @param {HTMLElement|string} [host]  Element or CSS selector. Defaults to `document.body`.
 * @param {object} [options]  See src/config.js.
 * @returns {ArStudio}
 *
 * @example
 * const studio = createArStudio('#stage', {
 *   assets: 'https://cdn.acme.com/models.json',
 *   branding: { title: 'Acme AR', accent: '#00b894' },
 * })
 * studio.on('add', ({ placement }) => console.log('placed', placement.title))
 */
export function createArStudio(host = document.body, options = {}) {
	const el = typeof host === 'string' ? document.querySelector(host) : host;
	if (!el) throw new Error(`ar-studio: no element matched ${JSON.stringify(host)}`);
	return new ArStudio(el, options);
}

export default createArStudio;
