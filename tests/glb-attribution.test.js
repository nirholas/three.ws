import { describe, it, expect } from 'vitest';
import { stampGlbAttribution, FORGE_GENERATOR } from '../src/shared/glb-attribution.js';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Build a minimal valid GLB from a gltf JSON object and optional BIN bytes. */
function buildGlb(gltf, bin = null) {
	const encoded = new TextEncoder().encode(JSON.stringify(gltf));
	const jsonPad = (4 - (encoded.byteLength % 4)) % 4;
	const jsonChunk = new Uint8Array(encoded.byteLength + jsonPad);
	jsonChunk.set(encoded);
	jsonChunk.fill(0x20, encoded.byteLength);

	let binChunk = null;
	if (bin) {
		const binPad = (4 - (bin.byteLength % 4)) % 4;
		binChunk = new Uint8Array(bin.byteLength + binPad);
		binChunk.set(bin);
	}

	const total = 12 + 8 + jsonChunk.byteLength + (binChunk ? 8 + binChunk.byteLength : 0);
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, GLB_MAGIC, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	dv.setUint32(12, jsonChunk.byteLength, true);
	dv.setUint32(16, CHUNK_JSON, true);
	out.set(jsonChunk, 20);
	if (binChunk) {
		const off = 20 + jsonChunk.byteLength;
		dv.setUint32(off, binChunk.byteLength, true);
		dv.setUint32(off + 4, CHUNK_BIN, true);
		out.set(binChunk, off + 8);
	}
	return out.buffer;
}

function parseGlb(buffer) {
	const dv = new DataView(buffer);
	const jsonLen = dv.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
	let bin = null;
	const off = 20 + jsonLen;
	if (off < buffer.byteLength) {
		const binLen = dv.getUint32(off, true);
		expect(dv.getUint32(off + 4, true)).toBe(CHUNK_BIN);
		bin = new Uint8Array(buffer, off + 8, binLen);
	}
	return { totalLen: dv.getUint32(8, true), jsonLen, json, bin };
}

describe('stampGlbAttribution', () => {
	it('stamps generator, source, and prompt into asset.*', () => {
		const glb = buildGlb({ asset: { version: '2.0' }, scenes: [] });
		const out = parseGlb(stampGlbAttribution(glb, { prompt: 'a brass steampunk owl' }));
		expect(out.json.asset.generator).toBe(FORGE_GENERATOR);
		expect(out.json.asset.extras.source).toBe('https://three.ws/forge');
		expect(out.json.asset.extras.prompt).toBe('a brass steampunk owl');
		expect(out.json.scenes).toEqual([]);
	});

	it('preserves the upstream engine generator in extras.pipeline', () => {
		const glb = buildGlb({ asset: { version: '2.0', generator: 'TRELLIS reconstructor' } });
		const out = parseGlb(stampGlbAttribution(glb));
		expect(out.json.asset.generator).toBe(FORGE_GENERATOR);
		expect(out.json.asset.extras.pipeline).toBe('TRELLIS reconstructor');
	});

	it('stamps an explicit engine and model version, authoritative over the sniffed generator', () => {
		const glb = buildGlb({ asset: { version: '2.0', generator: 'some upstream string' } });
		const out = parseGlb(stampGlbAttribution(glb, { engine: 'Tripo', engineVersion: 'v3.1-20260211' }));
		expect(out.json.asset.extras.engine).toBe('Tripo');
		expect(out.json.asset.extras.engineVersion).toBe('v3.1-20260211');
		expect(out.json.asset.extras.pipeline).toBe('some upstream string');
	});

	it('omits engine/engineVersion from extras when not given', () => {
		const glb = buildGlb({ asset: { version: '2.0' } });
		const out = parseGlb(stampGlbAttribution(glb, { prompt: 'x' }));
		expect(out.json.asset.extras.engine).toBeUndefined();
		expect(out.json.asset.extras.engineVersion).toBeUndefined();
	});

	it('keeps the BIN chunk byte-for-byte and updates lengths/alignment', () => {
		const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7]); // 7 bytes → padded chunk
		const glb = buildGlb({ asset: { version: '2.0' } }, bin);
		const stamped = stampGlbAttribution(glb, { prompt: 'x'.repeat(37) });
		const out = parseGlb(stamped);
		expect(out.totalLen).toBe(stamped.byteLength);
		expect(out.jsonLen % 4).toBe(0);
		expect(Array.from(out.bin.subarray(0, 7))).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it('truncates very long prompts to 500 chars', () => {
		const glb = buildGlb({ asset: { version: '2.0' } });
		const out = parseGlb(stampGlbAttribution(glb, { prompt: 'y'.repeat(2000) }));
		expect(out.json.asset.extras.prompt).toHaveLength(500);
	});

	it('rejects non-GLB input', () => {
		expect(() => stampGlbAttribution(new TextEncoder().encode('not a glb').buffer)).toThrow(
			/not a GLB/,
		);
	});
});
