// Pure planning logic for `npm run ship:insta360` (scripts/ship-insta360.mjs).
//
// Everything here is deterministic and side-effect free so it can be unit
// tested: which region the GPU workers land in, the exact gcloud argument
// lists, the production lane checks and how their poll bodies are judged.
// The runner owns every network call and every gcloud invocation.
//
// Contract: prompts/finish/_context/insta360-00-CONTEXT.md (C1 to C5).
// Runbook: docs/ops/insta360-ship.md.

import { parseImageDigest } from './sniper-rollout-image.mjs';

export const PROJECT = 'aerial-vehicle-466722-p5';
export const RUNTIME_SA = `three-ws@${PROJECT}.iam.gserviceaccount.com`;
export const API_SERVICE = Object.freeze({ name: 'three-ws-api', region: 'us-central1' });
export const PRODUCTION_ORIGIN = 'https://three.ws';
// The bearer secret every reconstruction worker reads as API_KEY; three-ws-api
// already carries it as GCP_RECONSTRUCTION_KEY (C5).
export const WORKER_KEY_SECRET = 'avatar-reconstruction-key';
export const L4_QUOTA_METRIC = 'run.googleapis.com/nvidia_l4_gpu_allocation_no_zonal_redundancy';

// GPU regions in preference order. europe-west4 has 8 L4s with almost no warm
// pins; us-central1 stays last because its 3 L4s are held by warm production
// pins (model-trellis min 2 plus model-rig).
export const GPU_REGIONS = Object.freeze([{ region: 'europe-west4' }, { region: 'us-central1' }]);

// Concurrency is the HTTP request limit, not the job limit. Each worker keeps
// its task table in process memory and runs one GPU job at a time from its own
// queue, so a status poll must reach the instance that owns the task. With
// concurrency 1 a second poll arriving mid-poll would spin up a fresh GPU
// instance that answers 404 for the task. Hence: one instance (max 1), many
// cheap HTTP requests, one GPU job at a time inside it.
const GPU_HTTP_CONCURRENCY = 8;

export const GPU_SERVICES = Object.freeze([
	Object.freeze({
		key: 'pano2splat',
		name: 'model-pano2splat',
		envVar: 'GCP_PANO2SPLAT_URL',
		imageRepoName: 'model-pano2splat',
		cpu: 8,
		memory: '32Gi',
		// A standard capture trains 30000 iterations; /infer answers 202 at once,
		// so the request timeout only bounds the longest single HTTP call.
		timeoutSeconds: 3600,
		env: { RESULT_BUCKET: 'three-ws-pano-captures', MAX_QUEUE: '8' },
		health: (body) => body?.ok === true && body?.gpu_available === true,
	}),
	Object.freeze({
		key: 'panodepth',
		name: 'model-panodepth',
		envVar: 'GCP_PANODEPTH_URL',
		imageRepoName: 'model-panodepth',
		cpu: 8,
		memory: '32Gi',
		timeoutSeconds: 900,
		// The MoGe-2 checkpoint is baked into the image and sha256-checked at
		// build time (workers/model-panodepth/Dockerfile), which also sets
		// WEIGHTS_PATH. No bucket mount: it would shadow the baked file.
		env: { RESULT_BUCKET: 'three-ws-pano-captures', MAX_CONCURRENT: '1' },
		health: (body) => body?.ok === true && body?.gpu_available === true && body?.weights_present === true,
	}),
]);

// model-video2motion already serves production (CPU, us-central1). 341 only
// changed its image, so the ship rolls the image and keeps its env, service
// account, scaling and resources exactly as they are.
export const VIDEO2MOTION = Object.freeze({
	key: 'video2motion',
	name: 'model-video2motion',
	region: 'us-central1',
	imageRepoName: 'model-video2motion',
	health: (body) => body?.ok === true || body?.status === 'ok',
});

export const ALL_SERVICE_KEYS = Object.freeze([...GPU_SERVICES.map((s) => s.key), VIDEO2MOTION.key]);

/**
 * Validate deploy/insta360/images.json: { "<key>": { "image": "<repo>@sha256:..", ... } }.
 * Returns { images: { key: ref }, missing: [key] }. A ref must be digest-pinned
 * and must come from the service's own Artifact Registry repository, in any
 * supported region (a GPU image may be built next to the GPUs that run it).
 */
