// Lexical ASL signs: the vocabulary an avatar signs instead of spelling.
//
// Fingerspelling is a fallback, not a language: a signer spells names and
// loanwords and SIGNS everything else. This module turns signs into clips; the
// signs themselves (src/sign-packs/asl.js) are written the way ASL is actually described: a handshape, a place on or in
// front of the body, the direction the palm and fingers face, and a movement
// through those places. Both hands are first-class: two-handed signs are the
// normal case in ASL, and writing one is a single `both:` block because places
// and directions are body-relative (src/sign-clip.js), so the non-dominant hand
// mirrors for free.
//
// Every sign compiles through the same solver the alphabet uses: the wrist goes
// to a POINT in signing space and src/sign-rig.js's two-bone IK finds the
// shoulder, elbow, and wrist that put it there. Nothing is hand-tuned in joint
// angles, so a sign holds up on any rigged avatar the retargeter can drive.
//
// Coverage is deliberately a core vocabulary, not a claim to fluency. Words with
// no entry fingerspell (src/sign-speech.js decides), and the pack is meant to
// grow: add an entry, add a test asserting where the hands end up, done.
//
// Grammar note: these are citation-form signs strung together in English word
// order. That is "signed English", not ASL grammar (which reorders, inflects
// verbs spatially, and carries meaning in the face). The page says so plainly;
// we are not pretending otherwise.


// The vocabulary itself lives in src/sign-packs/asl.js, one pack in the format
// every sign language uses (src/sign-packs/index.js). Each function below takes
// an optional pack (a pack object or its id) and defaults to ASL, so every
// existing caller and the goldens behave exactly as before.

import { SignTimeline, mirrorPhase, neutralPose, posePhase, restingPose } from './sign-clip.js';
import ASL from './sign-packs/asl.js';
import { DEFAULT_PACK_ID, resolvePack } from './sign-packs/index.js';

/**
 * The ASL vocabulary. Each sign is a list of phases; `t` is the seconds spent
 * moving INTO that phase and `hold` the seconds spent in it. `both` poses both
 * hands from one description, `right`/`left` override or act alone.
 *
 * @type {Record<string, { gloss: string, phases: object[] }>}
 */
export const SIGNS = ASL.signs;

/**
 * Every word a pack can sign, including aliases, sorted. For a pack under
 * review only its approved signs count.
 * @param {import('./sign-packs/index.js').SignPack|string} [pack]
 * @returns {readonly string[]}
 */
export function signableWords(pack) {
	const p = resolvePack(pack);
	const aliases = Object.keys(p.aliases ?? {});
	return Object.freeze([...new Set([...Object.keys(p.signs), ...aliases])].sort());
}

/** Every word the default (ASL) pack can sign, including aliases. */
export const SIGNABLE_WORDS = Object.freeze([...Object.keys(ASL.signs), ...Object.keys(ASL.aliases)].sort());

/**
 * Resolve a normalized word to its sign entry, or null when it must be spelled
 * (or, in a pack without an alphabet, is unsupported).
 * @param {string} word  already uppercased/normalized
 * @param {import('./sign-packs/index.js').SignPack|string} [pack]
 * @returns {{ name: string, sign: object }|null}
 */
export function lookupSign(word, pack) {
	const p = resolvePack(pack);
	const key = String(word ?? '').toUpperCase();
	const name = p.signs[key] ? key : p.aliases?.[key];
	return name && p.signs[name] ? { name, sign: p.signs[name] } : null;
}

export const DEFAULT_SIGN_TIMING = Object.freeze({
	leadSeconds: 0.3,
	tailSeconds: 0.38,
	/** Scales every authored phase duration: the tempo control for chat. */
	rate: 1,
});

/**
 * Build the AnimationClip document for one lexical sign.
 *
 * @param {string} word
 * @param {{ name?: string, base?: import('./sign-rig.js').Pose, settle?: boolean, rate?: number,
 *           pack?: import('./sign-packs/index.js').SignPack|string }} [opts]
 *   `pack` picks the vocabulary (default ASL); a pack under review only
 *   resolves approved signs.
 * @returns {object|null} clip document, or null when the word has no sign
 */
export function buildSignClip(word, opts = {}) {
	const pack = resolvePack(opts.pack);
	const found = lookupSign(word, pack);
	if (!found) return null;
	return buildClipForSign(found.name, found.sign, { ...opts, packId: pack.id });
}

/**
 * Build the clip for a sign entry directly, whether or not it is approved. The
 * reviewer page uses this to perform a sign that is still waiting for review;
 * serving paths go through buildSignClip, which only resolves approved signs.
 *
 * @param {string} name  the sign key (HELLO)
 * @param {{ gloss?: string, phases: object[] }} sign
 * @param {{ name?: string, base?: import('./sign-rig.js').Pose, settle?: boolean, lead?: boolean,
 *           rate?: number, dominant?: 'Left'|'Right', packId?: string }} [opts]
 * @returns {object}
 */
export function buildClipForSign(name, sign, opts = {}) {
	const timing = { ...DEFAULT_SIGN_TIMING, ...opts };
	const rate = timing.rate > 0 ? timing.rate : 1;
	const base = opts.base ?? restingPose();
	const lead = opts.lead !== false;
	// Mid-utterance the hands are already up, so the sign opens from the neutral
	// signing stance rather than from the arms hanging at the sides.
	const tl = new SignTimeline({ base, open: lead ? base : neutralPose(base) });

	const dominant = opts.dominant === 'Left' ? 'Left' : 'Right';
	sign.phases.forEach((phase, i) => {
		const seconds = ((phase.t ?? 0.3) + (i === 0 && lead ? timing.leadSeconds : 0)) / rate;
		const shaped = dominant === 'Left' ? mirrorPhase(phase) : phase;
		tl.to(posePhase(shaped, base), seconds, { ease: phase.ease ?? (i === 0 ? 'out' : 'smooth') });
		if (phase.hold) tl.hold(phase.hold / rate);
	});

	if (opts.settle !== false) tl.settle(timing.tailSeconds / rate);

	// ASL keeps the seed it always had; another pack prefixes its id so the same
	// key in two languages never shares a seed.
	const packId = opts.packId ?? DEFAULT_PACK_ID;
	const seedName = packId === DEFAULT_PACK_ID ? name : `${packId}:${name}`;
	return tl.build({
		name: opts.name ?? `sign-${name.toLowerCase()}`,
		seed: `sign:${seedName}:${rate}:${lead}:${opts.settle !== false}:${dominant}`,
	});
}

/**
 * A lookup function shaped for {@link import('./sign-speech.js').compileUtterance}:
 * pass it as `signs` and every word with an entry is SIGNED, the rest spelled.
 *
 * @param {{ base?: import('./sign-rig.js').Pose, rate?: number, dominant?: 'Left'|'Right',
 *           pack?: import('./sign-packs/index.js').SignPack|string }} [opts]
 * @returns {(word: string) => object|null}
 */
export function signLookup(opts = {}) {
	const cache = new Map();
	return (word, position = {}) => {
		const lead = position.first !== false;
		const settle = position.last !== false;
		const key = `${word}|${lead}|${settle}|${opts.dominant ?? 'Right'}`;
		if (!cache.has(key)) cache.set(key, buildSignClip(word, { ...opts, lead, settle }));
		return cache.get(key);
	};
}

/** Human-readable description of a sign, for the vocabulary UI. */
export function signGloss(word, pack) {
	return lookupSign(word, pack)?.sign.gloss ?? null;
}
