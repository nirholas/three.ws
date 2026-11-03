/**
 * Cinematic post-processing pipeline for the avatar viewer.
 *
 * Wraps a single EffectComposer and owns the full post chain so the core
 * Viewer stays readable. The chain, in render order:
 *
 *   RenderPass → NormalPass → DepthDownsamplingPass → SSAO → DoF → Bloom → Grade
 *
 * SSAO needs scene normals + depth (NormalPass / DepthDownsamplingPass), so it
 * lives in its own pass. Bloom and depth-of-field are *convolution* effects and
 * the postprocessing lib forbids merging two of them into one EffectPass — each
 * gets a dedicated pass. Everything cheap and per-pixel (colour grade, vignette,
 * chromatic aberration, film grain) is merged into one always-on final pass.
 *
 * Tone mapping stays on the WebGLRenderer (Viewer.updateLights sets
 * renderer.toneMapping) — we deliberately do NOT add a ToneMappingEffect here to
 * avoid double-tone-mapping the carefully-tuned Neutral default.
 *
 * Passes that aren't needed for the active preset are toggled off via `.enabled`
 * (zero GPU cost) rather than rebuilt, so switching presets is allocation-free.
 */

import { Vector2 } from 'three';
import {
	EffectComposer,
	RenderPass,
	EffectPass,
	NormalPass,
	DepthDownsamplingPass,
	BloomEffect,
	VignetteEffect,
	SSAOEffect,
	DepthOfFieldEffect,
	HueSaturationEffect,
	BrightnessContrastEffect,
	ChromaticAberrationEffect,
	NoiseEffect,
	BlendFunction,
} from 'postprocessing';

/**
 * Full parameter set. Presets are partial overrides of these defaults; any key a
 * preset omits resets to the value here, so presets are declarative and total.
 * @typedef {Object} CinematicParams
 */
export const CINEMATIC_DEFAULTS = Object.freeze({
	// Bloom — bleeds bright specular highlights. Threshold keeps matte surfaces flat.
	bloom: 0.6,
	bloomThreshold: 0.8,
	bloomSmoothing: 0.05,
	// Vignette — darkens the frame edges to pull focus onto the avatar.
	vignette: 0.22,
	vignetteOffset: 0.5,
	// Ambient occlusion — soft contact shadows in creases and where limbs meet.
	ssao: false,
	ssaoIntensity: 1.4,
	ssaoRadius: 0.18,
	// Depth of field — cinematic focus falloff. World-space focus distance in metres.
	dof: false,
	dofFocusDistance: 2.4,
	dofFocalLength: 0.08,
	dofBokeh: 2.2,
	// Colour grade — screen-space, applied after tone mapping.
	saturation: 0,
	brightness: 0,
	contrast: 0,
	hue: 0,
	// Chromatic aberration — RGB split at the lens edges. Subtle = lens realism.
	chromaticAberration: 0,
	// Film grain — animated luminance noise. Adds texture / hides banding.
	grain: 0,
});

/**
 * Named looks. Order here is the order shown in the picker. 'Studio' reproduces
 * the historical default (subtle bloom + vignette, no AO/DoF/grade) byte-for-byte
 * so existing gallery thumbnails and embeds are unchanged unless a user opts in.
 */
export const CINEMATIC_PRESETS = Object.freeze({
	Off: { bloom: 0, vignette: 0 },
	Studio: {},
	Cinematic: {
		bloom: 0.7,
		vignette: 0.34,
		ssao: true,
		ssaoIntensity: 1.3,
		dof: true,
		dofBokeh: 1.8,
		dofFocusDistance: 2.2,
		contrast: 0.09,
		saturation: 0.06,
		grain: 0.06,
		chromaticAberration: 0.0008,
	},
	Portrait: {
		bloom: 0.5,
		vignette: 0.3,
		ssao: true,
		ssaoIntensity: 1.0,
		dof: true,
		dofBokeh: 3.4,
		dofFocusDistance: 1.9,
		dofFocalLength: 0.05,
		saturation: 0.04,
		brightness: 0.03,
	},
	Vivid: {
		bloom: 0.8,
		vignette: 0.18,
		saturation: 0.26,
		contrast: 0.12,
	},
	Neon: {
		bloom: 1.4,
		bloomThreshold: 0.55,
		vignette: 0.32,
		saturation: 0.3,
		contrast: 0.06,
		chromaticAberration: 0.0016,
	},
	Noir: {
		bloom: 0.4,
		vignette: 0.5,
		saturation: -1,
		contrast: 0.26,
		grain: 0.13,
	},
});

