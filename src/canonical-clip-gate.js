// Can the pre-baked clip library drive this rig? One decision, read by every
// surface that asks it: AnimationManager.supportsCanonicalClips() (the live
// viewer), src/embodiment/rig-mode.js (its pure twin), src/rig-report.js (Rig
// Doctor) and api/_lib/avatar-capabilities.js (the capabilities API).
//
// There used to be two bars that disagreed. The bone-count gate said a skinned
// rig with 8 canonical bones could play the library; the retargeter refused any
// clip whose tracks mapped under MIN_COVERAGE and built no action for it. The
// retargeter's number also undercounted bodies. A library clip is baked on the
// canonical rig with one rotation track per canonical bone plus the Hips root
// translation (53 tracks), and 30 of those are finger joints. Counting fingers
// put every complete fingerless body (a Meshy AI biped, a Mixamo export without
// hands) at 23 of 53, under the floor, so it stood in its bind pose.
//
// A clip now clears the floor when either measure does: all 53 tracks, or the
// 23 body tracks (the 22 non-finger canonical bones plus the Hips position).
// The body measure lets a complete fingerless body animate. The full measure
// keeps the half-body avatars that always animated (a Ready Player Me
// half-body: head, spine and fully fingered hands, no arms or legs) animating.
// A rig short on both, such as arms and legs without a torso, still falls back.
// The gate below predicts the retargeter's own numbers for a library clip, so
// "supported" means a clip will actually bind.

import { CANONICAL_BONES } from './glb-canonicalize.js';

/**
 * Fewest distinct canonical bones a rig must expose. A model sharing a stray
 * bone or two (a prop with a node named "Head") is never a rig, whatever its
 * coverage arithmetic says.
 */
export const MIN_CANONICAL_BONES = 8;

/**
 * Fraction of a clip's tracks that must bind, measured over all of them or
 * over the body tracks alone (whichever is higher), or no action is built.
 */
export const MIN_COVERAGE = 0.5;

const FINGER_BONE = /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)\d$/;

/**
 * True for a canonical finger joint. Fingers are detail: a rig without them
 * still walks, waves and dances, so they never count toward body coverage.
 *
 * @param {string} canonical
 */
export function isFingerBone(canonical) {
	return FINGER_BONE.test(canonical);
}

/**
 * The floor itself, shared by the retargeter and the gate so they cannot drift.
 *
 * @param {{ coverage: number, bodyCoverage: number }} counts
 * @param {number} [min]
 */
export function clearsCoverageFloor(counts, min = MIN_COVERAGE) {
	return Math.max(counts.coverage, counts.bodyCoverage) >= min;
}

// What a library clip addresses: a rotation per canonical bone, plus the Hips
// position (root motion). Mirrors the `retargetable` rule in retargetClip.
const LIBRARY_TRACKS = CANONICAL_BONES.length + 1;
const BODY_BONES = CANONICAL_BONES.filter((b) => !isFingerBone(b));
const BODY_TRACKS = BODY_BONES.length + 1;

/**
 * The coverage retargetClip reports for a library clip on a rig that maps
 * `canonical` (the canonical names the rig resolves). Exact for every clip baked
 * on the full canonical skeleton, which is the idle and walk every surface plays
 * first. `matched`/`total`/`coverage` count every retargetable track, fingers
 * included; `bodyMatched`/`bodyTotal`/`bodyCoverage` count the body only. The
 * floor (clearsCoverageFloor) passes when either fraction reaches it.
 *
 * @param {Iterable<string>} canonical
 * @returns {{ matched: number, total: number, coverage: number, bodyMatched: number, bodyTotal: number, bodyCoverage: number }}
 */
export function predictLibraryCoverage(canonical) {
	const have = canonical instanceof Set ? canonical : new Set(canonical || []);
	let matched = 0;
	for (const bone of CANONICAL_BONES) if (have.has(bone)) matched++;
	let bodyMatched = 0;
	for (const bone of BODY_BONES) if (have.has(bone)) bodyMatched++;
	if (have.has('Hips')) {
		matched++;
		bodyMatched++;
	}
	return {
		matched,
		total: LIBRARY_TRACKS,
		coverage: matched / LIBRARY_TRACKS,
		bodyMatched,
		bodyTotal: BODY_TRACKS,
		bodyCoverage: bodyMatched / BODY_TRACKS,
	};
}

/**
 * The decision. `canonical` is the set of canonical bones the rig resolves (the
 * keys of the retargeter's canonical-to-node map, or the canonicalized joint
 * names when only the glTF JSON is available).
 *
 * @param {{ hasSkinnedMesh?: boolean, canonical?: Iterable<string> }} info
 * @returns {{ ok: boolean, why: 'no-skin'|'too-few-bones'|'low-coverage'|'ok', canonicalCount: number, matched: number, total: number, coverage: number, bodyMatched: number, bodyTotal: number, bodyCoverage: number }}
 */
export function canonicalClipGate(info = {}) {
	const canonical = info.canonical instanceof Set ? info.canonical : new Set(info.canonical || []);
	const base = { canonicalCount: canonical.size, ...predictLibraryCoverage(canonical) };
	if (!info.hasSkinnedMesh) return { ok: false, why: 'no-skin', ...base };
	if (canonical.size < MIN_CANONICAL_BONES) return { ok: false, why: 'too-few-bones', ...base };
	if (!clearsCoverageFloor(base)) return { ok: false, why: 'low-coverage', ...base };
	return { ok: true, why: 'ok', ...base };
}
