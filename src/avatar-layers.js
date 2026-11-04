// Texture layers for Parametric avatars (appearance.layers, specs/AVATAR_PARAMETERS.md).
//
// A pure compositor: ordered layers are rasterised into one RGBA base-color
// texture over the body's canonical UVs, each clipped to a region of
// parametric-base.regions.png. No canvas, no DOM, no three.js: it runs over
// plain typed arrays so the browser preview and the server bake (api/_lib/
// bake-layers.js) share the exact same code and produce the same pixels, which
// is what lets the bake be cached by the appearance hash.
//
// Callers decode images (a canvas in the browser, sharp on the server) into
// { width, height, data: RGBA } and hand them in through `sources` and `mask`.

import { BODY_REGIONS } from './garment-taxonomy.js';
import { decodeRegionCode } from './garment-region-mask.js';

export const LAYER_KINDS = Object.freeze(['complexion', 'makeup', 'tattoo', 'decal']);
export const LAYER_BLENDS = Object.freeze(['normal', 'multiply', 'overlay']);
export const LAYER_REGIONS = Object.freeze(['all', ...BODY_REGIONS]);
export const MAX_LAYERS = 8;
export const LAYER_TEXTURE_SIZE = 2048;
export const LAYER_SCALE_MIN = 0.01;
export const LAYER_SCALE_MAX = 2;

const SOURCE_RE = /^(catalog|upload):([a-z0-9][a-z0-9-]{0,63})$/;

/** `catalog:freckles` to `{ type: 'catalog', id: 'freckles' }`, or null when malformed. */
export function parseLayerSource(source) {
	const m = SOURCE_RE.exec(String(source || ''));
	return m ? { type: m[1], id: m[2] } : null;
}

/**
 * Cross-field rule the schema cannot express per key: tattoos and decals are
 * body art. They may not claim the head (`scalp`, where the lips live) or `all`
 * (which includes it). Face art is `makeup`. Returns an error string or null.
 */
export function layerRegionError(layer) {
	if ((layer.kind === 'tattoo' || layer.kind === 'decal') && (layer.region === 'scalp' || layer.region === 'all')) {
		return `${layer.kind} layers cannot target the ${layer.region === 'all' ? 'whole body' : 'head'}: use a body region, or the makeup kind for face art`;
	}
	return null;
}

/** Distinct sources a layer stack needs, in first-use order. */
export function layerSources(layers) {
	return [...new Set((layers || []).map((l) => l.source))];
}

