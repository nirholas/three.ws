/**
 * WebGPU twin of CinematicPipeline (src/viewer/cinematic.js), built from TSL
 * nodes on three's RenderPipeline instead of the WebGL-only postprocessing
 * EffectComposer. Same constructor, same methods, same presets: the Viewer
 * holds either one behind `this._cinematic` and never branches on which.
 *
 * Chain, in render order:
 *
 *   pass (MSAA) -> GTAO -> renderOutput (tone map + sRGB) -> DoF -> Bloom
 *     -> chromatic aberration -> hue/saturation -> brightness/contrast
 *     -> film grain -> vignette
 *
 * Parity with the WebGL path: the per-pixel stages (hue/saturation,
 * brightness/contrast, radial chromatic aberration, overlay grain, vignette)
 * are the exact formulas of the postprocessing shaders the WebGL pipeline runs,
 * evaluated on display-referred colour like theirs. Bloom (screen-blended),
 * DoF and AO are three's own TSL nodes (BloomNode, DepthOfFieldNode, GTAONode)
 * with the preset values mapped onto their units, so the Studio default reads
 * the same and the heavier looks match in character rather than bit for bit.
 * One deliberate difference: postprocessing's merged pass samples the
 * ungraded input for the red and blue channels of chromatic aberration, so the
 * grade drops out at the frame edges; here aberration runs first and the grade
 * applies to every channel.
 *
 * Effects that need their own render targets (AO, DoF, bloom, aberration) are
 * only in the node graph while the active look uses them. Toggling one rebuilds
 * the graph once; moving a slider only writes a uniform.
 */

