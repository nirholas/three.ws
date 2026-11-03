// Cinematic look parameters and named presets, shared by the WebGL2 pipeline
// (src/viewer/cinematic.js, postprocessing EffectComposer) and the WebGPU
// pipeline (src/viewer/cinematic-tsl.js, TSL RenderPipeline). Kept in a module
// of its own so the WebGPU path does not pull in the WebGL-only postprocessing
// library just to read a preset table.

/**
 * Full parameter set. Presets are partial overrides of these defaults; any key a
 * preset omits resets to the value here, so presets are declarative and total.
 * @typedef {Object} CinematicParams
 */
export const CINEMATIC_DEFAULTS = Object.freeze({
	// Bloom: bleeds bright specular highlights. Threshold keeps matte surfaces flat.
	bloom: 0.6,
	bloomThreshold: 0.8,
	bloomSmoothing: 0.05,
	// Vignette: darkens the frame edges to pull focus onto the avatar.
	vignette: 0.22,
	vignetteOffset: 0.5,
	// Ambient occlusion: soft contact shadows in creases and where limbs meet.
	// Radius is a fraction of the model's bounding diagonal, so the shading
	// reads the same on a 2 m avatar and a 20 cm figurine.
	ssao: false,
	ssaoIntensity: 1.4,
	ssaoRadius: 0.08,
	// Depth of field: cinematic focus falloff. World-space focus distance in metres.
	dof: false,
	dofFocusDistance: 2.4,
	dofFocalLength: 0.08,
	dofBokeh: 2.2,
	// Colour grade: screen-space, applied after tone mapping.
	saturation: 0,
	brightness: 0,
	contrast: 0,
	hue: 0,
	// Chromatic aberration: RGB split at the lens edges. Subtle = lens realism.
	chromaticAberration: 0,
	// Film grain: animated luminance noise. Adds texture / hides banding.
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