export function parseImagesFile(json) {
	const data = typeof json === 'string' ? JSON.parse(json) : json;
	const repoNames = Object.fromEntries([...GPU_SERVICES, VIDEO2MOTION].map((s) => [s.key, s.imageRepoName]));
	const regions = GPU_REGIONS.map((r) => r.region).join('|');
	const images = {};
	const missing = [];
	for (const key of ALL_SERVICE_KEYS) {
		const ref = data?.[key]?.image;
		if (!ref) {
			missing.push(key);
			continue;
		}
		const shape = new RegExp(`^(${regions})-docker\\.pkg\\.dev/${PROJECT}/${repoNames[key]}/server@sha256:[0-9a-f]{64}$`);
		if (!shape.test(ref) || !parseImageDigest(ref)) {
			throw new Error(`images.json: ${key} must be "<region>-docker.pkg.dev/${PROJECT}/${repoNames[key]}/server@sha256:<64 hex>", got "${ref}"`);
		}
		images[key] = ref;
	}
	return { images, missing };
}

/**
 * Sum of min-instances held by other GPU services in a region. Those L4s are
 * permanently allocated, so they are unavailable to a cold start.
 */
export function heldGpus(services, excludeNames = []) {
	let held = 0;
	for (const s of services || []) {
		if (excludeNames.includes(s.name)) continue;
		if (!s.gpu) continue;
		held += Math.max(0, Number(s.minScale) || 0);
	}
	return held;
}

/**
 * Pick the GPU region: the first in preference order whose free L4 headroom
 * (quota limit minus warm pins) covers one instance per GPU service.
 * quotas: { region: limit }, held: { region: warm L4s }.
 */
export function chooseGpuRegion({ quotas, held, needed = GPU_SERVICES.length, override } = {}) {
	const candidates = override ? GPU_REGIONS.filter((r) => r.region === override) : GPU_REGIONS;
	if (override && candidates.length === 0) {
		throw new Error(`--region ${override} is not a supported GPU region; use one of ${GPU_REGIONS.map((r) => r.region).join(', ')}`);
	}
	const report = candidates.map((r) => {
		const limit = Number(quotas?.[r.region]) || 0;
		const pinned = Number(held?.[r.region]) || 0;
		return { ...r, limit, held: pinned, headroom: limit - pinned };
	});
	const pick = report.find((r) => r.headroom >= needed);
	if (!pick) {
		const lines = report.map((r) => `${r.region}: limit ${r.limit}, warm ${r.held}, free ${r.headroom}`).join('; ');
		throw new Error(`no region has ${needed} free L4s (${lines})`);
	}
	return { ...pick, report };
}

function envPairs(env) {
	return Object.entries(env)
		.map(([k, v]) => `${k}=${v}`)
		.join(',');
}

/**
 * `gcloud run deploy` arguments for one GPU worker. `deploy` creates or
 * updates; only the update-style env and secret flags are used, so an existing
 * service never loses a variable this script does not manage.
 */
export function gpuDeployArgs(spec, { region, image }) {
	if (!image) throw new Error(`no image for ${spec.name}`);
	const args = [
		'run', 'deploy', spec.name,
		`--image=${image}`,
		`--project=${PROJECT}`,
		`--region=${region}`,
		`--service-account=${RUNTIME_SA}`,
		'--port=8080',
		'--gpu=1',
		'--gpu-type=nvidia-l4',
		'--no-gpu-zonal-redundancy',
		'--no-cpu-throttling',
		`--cpu=${spec.cpu}`,
		`--memory=${spec.memory}`,
		`--concurrency=${GPU_HTTP_CONCURRENCY}`,
		'--min-instances=0',
		'--max-instances=1',
		`--timeout=${spec.timeoutSeconds}`,
		'--allow-unauthenticated',
		`--update-env-vars=${envPairs(spec.env)}`,
		`--update-secrets=API_KEY=${WORKER_KEY_SECRET}:latest`,
		`--labels=app=three-ws,lane=insta360,worker=${spec.key}`,
		'--quiet',
	];
	return args;
}

export function video2motionUpdateArgs(image) {
	if (!image) throw new Error('no image for model-video2motion');
	return [
		'run', 'services', 'update', VIDEO2MOTION.name,
		`--image=${image}`,
		`--project=${PROJECT}`,
		`--region=${VIDEO2MOTION.region}`,
		'--quiet',
	];
}

/** Point three-ws-api at the new workers. Never --set-env-vars: it replaces the whole env set. */
export function apiEnvArgs(urls) {
	const pairs = GPU_SERVICES.map((s) => {
		const url = urls?.[s.key];
		if (!/^https:\/\/[^\s,]+$/.test(String(url || ''))) throw new Error(`no https URL for ${s.name}: "${url}"`);
		return `${s.envVar}=${url.replace(/\/+$/, '')}`;
	});
	return [
		'run', 'services', 'update', API_SERVICE.name,
		`--project=${PROJECT}`,
		`--region=${API_SERVICE.region}`,
		`--update-env-vars=${pairs.join(',')}`,
		'--quiet',
	];
}