function hexToRgb(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
	if (!m) return null;
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Round away the last-ulp differences between engines' sin/cos so a rotation
// of -90 degrees is exactly 0 and 1 everywhere.
const trig = (x) => Math.round(x * 1e12) / 1e12;

function regionTable(region) {
	const t = new Uint8Array(256);
	if (region === 'all') return t.fill(1);
	for (let code = 0; code < 256; code++) t[code] = decodeRegionCode(code) === region ? 1 : 0;
	// The region mask is built from bone ownership and `scalp` is the Head bone
	// only, so the jaw (mouth, chin) is left unassigned. Face art must reach the
	// lips, so the head region also takes unassigned pixels; tattoos and decals
	// can never use it (layerRegionError), so body art still cannot get there.
	if (region === 'scalp') t[0] = 1;
	return t;
}

function sampleSprite(src, x, y, out) {
	// Bilinear over premultiplied alpha so a transparent edge does not bleed its
	// (arbitrary) colour into the sprite.
	const { width: w, height: h, data } = src;
	const x0 = Math.floor(x), y0 = Math.floor(y);
	const fx = x - x0, fy = y - y0;
	let r = 0, g = 0, b = 0, a = 0;
	for (let j = 0; j < 2; j++) {
		const yy = Math.min(h - 1, Math.max(0, y0 + j));
		const wy = j ? fy : 1 - fy;
		for (let i = 0; i < 2; i++) {
			const xx = Math.min(w - 1, Math.max(0, x0 + i));
			const wgt = (i ? fx : 1 - fx) * wy;
			const o = (yy * w + xx) * 4;
			const al = (data[o + 3] / 255) * wgt;
			r += data[o] * al;
			g += data[o + 1] * al;
			b += data[o + 2] * al;
			a += al;
		}
	}
	if (a <= 0) { out[3] = 0; return; }
	out[0] = r / a; out[1] = g / a; out[2] = b / a; out[3] = a;
}

function blendChannel(mode, d, s) {
	if (mode === 'multiply') return (d * s) / 255;
	if (mode === 'overlay') return d < 128 ? (2 * d * s) / 255 : 255 - (2 * (255 - d) * (255 - s)) / 255;
	return s;
}

/**
 * Composite `layers` onto a flat `base` colour.
 *
 * @param {object} args
 * @param {number} [args.size]                 output edge in pixels (square)
 * @param {number[]} args.base                 [r, g, b] 0-255 skin colour under the layers
 * @param {object[]} args.layers               appearance.layers, bottom first
 * @param {Map<string,{width:number,height:number,data:ArrayLike<number>}>} args.sources  decoded RGBA per `source`
 * @param {{width:number,height:number,data:ArrayLike<number>}} args.mask  region codes, one byte per pixel
 * @returns {Uint8ClampedArray} RGBA, size*size*4, fully opaque
 */
export function compositeLayers({ size = LAYER_TEXTURE_SIZE, base, layers, sources, mask }) {
	if (!Number.isInteger(size) || size < 16 || size > 4096) throw new RangeError('size must be an integer from 16 to 4096');
	if (!Array.isArray(base) || base.length < 3) throw new TypeError('base must be [r, g, b]');
	const out = new Uint8ClampedArray(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		out[i * 4] = base[0]; out[i * 4 + 1] = base[1]; out[i * 4 + 2] = base[2]; out[i * 4 + 3] = 255;
	}
	const sample = [0, 0, 0, 0];
	for (const layer of layers || []) {
		const src = sources.get(layer.source);
		if (!src) throw new Error(`layer ${layer.id}: source ${layer.source} was not provided`);
		const allowed = regionTable(layer.region);
		const tint = hexToRgb(layer.tint) || [255, 255, 255];
		const opacity = layer.opacity;
		const rad = (layer.uv.rotation * Math.PI) / 180;
		const cos = trig(Math.cos(rad)), sin = trig(Math.sin(rad));
		const W = layer.uv.scale * size;
		const H = (W * src.height) / src.width;
		const cx = layer.uv.offset[0] * size, cy = layer.uv.offset[1] * size;
		const R = 0.5 * Math.hypot(W, H);
		const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(size - 1, Math.ceil(cx + R));
		const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(size - 1, Math.ceil(cy + R));
		for (let y = y0; y <= y1; y++) {
			const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / size));
			for (let x = x0; x <= x1; x++) {
				const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / size));
				if (!allowed[mask.data[my * mask.width + mx]]) continue;
				const vx = x + 0.5 - cx, vy = y + 0.5 - cy;
				const ux = vx * cos + vy * sin, uy = -vx * sin + vy * cos;
				const sx = (ux / W + 0.5) * src.width - 0.5;
				const sy = (uy / H + 0.5) * src.height - 0.5;
				if (sx < -0.5 || sy < -0.5 || sx > src.width - 0.5 || sy > src.height - 0.5) continue;
				sample[3] = 0;
				sampleSprite(src, sx, sy, sample);
				const a = sample[3] * opacity;
				if (a <= 0) continue;
				const o = (y * size + x) * 4;
				for (let c = 0; c < 3; c++) {
					const s = (sample[c] * tint[c]) / 255;
					const d = out[o + c];
					out[o + c] = Math.round(d * (1 - a) + blendChannel(layer.blend, d, s) * a);
				}
			}
		}
	}
	return out;
}
