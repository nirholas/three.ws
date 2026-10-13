#!/usr/bin/env node
/**
 * CC0 animation library pipeline: the Mixamo-free replacement for the bulk
 * motion library (api/animations/library.js).
 *
 * Adobe's Mixamo FAQ permits royalty-free use of its animations inside a
 * project but forbids redistributing the raw character/animation files
 * ("really the only thing you can't do is distribute the raw character and
 * animation files", community.adobe.com/t5/mixamo-discussions/mixamo-faq-
 * licensing-royalties-ownership-eula-and-tos/m-p/13234775). The bulk library
 * endpoint and scripts/mirror-animation-library.mjs exist precisely so third
 * parties can mirror the raw clip files, so a Mixamo bake was never safe to
 * publish there. This script bakes the library from two CC0 sources instead:
 *
 *   - Quaternius's Universal Animation Library 2 (CC0 1.0, quaternius.com),
 *     mirrored on OpenGameArt: https://opengameart.org/content/universal-animation-library-2
 *   - Mesh2Motion's human animation packs (CC0 1.0 per LICENSE-CC0.MD in
 *     github.com/Mesh2Motion/mesh2motion-app, "All 3d models, blend files,
 *     rigs, animations" are CC0; only the app code is MIT)
 *
 * Both ship as multi-clip GLBs on a non-Mixamo humanoid skeleton (Unreal
 * mannequin bone names: `pelvis`, `clavicle_l`, `upperarm_l`, and so on),
 * which build-animations.mjs's retargeter now canonicalizes via the same
 * bone-name map every uploaded avatar rig retargets through
 * (src/glb-canonicalize.js), so no separate conversion code is needed: it's
 * the same pipeline the curated set and the old Mixamo bake used, pointed at
 * different sources.
 *
 * Phases (resumable, same shape as scripts/mixamo-all.mjs):
 *
 *   --fetch      Download the two CC0 packs into animation-sources/cc0/
 *                (gitignored; re-run is a no-op once present).
 *   --enumerate  Open every source GLB, list its AnimationClips, and write
 *                scripts/cc0-library.config.json (committed, it's the
 *                provenance record: every entry names its source pack and
 *                CC0 license).
 *   --build      Retarget every config entry via build-animations.mjs into
 *                animation-sources/.cc0-library-clips/.
 *   --upload     Publish the staged clips + manifest to R2 at the same keys
 *                api/animations/library.js reads
 *                (animations/library/manifest.json), each entry carrying
 *                `source` and `license`.
 *
 *   node scripts/cc0-animation-library.mjs              # all phases
 *   node scripts/cc0-animation-library.mjs --enumerate  # regenerate config only
 *   node scripts/cc0-animation-library.mjs --upload     # needs S3_* creds
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const flags = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		return m ? [m[1], m[2] ?? true] : [a, true];
	}),
);
const ALL = !Object.keys(flags).length || flags.all;
const RUN_FETCH = flags.fetch || ALL;
const RUN_ENUMERATE = flags.enumerate || ALL;
const RUN_BUILD = flags.build || ALL;
const RUN_UPLOAD = flags.upload || ALL;

const SOURCES_DIR = join(ROOT, 'animation-sources/cc0');
const CONFIG_PATH = join(__dirname, 'cc0-library.config.json');
const STAGE_DIR = join(ROOT, 'animation-sources/.cc0-library-clips');
const STAGE_MANIFEST = join(STAGE_DIR, 'manifest.json');
const R2_PREFIX = 'animations/library';

// ── Pack registry ────────────────────────────────────────────────────────────
// Every pack names its exact license file/sentence so a future re-check (the
// partners campaign's standing rule: re-read the LICENSE on the day you adopt
// anything) has a fixed target instead of a vague "we checked once".
const PACKS = [
	{
		id: 'qt',
		name: 'Quaternius Universal Animation Library 2',
		license: 'CC0 1.0 Universal',
		licenseUrl: 'https://quaternius.com/packs/universalanimationlibrary2.html',
		url: 'https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip',
		kind: 'zip',
		// Path inside the zip to the GLB we bake from (Unreal/Godot export,
		// already a single rig+clip GLB, no Blender step needed).
		zipGlbPath: 'Unreal-Godot/UAL2_Standard.glb',
		file: join(SOURCES_DIR, 'quaternius/UAL2_Standard.glb'),
		skip: ['A_TPose'],
	},
	{
		id: 'm2m-base',
		name: 'Mesh2Motion human-base-animations',
		license: 'CC0 1.0 Universal',
		licenseUrl: 'https://github.com/Mesh2Motion/mesh2motion-app/blob/main/LICENSE-CC0.MD',
		url: 'https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/static/animations/human-base-animations.glb',
		kind: 'glb',
		file: join(SOURCES_DIR, 'mesh2motion/human-base-animations.glb'),
		skip: [],
	},
	{
		id: 'm2m-addon',
		name: 'Mesh2Motion human-addon-animations',
		license: 'CC0 1.0 Universal',
		licenseUrl: 'https://github.com/Mesh2Motion/mesh2motion-app/blob/main/LICENSE-CC0.MD',
		url: 'https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/static/animations/human-addon-animations.glb',
		kind: 'glb',
		file: join(SOURCES_DIR, 'mesh2motion/human-addon-animations.glb'),
		skip: ['Rest Pose'],
	},
	{
		id: 'm2m-mocap',
		name: 'Mesh2Motion human-mocap-animations',
		license: 'CC0 1.0 Universal',
		licenseUrl: 'https://github.com/Mesh2Motion/mesh2motion-app/blob/main/LICENSE-CC0.MD',
		url: 'https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/static/animations/human-mocap-animations.glb',
		kind: 'glb',
		file: join(SOURCES_DIR, 'mesh2motion/human-mocap-animations.glb'),
		skip: [],
	},
];

// ── Slug / icon / loop helpers (same heuristics as scripts/mixamo-all.mjs) ──
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ICON_MAP = [
	[/dance|shuffle|twerk|hip.?hop|disco|breakdance|charleston/i, '💃'],
	[/walk|stride|stroll|march|sneak|creep|crawl/i, '🚶'],
	[/run|sprint|jog|dash|chase/i, '🏃'],
	[/jump|leap|hop|vault|flip|aerial|ninjajump/i, '🦘'],
	[/fight|punch|kick|combat|attack|hit|strike|block|dodge|parry|melee/i, '🥊'],
	[/zombie|monster|creature|undead/i, '🧟'],
	[/wave|greet|hello|bye|salute/i, '👋'],
	[/taunt|insult|mock|point|angry/i, '😤'],
	[/idle|stand|wait|breath/i, '🧍'],
	[/sit|crouch|kneel|squat|lay|ledge|hang/i, '🪑'],
	[/cheer|celebrate|victory|happy|joy|clap|power.?up/i, '🎉'],
	[/dizzy|confused|shiver|hurt/i, '😵'],
	[/death|die|defeat|knockback/i, '💀'],
	[/climb|scale|ladder/i, '🧗'],
	[/swim|dive|fishing/i, '🎣'],
	[/shoot|aim|pistol|gun|reload/i, '🔫'],
	[/sword|blade|slash|shield/i, '⚔️'],
	[/fly|glide|levitate/i, '🪽'],
	[/farm|harvest|plant|water(?:ing)?/i, '🌱'],
	[/consume|eat|drink/i, '🍽️'],
	[/golf|sport/i, '⛳'],
	[/push.?up|jumping.?jack|workout|meditate/i, '🏋️'],
];
const iconFor = (label) => {
	for (const [re, icon] of ICON_MAP) if (re.test(label)) return icon;
	return '🎬';
};
const loopFor = (name, label) => {
	if (/loop/i.test(name)) return true;
	return /idle|walk|run|stand|wait|breath|cycle|patrol|sneak|crawl|jog|march|swim|drive|fly|glide|levitate|crouch_idle|sitting_idle/i.test(
		label,
	);
};
const labelFor = (name) =>
	name
		.replace(/_RM$/, ' (Root Motion)')
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.trim()
		.replace(/\s+/g, ' ');

// ── Phase: fetch ─────────────────────────────────────────────────────────────
async function fetchPacks() {
	console.log('\n── Phase: fetch CC0 packs ──────────────────────────────────');
	for (const pack of PACKS) {
		if (existsSync(pack.file)) {
			console.log(`  present  ${pack.id} → ${pack.file.replace(ROOT + '/', '')}`);
			continue;
		}
		mkdirSync(dirname(pack.file), { recursive: true });
		console.log(`  fetch    ${pack.id} ← ${pack.url}`);
		if (pack.kind === 'glb') {
			const res = await fetch(pack.url);
			if (!res.ok) throw new Error(`${pack.id}: HTTP ${res.status} fetching ${pack.url}`);
			await pipeline(Readable.fromWeb(res.body), createWriteStream(pack.file));
		} else if (pack.kind === 'zip') {
			const zipPath = `${pack.file}.download.zip`;
			const res = await fetch(pack.url);
			if (!res.ok) throw new Error(`${pack.id}: HTTP ${res.status} fetching ${pack.url}`);
			await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
			const extractDir = `${pack.file}.extract`;
			const unzip = spawnSync('unzip', ['-o', '-q', zipPath, '-d', extractDir]);
			if (unzip.status !== 0) throw new Error(`${pack.id}: unzip failed: ${unzip.stderr}`);
			const { execFileSync } = await import('node:child_process');
			const foundPath = execFileSync('find', [extractDir, '-name', '*.glb'], { encoding: 'utf8' })
				.split('\n')
				.find((p) => p.includes(pack.zipGlbPath.split('/').pop()));
			if (!foundPath) throw new Error(`${pack.id}: ${pack.zipGlbPath} not found in zip`);
			const { copyFileSync, rmSync } = await import('node:fs');
			copyFileSync(foundPath, pack.file);
			rmSync(extractDir, { recursive: true, force: true });
			rmSync(zipPath, { force: true });
		}
	}
	console.log('  ✅ all packs present');
}

// ── Phase: enumerate ─────────────────────────────────────────────────────────
// three's loaders touch a handful of DOM globals; stub them for node (same
// shim as build-animations.mjs: duplicated here because this phase runs
// before build-animations.mjs is spawned as a subprocess).
function installDomShims() {
	globalThis.self = globalThis;
	globalThis.window = globalThis;
	class FakeImage extends EventTarget {
		constructor() {
			super();
			this._src = '';
			this.style = {};
			this.complete = false;
			this.naturalWidth = 1;
			this.naturalHeight = 1;
		}
		get src() {
			return this._src;
		}
		set src(value) {
			this._src = value;
			setTimeout(() => {
				this.complete = true;
				this.onload?.({ target: this });
				this.dispatchEvent(new Event('load'));
			}, 0);
		}
		setAttribute() {}
	}
	globalThis.document = { createElementNS: () => new FakeImage(), createElement: () => new FakeImage() };
	globalThis.Image = FakeImage;
}

async function loadGLBAnimations(path) {
	installDomShims();
	const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
	const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
	const buf = readFileSync(path);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
	return gltf.animations;
}

async function enumerate() {
	console.log('\n── Phase: enumerate clips ──────────────────────────────────');
	const entries = [];
	const seen = new Set();
	for (const pack of PACKS) {
		if (!existsSync(pack.file)) {
			console.warn(`  ⚠️  ${pack.id}: source missing (run --fetch first), skipping`);
			continue;
		}
		const animations = await loadGLBAnimations(pack.file);
		let kept = 0;
		for (const anim of animations) {
			if (pack.skip.includes(anim.name)) continue;
			const name = `${pack.id}-${slugify(anim.name)}`;
			if (seen.has(name)) {
				console.warn(`  ⚠️  duplicate slug ${name} (source clip "${anim.name}"), skipped`);
				continue;
			}
			seen.add(name);
			const label = labelFor(anim.name);
			entries.push({
				name,
				source: pack.file.replace(join(ROOT, 'animation-sources') + '/', ''),
				sourceClip: anim.name,
				label,
				icon: iconFor(label),
				loop: loopFor(anim.name, label),
				source_name: pack.name,
				license: pack.license,
				license_url: pack.licenseUrl,
			});
			kept++;
		}
		console.log(`  ${pack.id.padEnd(10)} ${kept}/${animations.length} clips kept`);
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	writeFileSync(CONFIG_PATH, JSON.stringify(entries, null, '\t') + '\n');
	console.log(`  ✅ ${entries.length} clips → scripts/cc0-library.config.json`);
	return entries.length;
}

// ── Phase: build ─────────────────────────────────────────────────────────────
function build() {
	console.log('\n── Phase: build (retarget via build-animations.mjs) ────────');
	if (!existsSync(CONFIG_PATH)) {
		console.log('  ⚠️  No config, run --enumerate first.');
		return false;
	}
	const result = spawnSync(
		process.execPath,
		[
			join(__dirname, 'build-animations.mjs'),
			'--config=scripts/cc0-library.config.json',
			'--out=animation-sources/.cc0-library-clips',
			'--manifest=animation-sources/.cc0-library-clips/manifest.json',
			'--url-prefix=clips/',
		],
		{ cwd: ROOT, stdio: 'inherit' },
	);
	if (result.status !== 0) {
		console.error(`\n  ❌ Build failed (exit ${result.status})`);
		return false;
	}
	console.log('\n  ✅ Build complete.');
	return true;
}

// ── Phase: upload ────────────────────────────────────────────────────────────
function loadEnv(key) {
	if (process.env[key]) return process.env[key].trim();
	const p = join(ROOT, '.env.local');
	if (existsSync(p)) {
		const line = readFileSync(p, 'utf8')
			.split('\n')
			.find((l) => l.startsWith(`${key}=`));
		if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
	}
	return null;
}

async function upload() {
	console.log('\n── Phase: upload to R2 ─────────────────────────────────────');
	const accountId = loadEnv('R2_ACCOUNT_ID');
	const endpoint = loadEnv('S3_ENDPOINT') || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
	const accessKeyId = loadEnv('S3_ACCESS_KEY_ID') || loadEnv('R2_ACCESS_KEY_ID');
	const secretAccessKey = loadEnv('S3_SECRET_ACCESS_KEY') || loadEnv('R2_SECRET_ACCESS_KEY');
	const bucket = loadEnv('S3_BUCKET') || loadEnv('R2_BUCKET');
	const publicDomain = (loadEnv('S3_PUBLIC_DOMAIN') || '').replace(/\/+$/, '');

	if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicDomain) {
		console.log('  ⚠️  Storage creds missing, skipping upload.');
		console.log('  Needs S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_PUBLIC_DOMAIN.');
		return false;
	}
	if (!existsSync(STAGE_MANIFEST)) {
		console.log('  ⚠️  No staged library, run --build first.');
		return false;
	}

	const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
	const client = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

	const staged = JSON.parse(readFileSync(STAGE_MANIFEST, 'utf8'));
	let uploaded = 0;
	const clips = [];
	const queue = [...staged];

	async function worker() {
		while (queue.length) {
			const entry = queue.shift();
			const file = join(STAGE_DIR, `${entry.name}.json`);
			if (!existsSync(file)) continue;
			const body = readFileSync(file);
			const key = `${R2_PREFIX}/clips/${entry.name}.json`;
			await client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: body,
					ContentType: 'application/json',
					CacheControl: 'public, max-age=86400',
				}),
			);
			uploaded++;
			clips.push({
				name: entry.name,
				label: entry.label,
				icon: entry.icon,
				loop: entry.loop !== false,
				...(entry.duration ? { duration: entry.duration } : {}),
				bytes: body.length,
				url: `${publicDomain}/${key}`,
				source: entry.source,
				license: entry.license,
			});
			if (uploaded % 25 === 0) process.stdout.write(`\r  ${uploaded} uploaded…`);
		}
	}
	await Promise.all(Array.from({ length: 8 }, worker));

	clips.sort((a, b) => a.name.localeCompare(b.name));
	const manifest = { generated_at: new Date().toISOString(), total: clips.length, clips };
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `${R2_PREFIX}/manifest.json`,
			Body: JSON.stringify(manifest),
			ContentType: 'application/json',
			CacheControl: 'public, max-age=300',
		}),
	);
	console.log(`\n  ✅ Upload: ${uploaded} clips → ${R2_PREFIX}/manifest.json (${clips.length} total)`);
	return true;
}

(async () => {
	console.log('🎬 CC0 animation library pipeline\n');
	if (RUN_FETCH) await fetchPacks();
	if (RUN_ENUMERATE) await enumerate();
	if (RUN_BUILD) build();
	if (RUN_UPLOAD) await upload();
})().catch((err) => {
	console.error('[cc0-animation-library] failed:', err);
	process.exit(1);
});
