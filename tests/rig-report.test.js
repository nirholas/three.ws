// Rig report tests — run against the real GLBs shipped in public/avatars rather
// than synthetic fixtures. Those files are the exact rigs the platform serves,
// so a regression here is a regression a user would actually hit, and the suite
// covers every verdict level without anyone having to hand-author a broken rig.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	analyzeGlb,
	detectConvention,
	readGlbJson,
	manifestFromReport,
	formatBytes,
	MIN_CANONICAL_BONES,
	CANONICAL_TOTAL,
	CONVENTION_COUNT,
	LIMB_GROUPS,
	CONVENTIONS,
} from '../src/rig-report.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function load(name) {
	const buf = readFileSync(join(ROOT, 'public/avatars', `${name}.glb`));
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function report(name) {
	return analyzeGlb(load(name), { fileName: `${name}.glb` });
}

function documentedRigConventions() {
	const doc = readFileSync(join(ROOT, 'docs/rig-doctor.md'), 'utf8');
	const rows = [];
	for (const match of doc.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|$/gm)) {
		const convention = match[1].trim();
		if (convention === 'Convention' || /^-+$/.test(convention)) continue;
		rows.push({ convention, detectedBy: match[2].trim(), schema: match[3].trim() });
	}
	return rows;
}

// A JSON-only GLB built from a joint tree, so a rig convention can be checked
// without committing a binary fixture. `tree` is [name, ...children] nested.
function syntheticRig(tree) {
	const nodes = [{ name: 'Body', mesh: 0, skin: 0 }];
	const joints = [];
	const add = ([name, ...children]) => {
		const index = nodes.length;
		const node = { name };
		nodes.push(node);
		joints.push(index);
		const kids = children.map(add);
		if (kids.length) node.children = kids;
		return index;
	};
	const rootJoint = add(tree);
	const json = {
		asset: { version: '2.0' },
		nodes,
		meshes: [{ name: 'Body', primitives: [{ attributes: {} }] }],
		skins: [{ joints }],
		scenes: [{ nodes: [0, rootJoint] }],
	};
	let bytes = new TextEncoder().encode(JSON.stringify(json));
	const pad = (4 - (bytes.length % 4)) % 4;
	if (pad) {
		const padded = new Uint8Array(bytes.length + pad).fill(0x20);
		padded.set(bytes);
		bytes = padded;
	}
	const out = new Uint8Array(20 + bytes.length);
	const v = new DataView(out.buffer);
	v.setUint32(0, 0x46546c67, true);
	v.setUint32(4, 2, true);
	v.setUint32(8, out.length, true);
	v.setUint32(12, bytes.length, true);
	v.setUint32(16, 0x4e4f534a, true);
	out.set(bytes, 20);
	return out.buffer;
}

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const fingerChains = (prefix) => FINGERS.map((f) => [`${prefix}${f}1`, [`${prefix}${f}2`, [`${prefix}${f}3`]]]);

// A HumanIK skeleton in the given spelling (`Character1:` or `Character1`).
function humanIkTree(ns) {
	const n = (b) => `${ns}${b}`;
	const arm = (side) => [n(`${side}Shoulder`), [n(`${side}Arm`), [n(`${side}ForeArm`), [n(`${side}Hand`), ...fingerChains(n(`${side}Hand`))]]]];
	const leg = (side) => [n(`${side}UpLeg`), [n(`${side}Leg`), [n(`${side}Foot`), [n(`${side}ToeBase`)]]]];
	return [n('Hips'), [n('Spine'), [n('Spine1'), [n('Spine2'), [n('Neck'), [n('Head')]], arm('Left'), arm('Right')]]], leg('Left'), leg('Right')];
}

describe('readGlbJson', () => {
	it('rejects a file that is not a GLB with a message a creator can act on', () => {
		const notGlb = new TextEncoder().encode('this is plainly not a binary glTF file');
		expect(() => readGlbJson(notGlb.buffer)).toThrow(/Export as \.glb/);
	});

	it('rejects a truncated buffer instead of reading past its end', () => {
		expect(() => readGlbJson(new ArrayBuffer(8))).toThrow(/too small/);
	});

	it('reports a truncated JSON chunk rather than throwing a RangeError', () => {
		// Valid header claiming a 4 KB JSON chunk in a 40-byte file.
		const buf = new ArrayBuffer(40);
		const v = new DataView(buf);
		v.setUint32(0, 0x46546c67, true);
		v.setUint32(4, 2, true);
		v.setUint32(8, 40, true);
		v.setUint32(12, 4096, true);
		v.setUint32(16, 0x4e4f534a, true);
		expect(() => readGlbJson(buf)).toThrow(/runs past the end/);
	});
});

