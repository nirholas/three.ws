#!/usr/bin/env node
/**
 * Animation build pipeline.
 *
 * Reads Mixamo FBX clips listed in scripts/animations.config.json, retargets
 * them to the canonical Avaturn skeleton (cz.glb), and writes one GLB per
 * clip into public/animations/clips/. Also rewrites public/animations/manifest.json
 * to point only at clips that retargeted successfully.
 *
 * Why pre-bake?
 *   - On-chain agents must animate without runtime retargeting fragility.
 *   - Browser cold-loads should not re-parse FBX or guess bone names.
 *   - Build-time validation = clips that don't survive retargeting are dropped
 *     here, not silently broken in production.
 *
 * Run via: npm run build:animations
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { Blob } from 'node:buffer';

// three's loaders + exporter touch a handful of DOM globals; stub them out for node.
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({}) };
globalThis.Blob = Blob;

// GLTFExporter calls FileReader.readAsDataURL on Blob-wrapped texture/binary
// chunks. Node has no FileReader; the minimal stub below handles the two
// methods three's exporter actually invokes.
class NodeFileReader extends EventTarget {
	readAsDataURL(blob) {
		blob.arrayBuffer().then((buf) => {
			const b64 = Buffer.from(buf).toString('base64');
			this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
			this.onload?.({ target: this });
			this.dispatchEvent(new Event('load'));
		});
	}
	readAsArrayBuffer(blob) {
		blob.arrayBuffer().then((buf) => {
			this.result = buf;
			this.onload?.({ target: this });
			this.dispatchEvent(new Event('load'));
		});
	}
}
globalThis.FileReader = NodeFileReader;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ANIM_DIR = resolve(ROOT, 'public/animations');
const OUT_DIR = resolve(ANIM_DIR, 'clips');
const REFERENCE_GLB = resolve(ROOT, 'public/avatars/cz.glb');
const CONFIG = resolve(__dirname, 'animations.config.json');
const MANIFEST_OUT = resolve(ANIM_DIR, 'manifest.json');

const MIXAMO_PREFIX = /^mixamorig\d*[_:]?/i;
// Mixamo FBX exports hip translation in centimeters relative to the rig's
// natural scale. FBXLoader applies a 0.01 unit scale (cm→m), but the hip
// translation track itself is a *delta* baked into the clip and survives that
// rescale. We rescale the hips position track to match Avaturn's meter rig.
// 0.01 = the empirical factor that lands feet on the ground for the Avaturn
// rig (verified against cz.glb). Adjust here if a future rig diverges.
const HIPS_POSITION_SCALE = 0.01;

async function loadGLB(path) {
	const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
	const buf = readFileSync(path);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const loader = new GLTFLoader();
	return new Promise((res, rej) => loader.parse(ab, '', res, rej));
}

async function loadFBX(path) {
	const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
	const buf = readFileSync(path);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const loader = new FBXLoader();
	return loader.parse(ab, '');
}

function collectBoneNames(root) {
	const names = new Set();
	root.traverse((n) => {
		if (n.isBone) names.add(n.name);
	});
	return names;
}

/**
 * Retarget a single clip from a Mixamo skeleton to the canonical Avaturn rig.
 *
 * @param {import('three').AnimationClip} clip
 * @param {Set<string>} avaturnBones
 * @returns {{ clip: import('three').AnimationClip, matched: number, total: number, dropped: string[] }}
 */
function retargetClip(clip, avaturnBones) {
	const dropped = [];
	const newTracks = [];
	for (const track of clip.tracks) {
		const dot = track.name.indexOf('.');
		const boneRaw = track.name.slice(0, dot);
		const property = track.name.slice(dot + 1);
		const stripped = boneRaw.replace(MIXAMO_PREFIX, '');
		if (!avaturnBones.has(stripped)) {
			dropped.push(boneRaw);
			continue;
		}
		const newTrack = track.clone();
		newTrack.name = `${stripped}.${property}`;
		// Mixamo bakes hip translation in cm even after FBXLoader rescaling.
		// Without this, the avatar floats ~100m in the air for clips that have
		// vertical motion (Joyful Jump, Falling, etc.) and slides off-screen
		// for any clip with horizontal motion.
		if (stripped === 'Hips' && property === 'position') {
			for (let i = 0; i < newTrack.values.length; i++) {
				newTrack.values[i] *= HIPS_POSITION_SCALE;
			}
		}
		newTracks.push(newTrack);
	}
	const out = clip.clone();
	out.tracks = newTracks;
	return { clip: out, matched: newTracks.length, total: clip.tracks.length, dropped };
}

