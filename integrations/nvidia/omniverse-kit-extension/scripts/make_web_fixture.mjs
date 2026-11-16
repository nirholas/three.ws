// Build tests/data/box_web.glb: the import-test box, compressed the way web
// uploads to three.ws often are (EXT_meshopt_compression with octahedral
// normals, KHR_mesh_quantization, and an EXT_texture_webp base color texture).
//
// The extension's own decoder (threews/forge/gltf_compat.py) is tested against
// this file, so it is encoded by the reference tools rather than by the code
// under test. Run from the three.ws repo root, which has the dependencies:
//
//   python3 -c "import sys; sys.path.insert(0, 'integrations/nvidia/omniverse-kit-extension/exts/threews.forge/threews/forge/tests'); \
//     import glb_fixture; open('/tmp/box.glb', 'wb').write(glb_fixture.box_glb())"
//   node integrations/nvidia/omniverse-kit-extension/scripts/make_web_fixture.mjs /tmp/box.glb \
//     integrations/nvidia/omniverse-kit-extension/exts/threews.forge/threews/forge/tests/data/box_web.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
	console.error('usage: make_web_fixture.mjs <plain.glb> <out.glb>');
	process.exit(2);
}
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);

// An 8x8 two-tone checker, so the texture survives a decode with known pixels.
const pixels = Buffer.alloc(8 * 8 * 3);
for (let y = 0; y < 8; y++)
	for (let x = 0; x < 8; x++) {
		const on = (x + y) % 2 === 0;
		pixels.set(on ? [230, 120, 30] : [20, 40, 200], (y * 8 + x) * 3);
	}
const png = await sharp(pixels, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
const texture = doc.createTexture('checker').setImage(new Uint8Array(png)).setMimeType('image/png');
for (const material of doc.getRoot().listMaterials()) material.setBaseColorTexture(texture);
for (const mesh of doc.getRoot().listMeshes())
	for (const prim of mesh.listPrimitives()) {
		if (prim.getAttribute('TEXCOORD_0')) continue;
		const count = prim.getAttribute('POSITION').getCount();
		const uv = new Float32Array(count * 2);
		for (let i = 0; i < count; i++) uv.set([(i % 4) / 3, Math.floor(i / 4) % 2], i * 2);
		prim.setAttribute('TEXCOORD_0', doc.createAccessor('uv').setType('VEC2').setArray(uv).setBuffer(doc.getRoot().listBuffers()[0]));
	}

await doc.transform(
	textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 100, lossless: true }),
	meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(output, doc);
const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
console.log(`${output}: ${used.join(', ')}`);
