// Phonological and structural lint for a sign pack.
//
// Two-handed signs are not free-form. Battison (1978) described two constraints
// that hold across ASL, and the same shape holds in the sign languages studied
// since (they are about what two hands can produce and perceive, not about
// English), so a sign that breaks one is almost always an authoring mistake:
//
//   Symmetry Condition: if BOTH hands move, they use the same handshape and
//     their movement is symmetrical.
//   Dominance Condition: if the two hands take DIFFERENT handshapes, only the
//     dominant hand may move and the passive hand is limited to a small set of
//     unmarked handshapes. Two hands sharing one handshape are unrestricted,
//     which is why NAME (both hands in H, only the dominant one taps) is fine.
//
// This module is the one implementation: tests/sign-linguistics.test.js runs it
// over the ASL pack and scripts/validate-sign-pack.mjs runs it over any pack,
// together with the structural checks (handshapes, anchors, contact parts and
// directions the engine actually knows, aliases that resolve, no dead phases).

import { HANDSHAPES } from '../sign-handshapes.js';
import { ANCHORS } from '../sign-rig.js';
import { FACE_MARKERS } from '../sign-clip.js';

/** The unmarked handshapes: the ones a passive hand is allowed to take. */
export const UNMARKED = new Set(['A', 'S', 'B', 'FLAT', '5', 'C', 'O', '0', '1', 'BENT_B', 'FLAT_O', 'CLAW']);

const DIRECTIONS = new Set(['up', 'down', 'forward', 'back', 'in', 'out']);
const HAND_PARTS = new Set([
	'wrist',
	'palm',
	'back',
	'knuckles',
	'fingers',
	'edge',
	'indextip',
	'middletip',
	'thumbtip',
	'fingertips',
]);
const HAND_TARGETS = new Set(['other', 'left', 'right']);

/** Resolve each phase into what one hand is doing. */
export function handTrack(sign, side) {
	return sign.phases.map((phase) => {
		const own = phase[side];
		if (own === 'rest') return null;
		const merged = phase.both ? { ...phase.both, ...(own ?? {}) } : own;
		if (!merged) return null;
		return {
			shape: merged.shape ?? null,
			// Everything that determines WHERE the hand is. Two phases that differ
			// in any of these mean the hand moved.
			place: JSON.stringify([merged.at ?? null, merged.touch ?? null, merged.fingers ?? null, merged.palm ?? null]),
		};
	});
}

/** Whether a hand changes place across the sign. */
export function moves(track) {
	const active = track.filter(Boolean);
	if (active.length < 2) return false;
	return active.some((p) => p.place !== active[0].place);
}

/** The last handshape a hand is given (shapes carry forward between phases). */
export function shapeOf(track) {
	let shape = null;
	for (const phase of track) if (phase?.shape) shape = phase.shape;
	return shape;
}

/**
 * Battison's two conditions over one sign.
 * @returns {string[]} problems, empty when the sign is well-formed
 */
export function battisonIssues(word, sign) {
	const right = handTrack(sign, 'right');
	const left = handTrack(sign, 'left');
	if (!right.some(Boolean) || !left.some(Boolean)) return [];
	const issues = [];
	const rightMoves = moves(right);
	const leftMoves = moves(left);
	if (rightMoves && leftMoves && shapeOf(left) !== shapeOf(right)) {
		issues.push(`${word}: both hands move, so both must take one handshape (Symmetry Condition)`);
	}
	if (rightMoves !== leftMoves) {
		const active = shapeOf(rightMoves ? right : left);
		const passive = shapeOf(rightMoves ? left : right);
		if (passive && passive !== active && !UNMARKED.has(passive)) {
			issues.push(
				`${word}: the hands differ, so the passive "${passive}" must be an unmarked handshape (Dominance Condition)`,
			);
		}
	}
	return issues;
}

function directionIssues(word, label, spec) {
	if (spec == null) return [];
	if (Array.isArray(spec) && typeof spec[0] === 'number') return [];
	const names = Array.isArray(spec) ? spec : String(spec).split(/[\s-]+/);
	return names.filter((n) => !DIRECTIONS.has(n)).map((n) => `${word}: ${label} names unknown direction "${n}"`);
}

function handIssues(word, i, side, hand) {
	if (!hand || hand === 'rest') return [];
	const at = `${word} phase ${i} (${side})`;
	const issues = [];
	if (hand.shape && !HANDSHAPES[hand.shape]) issues.push(`${at}: unknown handshape "${hand.shape}"`);
	if (hand.at && typeof hand.at === 'object' && !Array.isArray(hand.at)) {
		const anchor = hand.at.anchor ?? 'sternum';
		if (!ANCHORS[anchor]) issues.push(`${at}: unknown anchor "${anchor}"`);
	}
	if (hand.touch) {
		const target = hand.touch.to ?? 'other';
		if (!HAND_TARGETS.has(target) && !ANCHORS[target]) issues.push(`${at}: touch names unknown place "${target}"`);
		if (hand.touch.part && !HAND_PARTS.has(hand.touch.part)) issues.push(`${at}: unknown hand part "${hand.touch.part}"`);
		if (hand.touch.on && !HAND_PARTS.has(hand.touch.on)) issues.push(`${at}: unknown hand part "${hand.touch.on}"`);
	}
	issues.push(...directionIssues(at, 'fingers', hand.fingers), ...directionIssues(at, 'palm', hand.palm));
	return issues;
}