export const CINEMATIC_PRESET_NAMES = Object.keys(CINEMATIC_PRESETS);
export const DEFAULT_CINEMATIC_PRESET = 'Studio';

export class CinematicPipeline {
	/**
	 * @param {import('three').WebGLRenderer} renderer
	 * @param {import('three').Scene} scene
	 * @param {import('three').Camera} camera
	 * @param {{ width: number, height: number, preset?: string }} opts
	 */
	constructor(renderer, scene, camera, { width, height, preset = DEFAULT_CINEMATIC_PRESET, lowPower = false } = {}) {
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.params = { ...CINEMATIC_DEFAULTS };
		this.preset = CINEMATIC_PRESETS[preset] ? preset : DEFAULT_CINEMATIC_PRESET;

		// The composer renders into its own target, which bypasses the canvas's
		// `antialias` MSAA: without multisampling here every edge stair-steps.
		// The target stays 8-bit on purpose: the presets' bloom thresholds were
		// tuned on clamped values, and a half-float target feeds HDR highlights
		// into bloom and visibly blows out the Studio look.
		const maxSamples = renderer.capabilities?.maxSamples ?? 0;
		this.composer = new EffectComposer(renderer, {
			multisampling: Math.min(lowPower ? 2 : 4, maxSamples),
		});

		this._renderPass = new RenderPass(scene, camera);
		this.composer.addPass(this._renderPass);

		// Scene-space normals + downsampled normal/depth feed SSAO. Disabled with
		// SSAO so they cost nothing when ambient occlusion is off (the default).
		this._normalPass = new NormalPass(scene, camera);
		this._depthDownsamplingPass = new DepthDownsamplingPass({
			normalBuffer: this._normalPass.texture,
			resolutionScale: 0.5,
		});
		this.composer.addPass(this._normalPass);
		this.composer.addPass(this._depthDownsamplingPass);

		this._ssaoEffect = new SSAOEffect(camera, this._normalPass.texture, {
			blendFunction: BlendFunction.MULTIPLY,
			normalDepthBuffer: this._depthDownsamplingPass.texture,
			samples: 9,
			rings: 7,
			distanceThreshold: 0.97,
			distanceFalloff: 0.03,
			rangeThreshold: 0.0005,
			rangeFalloff: 0.001,
			luminanceInfluence: 0.7,
			radius: this.params.ssaoRadius,
			intensity: this.params.ssaoIntensity,
			bias: 0.025,
			fade: 0.01,
		});
		this._ssaoPass = new EffectPass(camera, this._ssaoEffect);
		this.composer.addPass(this._ssaoPass);

		this._dofEffect = new DepthOfFieldEffect(camera, {
			focusDistance: 0,
			focalLength: this.params.dofFocalLength,
			bokehScale: this.params.dofBokeh,
		});
		this._dofPass = new EffectPass(camera, this._dofEffect);
		this.composer.addPass(this._dofPass);

		this._bloomEffect = new BloomEffect({
			intensity: this.params.bloom,
			luminanceThreshold: this.params.bloomThreshold,
			luminanceSmoothing: this.params.bloomSmoothing,
			mipmapBlur: true,
		});
		this._bloomPass = new EffectPass(camera, this._bloomEffect);
		this.composer.addPass(this._bloomPass);

		// Always-on final pass: cheap per-pixel grade + lens character, composited
		// straight to screen.
		this._hueSat = new HueSaturationEffect({ hue: 0, saturation: 0 });
		this._brightContrast = new BrightnessContrastEffect({ brightness: 0, contrast: 0 });
		this._chromaticAberration = new ChromaticAberrationEffect({
			offset: new Vector2(0, 0),
			radialModulation: true,
			modulationOffset: 0.15,
		});
		this._noiseEffect = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
		this._noiseEffect.blendMode.opacity.value = 0;
		this._vignetteEffect = new VignetteEffect({
			offset: this.params.vignetteOffset,
			darkness: this.params.vignette,
		});
		this._finalPass = new EffectPass(
			camera,
			this._hueSat,
			this._brightContrast,
			this._chromaticAberration,
			this._noiseEffect,
			this._vignetteEffect,
		);
		this._finalPass.renderToScreen = true;
		this.composer.addPass(this._finalPass);

		this.composer.setSize(width, height);
		this.applyPreset(this.preset);
	}

