// Real LOD chain generation for a GLB: decimates the mesh at each requested
// ratio with gltf-transform's simplify() (meshoptimizer under the hood), then
// emits both a combined GLB (MSFT_lod-tagged, for engines that switch LODs at
// runtime from one file) and one standalone GLB per level (for engines, like
// most game-engine importers, that want discrete LOD files on disk).
//
// MSFT_lod (https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Archived/MSFT_lod)
// is archived and gltf-transform ships no Extension class for it, so the
// combined GLB's JSON chunk is patched by hand after gltf-transform writes
// it. See glb-container.js for the chunk-level read/write this relies on.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, cloneDocument, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import draco3dgltf from 'draco3dgltf';
import { readGlbChunks, writeGlb } from './glb-container.js';

const TRIANGLES_MODE = 4; // glTF primitive.mode for GL_TRIANGLES

// Highest detail first. ratio 1 ships the source mesh untouched (LOD0 is the
// delivered quality bar, never itself simplified); LOD1/LOD2 are the two
// most common runtime switch points for real-time engines (Unity, Unreal,
// Godot all default to 2-4 LOD levels past the base mesh).
export const DEFAULT_LOD_LEVELS = Object.freeze([
	Object.freeze({ name: 'LOD0', ratio: 1, screenCoverage: 0.5 }),
	Object.freeze({ name: 'LOD1', ratio: 0.5, error: 0.01, screenCoverage: 0.15 }),
	Object.freeze({ name: 'LOD2', ratio: 0.15, error: 0.02, screenCoverage: 0 }),
]);

export const MSFT_LOD_EXTENSION_NAME = 'MSFT_lod';

let ioPromise = null;
function getIo() {
	if (!ioPromise) {
		ioPromise = (async () => {
			await Promise.all([MeshoptSimplifier.ready, MeshoptDecoder.ready, MeshoptEncoder.ready]);
			const [dracoDecoder, dracoEncoder] = await Promise.all([
				draco3dgltf.createDecoderModule(),
				draco3dgltf.createEncoderModule(),
			]);
			return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
				'meshopt.decoder': MeshoptDecoder,
				'meshopt.encoder': MeshoptEncoder,
				'draco3d.decoder': dracoDecoder,
				'draco3d.encoder': dracoEncoder,
			});
		})();
	}
	return ioPromise;
}

function normalizeLevels(levels) {
	if (levels === undefined || levels === null) return DEFAULT_LOD_LEVELS;
	if (!Array.isArray(levels) || levels.length < 2 || levels.length > 6) {
		throw new RangeError('buildLodChain: levels must be an array of 2-6 entries');
	}
	const normalized = levels.map((lvl, i) => {
		const entry = typeof lvl === 'number' ? { ratio: lvl } : lvl && typeof lvl === 'object' ? lvl : {};
		const ratio = Number(entry.ratio);
		if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
			throw new RangeError(`buildLodChain: levels[${i}].ratio must be a number in (0, 1]`);
		}
		return {
			name: typeof entry.name === 'string' && entry.name ? entry.name : `LOD${i}`,
			ratio,
			error: Number.isFinite(entry.error) ? entry.error : 0.01,
			screenCoverage: Number.isFinite(entry.screenCoverage) ? entry.screenCoverage : null,
		};
	});
	for (let i = 1; i < normalized.length; i++) {
		if (normalized[i].ratio >= normalized[i - 1].ratio) {
			throw new RangeError('buildLodChain: levels must be ordered highest to lowest detail (strictly decreasing ratio)');
		}
	}
	return normalized;
}

/** Sums triangle/vertex counts across every triangle-list primitive in the document. */
export function countDocumentGeometry(doc) {
	let triangleCount = 0;
	let vertexCount = 0;
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			if (prim.getMode() !== TRIANGLES_MODE) continue;
			const indices = prim.getIndices();
			const positions = prim.getAttribute('POSITION');
			const count = indices ? indices.getCount() : positions ? positions.getCount() : 0;
			triangleCount += Math.floor(count / 3);
			vertexCount += positions ? positions.getCount() : 0;
		}
	}
	return { triangleCount, vertexCount };
}