import { Vector2, Vector3 } from 'three';
import { RenderPipeline } from 'three/webgpu';
import {
	pass,
	uniform,
	renderOutput,
	convertToTexture,
	screenUV,
	vec2,
	vec3,
	vec4,
	float,
	dot,
	min,
	max,
	mix,
	step,
	distance,
	smoothstep,
	rand,
	time,
	Fn,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import {
	CINEMATIC_DEFAULTS,
	CINEMATIC_PRESETS,
	DEFAULT_CINEMATIC_PRESET,
} from './cinematic-presets.js';

// postprocessing's MipmapBlurPass default radius. BloomNode's radius is the
// same 0..1 "how far the glow spreads" knob.
const BLOOM_RADIUS = 0.85;
// ChromaticAberrationEffect({ radialModulation: true, modulationOffset: 0.15 }).
const CA_MODULATION_OFFSET = 0.15;

/**
 * HueSaturationEffect's hue vector for a rotation in radians (the `hue` setter
 * in postprocessing). Dotting the colour against its three rotations rotates
 * the hue around the grey axis.
 */
export function hueVector(radians) {
	const s = Math.sin(radians);
	const c = Math.cos(radians);
	const r3 = Math.sqrt(3);
	return [(2 * c + 1) / 3, (-r3 * s - c + 1) / 3, (r3 * s - c + 1) / 3];
}

/** HueSaturationEffect: `color += diff * factor`, factor depends on the sign. */
export function saturationFactor(saturation) {
	return saturation > 0 ? 1 - 1 / (1.001 - saturation) : -saturation;
}

/** BrightnessContrastEffect scales (c - 0.5) by this. */
export function contrastScale(contrast) {
	return contrast > 0 ? 1 / (1 - contrast) : 1 + contrast;
}

/**
 * Which render-target-owning stages the params need. The graph is rebuilt only
 * when this key changes.
 */
export function structureKey(p) {
	return [!!p.ssao, !!p.dof, p.bloom > 0, p.chromaticAberration > 0].map(Number).join('');
}

export class CinematicPipelineTSL {
	/**
	 * @param {import('three/webgpu').WebGPURenderer} renderer
	 * @param {import('three').Scene} scene
	 * @param {import('three').Camera} camera
	 * @param {{ width?: number, height?: number, preset?: string, lowPower?: boolean, onUpdate?: Function }} opts
	 */
	constructor(renderer, scene, camera, { preset = DEFAULT_CINEMATIC_PRESET, lowPower = false, onUpdate = null } = {}) {
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.lowPower = lowPower;
		this.onUpdate = onUpdate;
		this.contentSize = 2;
		this.params = { ...CINEMATIC_DEFAULTS };
		this.preset = CINEMATIC_PRESETS[preset] ? preset : DEFAULT_CINEMATIC_PRESET;
		this._disposed = false;
		this._key = null;
		this._scenePass = null;
		this._effects = [];

		this._u = {
			aoIntensity: uniform(1),
			dofFocus: uniform(1),
			dofFocal: uniform(1),
			dofBokeh: uniform(1),
			bloomStrength: uniform(0),
			bloomThreshold: uniform(1),
			caOffset: uniform(new Vector2()),
			hue: uniform(new Vector3(1, 0, 0)),
			saturation: uniform(0),
			brightness: uniform(0),
			contrast: uniform(1),
			grain: uniform(0),
			vignetteOffset: uniform(0.5),
			vignetteDarkness: uniform(0),
		};

		this.pipeline = new RenderPipeline(renderer);
		// renderOutput() is placed explicitly before the display-space stages.
		this.pipeline.outputColorTransform = false;

		this.applyPreset(this.preset);
	}

	/** The Viewer reads `_cinematic.composer` for setSize; the pipeline is its own. */
	get composer() {
		return this;
	}

	/** Apply a named preset: reset to defaults, layer the preset's overrides, push. */
	applyPreset(name) {
		const overrides = CINEMATIC_PRESETS[name];
		if (!overrides) return;
		this.preset = name;
		// Mutate in place: GUI sliders hold a reference to this object.
		Object.assign(this.params, CINEMATIC_DEFAULTS, overrides);
		this.apply();
	}

	/** Push `params` into the uniforms; rebuild the graph if a stage toggled. */
	apply() {
		const p = this.params;
		const u = this._u;
		u.aoIntensity.value = p.ssaoIntensity;
		u.dofBokeh.value = p.dofBokeh;
		u.bloomStrength.value = p.bloom;
		u.bloomThreshold.value = p.bloomThreshold;
		const [hx, hy, hz] = hueVector(p.hue);
		u.hue.value.set(hx, hy, hz);
		u.saturation.value = saturationFactor(p.saturation);
		u.brightness.value = p.brightness;
		u.contrast.value = contrastScale(p.contrast);
		u.grain.value = p.grain;
		u.vignetteOffset.value = p.vignetteOffset;
		u.vignetteDarkness.value = p.vignette;
		this._syncCameraUniforms();
		if (this._bloomNode) this._bloomNode.smoothWidth.value = p.bloomSmoothing;
		this._syncAo();
		const key = structureKey(p);
		if (key !== this._key) this._build(key);
	}

	/** Set one parameter and re-push. Keeps GUI bindings one-line. */
	set(key, value) {
		if (!(key in this.params)) return;
		this.params[key] = value;
		this.apply();
	}

	setContentSize(size) {
		if (!(size > 0) || !isFinite(size)) return;
		this.contentSize = size;
		this._syncAo();
	}

	setCamera(camera) {
		if (camera === this.camera) return;
		this.camera = camera;
		// PassNode, GTAO and DoF all bind the camera at construction.
		this._build(structureKey(this.params));
	}

	// The pipeline renders at the renderer's own size; nothing to reallocate.
	setSize() {}

	render() {
		if (this._disposed) return;
		this._syncCameraUniforms();
		this._caAspect();
		this.pipeline.render();
	}

	dispose() {
		this._disposed = true;
		this._disposeGraph();
		this.pipeline.dispose();
	}

	_syncAo() {
		if (!this._aoNode) return;
		this._aoNode.radius.value = this.params.ssaoRadius * this.contentSize;
	}

	// DepthOfFieldEffect works in depth normalised over near..far; DepthOfFieldNode
	// in world units. Scale the focal range by the same span so a preset's
	// in-focus band covers the same slice of the scene on both paths.
	_syncCameraUniforms() {
		const p = this.params;
		const near = this.camera?.near ?? 0.01;
		const far = this.camera?.far ?? 1000;
		this._u.dofFocus.value = p.dofFocusDistance;
		this._u.dofFocal.value = Math.max(1e-4, p.dofFocalLength * (far - near));
	}

	// ChromaticAberrationEffect shifts by offset * vec2(1, aspect).
	_caAspect() {
		const ca = this.params.chromaticAberration;
		const el = this.renderer.domElement;
		const aspect = el && el.height > 0 ? el.width / el.height : 1;
		this._u.caOffset.value.set(ca, ca * aspect);
	}

	_disposeGraph() {
		for (const node of this._effects) node.dispose?.();
		this._effects = [];
		this._scenePass?.dispose?.();
		this._scenePass = null;
		this._aoNode = null;
		this._bloomNode = null;
	}

	_build(key) {
		this._disposeGraph();
		this._key = key;
		const p = this.params;
		const u = this._u;

		// WebGPU multisampling is 1 or 4 samples; low-power devices skip it, as
		// the WebGL path skips MSAA on the canvas for them.
		const scenePass = pass(this.scene, this.camera, { samples: this.lowPower ? 0 : 4 });
		this._scenePass = scenePass;

		let lit = scenePass.getTextureNode('output');
		if (p.ssao) {
			const aoNode = ao(scenePass.getTextureNode('depth'), null, this.camera);
			aoNode.resolutionScale = this.lowPower ? 0.5 : 1;
			this._aoNode = aoNode;
			this._effects.push(aoNode);
			this._syncAo();
			const occlusion = aoNode.getTextureNode().sample(screenUV).r.pow(u.aoIntensity);
			lit = vec4(lit.rgb.mul(occlusion), lit.a);
		}

		// Tone mapping and sRGB encoding happen here, before every display-space
		// stage, matching where the WebGL composer grades.
		let out = renderOutput(lit);

		if (p.dof) {
			const dofNode = dof(out, scenePass.getViewZNode(), u.dofFocus, u.dofFocal, u.dofBokeh);
			this._effects.push(dofNode);
			out = dofNode;
		}

		if (p.bloom > 0) {
			const bloomNode = bloom(out, u.bloomStrength, BLOOM_RADIUS, u.bloomThreshold);
			bloomNode.smoothWidth.value = p.bloomSmoothing;
			this._bloomNode = bloomNode;
			this._effects.push(bloomNode);
			// BloomEffect's default blend is SCREEN.
			const base = vec4(out);
			const glow = bloomNode.rgb;
			out = vec4(float(1).sub(float(1).sub(base.rgb).mul(float(1).sub(glow))), base.a);
		}

		let color;
		if (p.chromaticAberration > 0) {
			const tex = convertToTexture(out);
			this._effects.push(tex);
			color = Fn(() => {
				const uv = screenUV;
				const d = max(distance(uv, vec2(0.5)).mul(2).sub(CA_MODULATION_OFFSET), 0);
				const base = tex.sample(uv);
				const r = tex.sample(mix(uv, uv.add(u.caOffset), d)).r;
				const b = tex.sample(mix(uv, uv.sub(u.caOffset), d)).b;
				return vec4(r, base.g, b, base.a);
			})();
		} else {
			color = vec4(out);
		}

		this.pipeline.outputNode = finalGrade(color, u);
		this.pipeline.needsUpdate = true;
		this.onUpdate?.();
	}
}

/**
 * The always-on per-pixel stages, in the WebGL pipeline's order. Each block is
 * the postprocessing shader of the same name, transcribed to TSL.
 */
function finalGrade(input, u) {
	return Fn(() => {
		const uv = screenUV;
		const src = vec4(input);
		// HueSaturationEffect
		let c = vec3(dot(src.rgb, u.hue.xyz), dot(src.rgb, u.hue.zxy), dot(src.rgb, u.hue.yzx));
		const average = c.r.add(c.g).add(c.b).div(3);
		c = min(c.add(vec3(average).sub(c).mul(u.saturation)), 1);
		// BrightnessContrastEffect
		c = c.add(u.brightness.sub(0.5)).mul(u.contrast).add(0.5);
		// NoiseEffect, premultiplied, OVERLAY blend at `grain` opacity
		const noise = min(c.mul(rand(uv.mul(float(1).add(time)))), 1);
		const a = noise.mul(c).mul(2);
		const b = float(1).sub(float(1).sub(noise).mul(float(1).sub(c)).mul(2));
		c = mix(c, mix(a, b, step(0.5, c)), u.grain);
		// VignetteEffect, default technique
		const d = distance(uv, vec2(0.5));
		c = c.mul(smoothstep(0.8, u.vignetteOffset.mul(0.799), d.mul(u.vignetteDarkness.add(u.vignetteOffset))));
		return vec4(c, src.a);
	})();
}
