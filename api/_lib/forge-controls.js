// What each pre-generation control on /forge and the home widget actually does
// on each Forge lane: one record, read by the API (to reject a combination a
// lane cannot honor), by the page (to hide, disable or relabel a control) and by
// tests/forge-controls-matrix.test.js (which captures each lane's outbound
// request and fails when this record and the wire disagree).
//
// Pure data and string helpers, no imports, so the browser bundle can load it
// the same way it loads forge-seed.js.
//
// Controls:
//   tier             Draft / Standard / High. "applied" when the lane's request
//                    changes with the tier (sampler budget, poly target, texture
//                    size or extra reference views); "ignored" when every tier
//                    sends the same request, so only the price would differ.
//   seed             "applied" when the lane's engine receives the seed;
//                    "ignored" when no part of the run receives it.
//   aspect_ratio     "reference" when a text prompt is painted into a reference
//                    picture at this shape before the 3D build (the shape frames
//                    the picture, the 3D engine then crops to the subject);
//                    "ignored" when the lane builds straight from the text with
//                    no picture.
//   guidance         The optional words beside an uploaded photo. "applied" when
//                    the lane's engine reads them; "ignored" when the engine
//                    builds from the photo alone (the words still name the model).
//   fill_other_sides "applied" only on the lane that can paint the missing sides
//                    of a single photo; "rejected" everywhere else.

export const CONTROL_APPLIED = 'applied';
export const CONTROL_IGNORED = 'ignored';
export const CONTROL_REJECTED = 'rejected';
export const ASPECT_REFERENCE = 'reference';

// The reference-image shapes a text prompt can be painted at.
export const FORGE_ASPECT_RATIOS = Object.freeze(['1:1', '4:3', '3:4', '16:9', '9:16']);

export const FORGE_CONTROLS = Object.freeze(['tier', 'seed', 'aspect_ratio', 'guidance', 'fill_other_sides']);

const A = CONTROL_APPLIED;
const I = CONTROL_IGNORED;
const R = CONTROL_REJECTED;

function lane(tier, seed, aspect, guidance, fill = R) {
	return Object.freeze({ tier, seed, aspect_ratio: aspect, guidance, fill_other_sides: fill });
}

export const LANE_CONTROLS = Object.freeze({
	// Our own GPU workers.
	trellis_selfhost: lane(A, A, ASPECT_REFERENCE, I),
	trellis2: lane(A, A, ASPECT_REFERENCE, I),
	pixal3d: lane(A, A, ASPECT_REFERENCE, I, A),
	hunyuan3d: lane(A, A, ASPECT_REFERENCE, I),
	modly: lane(A, A, ASPECT_REFERENCE, I),
	modly_hunyuan: lane(A, A, ASPECT_REFERENCE, I),
	anigen: lane(I, A, ASPECT_REFERENCE, I),
	partcrafter: lane(I, A, ASPECT_REFERENCE, I),
	triposg: lane(A, A, I, A),
	// Hosted lanes.
	huggingface: lane(I, A, ASPECT_REFERENCE, I),
	nvidia: lane(A, A, I, I),
	trellis: lane(I, A, ASPECT_REFERENCE, I),
	replicate_byok: lane(I, A, ASPECT_REFERENCE, I),
	// Your own key.
	meshy: lane(A, I, I, A),
	tripo: lane(A, A, I, I),
	rodin: lane(A, A, I, A),
	stability: lane(A, I, I, I),
});

// A lane that has no record (a new lane, or the page's pre-catalog state) is
// described as the default lane is: nothing is hidden on a guess.
const UNKNOWN = lane(A, A, ASPECT_REFERENCE, I);

export function laneControls(backendId) {
	return (backendId && LANE_CONTROLS[backendId]) || UNKNOWN;
}

export function laneHonorsTier(backendId) {
	return laneControls(backendId).tier === CONTROL_APPLIED;
}

export function laneHonorsSeed(backendId) {
	return laneControls(backendId).seed === CONTROL_APPLIED;
}

export function laneUsesAspect(backendId) {
	return laneControls(backendId).aspect_ratio === ASPECT_REFERENCE;
}

export function laneReadsGuidance(backendId) {
	return laneControls(backendId).guidance === CONTROL_APPLIED;
}

export function laneFillsOtherSides(backendId) {
	return laneControls(backendId).fill_other_sides === CONTROL_APPLIED;
}

// One-line reasons the page shows beside a control it disables, and the API
// returns in a 400. `label` is the engine's display name.
export function tierIgnoredReason(label) {
	return `${label} runs at one quality, so Draft and High would make the same model as Standard.`;
}

export function seedIgnoredReason(label) {
	return `${label} takes no seed, so a seed would not repeat the model.`;
}

export function fillSidesRejectedReason() {
	return 'fill_other_sides only works with the Match my photo engine (backend pixal3d) and one photo.';
}

// Placeholder for the optional words under an uploaded photo: says what the
// words do on this engine instead of promising control it does not have.
export function guidancePlaceholder(backendId) {
	return laneReadsGuidance(backendId)
		? 'Optional guidance, e.g. "matte plastic, no background"'
		: 'Optional name for the model. This engine builds from the photo alone.';
}