describe('detectConvention fingerprints', () => {
	const ctx = (joints, meshNames = []) => ({ joints, meshNames, json: {} });

	it('keeps documented rig conventions in sync with the detector', () => {
		const implemented = CONVENTIONS.filter((c) => c.id !== 'unknown');
		const docs = documentedRigConventions();
		const implementedLabels = implemented.map((c) => c.label);
		const documentedLabels = docs.map((row) => row.convention);

		expect(documentedLabels).toEqual(implementedLabels);
		for (const convention of implemented) {
			expect(convention.evidence, `${convention.label} evidence`).toEqual(expect.any(String));
			expect(convention.evidence.trim(), `${convention.label} evidence`).not.toBe('');
		}
	});

	it('identifies an MMD rig from its Japanese PMX bone names', () => {
		const c = detectConvention(ctx(['センター', '上半身', '左腕', '左ひじ', '右ひざ']));
		expect(c.id).toBe('mmd');
		expect(c.label).toBe('MikuMikuDance (PMX/PMD)');
	});

	it('identifies a Source engine rig and ranks it above plain Biped', () => {
		const c = detectConvention(ctx(['ValveBiped.Bip01_Pelvis', 'ValveBiped.Bip01_L_UpperArm', 'ValveBiped.Bip01_Head1']));
		expect(c.id).toBe('source');
		expect(detectConvention(ctx(['ValveBipedBip01_Pelvis'])).id).toBe('source');
		expect(detectConvention(ctx(['Bip01 Pelvis', 'Bip01 L UpperArm'])).id).toBe('biped');
	});

	it('does not claim MMD for a Latin-named rig', () => {
		expect(detectConvention(ctx(['Hips', 'Spine', 'LeftArm', 'RightArm'])).id).not.toBe('mmd');
	});

	it('identifies Apple joint-suffixed rigs', () => {
		const c = detectConvention(ctx(['hips_joint', 'spine_joint', 'left_arm_joint', 'right_arm_joint']));
		expect(c.id).toBe('apple-joint');
	});

	it('identifies Kinect rigs without confusing SpineShoulder for a limb', () => {
		const c = detectConvention(ctx(['SpineBase', 'SpineMid', 'SpineShoulder', 'ShoulderLeft', 'KneeRight']));
		expect(c.id).toBe('kinect');
	});

	it('identifies MediaPipe Pose from its unique foot landmarks', () => {
		const c = detectConvention(ctx(['left_hip', 'left_knee', 'left_heel', 'right_foot_index']));
		expect(c.id).toBe('mediapipe');
	});

	it('reports unknown rather than guessing when nothing fingerprints', () => {
		expect(detectConvention(ctx(['bone_a', 'bone_b', 'bone_c'])).id).toBe('unknown');
	});
});

