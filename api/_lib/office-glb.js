// Office-safe GLB pass: turn any three.ws GLB into one PowerPoint, Word and
// Excel will insert as an interactive 3D model.
//
// Office stores and renders every 3D model as glTF 2.0 binary, but its reader
// is narrower than the browsers three.ws targets. Measured and documented in
// docs/powerpoint.md; the short version of what this pass does about it:
//
//   * Geometry compression (KHR_draco_mesh_compression, EXT_meshopt_compression),
//     KHR_mesh_quantization and EXT_mesh_gpu_instancing are decoded back to
//     plain float vertex data. Office does not decode them, and a three.ws
//     delivery GLB is meshopt-compressed by default.
//   * Texture containers Office cannot read (KTX2 / KHR_texture_basisu,
//     EXT_texture_webp, EXT_texture_avif) are re-encoded: JPEG when the image is
//     opaque, PNG when it carries alpha. The forge delivery path writes WebP.
//   * Textures are capped at 2048 px on the long edge, Microsoft's mid-range
//     target in its 3D content guidelines, and stepped down further only if
//     the file would otherwise pass OFFICE_TARGET_BYTES.
//   * Skinning keeps its skeleton, capped at the 4 joint influences per vertex
//     Office supports, with weights renormalized to sum to 1.
//   * Animation is kept. STEP samplers become equivalent LINEAR ones (Office
//     lists linear and cubic spline only) and clips past Office's limit of 18
//     per file are dropped, in file order, with a warning.
//   * The model is recentred on the origin under one new root node, so the
//     slide's camera (api/_lib/pptx-writer.js) can look at 0,0,0 exactly as
//     PowerPoint's own insert does.
//   * Any remaining extension is marked not-required, so a reader that does
//     not know it ignores it instead of refusing the file (glTF 2.0 3.12).

import { Buffer } from 'node:buffer';

import { decodeKtx2 } from './ktx2-decode.js';

export const OFFICE_TEXTURE_MAX_PX = 2048;
export const OFFICE_TEXTURE_MIN_PX = 512;
export const OFFICE_MAX_ANIMATIONS = 18;
export const OFFICE_MAX_INFLUENCES = 4;
// Microsoft publishes no file-size ceiling for 3D models. This keeps a deck
// comfortably emailable and fast to open in PowerPoint for the web; textures
// halve until the file fits or reach OFFICE_TEXTURE_MIN_PX.
export const OFFICE_TARGET_BYTES = 40 * 1024 * 1024;

const DECODED_EXTENSIONS = new Set([
	'KHR_draco_mesh_compression',
	'EXT_meshopt_compression',
	'KHR_mesh_quantization',
	'EXT_mesh_gpu_instancing',
	'KHR_texture_basisu',
	'EXT_texture_webp',
	'EXT_texture_avif',
]);
const OFFICE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);

export class OfficeGlbError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'OfficeGlbError';
		this.code = code;
	}
}

let ioPromise = null;

async function getIO() {
	if (!ioPromise) {
		ioPromise = (async () => {
			const { NodeIO, Logger } = await import('@gltf-transform/core');
			const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
			const draco = await import('draco3dgltf');
			const create = draco.default ?? draco;
			const { MeshoptDecoder } = await import('meshoptimizer');
			await MeshoptDecoder.ready;
			return new NodeIO()
				.setLogger(new Logger(Logger.Verbosity.WARN))
				.registerExtensions(ALL_EXTENSIONS)
				.registerDependencies({
					'draco3d.decoder': await create.createDecoderModule(),
					'meshopt.decoder': MeshoptDecoder,
				});
		})().catch((err) => {
			ioPromise = null;
			throw err;
		});
	}
	return ioPromise;
}

async function loadSharp() {
	return (await import('sharp')).default;
}

// ---- textures ---------------------------------------------------------------

async function openImage(sharp, texture) {
	const mime = texture.getMimeType();
	const image = texture.getImage();
	if (mime === 'image/ktx2') {
		const raw = await decodeKtx2(image);
		return sharp(Buffer.from(raw.data), {
			raw: { width: raw.width, height: raw.height, channels: 4 },
		});
	}
	return sharp(Buffer.from(image));
}

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg' };

