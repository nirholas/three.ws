// The mesh-ops Draco path must decode without string-to-code evaluation, so the
// site CSP can drop 'unsafe-eval'. This test encodes a real Draco GLB with the
// draco3dgltf encoder, blocks Function()/eval, and reads it back through the
// shipped runner.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

import { dracoEsmSource } from '../scripts/lib/draco-esm.mjs';
import { configureDraco, readDocument } from '../src/mesh-ops/runner.js';
import { countTriangles } from '../src/mesh-ops/gltf.js';

const dracoDir = new URL('../public/three/draco/gltf/', import.meta.url);
const esmFile = new URL('draco_wasm_wrapper.esm.js', dracoDir);
const classic = new URL('draco_wasm_wrapper.js', dracoDir);

describe('dracoEsmSource', () => {
	it('appends a default export of the decoder factory', () => {
		const out = dracoEsmSource('var DracoDecoderModule = 1;');
		expect(out).toContain('export default DracoDecoderModule;');
		expect(out.startsWith('var DracoDecoderModule = 1;')).toBe(true);
	});
});

describe.runIf(existsSync(classic))('mesh-ops Draco decode without eval', () => {
	let glb;
	const realFetch = globalThis.fetch;

	beforeAll(async () => {
		const doc = new Document();
		const buffer = doc.createBuffer();
		const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1]);
		const indices = new Uint16Array([0, 1, 2, 2, 1, 3, 0, 4, 1, 1, 4, 5]);
		const prim = doc
			.createPrimitive()
			.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
			.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
		doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
		doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });
		const io = new NodeIO()
			.registerExtensions(ALL_EXTENSIONS)
			.registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() });
		glb = new Uint8Array(await io.writeBinary(doc));

		// Serve the decoder files from disk to the runner's fetch of the wasm.
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).endsWith('draco_decoder.wasm')) {
				const bytes = readFileSync(new URL('draco_decoder.wasm', dracoDir));
				return new Response(bytes, { status: 200 });
			}
			return realFetch(url);
		});
		configureDraco({ base: pathToFileURL(new URL('.', dracoDir).pathname).href });
	});

	afterAll(() => {
		globalThis.fetch = realFetch;
		configureDraco();
	});

	it('reads a Draco-compressed GLB while Function() and eval() are blocked', async () => {
		expect(existsSync(esmFile)).toBe(true);
		const realFunction = globalThis.Function;
		const blocked = new Proxy(realFunction, {
			construct() {
				throw new Error('EvalError: string-to-code blocked');
			},
			apply() {
				throw new Error('EvalError: string-to-code blocked');
			},
		});
		globalThis.Function = blocked;
		try {
			const { doc } = await readDocument(glb);
			expect(countTriangles(doc)).toBe(4);
		} finally {
			globalThis.Function = realFunction;
		}
	});
});

describe('dracoEsmSource UMD tail', () => {
	it('drops the CommonJS/AMD export probe', () => {
		const src = 'var DracoDecoderModule=function(){};"object"===typeof exports&&"object"===typeof module?module.exports=DracoDecoderModule:"function"===typeof define&&define.amd?define([],function(){return DracoDecoderModule}):"object"===typeof exports&&(exports.DracoDecoderModule=DracoDecoderModule);';
		const out = dracoEsmSource(src);
		expect(out).not.toMatch(/module\.exports|define\(/);
		expect(out).toContain('export default DracoDecoderModule;');
	});
});
