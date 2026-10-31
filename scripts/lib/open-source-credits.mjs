// Pure data and generation logic for the /open-source credits page.
//
// scripts/build-open-source-credits.mjs calls buildCredits() and writes the
// result to data/open-source-credits.json. tests/open-source-credits.test.js
// imports the same function and diffs it against that committed file, so a
// dependency added to package.json without a regenerated, re-committed
// dataset fails the test instead of rotting silently.
//
// Three kinds of entry feed the page:
//   npm    - every direct dependency in package.json, resolved against its
//            own installed package.json for version/license/repository/funding.
//   model  - GPU worker models under workers/*, hand-curated from each
//            worker's README because the license and upstream name are prose,
//            not machine-readable metadata.
//   asset  - non-code asset sources (Poly Haven, Mixamo, the CC0 animation
//            packs) and vendored/forked source trees recorded in NOTICE and
//            third_party/README.md.
//
// Every area id used below must appear in AREAS; the page and the guard test
// both read AREAS as the source of truth for section order and labels.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');

export const AREAS = [
	{ id: 'rendering', label: 'Rendering' },
	{ id: 'formats', label: 'Formats and compression' },
	{ id: 'generation', label: 'Generation models' },
	{ id: 'motion', label: 'Motion' },
	{ id: 'voice', label: 'Voice' },
	{ id: 'assets', label: 'Assets' },
	{ id: 'infrastructure', label: 'Infrastructure' },
];

const AREA_IDS = new Set(AREAS.map((a) => a.id));