/**
 * Rewrite one texture so Office can read it. Returns a report row, or null
 * when the texture already qualifies.
 */
async function officeTexture(sharp, texture, maxPx) {
	const mime = texture.getMimeType();
	const image = texture.getImage();
	if (!image || image.byteLength === 0) return null;
	const size = texture.getSize();
	const tooBig = size ? Math.max(size[0], size[1]) > maxPx : false;
	const unreadable = !OFFICE_IMAGE_TYPES.has(mime);
	if (!tooBig && !unreadable) return null;

	let pipeline = await openImage(sharp, texture);
	const meta = await pipeline.metadata();
	const width = meta.width ?? size?.[0] ?? 0;
	const height = meta.height ?? size?.[1] ?? 0;
	if (Math.max(width, height) > maxPx) {
		pipeline = pipeline.resize({
			width: maxPx,
			height: maxPx,
			fit: 'inside',
			withoutEnlargement: true,
		});
	}
	// A PNG or JPEG that only needed resizing keeps its format, so a lossless
	// source never picks up JPEG artifacts. Converted containers pick by alpha.
	let outMime = mime;
	if (unreadable) {
		const { isOpaque } = await pipeline.clone().stats();
		outMime = isOpaque ? 'image/jpeg' : 'image/png';
	}
	const out =
		outMime === 'image/jpeg'
			? await pipeline
					.jpeg({ quality: 90, mozjpeg: true })
					.toBuffer({ resolveWithObject: true })
			: await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
	texture.setImage(new Uint8Array(out.data)).setMimeType(outMime);
	const uri = texture.getURI();
	if (uri) texture.setURI(uri.replace(/\.[a-z0-9]+$/i, '') + '.' + EXT_BY_MIME[outMime]);
	return {
		name: texture.getName() || uri || '',
		from: mime,
		to: outMime,
		fromSize: [width, height],
		toSize: [out.info.width, out.info.height],
	};
}

// ---- skinning ---------------------------------------------------------------

/**
 * Cap every skinned primitive at four influences per vertex: merge JOINTS_n /
 * WEIGHTS_n sets, keep the four heaviest, renormalize. Returns how many
 * primitives were rewritten.
 */
function limitInfluences(doc) {
	let rewritten = 0;
	const buffer = doc.getRoot().listBuffers()[0];
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const sets = [];
			for (let i = 0; ; i++) {
				const joints = prim.getAttribute(`JOINTS_${i}`);
				const weights = prim.getAttribute(`WEIGHTS_${i}`);
				if (!joints || !weights) break;
				sets.push({ joints, weights });
			}
			if (sets.length === 0) continue;
			const count = sets[0].joints.getCount();
			const outJoints = new Uint16Array(count * 4);
			const outWeights = new Float32Array(count * 4);
			const j = [0, 0, 0, 0];
			const w = [0, 0, 0, 0];
			for (let v = 0; v < count; v++) {
				const pairs = [];
				for (const set of sets) {
					set.joints.getElement(v, j);
					set.weights.getElement(v, w);
					for (let k = 0; k < 4; k++) if (w[k] > 0) pairs.push([j[k], w[k]]);
				}
				pairs.sort((a, b) => b[1] - a[1]);
				const top = pairs.slice(0, OFFICE_MAX_INFLUENCES);
				const sum = top.reduce((s, p) => s + p[1], 0);
				for (let k = 0; k < 4; k++) {
					const p = top[k];
					outJoints[v * 4 + k] = p ? p[0] : 0;
					outWeights[v * 4 + k] =
						p && sum > 0 ? p[1] / sum : k === 0 && sum === 0 ? 1 : 0;
				}
			}
			prim.setAttribute(
				'JOINTS_0',
				doc.createAccessor().setType('VEC4').setArray(outJoints).setBuffer(buffer),
			);
			prim.setAttribute(
				'WEIGHTS_0',
				doc.createAccessor().setType('VEC4').setArray(outWeights).setBuffer(buffer),
			);
			for (let i = 1; i < sets.length; i++) {
				prim.setAttribute(`JOINTS_${i}`, null);
				prim.setAttribute(`WEIGHTS_${i}`, null);
			}
			rewritten++;
		}
	}
	return rewritten;
}

