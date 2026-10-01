// The client posing stack, shipped into a headless-chromium render page.
//
// src/pose-rig.js + src/glb-canonicalize.js + src/pose-mannequin.js are pure
// three.js ESM, so a render page can run the EXACT code the browser runs:
// canonical bone-name mapping for every rig convention we support, and
// world-delta preset retargeting (poseFromMannequinPreset then
// GltfRig.applyPose) that lands a preset on top of any bind stance.
//
// The sources go to the page as data: URL modules in its import map, with
// pose-rig's relative imports rewritten to the bare specifiers the map
// defines. Never reintroduce a hand-rolled alias table in a renderer: one
// silently missed every Mixamo rig (GLTFLoader strips ':' from node names) and
// stomped absolute local Eulers over bind rotations on the rest, so
// /api/render/avatar-clip answered 200 with an unposed model.

import { readFileSync } from 'node:fs';

const SRC_DIR = new URL('../../src/', import.meta.url);

function poseModuleDataUrl(file, rewrites = []) {
	let code = readFileSync(new URL(file, SRC_DIR), 'utf8');
	for (const [from, to] of rewrites) code = code.replaceAll(from, to);
	if (/from\s+['"]\.{1,2}\//.test(code)) {
		throw new Error(`pose-runtime: ${file} still has relative imports after rewrite, update poseRuntimeModules()`);
	}
	return 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');
}

let _poseRuntimeModules = null;

/**
 * Import-map entries for the posing stack, built once per container.
 *
 * @returns {{['glb-canonicalize']:string,['pose-mannequin']:string,['pose-rig']:string}}
 */
export function poseRuntimeModules() {
	if (_poseRuntimeModules) return _poseRuntimeModules;
	_poseRuntimeModules = {
		'glb-canonicalize': poseModuleDataUrl('glb-canonicalize.js'),
		'pose-mannequin': poseModuleDataUrl('pose-mannequin.js'),
		'pose-rig': poseModuleDataUrl('pose-rig.js', [
			["from './glb-canonicalize.js'", "from 'glb-canonicalize'"],
			["from './pose-mannequin.js'", "from 'pose-mannequin'"],
		]),
	};
	return _poseRuntimeModules;
}

// ── Thumbnail rest pose ──────────────────────────────────────────────────────
//
// src/thumbnail-pose.js poses an avatar through AnimationManager, which pulls in
// the whole retargeting stack. Rather than hand-list a rewrite per file (the
// pattern above, fine for three modules), walk the module graph from the entry
// and give every src/ file one bare specifier, `tws/<path relative to src>`, so
// a new import in any of them ships automatically instead of 404ing the page.

const THUMBNAIL_POSE_ENTRY = 'thumbnail-pose.js';
export const THUMBNAIL_POSE_SPECIFIER = `tws/${THUMBNAIL_POSE_ENTRY}`;

// Static `import … from './x.js'`, `export … from '../y.js'` and bare
// `import './z.js'`. Only relative specifiers: 'three' and its addons resolve
// through the page's own import map.
const RELATIVE_IMPORT_RE = /(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

function srcPath(fromFile, spec) {
	const url = new URL(spec, new URL(fromFile, SRC_DIR));
	return url.href.slice(SRC_DIR.href.length);
}

let _thumbnailPoseModules = null;

/**
 * Import-map entries for src/thumbnail-pose.js and everything it imports, as
 * data: URL modules. Built once per container.
 *
 * @returns {Record<string,string>} specifier → data: URL
 */
export function thumbnailPoseModules() {
	if (_thumbnailPoseModules) return _thumbnailPoseModules;
	const modules = {};
	const pending = [THUMBNAIL_POSE_ENTRY];
	const seen = new Set();
	while (pending.length) {
		const file = pending.shift();
		if (seen.has(file)) continue;
		seen.add(file);
		const source = readFileSync(new URL(file, SRC_DIR), 'utf8');
		const code = source.replace(RELATIVE_IMPORT_RE, (_m, lead, quote, spec) => {
			const target = srcPath(file, spec);
			pending.push(target);
			return `${lead}${quote}tws/${target}${quote}`;
		});
		if (/\bimport\s*\(\s*['"]\.{1,2}\//.test(code)) {
			throw new Error(`pose-runtime: ${file} has a relative dynamic import a render page cannot resolve`);
		}
		modules[`tws/${file}`] = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');
	}
	_thumbnailPoseModules = modules;
	return modules;
}

let _thumbnailPoseClip = null;

/**
 * The frozen rest pose every server-rendered thumbnail is posed with: the
 * library clip named by THUMBNAIL_POSE_CLIP, read from the motion library baked
 * into the image (public/animations/clips/) and sampled once per container.
 *
 * @returns {Promise<object>} AnimationClip JSON (see sampleClipPose)
 */
export async function thumbnailPoseClip() {
	if (_thumbnailPoseClip) return _thumbnailPoseClip;
	const { sampleClipPose, THUMBNAIL_POSE_CLIP, THUMBNAIL_POSE_TIME } = await import('../../src/thumbnail-pose.js');
	const file = new URL(`../../public/animations/clips/${THUMBNAIL_POSE_CLIP}.json`, import.meta.url);
	_thumbnailPoseClip = sampleClipPose(JSON.parse(readFileSync(file, 'utf8')), THUMBNAIL_POSE_TIME);
	return _thumbnailPoseClip;
}