// ---- npm dependency curation -----------------------------------------------
//
// Only "major" projects (the ones a visitor would recognize or that do
// genuinely load-bearing work) get a hand-written "what it powers here"
// line. Everything else in package.json still gets a full entry (name,
// version, license, repository, funding) from its own installed metadata,
// just grouped by the fallback classifier below with no powers line.
const CURATED_PACKAGES = {
	three: {
		area: 'rendering',
		powers:
			'The 3D engine behind every viewer: the Forge stage, AR Studio, the agent embeds, and the Entity Studio.',
	},
	'three-mesh-bvh': {
		area: 'rendering',
		powers: 'Accelerated raycasting and collision queries for the viewer and AR placement.',
	},
	'three-gpu-pathtracer': {
		area: 'rendering',
		powers: 'The physically based path-traced render mode in the Forge viewer and cinematic captures.',
	},
	'three-pathfinding': {
		area: 'rendering',
		powers: "Navmesh pathfinding for agent movement in AgenC's embodiment surfaces.",
	},
	postprocessing: {
		area: 'rendering',
		powers: 'Bloom, depth of field, and color grading passes on top of the three.js render.',
	},
	'@pixiv/three-vrm': {
		area: 'rendering',
		powers: 'VRM avatar import and rendering across the viewer and avatar pipeline.',
	},
	'@pixiv/three-vrm-animation': {
		area: 'rendering',
		powers: 'VRM animation playback paired with @pixiv/three-vrm.',
	},
	'@dimforge/rapier3d-compat': {
		area: 'rendering',
		powers: 'Physics simulation for AgenC rooms and interactive 3D scenes.',
	},
	'@sparkjsdev/spark': {
		area: 'rendering',
		powers: 'Gaussian-splat rendering for captured scenes and reconstructed environments.',
	},
	'dat.gui': {
		area: 'rendering',
		powers: 'Internal tuning panels for lighting and material debugging in the 3D tools.',
	},
	delaunator: {
		area: 'rendering',
		powers: 'Delaunay triangulation for terrain and globe-surface mesh generation.',
	},
	'@gltf-transform/core': {
		area: 'formats',
		powers: 'The glTF read/write/transform pipeline behind every export and optimize path.',
	},
	'@gltf-transform/extensions': {
		area: 'formats',
		powers: 'glTF extension support (meshopt, Draco, KTX2) in the export and optimize pipeline.',
	},
	'@gltf-transform/functions': {
		area: 'formats',
		powers: 'Mesh simplification, pruning, and resampling transforms used by the optimize panel.',
	},
	meshoptimizer: {
		area: 'formats',
		powers:
			'Mesh and vertex-cache optimization, and the EXT_meshopt_compression codec every stylize/rig/remesh/segment worker decodes before touching a caller-supplied mesh.',
	},
	draco3dgltf: {
		area: 'formats',
		powers: 'Draco geometry compression and decompression for glTF assets.',
	},
	'gltf-validator': {
		area: 'formats',
		powers: 'Validates every generated GLB against the glTF 2.0 spec before it ships.',
	},
	'manifold-3d': {
		area: 'formats',
		powers: 'Boolean mesh operations (union, difference, intersection) in the mesh-ops pipeline.',
	},
	'@ffmpeg/ffmpeg': {
		area: 'formats',
		powers: 'In-browser video/audio transcoding for capture and export flows.',
	},
	'@ffmpeg/util': { area: 'formats', powers: 'Helper utilities for the @ffmpeg/ffmpeg WASM build.' },
	fflate: { area: 'formats', powers: 'Fast zip/gzip (de)compression for asset bundling and uploads.' },
	sharp: { area: 'formats', powers: 'Server-side image resizing and format conversion (thumbnails, OG images, textures).' },
	hyparquet: { area: 'formats', powers: 'Reads Parquet files for dataset and analytics tooling.' },
	'hyparquet-compressors': { area: 'formats', powers: 'Compression codecs for the hyparquet Parquet reader.' },
	'@mediapipe/tasks-vision': {
		area: 'motion',
		powers: 'Pose, hand, and face landmark detection behind video-to-motion capture and the home voice camera lane.',
	},
	'onnxruntime-web': {
		area: 'motion',
		powers: 'In-browser ONNX model inference for client-side pose and sign-language recognition demos.',
	},
	nipplejs: { area: 'motion', powers: 'The on-screen joystick for touch-driven avatar and agent movement.' },
	'@elevenlabs/elevenlabs-js': {
		area: 'voice',
		powers: "The agent's text-to-speech voice in chat, calls, and the home voice loop.",
	},
	'@ricky0123/vad-web': {
		area: 'voice',
		powers: 'Browser-side voice activity detection for the hands-free wake-word loop.',
	},
	'wawa-lipsync': { area: 'voice', powers: "Drives the avatar's mouth shapes from live or recorded speech audio." },
	'@avaturn/sdk': {
		area: 'assets',
		powers: 'The Avaturn avatar creator embedded in the Avatar Creator flow.',
	},
	'simple-dropzone': { area: 'assets', powers: 'Drag-and-drop file intake for avatar and model uploads.' },
	'idb-keyval': { area: 'infrastructure', powers: 'Lightweight IndexedDB storage for client-side caches.' },
	express: { area: 'infrastructure', powers: 'The HTTP server behind server/index.mjs in production.' },
	'@modelcontextprotocol/sdk': {
		area: 'infrastructure',
		powers: "The MCP server and tool definitions three.ws exposes to agent clients.",
	},
	'@solana/web3.js': { area: 'infrastructure', powers: 'Solana transaction building and RPC access across the platform.' },
	'@solana/kit': { area: 'infrastructure', powers: 'Modern Solana client primitives used alongside @solana/web3.js.' },
	'@coinbase/x402': { area: 'infrastructure', powers: 'The x402 payment protocol implementation for pay-per-call APIs.' },
	ethers: { area: 'infrastructure', powers: 'EVM transaction building for the Base and other EVM-chain lanes.' },
	viem: { area: 'infrastructure', powers: 'Typed EVM client used alongside ethers for EVM-chain integrations.' },
	ajv: { area: 'infrastructure', powers: 'JSON Schema validation for API payloads and agent tool schemas.' },
	zod: { area: 'infrastructure', powers: 'Runtime schema validation across the API and agent SDKs.' },
	ai: { area: 'infrastructure', powers: 'The Vercel AI SDK powering agent chat streaming and tool calls.' },
	'livekit-client': { area: 'infrastructure', powers: 'Real-time audio/video for the LiveKit avatar presence lane.' },
	ws: { area: 'infrastructure', powers: 'WebSocket transport for live agent and multiplayer connections.' },
	'puppeteer-core': { area: 'infrastructure', powers: 'Headless Chromium automation for server-side rendering and screenshots.' },
	'@huggingface/transformers': {
		area: 'infrastructure',
		powers: 'In-browser transformer model inference for client-side AI features.',
	},
	colyseus: { area: 'infrastructure', powers: 'Multiplayer room server used by shared 3D spaces.' },
	'colyseus.js': { area: 'infrastructure', powers: 'Multiplayer room client paired with the colyseus server.' },
};