// ---- animation --------------------------------------------------------------

/**
 * Replace a STEP sampler with a LINEAR one that holds each value until the
 * instant before the next key, which plays identically.
 */
function stepToLinear(doc, sampler) {
	const input = sampler.getInput();
	const output = sampler.getOutput();
	const times = input.getArray();
	const size = output.getElementSize();
	const values = output.getArray();
	const n = input.getCount();
	const outTimes = [];
	const outValues = [];
	for (let i = 0; i < n; i++) {
		if (i > 0) {
			const gap = times[i] - times[i - 1];
			outTimes.push(times[i] - Math.min(1e-4, gap / 10));
			for (let k = 0; k < size; k++) outValues.push(values[(i - 1) * size + k]);
		}
		outTimes.push(times[i]);
		for (let k = 0; k < size; k++) outValues.push(values[i * size + k]);
	}
	const buffer = doc.getRoot().listBuffers()[0];
	sampler
		.setInput(
			doc
				.createAccessor()
				.setType('SCALAR')
				.setArray(new Float32Array(outTimes))
				.setBuffer(buffer),
		)
		.setOutput(
			doc
				.createAccessor()
				.setType(output.getType())
				.setArray(new Float32Array(outValues))
				.setBuffer(buffer),
		)
		.setInterpolation('LINEAR');
}

function officeAnimations(doc, warnings) {
	const animations = doc.getRoot().listAnimations();
	if (animations.length > OFFICE_MAX_ANIMATIONS) {
		for (const extra of animations.slice(OFFICE_MAX_ANIMATIONS)) extra.dispose();
		warnings.push(
			`Office plays at most ${OFFICE_MAX_ANIMATIONS} animations per model; kept the first ${OFFICE_MAX_ANIMATIONS} of ${animations.length}.`,
		);
	}
	let stepSamplers = 0;
	let morphChannels = 0;
	for (const anim of doc.getRoot().listAnimations()) {
		for (const sampler of anim.listSamplers()) {
			if (sampler.getInterpolation() === 'STEP') {
				stepToLinear(doc, sampler);
				stepSamplers++;
			}
		}
		for (const channel of anim.listChannels())
			if (channel.getTargetPath() === 'weights') morphChannels++;
	}
	if (morphChannels) {
		warnings.push(
			'This model animates morph targets. Microsoft documents skeletal animation for Office; morph-target motion may not play in PowerPoint.',
		);
	}
	return { animations: doc.getRoot().listAnimations().length, stepSamplers };
}

// ---- framing ----------------------------------------------------------------

/**
 * Move the scene so its bounding box is centred on the origin, by parenting
 * every root node under one translated node. Skins, animations and the root
 * nodes' own transforms are untouched. Returns the centred bounds.
 */
async function recentre(doc) {
	const { getBounds } = await import('@gltf-transform/functions');
	const root = doc.getRoot();
	const scene = root.getDefaultScene() || root.listScenes()[0];
	if (!scene)
		throw new OfficeGlbError('no_geometry', 'The model has no scene to place on a slide.');
	if (!root.getDefaultScene()) root.setDefaultScene(scene);
	const { min, max } = getBounds(scene);
	if (![...min, ...max].every(Number.isFinite)) {
		throw new OfficeGlbError(
			'no_geometry',
			'The model has no visible geometry to place on a slide.',
		);
	}
	const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
	const extent = Math.max(...[0, 1, 2].map((i) => max[i] - min[i]));
	if (!(extent > 0)) throw new OfficeGlbError('no_geometry', 'The model has zero size.');
	if (center.some((c) => Math.abs(c) > extent * 1e-6)) {
		const wrapper = doc
			.createNode('three.ws office centre')
			.setTranslation(center.map((c) => -c));
		for (const child of scene.listChildren()) {
			scene.removeChild(child);
			wrapper.addChild(child);
		}
		scene.addChild(wrapper);
	}
	return {
		min: [0, 1, 2].map((i) => min[i] - center[i]),
		max: [0, 1, 2].map((i) => max[i] - center[i]),
	};
}