/**
 * Build a real LOD chain for a GLB.
 *
 * @param {Uint8Array | ArrayBuffer} glb
 * @param {{ levels?: Array<number | { name?: string, ratio: number, error?: number, screenCoverage?: number }> }} [options]
 * @returns {Promise<{
 *   source: { triangleCount: number, vertexCount: number },
 *   levels: Array<{ name: string, ratio: number, error: number, screenCoverage: number | null, triangleCount: number, vertexCount: number, glb: Uint8Array }>,
 *   combined: Uint8Array,
 * }>}
 */
export async function buildLodChain(glb, options = {}) {
	const input = glb instanceof Uint8Array ? glb : new Uint8Array(glb);
	const levels = normalizeLevels(options.levels);
	const io = await getIo();

	const sourceDoc = await io.readBinary(input);
	const source = countDocumentGeometry(sourceDoc);
	if (source.triangleCount === 0) {
		throw new Error('buildLodChain: source GLB has no triangle geometry to simplify');
	}

	const target = cloneDocument(sourceDoc);
	const scene = target.getRoot().listScenes()[0];
	if (!scene) throw new Error('buildLodChain: source GLB has no default scene');
	const primaryRootNodes = scene.listChildren();

	const levelDocs = [];
	const results = [];
	for (const level of levels) {
		const doc = cloneDocument(sourceDoc);
		if (level.ratio < 1) {
			await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: level.ratio, error: level.error }));
		}
		const stats = countDocumentGeometry(doc);
		const bytes = await io.writeBinary(doc);
		levelDocs.push(doc);
		results.push({
			name: level.name,
			ratio: level.ratio,
			error: level.error,
			screenCoverage: level.screenCoverage,
			triangleCount: stats.triangleCount,
			vertexCount: stats.vertexCount,
			glb: bytes,
		});
	}

	for (let i = 1; i < results.length; i++) {
		if (results[i].triangleCount > results[i - 1].triangleCount) {
			throw new Error(
				`buildLodChain: ${results[i].name} (${results[i].triangleCount} tris) is not lower detail than ${results[i - 1].name} (${results[i - 1].triangleCount} tris) - raise the error tolerance or lower the ratio`,
			);
		}
	}

	// Merge LOD1..N as orphan nodes: present in the Document (and therefore the
	// JSON chunk) but excluded from the Scene's child graph, so a viewer that
	// does not understand MSFT_lod only ever traverses and renders LOD0.
	const altRootNodesByLevel = [];
	for (let i = 1; i < levelDocs.length; i++) {
		mergeDocuments(target, levelDocs[i]);
		const mergedScenes = target.getRoot().listScenes();
		const extraScene = mergedScenes[mergedScenes.length - 1];
		const altRootNodes = extraScene.listChildren();
		extraScene.dispose(); // the wrapper scene goes; its root nodes stay alive as orphans
		altRootNodesByLevel.push(altRootNodes);
	}

	await target.transform(unpartition());

	const combinedBytes = await io.writeBinary(target);
	const { json, binChunk } = readGlbChunks(combinedBytes);
	const docNodes = target.getRoot().listNodes();
	const indexOfNode = (node) => docNodes.indexOf(node);

	json.extensionsUsed = Array.from(new Set([...(json.extensionsUsed ?? []), MSFT_LOD_EXTENSION_NAME]));
	const screenCoverages = levels.slice(1).map((l) => l.screenCoverage ?? 0);

	primaryRootNodes.forEach((primaryNode, i) => {
		const primaryIndex = indexOfNode(primaryNode);
		const altIds = altRootNodesByLevel.map((altRoots) => indexOfNode(altRoots[i]));
		const jsonNode = json.nodes[primaryIndex];
		jsonNode.extensions = { ...jsonNode.extensions, [MSFT_LOD_EXTENSION_NAME]: { ids: altIds } };
		jsonNode.extras = { ...jsonNode.extras, MSFT_screencoverage: screenCoverages };
	});

	const combined = writeGlb({ json, binChunk });

	return { source, levels: results, combined };
}
