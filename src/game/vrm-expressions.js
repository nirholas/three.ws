// ARKit-52 -> VRM expression-preset driver (best3d order 075, task 2).
//
// Voice/face capture across the site (src/voice/talk-emotes.js and friends)
// already speaks ARKit-52 blendshape weights. A VRM avatar's face is not a
// blendshape target list: pixiv/three-vrm exposes a small, discrete preset set
// (vrm.expressionManager, VRM-1.0 names, which the library normalizes VRM 0.x's
// PascalCase preset names into on load) -- visemes (aa/ih/ou/ee/oh), emotions
// (happy/angry/sad/relaxed/surprised) and blink. Rather than hand-author a
// second ARKit<->VRM table, this module inverts the existing, reviewed
// VRM->ARKit map in src/voice/arkit-blendshapes.js (VRM_TO_ARKIT): each VRM
// preset's weighted ARKit combination becomes a basis vector, and an incoming
// ARKit weight set is scored against every preset by projecting onto that
// vector (dot(incoming, preset) / dot(preset, preset)), so "how much of this
// preset's pattern is present in the capture" comes out as a single 0..1
// number per preset, with no duplicated expression data to drift out of sync.

import { VRM_TO_ARKIT } from '../voice/arkit-blendshapes.js';

// VRM-1.0 expressionManager preset name -> the VRM_TO_ARKIT key that carries
// its ARKit combination. VRM_TO_ARKIT keeps both the 0.x and 1.0 spellings for
// visemes (Aa/A/Ah) and emotions (Joy/Happy); one representative per preset is
// enough as a basis vector since the aliases resolve to the same weights.
const PRESET_SOURCE = {
	aa: 'Aa', ih: 'Ih', ou: 'Ou', ee: 'Ee', oh: 'Oh',
	happy: 'Joy', angry: 'Angry', sad: 'Sad', surprised: 'Surprised', relaxed: 'Fun',
	blink: 'Blink', blinkLeft: 'BlinkL', blinkRight: 'BlinkR',
};

/** VRM-1.0 preset name -> { arkitName: weight } basis vector. */
export const VRM1_EXPRESSION_TO_ARKIT = Object.freeze(
	Object.fromEntries(
		Object.entries(PRESET_SOURCE).map(([preset, key]) => [preset, VRM_TO_ARKIT[key]]),
	),
);

/** Every VRM-1.0 preset name this module knows how to drive from ARKit weights. */
export const VRM_EXPRESSION_PRESETS = Object.freeze(Object.keys(VRM1_EXPRESSION_TO_ARKIT));

/**
 * How much of `preset`'s ARKit pattern is present in `weights`?
 * Projection coefficient dot(weights, preset) / dot(preset, preset): 0 when the
 * incoming weights have none of this preset's shapes active, ~1 when they match
 * the preset's own combination at full intensity, clamped so a louder-than-the-
 * preset capture (e.g. jawOpen pinned to 1 while the preset only calls for 0.5)
 * cannot overshoot 1 and fight sibling presets in expressionManager.
 *
 * @param {Record<string, number>} weights ARKit-52 name -> 0..1
 * @param {Record<string, number>} preset ARKit-52 name -> 0..1 basis vector
 * @returns {number} 0..1
 */
function projectWeight(weights, preset) {
	let dot = 0;
	let normSq = 0;
	for (const [name, w] of Object.entries(preset)) {
		dot += (weights[name] || 0) * w;
		normSq += w * w;
	}
	if (normSq <= 0) return 0;
	return Math.max(0, Math.min(1, dot / normSq));
}

/**
 * Score an ARKit-52 weight set against every VRM expression preset this
 * module maps. Pure, no VRM instance required, so it is testable and reusable
 * on the server (export validation, preview tooling) without a GL context.
 *
 * @param {Record<string, number>} arkitWeights ARKit-52 name -> 0..1
 * @returns {Record<string, number>} VRM-1.0 preset name -> 0..1
 */
export function arkitWeightsToVrmExpressions(arkitWeights) {
	const weights = arkitWeights || {};
	const out = {};
	for (const [preset, vector] of Object.entries(VRM1_EXPRESSION_TO_ARKIT)) {
		out[preset] = projectWeight(weights, vector);
	}
	return out;
}

/**
 * Drive a loaded VRM's expressionManager straight from an ARKit-52 weight set
 * (the same shape voice/face capture already produces for every other avatar).
 * No-op (returns false) when `vrm` has no expressionManager, e.g. a VRM parsed
 * without the reference plugin installed, or a non-VRM model.
 *
 * @param {object} vrm a VRMCore instance (vrm.expressionManager)
 * @param {Record<string, number>} arkitWeights ARKit-52 name -> 0..1
 * @returns {boolean} whether anything was applied
 */
export function applyArkitWeightsToVrm(vrm, arkitWeights) {
	const em = vrm?.expressionManager;
	if (!em) return false;
	const presets = arkitWeightsToVrmExpressions(arkitWeights);
	for (const [name, weight] of Object.entries(presets)) {
		em.setValue(name, weight);
	}
	return true;
}
