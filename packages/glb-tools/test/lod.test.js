import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLodChain, DEFAULT_LOD_LEVELS, MSFT_LOD_EXTENSION_NAME } from '../src/lod.js';
import { readGlbChunks, writeGlb } from '../src/glb-container.js';

// Real, bundled static mesh: honest input for a real decimation pipeline.
// Same fixture glb-compress.test.js uses, so CI guarantees it exists.
const FIXTURE = fileURLToPath(new URL('../../../public/avatars/cesium-man.glb', import.meta.url));
const hasFixture = existsSync(FIXTURE);

test('glb-container round-trips a GLB byte-for-byte through JSON', { skip: !hasFixture }, () => {
	const buf = readFileSync(FIXTURE);
	const { json, binChunk } = readGlbChunks(buf);
	assert.ok(Array.isArray(json.nodes) && json.nodes.length > 0);
	assert.ok(binChunk && binChunk.byteLength > 0);

	const rewritten = writeGlb({ json, binChunk });
	const { json: json2 } = readGlbChunks(rewritten);
	assert.deepEqual(json2.nodes.map((n) => n.name), json.nodes.map((n) => n.name));
});

test('readGlbChunks rejects a non-GLB buffer', () => {
	assert.throws(() => readGlbChunks(Buffer.from('not a glb')), /bad magic/);
});

test('buildLodChain produces 3 default levels with strictly decreasing triangle counts', { skip: !hasFixture, timeout: 60_000 }, async () => {
	const buf = readFileSync(FIXTURE);
	const result = await buildLodChain(buf);

	assert.equal(result.levels.length, DEFAULT_LOD_LEVELS.length);
	assert.ok(result.source.triangleCount > 0);
	assert.equal(result.levels[0].triangleCount, result.source.triangleCount); // LOD0 is untouched

	for (let i = 1; i < result.levels.length; i++) {
		assert.ok(
			result.levels[i].triangleCount < result.levels[i - 1].triangleCount,
			`${result.levels[i].name} (${result.levels[i].triangleCount}) should be lower-poly than ${result.levels[i - 1].name} (${result.levels[i - 1].triangleCount})`,
		);
	}
});

test('buildLodChain levels are each a structurally valid, independently loadable GLB', { skip: !hasFixture, timeout: 60_000 }, async () => {
	const buf = readFileSync(FIXTURE);
	const result = await buildLodChain(buf);

	for (const level of result.levels) {
		const { json, binChunk } = readGlbChunks(level.glb);
		assert.ok(json.meshes.length > 0, `${level.name} standalone GLB has no meshes`);
		assert.ok(binChunk.byteLength > 0, `${level.name} standalone GLB has no binary payload`);
	}
});

test('buildLodChain combined GLB wires MSFT_lod on the scene root and keeps the default scene single-LOD', { skip: !hasFixture, timeout: 60_000 }, async () => {
	const buf = readFileSync(FIXTURE);
	const result = await buildLodChain(buf);
	const { json } = readGlbChunks(result.combined);

	assert.ok(json.extensionsUsed.includes(MSFT_LOD_EXTENSION_NAME));

	const sceneIndex = json.scene ?? 0;
	const rootNodeIndices = json.scenes[sceneIndex].nodes;
	assert.equal(rootNodeIndices.length, 1);

	const rootNode = json.nodes[rootNodeIndices[0]];
	const lod = rootNode.extensions?.[MSFT_LOD_EXTENSION_NAME];
	assert.ok(lod, 'scene root node is missing the MSFT_lod extension');
	assert.equal(lod.ids.length, result.levels.length - 1); // one alternate id per non-LOD0 level
	assert.equal(rootNode.extras.MSFT_screencoverage.length, result.levels.length - 1);

	// The alternate LOD root nodes exist in the document (addressable by index)
	// but are not reachable from the default scene's own child graph.
	for (const altId of lod.ids) {
		assert.ok(json.nodes[altId], `alternate LOD node ${altId} does not exist`);
		assert.ok(!rootNodeIndices.includes(altId), `alternate LOD node ${altId} leaked into the default scene`);
	}
});

test('buildLodChain accepts a custom 2-level chain', { skip: !hasFixture, timeout: 60_000 }, async () => {
	const buf = readFileSync(FIXTURE);
	const result = await buildLodChain(buf, { levels: [1, 0.3] });
	assert.equal(result.levels.length, 2);
	assert.ok(result.levels[1].triangleCount < result.levels[0].triangleCount);
});

test('buildLodChain rejects a non-decreasing levels array', { skip: !hasFixture }, async () => {
	const buf = readFileSync(FIXTURE);
	await assert.rejects(() => buildLodChain(buf, { levels: [0.5, 0.8] }), /strictly decreasing/);
});

test('buildLodChain rejects an out-of-range ratio', { skip: !hasFixture }, async () => {
	const buf = readFileSync(FIXTURE);
	await assert.rejects(() => buildLodChain(buf, { levels: [1, 0] }), /\(0, 1\]/);
});

test('buildLodChain rejects too few levels', { skip: !hasFixture }, async () => {
	const buf = readFileSync(FIXTURE);
	await assert.rejects(() => buildLodChain(buf, { levels: [1] }), /2-6 entries/);
});