// ---- GPU worker models ------------------------------------------------------
//
// Hand-curated from each worker's own README (license and upstream name are
// prose there, confirmed against the upstream LICENSE file on the date
// noted). A worker with no third-party model (pure in-house code, e.g.
// agent-* orchestration workers) has no entry here on purpose.
export const WORKER_MODELS = [
	{
		id: 'model:trellis',
		name: 'Microsoft TRELLIS',
		org: 'Microsoft',
		license: 'MIT',
		repo: 'https://github.com/microsoft/TRELLIS',
		area: 'generation',
		powers: 'workers/model-trellis: single-image to textured 3D mesh, a Forge image-to-3D lane.',
	},
	{
		id: 'model:trellis2',
		name: 'Microsoft TRELLIS.2',
		org: 'Microsoft',
		license: 'MIT',
		repo: 'https://github.com/microsoft/TRELLIS.2',
		area: 'generation',
		powers: "workers/model-trellis2: the default image-to-3D PBR engine behind Forge's primary lane.",
	},
	{
		id: 'model:sam3d-objects',
		name: 'SAM 3D Objects',
		org: 'Meta',
		license: 'SAM License (Meta, last updated November 19, 2025; use allowed subject to Trade Controls, gated weights)',
		repo: 'https://github.com/facebookresearch/sam-3d-objects',
		area: 'generation',
		powers: 'workers/model-sam3d-objects: rebuilds the objects in one photo as a laid-out 3D scene (Forge and AR Studio "From a photo"), a 32 GB+ GPU lane that stays off until the owner stages the weights.',
	},
	{
		id: 'model:hunyuan3d',
		name: 'Tencent Hunyuan3D 2.1',
		org: 'Tencent',
		license: 'Tencent Hunyuan Non-Commercial License (self-hosted inference only, no redistribution)',
		repo: 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1',
		area: 'generation',
		powers: 'workers/model-hunyuan3d: a Forge image-to-3D engine, served worldwide excluding the EU, UK, and South Korea per the license territory clause.',
	},
	{
		id: 'model:triposg',
		name: 'TripoSG',
		org: 'VAST-AI-Research',
		license: 'MIT',
		repo: 'https://github.com/VAST-AI-Research/TripoSG',
		area: 'generation',
		powers: 'workers/model-triposg: a Forge image-to-3D engine.',
	},
	{
		id: 'model:triposr',
		name: 'TripoSR',
		org: 'VAST-AI-Research and Stability AI',
		license: 'MIT',
		repo: 'https://github.com/VAST-AI-Research/TripoSR',
		area: 'generation',
		powers: 'workers/model-triposr: fast single-image mesh reconstruction, a Forge lane.',
	},
	{
		id: 'model:partcrafter',
		name: 'PartCrafter',
		org: 'wgsxm',
		license: 'MIT',
		repo: 'https://github.com/wgsxm/PartCrafter',
		area: 'generation',
		powers: 'workers/model-partcrafter: part-aware 3D generation for segmentable Forge results.',
	},
	{
		id: 'model:holopart',
		name: 'HoloPart',
		org: 'VAST-AI-Research',
		license: 'MIT',
		repo: 'https://github.com/VAST-AI-Research/HoloPart',
		area: 'generation',
		powers: 'workers/model-holopart: completes a part-segmented mesh into per-part and whole-object geometry.',
	},
	{
		id: 'model:anigen',
		name: 'AniGen',
		org: 'VAST-AI-Research',
		license: 'MIT',
		repo: 'https://github.com/VAST-AI-Research/AniGen',
		area: 'generation',
		powers: 'workers/model-anigen: predicts mesh, joint skeleton, and skinning for animatable results.',
	},
	{
		id: 'model:pixal3d',
		name: 'Pixal3D',
		org: 'TencentARC',
		license: 'MIT',
		repo: 'https://github.com/TencentARC/Pixal3D',
		area: 'generation',
		powers: 'workers/model-pixal3d: pixel-aligned image-to-3D built on the TRELLIS.2 backbone.',
	},
	{
		id: 'model:make-it-animatable',
		name: 'Make-It-Animatable',
		org: 'jasongzy',
		license: 'MIT',
		repo: 'https://github.com/jasongzy/Make-It-Animatable',
		area: 'motion',
		powers: 'workers/rig: predicts joint positions, skinning weights, and pose for auto-rigging.',
	},
	{
		id: 'model:unirig',
		name: 'UniRig',
		org: 'VAST-AI-Research',
		license: 'MIT',
		repo: 'https://github.com/VAST-AI-Research/UniRig',
		area: 'motion',
		powers: 'workers/rig-nonhuman: skeleton prediction for non-human auto-rigging.',
	},
	{
		id: 'model:skintokens',
		name: 'SkinTokens',
		org: 'VAST-AI-Research',
		license: 'MIT',
		repo: 'https://github.com/VAST-AI-Research/SkinTokens',
		area: 'motion',
		powers: 'workers/rig-nonhuman: skin-weight prediction, paired with UniRig.',
	},
	{
		id: 'model:ict-facekit',
		name: 'ICT-FaceKit',
		org: 'ICT-VGL',
		license: 'MIT',
		repo: 'https://github.com/ICT-VGL/ICT-FaceKit',
		area: 'motion',
		powers: 'workers/rig: the template head used for facial rigging correspondence.',
	},
	{
		id: 'model:motion-diffusion-model',
		name: 'Motion Diffusion Model (MDM)',
		org: 'GuyTevet',
		license: 'MIT',
		repo: 'https://github.com/GuyTevet/motion-diffusion-model',
		area: 'motion',
		powers: 'workers/model-text2motion: the default text-to-motion backend.',
	},
	{
		id: 'model:momask',
		name: 'MoMask',
		org: 'EricGuo5513',
		license: 'MIT',
		repo: 'https://github.com/EricGuo5513/momask-codes',
		area: 'motion',
		powers: 'workers/model-text2motion: the selectable alternate text-to-motion backend.',
	},
	{
		id: 'model:mediapipe-tasks',
		name: 'MediaPipe (PoseLandmarker, HandLandmarker, ImageSegmenter)',
		org: 'Google',
		license: 'Apache-2.0',
		repo: 'https://github.com/google-ai-edge/mediapipe',
		area: 'motion',
		powers: 'workers/model-video2motion: landmark and segmentation models the pose solver retargets onto the canonical rig.',
	},
	{
		id: 'model:lingbot-map',
		name: 'LingBot-Map',
		org: 'Robbyant',
		license: 'Apache-2.0',
		repo: 'https://github.com/Robbyant/lingbot-map',
		area: 'generation',
		powers: 'workers/model-video2scene: video-to-scene reconstruction.',
	},
	{
		id: 'model:asl-fingerspelling',
		name: 'Kaggle ASL Fingerspelling 1st place solution',
		org: 'ChristofHenkel',
		license: 'Apache-2.0 (code and weights); training data CC BY 4.0',
		repo: 'https://github.com/ChristofHenkel/kaggle-asl-fingerspelling-1st-place-solution',
		area: 'motion',
		powers: 'workers/model-asl-recognition: sign-language fingerspelling recognition.',
	},
	{
		id: 'model:quadriflow',
		name: 'QuadriFlow',
		org: 'hjwdzh',
		license: 'MIT',
		repo: 'https://github.com/hjwdzh/QuadriFlow',
		area: 'formats',
		powers: 'workers/remesh: quad remeshing.',
	},
	{
		id: 'model:xatlas',
		name: 'xatlas',
		org: 'jpcy',
		license: 'MIT',
		repo: 'https://github.com/jpcy/xatlas',
		area: 'formats',
		powers: 'workers/remesh: UV unwrapping for remeshed geometry.',
	},
	{
		id: 'model:manifold',
		name: 'Manifold',
		org: 'hjwdzh',
		license: 'MIT',
		repo: 'https://github.com/hjwdzh/Manifold',
		area: 'formats',
		powers: 'workers/remesh: watertight mesh repair.',
	},
	{
		id: 'model:rembg',
		name: 'rembg (with u2net and BiRefNet)',
		org: 'danielgatis, ZhengPeng7',
		license: 'MIT',
		repo: 'https://github.com/danielgatis/rembg',
		area: 'generation',
		powers: 'workers/rembg: background removal ahead of image-to-3D generation.',
	},
	{
		id: 'model:gltfpack',
		name: 'gltfpack (meshoptimizer)',
		org: 'zeux',
		license: 'MIT',
		repo: 'https://github.com/zeux/meshoptimizer',
		area: 'formats',
		powers: 'workers/stylize and every worker that decodes EXT_meshopt_compression on a caller-supplied mesh.',
	},
	{
		id: 'model:longcat-video-avatar',
		name: 'LongCat-Video-Avatar-1.5',
		org: 'Meituan',
		license: 'MIT',
		repo: 'https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5',
		area: 'generation',
		powers: 'workers/longcat: built and tested, not yet deployed to production.',
	},
];

