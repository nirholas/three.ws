import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
	EquirectangularReflectionMapping,
	HalfFloatType,
	LinearFilter,
	LinearMipmapLinearFilter,
	LinearSRGBColorSpace,
	RGBAFormat,
	ShaderMaterial,
	SRGBColorSpace,
	Texture,
	WebGLRenderTarget,
} from 'three';
import {
	MAX_PANO_BYTES,
	PanoError,
	PANO_MESSAGES,
	brightenGain,
	clampEquirectSize,
	colorSpaceForFormat,
	isEquirectSize,
	isMobileDevice,
	readPanoHeader,
} from './pano-photo.js';

/** Width of the equirect the lighting is prefiltered from. PMREM never needs more. */
const LIGHTING_WIDTH = 2048;
/** Linear value where highlight expansion starts (an sRGB code of about 0.8). */
const BRIGHTEN_THRESHOLD = 0.6;

export function getCubeMapTexture(viewer, environment) {
	const { id, path } = environment;

	// neutral (THREE.RoomEnvironment)
	if (id === 'neutral') {
		return Promise.resolve({ envMap: viewer.neutralEnvironment });
	}

	// none
	if (id === '') {
		return Promise.resolve({ envMap: null });
	}

	// The user's own 360 photo. Without one loaded the viewer keeps the neutral
	// studio light and the picker panel explains how to add a photo.
	if (id === 'pano') {
		const lighting = viewer.pano?.getLightingEnvironment() ?? null;
		return Promise.resolve({
			envMap: lighting || viewer.neutralEnvironment,
			background: viewer.pano?.getBackgroundTexture() ?? null,
		});
	}

	return new Promise((resolve, reject) => {
		new EXRLoader().load(
			path,
			(texture) => {
				const envMap = viewer.pmremGenerator.fromEquirectangular(texture).texture;
				texture.dispose();

				if (viewer._loadedEnvironment && viewer._loadedEnvironment !== envMap) {
					viewer._loadedEnvironment.dispose();
				}
				viewer._loadedEnvironment = envMap;

				resolve({ envMap });
			},
			undefined,
			reject,
		);
	});
}

// -- 360 photo loading --------------------------------------------------------

const abortError = () => new DOMException('The load was cancelled', 'AbortError');

// Read a File or a fetch Response body to memory, reporting real bytes read. When
// the total is known the buffer is allocated once, so a 25 MB photo never exists
// twice at the same time.
async function readStream(stream, total, onProgress, signal) {
	const reader = stream.getReader();
	const known = Number.isFinite(total) && total > 0 && total <= MAX_PANO_BYTES;
	let out = known ? new Uint8Array(total) : null;
	const chunks = [];
	let loaded = 0;
	try {
		for (;;) {
			if (signal?.aborted) throw abortError();
			const { done, value } = await reader.read();
			if (done) break;
			if (loaded + value.length > MAX_PANO_BYTES) throw new PanoError('tooLarge');
			if (out && loaded + value.length <= out.length) out.set(value, loaded);
			else {
				if (out) {
					chunks.push(out.subarray(0, loaded));
					out = null;
				}
				chunks.push(value);
			}
			loaded += value.length;
			onProgress?.({ loaded, total: known ? total : 0 });
		}
	} catch (err) {
		reader.cancel().catch(() => {});
		throw err;
	}
	if (out) return loaded === out.length ? out.buffer : out.slice(0, loaded).buffer;
	const merged = new Uint8Array(loaded);
	let at = 0;
	for (const c of chunks) {
		merged.set(c, at);
		at += c.length;
	}
	return merged.buffer;
}

/** Read a user File, or fetch a public https URL, to an ArrayBuffer. */
export async function readPanoSource(source, { onProgress, signal } = {}) {
	if (typeof source === 'string') {
		let response;
		try {
			response = await fetch(source, { mode: 'cors', credentials: 'omit', signal });
		} catch (err) {
			if (err?.name === 'AbortError') throw err;
			throw new PanoError('cors');
		}
		if (!response.ok) throw new PanoError('http');
		const total = Number(response.headers.get('content-length')) || 0;
		if (total > MAX_PANO_BYTES) throw new PanoError('tooLarge');
		if (!response.body) {
			const buffer = await response.arrayBuffer();
			onProgress?.({ loaded: buffer.byteLength, total: buffer.byteLength });
			return { buffer, name: new URL(source).pathname.split('/').pop() || 'photo' };
		}
		const buffer = await readStream(response.body, total, onProgress, signal);
		return { buffer, name: new URL(source).pathname.split('/').pop() || 'photo' };
	}
	if (source.size > MAX_PANO_BYTES) throw new PanoError('tooLarge');
	const buffer = await readStream(source.stream(), source.size, onProgress, signal);
	return { buffer, name: source.name || 'photo' };
}