describe('analyzeGlb verdicts', () => {
	it('passes the canonical Avaturn reference rig with every joint mapped', () => {
		const r = report('cz');
		expect(r.verdict.level).toBe('pass');
		expect(r.skeleton.convention.id).toBe('avaturn');
		expect(r.skeleton.mapped).toBe(CANONICAL_TOTAL);
		expect(r.skeleton.groups.every((g) => g.driven)).toBe(true);
	});

	it('passes a Mixamo rig and names the convention from its joint prefix', () => {
		const r = report('michelle');
		expect(r.verdict.level).toBe('pass');
		expect(r.skeleton.convention.id).toBe('mixamo');
		expect(r.skeleton.renames.length).toBeGreaterThan(0);
		expect(r.skeleton.renames[0].from).toMatch(/^mixamorig/i);
	});

	it('identifies Ready Player Me from its Wolf3D mesh nodes, not its bone names', () => {
		const r = report('default');
		expect(r.skeleton.convention.id).toBe('rpm');
		expect(r.skeleton.convention.schema).toBe('rpm');
	});

	it('fails a model with no skinned mesh and says so plainly', () => {
		const r = report('mannequin');
		expect(r.skeleton.skinned).toBe(false);
		expect(r.verdict.level).toBe('fail');
		expect(r.verdict.drivable).toBe(false);
		expect(r.verdict.headline).toMatch(/no skinned mesh/i);
	});

	it('fails a skinned but non-humanoid rig for lack of canonical joints', () => {
		const r = report('fox');
		expect(r.skeleton.skinned).toBe(true);
		expect(r.skeleton.jointCount).toBeGreaterThan(0);
		expect(r.skeleton.mapped).toBeLessThan(MIN_CANONICAL_BONES);
		expect(r.verdict.level).toBe('fail');
		expect(r.verdict.headline).toMatch(/canonical skeleton/i);
	});

	it('reports per-vertex skin-weight health for a non-humanoid rig, same verdict as before', () => {
		// fox.glb has no canonical bone names at all (UniRig/SkinTokens/AniGen
		// output looks the same way), so canonical coverage can never answer
		// "is this skin sound" for it; maxInfluences/unweightedVertices can.
		const r = report('fox');
		expect(r.skeleton.skinnedVertices).toBeGreaterThan(0);
		expect(r.skeleton.maxInfluences).toBeGreaterThan(0);
		expect(r.skeleton.maxInfluences).toBeLessThanOrEqual(8);
		expect(r.skeleton.unweightedVertices).toBeGreaterThanOrEqual(0);
		expect(r.skeleton.unweightedVertices).toBeLessThanOrEqual(r.skeleton.skinnedVertices);
		// The new fields are informational: they must not change the verdict
		// this rig already got.
		expect(r.verdict.drivable).toBe(false);
		expect(r.verdict.level).toBe('fail');
		expect(r.verdict.notes.some((n) => /skinned vertices?/i.test(n))).toBe(true);
	});

	it('reports zero skin-weight stats for an unskinned model rather than throwing', () => {
		const r = report('mannequin');
		expect(r.skeleton.skinned).toBe(false);
		expect(r.skeleton.maxInfluences).toBe(0);
		expect(r.skeleton.unweightedVertices).toBe(0);
		expect(r.skeleton.skinnedVertices).toBe(0);
	});

	it('warns on a halfbody rig and names exactly which groups stay frozen', () => {
		const r = report('realistic-halfbody');
		expect(r.verdict.level).toBe('warn');
		expect(r.verdict.drivable).toBe(true);
		const legs = r.skeleton.groups.find((g) => g.id === 'legs');
		expect(legs.driven).toBe(false);
		expect(legs.missingKey).toContain('LeftUpLeg');
		// Hands are fully rigged on this avatar, so the warning must not smear
		// the failure across every group.
		expect(r.skeleton.groups.find((g) => g.id === 'hands').driven).toBe(true);
	});

	it('mirrors the runtime gate: skinned plus MIN_CANONICAL_BONES decides drivability', () => {
		for (const name of ['cz', 'michelle', 'fox', 'mannequin', 'realistic-halfbody']) {
			const r = report(name);
			const expected = r.skeleton.skinned && r.skeleton.mapped >= MIN_CANONICAL_BONES;
			expect(r.verdict.drivable).toBe(expected);
		}
	});
});

describe('analyzeGlb inventory', () => {
	it('counts triangles, materials, and joints for a real avatar', () => {
		const r = report('michelle');
		expect(r.geometry.triangles).toBeGreaterThan(1000);
		expect(r.geometry.vertices).toBeGreaterThan(1000);
		expect(r.counts.materials).toBeGreaterThan(0);
		expect(r.skeleton.jointCount).toBeGreaterThanOrEqual(CANONICAL_TOTAL);
		expect(r.bytes).toBe(r.jsonBytes + r.binBytes + 28);
	});

	it('finds the full Oculus viseme set on an avatar that ships lip-sync', () => {
		const r = report('realistic-female');
		expect(r.morphs.visemeCount).toBe(15);
		expect(r.morphs.visemeComplete).toBe(true);
		expect(r.morphs.lipSync).toBe(true);
		expect(r.verdict.notes.some((n) => /lip-sync/i.test(n))).toBe(true);
	});

	it('reports no lip-sync, and suggests visemes, on a rig with none', () => {
		const r = report('cz');
		expect(r.morphs.visemeCount).toBe(0);
		expect(r.morphs.lipSync).toBe(false);
		expect(r.verdict.fixes.some((f) => /viseme/i.test(f))).toBe(true);
	});

	it('lists every limb group exactly once, in body order', () => {
		const r = report('cz');
		expect(r.skeleton.groups.map((g) => g.id)).toEqual(LIMB_GROUPS.map((g) => g.id));
	});

	it('surfaces unmapped joint names so they can become new canonicalizer rules', () => {
		const r = report('cesium-man');
		expect(r.skeleton.unmapped.length).toBeGreaterThan(0);
		expect(r.skeleton.unmapped.every((n) => typeof n === 'string' && n.length)).toBe(true);
	});
});