/** Which env vars actually change, given three-ws-api's current env. */
export function apiEnvDiff(currentEnv, urls) {
	return GPU_SERVICES.map((s) => {
		const next = String(urls?.[s.key] || '').replace(/\/+$/, '');
		const prev = currentEnv?.[s.envVar] ?? null;
		return { name: s.envVar, prev, next, changed: prev !== next };
	});
}

// Real fixtures from gs://three-ws-capture-fixtures/insta360/MANIFEST.json,
// fetched by the workers from their public Wikimedia Commons originals.
export const LANE_FIXTURES = Object.freeze({
	pano2splat: {
		id: 'commons-moscow-metro-interior-2023',
		url: 'https://upload.wikimedia.org/wikipedia/commons/5/55/Moscow_metro_train_Sokolniki_interior_shot_on_spherical_camera_2023-03.MP4.webm',
		license: 'CC0',
	},
	panodepth: {
		id: 'commons-wikimedia-malaysia-office-x4',
		url: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/Wikimedia_Malaysia_offices_-_20250712.jpg',
		license: 'CC0',
	},
	video2motion: {
		id: 'commons-visby-march-theta',
		url: 'https://upload.wikimedia.org/wikipedia/commons/3/37/Hundra_knektars_marsch_utanf%C3%B6r_Kapitelhusg%C3%A5rden.webm',
		license: 'CC BY-SA 4.0',
		subject: { yaw_deg: 34.5, pitch_deg: -28.1 },
	},
});

/** One authenticated preview job per lane, through the production API (C4). */
export function laneChecks(origin = PRODUCTION_ORIGIN) {
	const f = LANE_FIXTURES;
	return [
		{
			key: 'pano2splat',
			submit: { url: `${origin}/api/pano-capture`, body: { source_url: f.pano2splat.url, source_kind: 'equirect_video', quality: 'preview' } },
			poll: (jobId) => `${origin}/api/pano-capture?job=${encodeURIComponent(jobId)}`,
			cleanup: (jobId) => `${origin}/api/pano-capture?job=${encodeURIComponent(jobId)}`,
			artifacts: ['ply_url', 'spz_url', 'preview_url', 'poster_url'],
			timeoutMs: 110 * 60_000,
		},
		{
			key: 'panodepth',
			submit: { url: `${origin}/api/pano-scene`, body: { image_url: f.panodepth.url, source_kind: 'equirect_image' } },
			poll: (jobId) => `${origin}/api/pano-scene?job=${encodeURIComponent(jobId)}`,
			cleanup: null,
			artifacts: ['glb_url', 'ply_url'],
			timeoutMs: 30 * 60_000,
		},
		{
			key: 'video2motion',
			submit: {
				url: `${origin}/api/motion-swap`,
				body: { video_url: f.video2motion.url, projection: 'equirect', subject: f.video2motion.subject, max_seconds: 20 },
			},
			poll: (jobId) => `${origin}/api/motion-swap?job=${encodeURIComponent(jobId)}`,
			cleanup: null,
			artifacts: ['clip_url', 'reframe_url'],
			timeoutMs: 30 * 60_000,
		},
	];
}

const DONE = new Set(['succeeded', 'completed', 'complete', 'done', 'ready']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled']);

/**
 * Judge one poll body. Returns { state: 'running'|'passed'|'failed', detail }.
 * pano-capture and pano-scene nest files under `result`; motion-swap returns
 * them at the top level.
 */
export function judgePoll(check, body) {
	const status = String(body?.status || '').toLowerCase();
	if (FAILED.has(status)) {
		const err = body?.error;
		const msg = typeof err === 'string' ? err : err?.message || err?.code || 'no error detail';
		return { state: 'failed', detail: `${status}: ${msg}` };
	}
	if (!DONE.has(status)) return { state: 'running', detail: [status, body?.stage].filter(Boolean).join(' / ') };
	const files = body?.result && typeof body.result === 'object' ? body.result : body;
	const absent = check.artifacts.filter((k) => !/^https?:\/\//.test(String(files?.[k] || '')));
	if (absent.length) return { state: 'failed', detail: `${status} but missing ${absent.join(', ')}` };
	return { state: 'passed', detail: status, files: Object.fromEntries(check.artifacts.map((k) => [k, files[k]])) };
}

/** True when the API answered with the server's route-miss 404 (route not deployed yet). */
export function isRouteMissing(status, body) {
	if (status !== 404) return false;
	const text = typeof body === 'string' ? body : JSON.stringify(body || {});
	return /No API route matches|route_not_found/i.test(text);
}
