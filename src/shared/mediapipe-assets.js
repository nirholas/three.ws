// Where MediaPipe's runtime and model files come from.
//
// Every vision feature (face and body mocap, sign-language input, selfie
// refinement, capture quality gating) needs three things: the tasks-vision
// module, the vision WASM runtime, and a `.task` / `.tflite` model. Each call
// site used to name a CDN URL for all three, so /mocap, /sign and
// selfie-to-avatar were simultaneously hard-dependent on cdn.jsdelivr.net AND
// storage.googleapis.com, with no timeout and no alternative. One blocked host
// (a corporate proxy, a region, an ad blocker, a CDN incident) took every one of
// those features down with a raw MediaPipe error string.
//
// This module answers all three questions once:
//
//   loadVision()        the tasks-vision module, from our own bundle
//   visionWasmBase()    the WASM directory, our copy first, then two CDNs
//   modelUrl(name)      a model file, our copy first, then Google's bucket
//
// `@mediapipe/tasks-vision` is a real dependency of this repo, so the module
// itself now ships in our bundle and needs no CDN at all. The WASM runtime is
// vendored under public/vendor/mediapipe/wasm, and face_landmarker.task with
// it; the larger models (pose, holistic, hand, segmenter) are still fetched
// from Google's public bucket, but under a deadline, so a stalled download
// surfaces as a real error instead of a spinner that never resolves.

// Models vendored into public/vendor/mediapipe. Anything not listed here is
// fetched from Google's bucket.
const LOCAL_MODELS = new Set(['face_landmarker.task']);

const GOOGLE_MODELS = 'https://storage.googleapis.com/mediapipe-models';

// Pinned to the version in package.json: the WASM runtime and the JS module must
// agree, so this constant moves when the dependency does.
const VERSION = '0.10.35';
const CDN_WASM_BASES = [
	`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`,
	`https://unpkg.com/@mediapipe/tasks-vision@${VERSION}/wasm`,
];

// Resolved against this module's own URL rather than written as a site-absolute
// path, so an embed served from three.ws still points at three.ws instead of at
// the embedding page's origin.
const LOCAL_BASE = (() => {
	try {
		return new URL('../../vendor/mediapipe', import.meta.url).href.replace(/\/$/, '');
	} catch {
		return '/vendor/mediapipe';
	}
})();

const PROBE_TIMEOUT_MS = 4_000;

/**
 * The tasks-vision module. Bundled, so this resolves without any network call
 * beyond our own assets.
 *
 * @returns {Promise<typeof import('@mediapipe/tasks-vision')>}
 */
export function loadVision() {
	return import('@mediapipe/tasks-vision');
}

let _wasmBase = null;
let _wasmBaseProbe = null;

/**
 * Ask one host whether it serves the WASM runtime.
 *
 * Three answers, not two. A non-ok status means the file is genuinely not
 * there. A deadline that expired means nothing about the file: page startup
 * routinely blocks the main thread long enough for a four-second fetch
 * deadline to expire on a request the server answers in under ten
 * milliseconds, which is exactly how the vendored copy was losing to a CDN on
 * every real page load of /create/selfie.
 *
 * @param {string} base
 * @returns {Promise<'present' | 'absent' | 'stalled'>}
 */
async function probeWasmHost(base) {
	try {
		const res = await fetch(`${base}/vision_wasm_internal.wasm`, {
			method: 'HEAD',
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return res.ok ? 'present' : 'absent';
	} catch (err) {
		const name = err?.name;
		return name === 'TimeoutError' || name === 'AbortError' ? 'stalled' : 'absent';
	}
}

async function resolveWasmBase() {
	const local = `${LOCAL_BASE}/wasm`;
	// Our own copy ships with the deploy, so only a definitive "not there"
	// sends the runtime to a third-party CDN. An inconclusive probe keeps it.
	if ((await probeWasmHost(local)) !== 'absent') return local;
	for (const base of CDN_WASM_BASES) {
		if ((await probeWasmHost(base)) === 'present') return base;
	}
	// Nothing answered. Return the first CDN anyway rather than throwing here:
	// MediaPipe's own loader gives a better error than a probe.
	return CDN_WASM_BASES[0];
}

/**
 * Directory to hand `FilesetResolver.forVisionTasks()`. Prefers the copy under
 * public/vendor/mediapipe/wasm and falls back to jsDelivr then unpkg.
 *
 * Every caller on a page shares one probe: face quality, selfie refinement,
 * face mocap and body mocap all ask for this within the same tick, and four
 * identical HEAD requests raced each other before the answer was memoised.
 *
 * @returns {Promise<string>}
 */
export function visionWasmBase() {
	if (_wasmBase) return Promise.resolve(_wasmBase);
	if (!_wasmBaseProbe) {
		_wasmBaseProbe = resolveWasmBase().then((base) => {
			_wasmBase = base;
			_wasmBaseProbe = null;
			return base;
		});
	}
	return _wasmBaseProbe;
}

/**
 * Milliseconds a vision model may take to load before the caller gives up.
 *
 * The runtime is an 11 MB WASM binary plus a model file, so a cold load is
 * seconds, not milliseconds, and this has to sit well above that. It exists
 * because the alternative is unbounded: MediaPipe's loader has no deadline of
 * its own, so an asset that never finishes downloading leaves the caller
 * awaiting forever. Every vision feature here is an enhancement over a path
 * that already works without it, so a slow load has to degrade rather than
 * hang. On 2026-09-11 a single truncated response for the WASM binary held
 * /create/selfie on "Processing your face..." with no error and no timeout,
 * and the reconstruction request was never sent.
 */
export const VISION_LOAD_DEADLINE_MS = 15_000;

/**
 * Bound a vision-model load. Resolves with the model, or rejects once the
 * deadline passes, so the caller's existing failure path runs instead of the
 * await never settling.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {string} label  Named in the timeout error, e.g. 'face detector'.
 * @param {number} [ms]
 * @returns {Promise<T>}
 */
export function withVisionDeadline(promise, label, ms = VISION_LOAD_DEADLINE_MS) {
	let timer;
	const deadline = new Promise((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`${label} did not load within ${ms}ms`));
		}, ms);
	});
	return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Absolute URL for a MediaPipe model file. Vendored models come from our own
 * origin; everything else comes from Google's public bucket.
 *
 * @param {string} path  Bucket-relative path, e.g.
 *   'pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
 * @returns {string}
 */
export function modelUrl(path) {
	const file = String(path).split('/').pop();
	if (LOCAL_MODELS.has(file)) return `${LOCAL_BASE}/${file}`;
	return `${GOOGLE_MODELS}/${String(path).replace(/^\/+/, '')}`;
}

/**
 * The two calls every consumer makes, in one await: the module plus a WASM
 * fileset resolved against the healthiest host.
 *
 * @returns {Promise<{ vision: any, tasks: typeof import('@mediapipe/tasks-vision') }>}
 */
export async function visionFileset() {
	const [tasks, base] = await Promise.all([loadVision(), visionWasmBase()]);
	const vision = await tasks.FilesetResolver.forVisionTasks(base);
	return { vision, tasks };
}