// ---- asset sources and vendored/forked code --------------------------------
export const ASSET_SOURCES = [
	{
		id: 'asset:polyhaven',
		name: 'Poly Haven',
		license: 'CC0 1.0',
		repo: 'https://polyhaven.com',
		funding: 'https://www.polyhaven.com/donate',
		area: 'assets',
		powers: 'Every prop in the /objects library and the curated HDRI environment set, fetched by scripts/fetch-polyhaven-objects.mjs.',
	},
	{
		id: 'asset:kenney-graveyard',
		name: 'Kenney Graveyard Kit',
		license: 'CC0 1.0',
		repo: 'https://kenney.nl/assets/graveyard-kit',
		funding: 'https://kenney.nl/support',
		area: 'assets',
		powers: 'The 91 Halloween models in the /objects library and the whole /haunted graveyard, ingested by scripts/ingest-kenney-graveyard.mjs.',
	},
	{
		id: 'asset:mixamo',
		name: 'Mixamo',
		license: 'Adobe Mixamo Terms of Use (commercial use permitted, redistribution of raw clips not permitted)',
		repo: 'https://www.mixamo.com',
		funding: null,
		area: 'motion',
		powers: 'Most of the curated animation gallery at /animations (the "Studio" tier), exported under an authenticated Adobe account.',
	},
	{
		id: 'asset:quaternius',
		name: "Quaternius Universal Animation Library 2",
		license: 'CC0 1.0',
		repo: 'https://quaternius.com',
		funding: 'https://www.patreon.com/quaternius',
		area: 'motion',
		powers: 'Part of the bulk mocap library at GET /api/animations/library.',
	},
	{
		id: 'asset:mesh2motion',
		name: "Mesh2Motion human animation packs",
		license: 'CC0 1.0',
		repo: 'https://www.mesh2motion.org',
		funding: null,
		area: 'motion',
		powers: 'Part of the bulk mocap library at GET /api/animations/library.',
	},
	{
		id: 'vendor:modly',
		name: 'Modly',
		license: 'MIT',
		repo: 'https://github.com/lightningpixel/modly',
		funding: null,
		area: 'infrastructure',
		powers: 'The desktop app fork, the Modly GPU worker, and the workflow graph behind the Forge desktop and mesh-ops pipelines.',
	},
	{
		id: 'vendor:characterstudio',
		name: 'CharacterStudio',
		license: 'MIT',
		repo: 'https://github.com/M3-org/CharacterStudio',
		funding: null,
		area: 'infrastructure',
		powers: 'The trait-swapping avatar builder that runs inside the Avatar Creator iframe (character-studio/).',
	},
	{
		id: 'vendor:threejs-editor',
		name: 'three.js editor',
		license: 'MIT',
		repo: 'https://github.com/mrdoob/three.js',
		funding: null,
		area: 'rendering',
		powers: 'The vendored scene editor behind the Scene Studio (src/scene-studio/vendor/).',
	},
	{
		id: 'vendor:threeui',
		name: 'ThreeUI',
		license: 'MIT',
		repo: 'https://github.com/MengTo/threeui',
		funding: null,
		area: 'rendering',
		powers: 'A read, pattern-matched third-party source tree under third_party/threeui, not shipped to production.',
	},
	{
		id: 'vendor:openzeppelin',
		name: 'OpenZeppelin Contracts',
		license: 'MIT',
		repo: 'https://github.com/OpenZeppelin/openzeppelin-contracts',
		funding: 'https://github.com/sponsors/OpenZeppelin',
		area: 'infrastructure',
		powers: 'Audited Solidity building blocks for the EVM-chain contracts (contracts/lib/openzeppelin-contracts).',
	},
	{
		id: 'vendor:forge-std',
		name: 'forge-std',
		license: 'MIT or Apache-2.0',
		repo: 'https://github.com/foundry-rs/forge-std',
		funding: null,
		area: 'infrastructure',
		powers: 'Foundry testing helpers for the smart-contract test suite (contracts/lib/forge-std).',
	},
];