/**
 * Structural checks for one sign: the shape the engine expects, vocabulary the
 * engine knows, every hand given a handshape, and no phase that repeats the one
 * before it (dead time, not a sign).
 * @returns {string[]}
 */
export function structureIssues(word, sign) {
	const issues = [];
	if (!/^[A-Z0-9]+$/.test(word)) issues.push(`${word}: sign keys are uppercase letters and digits`);
	if (!sign || typeof sign !== 'object') return [...issues, `${word}: entry is not an object`];
	if (typeof sign.gloss !== 'string' || !sign.gloss.trim()) issues.push(`${word}: missing gloss (a plain description reviewers read)`);
	if (!Array.isArray(sign.phases) || !sign.phases.length) return [...issues, `${word}: phases must be a non-empty array`];

	for (const [i, phase] of sign.phases.entries()) {
		if (phase.t != null && !(Number.isFinite(phase.t) && phase.t > 0)) issues.push(`${word} phase ${i}: t must be a positive number of seconds`);
		if (phase.hold != null && !(Number.isFinite(phase.hold) && phase.hold >= 0)) issues.push(`${word} phase ${i}: hold must be zero or more seconds`);
		if (phase.face && typeof phase.face === 'string' && !FACE_MARKERS[phase.face]) issues.push(`${word} phase ${i}: unknown face marker "${phase.face}"`);
		if (!phase.both && !phase.left && !phase.right) issues.push(`${word} phase ${i}: no hand is posed`);
		for (const side of ['both', 'left', 'right']) issues.push(...handIssues(word, i, side, phase[side]));
		for (const side of ['left', 'right']) {
			const hand = phase.both ? { ...phase.both, ...(phase[side] ?? {}) } : phase[side];
			if (!hand || hand === 'rest') continue;
			const first = sign.phases.findIndex((p) => p.both?.shape || p[side]?.shape);
			if (!(first >= 0 && first <= i)) issues.push(`${word} phase ${i} (${side}): a place with no handshape yet`);
		}
	}

	const right = handTrack(sign, 'right');
	const left = handTrack(sign, 'left');
	for (let i = 1; i < right.length; i++) {
		const same =
			right[i]?.place === right[i - 1]?.place &&
			left[i]?.place === left[i - 1]?.place &&
			right[i]?.shape === right[i - 1]?.shape;
		if (same) issues.push(`${word}: phase ${i} repeats phase ${i - 1}`);
	}
	return issues;
}

/**
 * Every problem in a pack: pack metadata, each sign's structure, Battison's
 * conditions, and aliases that point nowhere or shadow a sign.
 * @param {import('./index.js').SignPack} pack
 * @returns {string[]}
 */
export function lintPack(pack) {
	const issues = [];
	if (!/^[a-z]{3}$/.test(pack.id ?? '')) issues.push(`pack id "${pack.id}" must be an ISO 639-3 code (three lowercase letters)`);
	if (!pack.name) issues.push('pack needs a name');
	if (!pack.bcp47) issues.push('pack needs a bcp47 tag');
	if (!['native', 'review'].includes(pack.status)) issues.push(`pack status "${pack.status}" must be native or review`);
	if (pack.status === 'native' && pack.id !== 'ase') issues.push('only the ASL pack is native; every other pack is reviewed sign by sign');
	if (pack.status === 'review' && !(Number.isInteger(pack.requiredApprovals) && pack.requiredApprovals >= 2)) {
		issues.push('a pack under review needs requiredApprovals of at least 2');
	}
	if (pack.alphabet != null && pack.alphabet !== 'asl-manual') {
		issues.push(`alphabet "${pack.alphabet}" has no fingerspelling engine; use null until one exists`);
	}
	if (pack.alphabet === 'asl-manual' && pack.id !== 'ase') {
		issues.push('only ASL fingerspells with the ASL manual alphabet; set alphabet to null');
	}

	const signs = pack.signs ?? {};
	for (const [word, sign] of Object.entries(signs)) {
		issues.push(...structureIssues(word, sign));
		if (Array.isArray(sign?.phases)) issues.push(...battisonIssues(word, sign));
	}
	for (const [alias, target] of Object.entries(pack.aliases ?? {})) {
		if (!signs[target]) issues.push(`alias ${alias} points at missing sign "${target}"`);
		if (signs[alias] && alias !== target) issues.push(`alias ${alias} shadows the sign of the same name`);
	}
	if (!Array.isArray(pack.reviews)) issues.push('reviews must be an array (the committed ledger)');
	else {
		for (const [i, r] of pack.reviews.entries()) {
			if (!signs[r.sign]) issues.push(`review ${i} names missing sign "${r.sign}"`);
			if (!/^[0-9a-f]{64}$/.test(r.hash ?? '')) issues.push(`review ${i} has no content hash`);
			if (!r.reviewer) issues.push(`review ${i} has no reviewer`);
			if (!['approve', 'reject', 'needs_change'].includes(r.verdict)) issues.push(`review ${i} has unknown verdict "${r.verdict}"`);
		}
	}
	return issues;
}
