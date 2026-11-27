// iterate-plan.js: what an iteration request actually is, decided once and
// shared by the server (api/forge-iterate.js) and the Forge page
// (src/forge-conversational-refine.js) so the hint the page shows before a
// request and the work the server does can never disagree.
//
// Three kinds of iteration exist, and each label has to be true:
//   - look:      a surface change ("make it red", "less shiny", "brushed brass").
//                Restyles the current model's materials. No geometry job, so the
//                shape the user liked is kept exactly.
//   - shape:     a geometry change ("add wings", "bigger helmet"). Rebuilds the
//                model from the PARENT VERSION's prompt plus the change.
//   - variation: "more like this". Same subject prompt, new seed, a new take.
//
// Pure and dependency-light (one shared import), so it runs in the browser, on
// the server and under vitest unchanged.

import { shapeIntent } from './restyle-instruction.js';

export const ITERATE_INSTRUCTION_MAX = 500;
export const MAX_SEED = 2147483647;

const COLORS =
	'red|crimson|scarlet|maroon|burgundy|blue|navy|azure|cobalt|teal|cyan|turquoise|green|emerald|olive|lime|mint|' +
	'yellow|amber|mustard|orange|tangerine|purple|violet|lavender|magenta|pink|rose|black|white|ivory|cream|grey|gray|' +
	'charcoal|brown|tan|beige|bronze|copper|brass|gold|golden|silver|platinum|rainbow|pastel|monochrome|colou?rful';

const FINISHES =
	'shiny|shinier|glossy|glossier|gloss|matte|matt|satin|metallic|metal|chrome|chromed|polished|brushed|rusty|rusted|' +
	'weathered|worn|aged|patina|reflective|dull|duller|rough|rougher|smooth|smoother|glowing|glow|emissive|neon|' +
	'iridescent|holographic|pearlescent|translucent|transparent|frosted|glass|crystal|marble|ceramic|porcelain|' +
	'wooden|wood|oak|walnut|plastic|rubber|rubbery|stone|granite|jade|obsidian|clay|terracotta|velvet|leather|' +
	'painted|paint|lacquered|varnished|enamel|colou?r|colou?rs|texture|textured|finish|material|surface|tint|tinted|hue';

const LOOK_RE = new RegExp(`\\b(?:${COLORS}|${FINISHES})\\b`);

// A named part ("the helmet", "its wings") means the user wants that part
// changed. A material restyle recolours the whole model, so a part-scoped look
// is a rebuild, not a restyle.
const PART_RE =
	/\b(wings?|horns?|tails?|hats?|helmets?|capes?|cloaks?|arms?|legs?|heads?|ears?|eyes?|nose|mouth|hands?|feet|foot|fingers?|claws?|teeth|manes?|beards?|hair|wheels?|handles?|antennas?|crowns?|swords?|shields?|staffs?|weapons?|guns?|backpacks?|scarf|glasses|masks?|armou?r|torso|base|lid|roof|doors?|windows?|buttons?|straps?|belts?|boots?|gloves?|sleeves?|collars?|stripes?|spots?|eyes|trim|accents?|details?)\b/;

// Verbs that only ever change geometry, even next to a colour word
// ("add a red cape").
const GEOMETRY_VERB_RE =
	/\b(add|adding|remove|removing|delete|attach|replace|take off|get rid of|extend|shorten|lengthen|bend|rotate|tilt|pose|reshape|resize|bigger|smaller|taller|shorter|wider|thinner|longer)\b/;

/** Lowercased, whitespace-collapsed, trailing punctuation dropped. */
export function normalizeForCompare(text) {
	return String(text || '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[.!?,;\s]+$/u, '');
}

/**
 * Is this a surface-only change the material restyle can make without a new
 * geometry job?
 * @param {string} instruction
 * @returns {boolean}
 */
export function isLookOnly(instruction) {
	const text = normalizeForCompare(instruction);
	if (!text) return false;
	if (shapeIntent(text)) return false;
	if (GEOMETRY_VERB_RE.test(text)) return false;
	if (PART_RE.test(text)) return false;
	return LOOK_RE.test(text);
}

const STOP = new Set([
	'a', 'an', 'the', 'of', 'with', 'and', 'in', 'on', 'for', 'to', 'it', 'its', 'this', 'that', 'some', 'very',
	'small', 'big', 'large', 'little', 'tiny', 'cute', 'detailed', 'stylized', 'stylised', 'realistic', 'model', '3d',
]);

function contentWords(text) {
	return normalizeForCompare(text)
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOP.has(w))
		.map((w) => w.replace(/(?:es|s)$/u, ''));
}