// ---- license overrides for packages with no declared license in their
// installed package.json -----------------------------------------------------
//
// Checked by hand against the upstream repository on 2026-10-13 because
// `npm` has no license field to fall back on for these.
const LICENSE_OVERRIDES = {
	// No LICENSE file and no license field anywhere in the livepeer/livepeer-js
	// repo, npm registry metadata, or README as of 2026-10-13.
	livepeer: 'not declared upstream (no LICENSE file; verify before redistribution)',
	// package.json omits the field, but the upstream repo
	// (solana-foundation/solana-attestation-service) carries an MIT LICENSE file.
	'sas-lib': 'MIT',
};

// ---- fallback classifier for every other npm dependency --------------------
function fallbackArea(name) {
	const n = name.toLowerCase();
	if (/ffmpeg|gltf|draco|meshopt|parquet|zip|compress/.test(n)) return 'formats';
	if (/three|rapier|bvh|pathtrac|webgl|gaussian|splat/.test(n)) return 'rendering';
	if (/voice|speech|tts|stt|lipsync|vad-/.test(n)) return 'voice';
	return 'infrastructure';
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function npmEntries() {
	const pkg = readJson(resolve(ROOT, 'package.json'));
	const names = [
		...Object.keys(pkg.dependencies || {}),
		...Object.keys(pkg.devDependencies || {}),
	].sort();
	const entries = [];
	for (const name of names) {
		const pkgJsonPath = resolve(ROOT, 'node_modules', name, 'package.json');
		if (!existsSync(pkgJsonPath)) continue; // reported separately by the build script
		const meta = readJson(pkgJsonPath);
		const curated = CURATED_PACKAGES[name];
		const repoField = meta.repository;
		const repo =
			typeof repoField === 'string'
				? repoField
				: repoField && typeof repoField === 'object'
					? repoField.url
					: meta.homepage || null;
		entries.push({
			id: `npm:${name}`,
			kind: 'npm',
			name,
			area: curated?.area || fallbackArea(name),
			license: meta.license || meta.licenses?.[0]?.type || LICENSE_OVERRIDES[name] || 'unknown',
			repo: normalizeRepoUrl(repo),
			funding: normalizeFunding(meta.funding),
			version: meta.version || null,
			powers: curated?.powers || null,
		});
	}
	return entries;
}

export function normalizeRepoUrl(repo) {
	if (!repo) return null;
	let url = repo
		.replace(/^git\+/, '')
		.replace(/\.git$/, '');
	if (/^git@([^:]+):(.+)$/.test(url)) {
		url = url.replace(/^git@([^:]+):(.+)$/, 'https://$1/$2');
	} else if (/^ssh:\/\/git@([^/]+)\/(.+)$/.test(url)) {
		url = url.replace(/^ssh:\/\/git@([^/]+)\/(.+)$/, 'https://$1/$2');
	} else if (/^[^/:]+\.[^/:]+:[^/]+\/[^/]+$/.test(url)) {
		url = url.replace(/^([^:]+):(.+)$/, 'https://$1/$2');
	} else if (/^[^/\s:]+\/[^/\s:]+$/.test(url)) {
		url = `https://github.com/${url}`;
	}
	return url
		.replace(/^git:\/\//, 'https://')
		.replace(/^github:/, 'https://github.com/');
}

function normalizeFunding(funding) {
	if (!funding) return null;
	if (typeof funding === 'string') return funding;
	if (Array.isArray(funding)) return normalizeFunding(funding[0]);
	return funding.url || null;
}

/** Build the full, deterministic credits dataset. Pure: no side effects. */
export function buildCredits() {
	const entries = [
		...npmEntries(),
		...WORKER_MODELS.map((m) => ({
			id: m.id,
			kind: 'model',
			name: m.name,
			area: m.area,
			license: m.license,
			repo: m.repo,
			funding: null,
			version: null,
			powers: m.powers,
			org: m.org,
		})),
		...ASSET_SOURCES.map((a) => ({
			id: a.id,
			kind: a.id.startsWith('vendor:') ? 'vendored' : 'asset',
			name: a.name,
			area: a.area,
			license: a.license,
			repo: a.repo,
			funding: a.funding || null,
			version: null,
			powers: a.powers,
		})),
	];
	for (const e of entries) {
		if (!AREA_IDS.has(e.area)) {
			throw new Error(`open-source-credits: entry "${e.id}" has an unknown area "${e.area}"`);
		}
	}
	entries.sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
	return { areas: AREAS, entries };
}