const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };

// Decode off the main thread: a one-shot module worker runs createImageBitmap,
// which is where a 72 MP JPEG spends its time and memory. Browsers without module
// workers decode with the same call on the main thread.
function decodeInWorker(buffer, mime, options) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./pano-decode.worker.js', import.meta.url), { type: 'module' });
		const done = (fn, value) => {
			worker.terminate();
			fn(value);
		};
		worker.onmessage = ({ data }) => {
			if (data.error) done(reject, new Error(data.error));
			else done(resolve, data.bitmap);
		};
		worker.onerror = (e) => done(reject, new Error(e.message || 'worker failed'));
		worker.postMessage({ buffer, mime, options }, [buffer]);
	});
}

async function decodeBitmap(buffer, format, size) {
	const options = {
		imageOrientation: 'flipY',
		premultiplyAlpha: 'none',
		colorSpaceConversion: 'default',
		...(size.scaled ? { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' } : {}),
	};
	const mime = MIME[format];
	if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
		try {
			return await decodeInWorker(buffer.slice(0), mime, options);
		} catch {
			// fall through to the main thread
		}
	}
	return createImageBitmap(new Blob([buffer], { type: mime }), options);
}

function loadFloatTexture(buffer, format) {
	const url = URL.createObjectURL(new Blob([buffer]));
	const loader = format === 'exr' ? new EXRLoader() : new HDRLoader();
	return new Promise((resolve, reject) => {
		loader.load(url, resolve, undefined, reject);
	}).finally(() => URL.revokeObjectURL(url));
}

/**
 * Decode a 360 photo into an equirect texture.
 *
 * Accepts a `File` or a public https URL of a JPEG, PNG, WebP, AVIF, EXR or
 * Radiance HDR. The header is read first: a non 2:1 image is refused before any
 * pixels are decoded, and a photo larger than the GPU (or the device class) can
 * use is decoded straight to the largest 2:1 size allowed, so a 72 MP JPEG never
 * exists at full size in memory.
 *
 * @param {File|string} source
 * @param {object} options
 * @param {number} options.maxTextureSize  `renderer.capabilities.maxTextureSize`
 * @param {boolean} [options.mobile]       defaults to {@link isMobileDevice}
 * @param {(p: {loaded:number,total:number}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<PanoImage>}
 */
export async function loadPanoTexture(source, { maxTextureSize, mobile = isMobileDevice(), onProgress, signal } = {}) {
	const started = performance.now();
	const { buffer, name } = await readPanoSource(source, { onProgress, signal });
	const header = readPanoHeader(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 262144)));
	if (!header) {
		throw new PanoError(buffer.byteLength < 12 ? 'unreadable' : 'unsupported');
	}
	if (!isEquirectSize(header.width, header.height)) throw new PanoError('notEquirect');

	const { colorSpace, hdr } = colorSpaceForFormat(header.format);
	const size = clampEquirectSize(header.width, header.height, { maxTextureSize, mobile });
	const bytes = buffer.byteLength;
	let texture;
	let width = size.width;
	let height = size.height;

	if (hdr) {
		if (size.scaled) {
			throw new PanoError(
				'tooLarge',
				`That HDR image is ${header.width} px wide and this device can use ${size.width}. Export it at ${size.width} x ${size.height} or smaller.`,
			);
		}
		try {
			texture = await loadFloatTexture(buffer, header.format);
		} catch {
			throw new PanoError('unreadable');
		}
		width = texture.image.width;
		height = texture.image.height;
		texture.colorSpace = LinearSRGBColorSpace;
	} else {
		let bitmap;
		try {
			bitmap = await decodeBitmap(buffer, header.format, size);
		} catch {
			throw new PanoError('decode');
		}
		if (signal?.aborted) {
			bitmap.close?.();
			throw abortError();
		}
		width = bitmap.width;
		height = bitmap.height;
		texture = new Texture(bitmap);
		texture.colorSpace = SRGBColorSpace;
		texture.format = RGBAFormat;
		texture.flipY = false;
		texture.generateMipmaps = true;
		texture.minFilter = LinearMipmapLinearFilter;
		texture.magFilter = LinearFilter;
		texture.needsUpdate = true;
	}
	texture.mapping = EquirectangularReflectionMapping;

	return {
		texture,
		width,
		height,
		format: header.format,
		hdr,
		colorSpace,
		sourceWidth: header.width,
		sourceHeight: header.height,
		scaled: size.scaled,
		bytes,
		name,
		fromUrl: typeof source === 'string',
		decodeMs: Math.round(performance.now() - started),
		dispose() {
			texture.image?.close?.();
			texture.dispose();
		},
	};
}