const NEW_SUBJECT_RE =
	/^(?:please\s+)?(?:(?:turn|change|transform|convert|morph)\s+(?:it|this|the model|the whole thing)\s+into|(?:make|generate|create|build)\s+(?:me\s+)?(?:it\s+)?(?:a|an)\b(?!\s+(?:bit|little|lot)\b)|replace\s+(?:it|this)\s+with)\s+(?:a\s+|an\s+)?(.+)$/;

/**
 * Does the instruction ask for a different object entirely? Returns the new
 * subject (a ready-made prompt for a fresh generation) or null. An instruction
 * that names the current subject ("turn it into a robot dog" on "a robot") or
 * is only a look ("turn it into gold") stays an iteration.
 * @param {string} instruction
 * @param {string} parentPrompt
 * @returns {string|null}
 */
export function newSubjectOf(instruction, parentPrompt) {
	const text = normalizeForCompare(instruction);
	const m = NEW_SUBJECT_RE.exec(text);
	if (!m) return null;
	const subject = m[1].trim();
	if (!subject || isLookOnly(subject)) return null;
	const parentWords = new Set(contentWords(parentPrompt));
	if (!parentWords.size) return null;
	if (contentWords(subject).some((w) => parentWords.has(w))) return null;
	return /^(a|an|the)\s/.test(subject) ? subject : `${/^[aeiou]/.test(subject) ? 'an' : 'a'} ${subject}`;
}

/**
 * The checks every instruction goes through before any work is spent on it.
 * @param {{ instruction: string, mode?: string, parentInstruction?: string|null,
 *           parentPrompt?: string, allowNewSubject?: boolean }} args
 * @returns {{ ok: true, text: string, kind: 'look'|'shape'|'variation' }
 *         | { ok: false, status: number, code: string, message: string, suggestedPrompt?: string }}
 */
export function planIteration({ instruction, mode = 'auto', parentInstruction = null, parentPrompt = '', allowNewSubject = false }) {
	if (mode === 'variation') {
		if (!String(parentPrompt || '').trim()) {
			return {
				ok: false,
				status: 422,
				code: 'no_subject',
				message:
					'More like this needs the prompt that made this model, and this one has none (it came from a photo or an upload). Describe it in the prompt box to generate takes on it.',
			};
		}
		return { ok: true, text: '', kind: 'variation' };
	}
	const text = String(instruction || '').replace(/\s+/g, ' ').trim();
	if (!text) {
		return { ok: false, status: 400, code: 'missing_instruction', message: 'Describe the change to make, e.g. "make it metallic" or "add wings".' };
	}
	if (text.length > ITERATE_INSTRUCTION_MAX) {
		return {
			ok: false,
			status: 400,
			code: 'instruction_too_long',
			message: `Keep the instruction to ${ITERATE_INSTRUCTION_MAX} characters or fewer.`,
		};
	}
	if (parentInstruction && normalizeForCompare(parentInstruction) === normalizeForCompare(text)) {
		return {
			ok: false,
			status: 409,
			code: 'same_instruction',
			message:
				'That is the change that made this version. Use Try again on it for another take, or describe a new change.',
		};
	}
	if (!allowNewSubject) {
		const subject = newSubjectOf(text, parentPrompt);
		if (subject) {
			return {
				ok: false,
				status: 422,
				code: 'different_object',
				message: `That describes a different object. Generate "${subject}" as a new model so this one and its history stay as they are, or iterate anyway.`,
				suggestedPrompt: subject,
			};
		}
	}
	const kind = mode === 'look' ? 'look' : mode === 'shape' ? 'shape' : isLookOnly(text) ? 'look' : 'shape';
	return { ok: true, text, kind };
}

/** A fresh seed in the range every lane accepts (1 to 2147483647). */
export function mintSeed(rng = Math.random) {
	return 1 + Math.floor(rng() * (MAX_SEED - 1));
}

/** A caller-supplied seed, or null when it is not a usable integer. */
export function parseSeed(value) {
	return Number.isInteger(value) && value > 0 && value <= MAX_SEED ? value : null;
}
