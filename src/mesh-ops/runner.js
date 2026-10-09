// GLB bytes in, GLB bytes out: one mesh operation end to end.
//
// Used by ./worker.js (the normal path, off the main thread) and directly by
// ./client.js when a browser cannot start a module worker. Decoders load on
// demand: meshoptimizer always (it is also the simplifier), Draco only when the
// file actually declares KHR_draco_mesh_compression, from the same decoder
// files the three.js viewers on this site already serve.
//
// Output is a plain GLB: geometry compression extensions are dropped so the
// result opens in every tool (slicers, DCCs, the STL exporter) and so a second
// operation can read it straight back. Textures are carried through byte for
// byte, including EXT_texture_webp.

import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

import { applyMeshOp, countTriangles } from './gltf.js';

const DRACO_EXTENSION = 'KHR_draco_mesh_compression';
const COMPRESSION_EXTENSIONS = new Set([DRACO_EXTENSION, 'EXT_meshopt_compression', 'KHR_mesh_quantization']);
const DRACO_BASE = '/three/draco/gltf/';

let dracoPromise = null;

/**
 * The Draco decoder module, built from /three/draco/gltf/. Fetched as text and
 * evaluated so it works the same in a module worker (no importScripts) and on
 * the main thread. Only ever reached for a Draco-compressed file.
 */
function loadDracoDecoder() {
	if (!dracoPromise) {
		dracoPromise = (async () => {
			const [wrapperRes, wasmRes] = await Promise.all([
				fetch(`${DRACO_BASE}draco_wasm_wrapper.js`),
				fetch(`${DRACO_BASE}draco_decoder.wasm`),
			]);
			if (!wrapperRes.ok || !wasmRes.ok) throw new Error('The Draco decoder could not be downloaded.');
			const source = await wrapperRes.text();
			const wasmBinary = await wasmRes.arrayBuffer();
			const factory = new Function(`${source}\nreturn DracoDecoderModule;`)();
			return factory({ wasmBinary });
		})().catch((err) => {
			dracoPromise = null;
			throw err;
		});
	}
	return dracoPromise;
}

function declaredExtensions(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return [];
	const jsonLength = view.getUint32(12, true);
	try {
		const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
		return [...(json.extensionsUsed || []), ...(json.extensionsRequired || [])];
	} catch {
		return [];
	}
}

async function createIO(bytes) {
	await MeshoptDecoder.ready;
	const deps = { 'meshopt.decoder': MeshoptDecoder };
	if (declaredExtensions(bytes).includes(DRACO_EXTENSION)) deps['draco3d.decoder'] = await loadDracoDecoder();
	return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies(deps);
}

/** Parse GLB bytes into a float, uncompressed document ready to edit. */
export async function readDocument(bytes) {
	const io = await createIO(bytes);
	const doc = await io.readBinary(bytes);
	await doc.transform(dequantize());
	return { doc, io };
}

/** Serialise a document as a plain GLB (no geometry compression). */
export async function writeDocument(doc, io) {
	for (const ext of doc.getRoot().listExtensionsUsed()) {
		if (COMPRESSION_EXTENSIONS.has(ext.extensionName)) ext.dispose();
	}
	return io.writeBinary(doc);
}

/** Triangle count of a GLB without changing it. */
export async function inspectGlb(bytes) {
	const { doc } = await readDocument(bytes);
	return { triangles: countTriangles(doc) };
}

/**
 * Run `op` on GLB `bytes`. `onPhase` receives 'reading' | 'processing' |
 * 'writing' as each real stage starts, for the panel's status line.
 */
export async function runMeshOp(bytes, op, params = {}, onPhase = () => {}) {
	onPhase('reading');
	const { doc, io } = await readDocument(bytes);
	onPhase('processing');
	if (op === 'decimate') await MeshoptSimplifier.ready;
	const stats = applyMeshOp(doc, op, params, { simplifier: MeshoptSimplifier });
	onPhase('writing');
	const out = await writeDocument(doc, io);
	return { bytes: out, stats, triangles: stats.trianglesAfter };
}
