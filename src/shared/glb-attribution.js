/**
 * Stamp provenance into a binary glTF (.glb) container without touching
 * geometry: rewrites the JSON chunk's `asset.generator` and `asset.extras`,
 * then repacks the container with correct chunk padding and total length.
 *
 * The glTF 2.0 spec reserves `asset.generator` for "the tool that generated
 * this asset" and `asset.extras` for application-specific metadata — so a
 * Forge model keeps saying where it came from (and what prompt made it) in
 * any DCC tool, engine, or validator that opens it.
 */

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

export const FORGE_GENERATOR = 'three.ws Forge — text/image → 3D (https://three.ws/forge)';

/**
 * @param {ArrayBuffer} buffer  A complete .glb file.
 * @param {{ prompt?: string, source?: string, engine?: string, engineVersion?: string }} [meta]
 * @returns {ArrayBuffer} A new .glb with attribution stamped into asset.*.
 * @throws {Error} If the buffer is not a well-formed glTF 2.0 binary.
 */
export function stampGlbAttribution(buffer, { prompt, source = 'https://three.ws/forge', engine, engineVersion } = {}) {
	const dv = new DataView(buffer);
	if (buffer.byteLength < 20 || dv.getUint32(0, true) !== GLB_MAGIC) {
		throw new Error('not a GLB container');
	}
	const version = dv.getUint32(4, true);
	if (version !== 2) throw new Error(`unsupported glTF container version ${version}`);
	const jsonLen = dv.getUint32(12, true);
	if (20 + jsonLen > buffer.byteLength || dv.getUint32(16, true) !== CHUNK_JSON) {
		throw new Error('first GLB chunk is not a valid JSON chunk');
	}

	const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
	json.asset = json.asset || { version: '2.0' };
	const extras = { ...(json.asset.extras || {}) };
	// Keep the upstream reconstruction engine visible instead of erasing it.
	if (json.asset.generator && !String(json.asset.generator).includes('three.ws')) {
		extras.pipeline = json.asset.generator;
	}
	json.asset.generator = FORGE_GENERATOR;
	extras.source = source;
	if (prompt) extras.prompt = String(prompt).slice(0, 500);
	// Deterministic, platform-reported engine name/version: authoritative over
	// extras.pipeline above, which only carries whatever string the upstream
	// engine's own GLB happened to self-report.
	if (engine) extras.engine = engine;
	if (engineVersion) extras.engineVersion = engineVersion;
	json.asset.extras = extras;

	// Re-encode and pad to the 4-byte boundary the spec requires (0x20 for JSON).
	const encoded = new TextEncoder().encode(JSON.stringify(json));
	const pad = (4 - (encoded.byteLength % 4)) % 4;
	const outJson = new Uint8Array(encoded.byteLength + pad);
	outJson.set(encoded);
	outJson.fill(0x20, encoded.byteLength);

	// Everything after the original JSON chunk (the BIN chunk, if any) is
	// byte-for-byte untouched.
	const rest = new Uint8Array(buffer, 20 + jsonLen);
	const total = 12 + 8 + outJson.byteLength + rest.byteLength;
	const out = new Uint8Array(total);
	const outDv = new DataView(out.buffer);
	outDv.setUint32(0, GLB_MAGIC, true);
	outDv.setUint32(4, 2, true);
	outDv.setUint32(8, total, true);
	outDv.setUint32(12, outJson.byteLength, true);
	outDv.setUint32(16, CHUNK_JSON, true);
	out.set(outJson, 20);
	out.set(rest, 20 + outJson.byteLength);
	return out.buffer;
}
