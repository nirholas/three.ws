/**
 * Rig-mode gate — the pure twin of AnimationManager.supportsCanonicalClips().
 *
 * The pre-baked clip library addresses tracks by the canonical bone names in
 * src/glb-canonicalize.js. A rig the canonicalizer can map enough of can be
 * driven by those clips ("canonical" mode); one it can't — too few mappable
 * bones, or no SkinnedMesh to skin at all — must fall back to a known-good
 * default rig rather than freeze in a bind-pose T-pose ("fallback" mode).
 *
 * This module is the side-effect-free decision: it takes a rig description
 * (or a traversable Three.js root via inspectRig) and returns the mode plus
 * the evidence behind it. AnimationManager.supportsCanonicalClips() applies
 * the same bar live; the bone threshold here must match it.
 */

import { canonicalizeBoneName } from '../glb-canonicalize.js';
import { MIN_CANONICAL_BONES, MIN_COVERAGE, canonicalClipGate } from '../canonical-clip-gate.js';

/**
 * Minimum number of distinct canonical bones a rig must expose to drive the
 * baked clip library. Re-exported from the shared gate the live AnimationManager
 * reads, so the two bars cannot drift.
 */
export { MIN_CANONICAL_BONES };

/**
 * The distinct canonical bones a list of raw bone names resolves to. Deduped so
 * a rig that ships a bone twice (de-dup suffixes, mirrored helpers) can't
 * inflate its way past the threshold.
 *
 * @param {string[]} boneNames
 * @returns {Set<string>}
 */
function canonicalBones(boneNames) {
	const seen = new Set();
	for (const name of boneNames) {
		const canonical = canonicalizeBoneName(name);
		if (canonical) seen.add(canonical);
	}
	return seen;
}

/**
 * Decide whether a rig can drive the canonical clip library: the same decision
 * AnimationManager.supportsCanonicalClips() makes, including the retargeter's
 * coverage floor, so a rig is never put in canonical mode only to bind no clip.
 *
 * @param {{ hasSkinnedMesh?: boolean, boneNames?: string[] }} [info]
 * @returns {{ mode: 'canonical'|'fallback', reason: string, canonicalCount: number, hasSkinnedMesh: boolean, coverage: number }}
 */
export function decideRigMode(info = {}) {
	const hasSkinnedMesh = !!info.hasSkinnedMesh;
	const boneNames = Array.isArray(info.boneNames) ? info.boneNames : [];
	const gate = canonicalClipGate({ hasSkinnedMesh, canonical: hasSkinnedMesh ? canonicalBones(boneNames) : [] });
	const out = (mode, reason) => ({
		mode,
		reason,
		canonicalCount: gate.canonicalCount,
		hasSkinnedMesh,
		coverage: gate.coverage,
	});

	if (gate.why === 'no-skin') {
		return out('fallback', 'No SkinnedMesh, so nothing to skin and the canonical clips have nothing to drive.');
	}
	if (gate.why === 'too-few-bones') {
		return out('fallback', `Only ${gate.canonicalCount} canonical bone(s), below the ${MIN_CANONICAL_BONES} the baked clips need.`);
	}
	if (gate.why === 'low-coverage') {
		return out(
			'fallback',
			`${gate.canonicalCount} canonical bones map ${gate.matched} of ${gate.total} clip tracks, under the ${Math.round(MIN_COVERAGE * 100)}% the retargeter binds (finger joints are most of a clip).`,
		);
	}
	return out('canonical', `${gate.canonicalCount} canonical bones mapped, which drives the baked clip library.`);
}

/**
 * Collect the canonicalizer's inputs from a traversable Three.js root: whether
 * any node is a SkinnedMesh and the names of every bone node. Safe on a null
 * or non-traversable root.
 *
 * @param {{ traverse?: (fn: (node: any) => void) => void }} root
 * @returns {{ hasSkinnedMesh: boolean, boneNames: string[] }}
 */
export function inspectRig(root) {
	const result = { hasSkinnedMesh: false, boneNames: [] };
	if (!root || typeof root.traverse !== 'function') return result;

	root.traverse((node) => {
		if (!node) return;
		if (node.isSkinnedMesh) result.hasSkinnedMesh = true;
		if ((node.isBone || node.type === 'Bone') && typeof node.name === 'string' && node.name) {
			result.boneNames.push(node.name);
		}
	});
	return result;
}