	/** Apply a named preset: reset to defaults, layer the preset's overrides, push. */
	applyPreset(name) {
		const overrides = CINEMATIC_PRESETS[name];
		if (!overrides) return;
		this.preset = name;
		this.params = { ...CINEMATIC_DEFAULTS, ...overrides };
		this.apply();
	}

	/** Push the current `params` into every effect + pass-enable flag. */
	apply() {
		const p = this.params;

		this._bloomEffect.intensity = p.bloom;
		this._bloomEffect.luminanceMaterial.threshold = p.bloomThreshold;
		this._bloomEffect.luminanceMaterial.smoothing = p.bloomSmoothing;
		this._bloomPass.enabled = p.bloom > 0;

		this._vignetteEffect.darkness = p.vignette;
		this._vignetteEffect.offset = p.vignetteOffset;

		this._ssaoEffect.intensity = p.ssaoIntensity;
		this._ssaoEffect.radius = p.ssaoRadius;
		const ssaoOn = !!p.ssao;
		this._ssaoPass.enabled = ssaoOn;
		this._normalPass.enabled = ssaoOn;
		this._depthDownsamplingPass.enabled = ssaoOn;

		this._dofEffect.cocMaterial.focalLength = p.dofFocalLength;
		this._dofEffect.bokehScale = p.dofBokeh;
		this._setDofFocusDistance(p.dofFocusDistance);
		this._dofPass.enabled = !!p.dof;

		this._hueSat.saturation = p.saturation;
		this._hueSat.hue = p.hue;
		this._brightContrast.brightness = p.brightness;
		this._brightContrast.contrast = p.contrast;

		this._chromaticAberration.offset.set(p.chromaticAberration, p.chromaticAberration);
		this._noiseEffect.blendMode.opacity.value = p.grain;
	}

	/** Set one parameter and re-push. Keeps GUI bindings one-line. */
	set(key, value) {
		if (!(key in this.params)) return;
		this.params[key] = value;
		this.apply();
	}

	_setDofFocusDistance(metres) {
		// DoF focusDistance is normalised [0,1] over the camera near→far range.
		const cam = this.camera;
		const near = cam?.near ?? 0.01;
		const far = cam?.far ?? 1000;
		const norm = Math.min(1, Math.max(0, (metres - near) / (far - near)));
		if (this._dofEffect.cocMaterial) this._dofEffect.cocMaterial.focusDistance = norm;
	}

	setCamera(camera) {
		this.camera = camera;
		this._renderPass.mainCamera = camera;
		this._normalPass.mainCamera = camera;
		this._ssaoPass.mainCamera = camera;
		this._dofPass.mainCamera = camera;
		this._bloomPass.mainCamera = camera;
		this._finalPass.mainCamera = camera;
		this._setDofFocusDistance(this.params.dofFocusDistance);
	}

	setSize(width, height) {
		if (width > 0 && height > 0) this.composer.setSize(width, height);
	}

	render(deltaTime) {
		this.composer.render(deltaTime);
	}

	dispose() {
		this.composer.dispose();
	}
}