// -- Lighting from the photo --------------------------------------------------

const BRIGHTEN_VERT = `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0);
	}
`;

// An LDR photo clips the sun and sky at 1.0, so lit by it the avatar looks flat.
// Pixels above the threshold are expanded by a smooth curve: the clipped sun
// ends up many times brighter than the sky around it, as it was in the scene.
const BRIGHTEN_FRAG = `
	uniform sampler2D map;
	uniform float threshold;
	uniform float gain;
	varying vec2 vUv;
	void main() {
		vec3 rgb = texture2D(map, vUv).rgb;
		float peak = max(rgb.r, max(rgb.g, rgb.b));
		float t = smoothstep(threshold, 1.0, peak);
		gl_FragColor = vec4(rgb * (1.0 + gain * t * t), 1.0);
	}
`;

/**
 * Prefilter the photo into an environment map for image based lighting.
 * Returns the PMREM texture; the caller owns it and disposes it.
 *
 * An LDR photo goes through a half-float pass at lighting resolution (with the
 * optional highlight expansion), HDR and EXR keep their linear data untouched.
 * @param {object} renderer
 * @param {object} pmrem a PMREMGenerator for that renderer
 * @param {PanoImage} image
 * @param {{ brighten?: boolean, strength?: number }} [options]
 */
export function buildPanoLighting(renderer, pmrem, image, { brighten = true, strength = 0.6 } = {}) {
	if (image.hdr || !renderer.isWebGLRenderer) {
		return pmrem.fromEquirectangular(image.texture).texture;
	}
	const width = Math.min(LIGHTING_WIDTH, image.width);
	const target = new WebGLRenderTarget(width, width / 2, {
		type: HalfFloatType,
		format: RGBAFormat,
		colorSpace: LinearSRGBColorSpace,
		depthBuffer: false,
		generateMipmaps: false,
		minFilter: LinearFilter,
		magFilter: LinearFilter,
	});
	const material = new ShaderMaterial({
		uniforms: {
			map: { value: image.texture },
			threshold: { value: BRIGHTEN_THRESHOLD },
			gain: { value: brighten ? brightenGain(strength) : 0 },
		},
		vertexShader: BRIGHTEN_VERT,
		fragmentShader: BRIGHTEN_FRAG,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	const quad = new FullScreenQuad(material);
	const previous = renderer.getRenderTarget();
	try {
		renderer.setRenderTarget(target);
		quad.render(renderer);
	} finally {
		renderer.setRenderTarget(previous);
	}
	target.texture.mapping = EquirectangularReflectionMapping;
	const envMap = pmrem.fromEquirectangular(target.texture).texture;
	quad.dispose();
	material.dispose();
	target.dispose();
	return envMap;
}

/**
 * @typedef {object} PanoImage
 * @property {Texture} texture      equirect texture, mapping and colour space already set
 * @property {number} width         decoded size
 * @property {number} height
 * @property {string} format        jpeg | png | webp | avif | exr | hdr
 * @property {boolean} hdr
 * @property {number} sourceWidth   size in the file
 * @property {number} sourceHeight
 * @property {boolean} scaled       decoded smaller than the file
 * @property {number} bytes
 * @property {string} name
 * @property {boolean} fromUrl
 * @property {number} decodeMs      read plus decode
 * @property {() => void} dispose
 */

export { PANO_MESSAGES };