describe('manifestFromReport', () => {
	it('produces a manifest that satisfies every required schema-v1 field', () => {
		const r = report('michelle');
		const m = manifestFromReport(r, {
			id: 'avatar-test',
			name: 'Michelle',
			meshUri: 'https://three.ws/avatars/michelle.glb',
			owner: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
			sha256: 'a'.repeat(64),
			createdAt: '2026-07-31T00:00:00.000Z',
		});
		for (const key of ['schemaVersion', 'id', 'name', 'mesh', 'skeleton', 'owner', 'createdAt']) {
			expect(m[key], `missing required field ${key}`).toBeDefined();
		}
		expect(m.schemaVersion).toBe(1);
		expect(m.mesh.format).toBe('glb');
		expect(m.mesh.kBytes).toBeGreaterThan(0);
		expect(m.owner.chain).toBe('solana');
	});

	it('declares a skeleton value the schema enum actually accepts', () => {
		const allowed = ['avaturn', 'mixamo', 'rpm', 'vrm-humanoid', 'custom'];
		for (const name of ['cz', 'michelle', 'default', 'fox', 'cesium-man']) {
			const m = manifestFromReport(report(name), {
				id: 'x', name: 'x', meshUri: 'https://example.com/x.glb', owner: 'x', createdAt: '2026-07-31T00:00:00.000Z',
			});
			expect(allowed).toContain(m.skeleton);
		}
	});
});

describe('formatBytes', () => {
	it('scales through B, KB, and MB', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2.0 KB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
	});
});

// The /rig-doctor hero advertises "N rig conventions recognised" and "52
// canonical joints scored". The page rewrites both from this module at runtime,
// but the markup still carries them for a reader with JavaScript off, and that
// static copy had already gone stale by one convention. These assertions fail
// the moment the two disagree again.
describe('the /rig-doctor hero facts match the analyser', () => {
	const html = readFileSync(join(ROOT, 'pages/rig-doctor.html'), 'utf8');

	it('states the number of conventions the fingerprinter actually implements', () => {
		const m = html.match(/<strong id="rd-fact-conventions">(\d+)<\/strong>/);
		expect(m, 'pages/rig-doctor.html lost its #rd-fact-conventions element').not.toBeNull();
		expect(Number(m[1])).toBe(CONVENTION_COUNT);
	});

	it('states the size of the canonical skeleton it actually scores against', () => {
		const m = html.match(/<strong id="rd-fact-joints">(\d+)<\/strong>/);
		expect(m, 'pages/rig-doctor.html lost its #rd-fact-joints element').not.toBeNull();
		expect(Number(m[1])).toBe(CANONICAL_TOTAL);
	});
});

describe('Rig Doctor agrees with the runtime', () => {
	it.each([['Character1:'], ['Character1']])('fingerprints and fully maps a HumanIK rig spelled %s', (ns) => {
		const r = analyzeGlb(syntheticRig(humanIkTree(ns)));
		expect(r.skeleton.convention.id).toBe('humanik');
		expect(r.skeleton.mapped).toBe(CANONICAL_TOTAL);
		expect(r.skeleton.mappedNames.Hips).toBe(`${ns}Hips`);
		expect(r.skeleton.collisions).toEqual([]);
		expect(r.verdict.level).toBe('pass');
	});

	it('reports the Rigify clavicle/upper-arm collision as resolved, the way the runtime resolves it', () => {
		const side = (s) => [`DEF-shoulder.${s}`, [`DEF-upper_arm.${s}`, [`DEF-forearm.${s}`, [`DEF-hand.${s}`]]]];
		const leg = (s) => [`DEF-thigh.${s}`, [`DEF-shin.${s}`, [`DEF-foot.${s}`, [`DEF-toe.${s}`]]]];
		const r = analyzeGlb(syntheticRig(['DEF-hips', ['DEF-spine', ['DEF-chest', ['DEF-neck', ['DEF-head']], side('L'), side('R')]], leg('L'), leg('R')]));
		expect(r.skeleton.convention.id).toBe('rigify');
		expect(r.skeleton.collisions).toEqual([]);
		expect(r.skeleton.mappedNames.LeftShoulder).toBe('DEF-shoulder.L');
		expect(r.skeleton.mappedNames.LeftArm).toBe('DEF-upper_arm.L');
		expect(r.skeleton.mappedNames.RightShoulder).toBe('DEF-shoulder.R');
		expect(r.skeleton.mappedNames.RightArm).toBe('DEF-upper_arm.R');
		expect(r.skeleton.resolvedCollisions).toEqual([
			{ name: 'DEF-shoulder.L', from: 'LeftArm', to: 'LeftShoulder' },
			{ name: 'DEF-shoulder.R', from: 'RightArm', to: 'RightShoulder' },
		]);
		expect(r.skeleton.renames).toContainEqual({ from: 'DEF-shoulder.L', to: 'LeftShoulder' });
	});
});