// ---- the pass -----------------------------------------------------------------

/**
 * Make a GLB Office will insert.
 *
 * @param {Uint8Array|Buffer} input  any glTF 2.0 binary three.ws produces or accepts
 * @param {{ maxTextureSize?: number, targetBytes?: number }} [opts]
 * @returns {Promise<{ glb: Uint8Array, bounds: { min: number[], max: number[] }, report: object }>}
 */
export async function makeOfficeSafeGlb(
	input,
	{ maxTextureSize = OFFICE_TEXTURE_MAX_PX, targetBytes = OFFICE_TARGET_BYTES } = {},
) {
	if (!input || input.byteLength < 20)
		throw new OfficeGlbError('invalid_model', 'The model file is empty.');
	const io = await getIO();
	const { dequantize, uninstance, unpartition, prune } =
		await import('@gltf-transform/functions');
	const { PropertyType } = await import('@gltf-transform/core');

	let doc;
	try {
		doc = await io.readBinary(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
	} catch (err) {
		throw new OfficeGlbError(
			'invalid_model',
			`The model is not a readable GLB: ${err.message}`,
		);
	}
	const root = doc.getRoot();
	const extensionsBefore = root.listExtensionsUsed().map((e) => e.extensionName);
	const warnings = [];

	if (extensionsBefore.includes('EXT_mesh_gpu_instancing')) await doc.transform(uninstance());
	await doc.transform(unpartition());
	if (extensionsBefore.includes('KHR_mesh_quantization')) await doc.transform(dequantize());

	const influencesRewritten = limitInfluences(doc);
	const animation = officeAnimations(doc, warnings);
	const bounds = await recentre(doc);

	const optional = [];
	for (const ext of root.listExtensionsUsed()) {
		if (DECODED_EXTENSIONS.has(ext.extensionName)) ext.dispose();
		else if (ext.isRequired()) {
			ext.setRequired(false);
			optional.push(ext.extensionName);
		}
	}
	if (optional.length) {
		warnings.push(
			`Marked ${optional.join(', ')} optional; Office ignores extensions it does not read.`,
		);
	}
	await doc.transform(
		prune({
			propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE, PropertyType.MATERIAL],
			keepAttributes: true,
		}),
	);

	const sharp = await loadSharp();
	const textures = [];
	let maxPx = maxTextureSize;
	let glb;
	for (;;) {
		for (const texture of root.listTextures()) {
			let row;
			try {
				row = await officeTexture(sharp, texture, maxPx);
			} catch (err) {
				throw new OfficeGlbError(
					'texture_unreadable',
					`Could not convert texture "${texture.getName() || texture.getURI()}": ${err.message}`,
				);
			}
			if (row) {
				const prior = textures.find((t) => t.texture === texture);
				if (prior) Object.assign(prior.row, { to: row.to, toSize: row.toSize });
				else textures.push({ texture, row });
			}
		}
		glb = await io.writeBinary(doc);
		if (
			glb.byteLength <= targetBytes ||
			maxPx <= OFFICE_TEXTURE_MIN_PX ||
			root.listTextures().length === 0
		)
			break;
		maxPx = Math.max(OFFICE_TEXTURE_MIN_PX, Math.floor(maxPx / 2));
	}
	if (glb.byteLength > targetBytes) {
		warnings.push(
			`The Office copy is ${(glb.byteLength / 1048576).toFixed(1)} MB; it will insert, but the deck is large.`,
		);
	}

	return {
		glb,
		bounds,
		report: {
			inputBytes: input.byteLength,
			outputBytes: glb.byteLength,
			extensionsBefore,
			extensionsAfter: root.listExtensionsUsed().map((e) => e.extensionName),
			textures: textures.map((t) => t.row),
			textureMaxPx: maxPx,
			skins: root.listSkins().length,
			influencesRewritten,
			animations: animation.animations,
			stepSamplersConverted: animation.stepSamplers,
			warnings,
		},
	};
}