/**
 * Build a minimal scene containing only the bone hierarchy from a reference
 * skinned model. Skips meshes/textures so each exported clip GLB stays small
 * (~bone count × keyframes) instead of carrying a copy of the avatar mesh.
 */
async function buildBonesOnlyScene(referenceScene) {
	const { Scene } = await import('three');
	const scene = new Scene();
	scene.name = 'AnimationRig';
	// Find the root bone (first bone with no bone parent) and clone the bone tree.
	let rootBone = null;
	referenceScene.traverse((n) => {
		if (n.isBone && !rootBone && (!n.parent || !n.parent.isBone)) rootBone = n;
	});
	if (!rootBone) throw new Error('reference scene has no bones');
	scene.add(rootBone.clone(true));
	return scene;
}

async function exportClipAsGLB(clip, bonesScene) {
	const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
	const exporter = new GLTFExporter();
	return new Promise((resolve, reject) => {
		exporter.parse(
			bonesScene,
			(arrayBuffer) => resolve(Buffer.from(arrayBuffer)),
			(err) => reject(err),
			{ binary: true, animations: [clip], onlyVisible: false },
		);
	});
}

async function main() {
	const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
	if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
	mkdirSync(OUT_DIR, { recursive: true });

	console.log('[animations] loading reference Avaturn rig:', basename(REFERENCE_GLB));
	const reference = await loadGLB(REFERENCE_GLB);
	const avaturnBones = collectBoneNames(reference.scene);
	console.log(`[animations] reference rig has ${avaturnBones.size} bones`);

	const bonesScene = await buildBonesOnlyScene(reference.scene);

	const manifest = [];
	let okCount = 0;
	let failCount = 0;

	for (const def of config) {
		const fbxPath = resolve(ANIM_DIR, def.source);
		if (!existsSync(fbxPath)) {
			console.warn(`[animations] SKIP ${def.name}: missing source ${def.source}`);
			failCount++;
			continue;
		}
		try {
			const fbx = await loadFBX(fbxPath);
			const sourceClip = fbx.animations?.[0];
			if (!sourceClip) {
				console.warn(`[animations] SKIP ${def.name}: no clip in FBX`);
				failCount++;
				continue;
			}
			const { clip, matched, total, dropped } = retargetClip(sourceClip, avaturnBones);
			const matchPct = (matched / total) * 100;
			if (matchPct < 60) {
				console.warn(
					`[animations] SKIP ${def.name}: only ${matchPct.toFixed(0)}% bones matched`,
				);
				failCount++;
				continue;
			}
			clip.name = def.name;
			const glbBytes = await exportClipAsGLB(clip, bonesScene);
			const outName = `${def.name}.glb`;
			writeFileSync(resolve(OUT_DIR, outName), glbBytes);
			manifest.push({
				name: def.name,
				url: `/animations/clips/${outName}`,
				label: def.label,
				icon: def.icon,
				loop: def.loop !== false,
			});
			okCount++;
			const droppedNote = dropped.length ? ` (dropped ${dropped.length} unknown bones)` : '';
			console.log(
				`[animations] OK   ${def.name.padEnd(12)} ${matched}/${total} tracks, ${(glbBytes.length / 1024).toFixed(0)}kB${droppedNote}`,
			);
		} catch (err) {
			console.warn(`[animations] FAIL ${def.name}: ${err.message}`);
			failCount++;
		}
	}

	writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`\n[animations] wrote manifest with ${manifest.length} clips → ${MANIFEST_OUT}`);
	console.log(`[animations] ${okCount} ok, ${failCount} failed`);
	if (okCount === 0) process.exit(1);
}

main().catch((err) => {
	console.error('[animations] build failed:', err);
	process.exit(1);
});
