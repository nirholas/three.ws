/**
 * Tests for api/_lib/preserve-contract.js: the shared "preserve" contract
 * every retexture and part edit declares before touching a GLB, verified for
 * real against @three-ws/glb-diff rather than trusted on say-so (work order
 * 078: "keep the rig").
 *
 * Every model here is a real glTF-Transform Document, written to real GLB
 * bytes with NodeIO and read back through describeModel: no mocked diff
 * output anywhere in this file.
 */

import { describe, it, expect } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { verifyPreserved, PreserveViolationError, PRESERVE_KINDS } from '../../api/_lib/preserve-contract.js';

const io = new NodeIO();

// A rigged, animated triangle: one mesh skinned to two joints, textured with
// UVs, driven by one clip. Every preserve kind has something real to check.
function buildGlb(overrides = {}) {
	const {
		positions = [0, 0, 0, 1, 0, 0, 0, 1, 0],
		uv = [0, 0, 1, 0, 0, 1],
		jointIndices = [0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
		jointWeights = [0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
		baseColor = [1, 1, 1, 1],
		joints = ['Hips', 'Spine'],
		clipName = 'idle',
	} = overrides;

	const doc = new Document();
	const buffer = doc.createBuffer();

	const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer);
	const texcoord = doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer);
	const jointsAccessor = doc.createAccessor().setType('VEC4').setArray(new Uint16Array(jointIndices)).setBuffer(buffer);
	const weightsAccessor = doc.createAccessor().setType('VEC4').setArray(new Float32Array(jointWeights)).setBuffer(buffer);

	const material = doc.createMaterial('Skin').setBaseColorFactor(baseColor);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', position)
		.setAttribute('TEXCOORD_0', texcoord)
		.setAttribute('JOINTS_0', jointsAccessor)
		.setAttribute('WEIGHTS_0', weightsAccessor)
		.setMaterial(material);
	const mesh = doc.createMesh('Body').addPrimitive(prim);

	const root = doc.createNode('Root').setMesh(mesh);
	const jointNodes = joints.map((name) => doc.createNode(name));
	const skin = doc.createSkin('Armature');
	for (const joint of jointNodes) skin.addJoint(joint);
	if (jointNodes[0]) skin.setSkeleton(jointNodes[0]);
	root.setSkin(skin);

	if (clipName) {
		const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer);
		const output = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 0, 0])).setBuffer(buffer);
		const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
		const channel = doc.createAnimationChannel().setTargetNode(jointNodes[0] || root).setTargetPath('translation').setSampler(sampler);
		doc.createAnimation(clipName).addSampler(sampler).addChannel(channel);
	}

	const scene = doc.createScene('Scene');
	scene.addChild(root);
	for (const joint of jointNodes) scene.addChild(joint);

	return io.writeBinary(doc);
}

const ALL_KINDS = PRESERVE_KINDS;

describe('verifyPreserved', () => {
	it('passes every kind when nothing changed', async () => {
		const before = await buildGlb();
		const after = await buildGlb();
		const result = await verifyPreserved(before, after, ALL_KINDS);
		expect(result.violations).toEqual([]);
		expect(result.changes.identical).toBe(true);
	});

	it('is a no-op for an empty kinds list', async () => {
		const before = await buildGlb();
		const after = await buildGlb({ positions: [0, 0, 0, 5, 0, 0, 0, 9, 0] });
		const result = await verifyPreserved(before, after, []);
		expect(result).toEqual({ changes: null, violations: [] });
	});

	it('only restyling the material (no geometry/UV/skin/clip touch) preserves everything', async () => {
		const before = await buildGlb();
		const after = await buildGlb({ baseColor: [0.2, 0.1, 0.05, 1] });
		const result = await verifyPreserved(before, after, ALL_KINDS);
		expect(result.violations).toEqual([]);
	});

	it('throws when topology is declared preserved but a vertex moved', async () => {
		const before = await buildGlb();
		const after = await buildGlb({ positions: [0, 0, 0, 1, 0, 0, 0, 9, 0] });
		await expect(verifyPreserved(before, after, ['topology'], { label: 'retexture' })).rejects.toMatchObject({
			name: 'PreserveViolationError',
			code: 'preserve_violation',
		});
	});

	it('names the failing kind and field in the thrown message', async () => {
		const before = await buildGlb();
		const after = await buildGlb({ positions: [0, 0, 0, 1, 0, 0, 0, 9, 0] });
		try {
			await verifyPreserved(before, after, ['topology'], { label: 'retexture' });
			throw new Error('expected verifyPreserved to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(PreserveViolationError);
			expect(err.message).toContain('retexture');
			expect(err.message).toContain('topology');
			expect(err.violations[0]).toMatchObject({ kind: 'topology', section: 'meshes', name: 'Body' });
		}
	});

	it('does not flag topology when only UVs moved', async () => {
		const before = await buildGlb();
		const after = await buildGlb({ uv: [1, 1, 0, 1, 1, 0] });
		await expect(verifyPreserved(before, after, ['topology'])).resolves.toMatchObject({ violations: [] });
		await expect(verifyPreserved(before, after, ['uv'])).rejects.toBeInstanceOf(PreserveViolationError);
	});

	it('does not flag UV when only skin weights moved', async () => {
		const before = await buildGlb();
		const after = await buildGlb({ jointWeights: [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0] });
		await expect(verifyPreserved(before, after, ['uv'])).resolves.toMatchObject({ violations: [] });
		await expect(verifyPreserved(before, after, ['skin'])).rejects.toBeInstanceOf(PreserveViolationError);
	});

	it('throws when a joint is removed from the skeleton', async () => {
		const before = await buildGlb();
		const after = await buildGlb({ joints: ['Hips'], jointIndices: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
		await expect(verifyPreserved(before, after, ['skeleton'])).rejects.toMatchObject({
			violations: expect.arrayContaining([expect.objectContaining({ kind: 'skeleton', section: 'skins', field: 'joints' })]),
		});
	});

	it('throws when the animation clip is removed', async () => {
		const before = await buildGlb();
		const after = await buildGlb({ clipName: null });
		await expect(verifyPreserved(before, after, ['clips'])).rejects.toMatchObject({
			violations: [expect.objectContaining({ kind: 'clips', section: 'animations', field: 'removed' })],
		});
	});

	it('only reports violations for declared kinds, ignoring unrelated changes', async () => {
		// Clip removed AND a vertex moved, but only 'clips' was declared: the
		// topology change is real but out of scope for this call's contract.
		const before = await buildGlb();
		const after = await buildGlb({ clipName: null, positions: [0, 0, 0, 1, 0, 0, 0, 9, 0] });
		try {
			await verifyPreserved(before, after, ['clips']);
			throw new Error('expected verifyPreserved to throw');
		} catch (err) {
			expect(err.violations).toHaveLength(1);
			expect(err.violations[0].kind).toBe('clips');
		}
	});

	it('rejects an unknown preserve kind before describing anything', async () => {
		const before = await buildGlb();
		await expect(verifyPreserved(before, before, ['topology', 'bogus'])).rejects.toThrow(/unknown kind/);
	});
});
