// Garment generation: the request checks that run BEFORE a garment job starts,
// and the honest translation of a finished job's failure for the person who
// asked for it. Pure functions, no network: api/garment-forge.js wires them.
//
// Why a slot check exists at all
// ──────────────────────────────
// The worker (workers/garment-forge) scales whatever it is handed into the
// slot's region box on the reference body (garment_glb.SLOT_BOXES). It never
// asks whether the description belongs in that box. "a car" for headwear is
// painted, meshed, shrunk to a 30 cm skull box and rigged, about seven GPU
// minutes later, into something no one wanted; "a pair of jeans" for glasses is
// squeezed into an 18 cm face box. Both are cheap to recognise from the words
// alone, so they are answered here with a pointer to what to type instead.
//
// The check is deliberately one-sided: it refuses only when the words name a
// thing that is clearly not worn, or a garment that clearly belongs to another
// slot. A description it cannot place ("something cozy in forest green") passes,
// because the worker's own prompt frames it as a product photo for that slot.

import { GARMENT_SLOTS } from '../../src/garment-taxonomy.js';

export { GARMENT_SLOTS };

export const PROMPT_MIN = 3;
export const PROMPT_MAX = 500;

/** Human names for each slot, used in every message below. */
export const SLOT_NAMES = Object.freeze({
	top: 'a top',
	bottom: 'a bottom',
	footwear: 'footwear',
	outerwear: 'outerwear',
	hair: 'hair',
	headwear: 'headwear',
	glasses: 'glasses',
	accessory: 'an accessory',
});

/** A worked example per slot, so a refusal always says what would work. */
export const SLOT_EXAMPLES = Object.freeze({
	top: 'a white oxford cotton dress shirt',
	bottom: 'dark indigo slim denim jeans',
	footwear: 'white low-top canvas sneakers',
	outerwear: 'a black leather biker jacket',
	hair: 'short wavy brown hair',
	headwear: 'a grey wool beanie',
	glasses: 'round gold-rimmed eyeglasses',
	accessory: 'a brown leather crossbody bag',
});

// Phrases are matched before single words and their words are then removed, so
// "top hat" is headwear and never also a top, and "tank top" is never a tank.
const PHRASES = [
	['top hat', 'headwear'], ['bucket hat', 'headwear'], ['cowboy hat', 'headwear'],
	['baseball cap', 'headwear'], ['cat ears', 'headwear'], ['bunny ears', 'headwear'],
	['tank top', 'top'], ['crop top', 'top'], ['polo shirt', 'top'],
	['bow tie', 'accessory'], ['neck tie', 'accessory'],
	['buzz cut', 'hair'], ['pixie cut', 'hair'], ['crew cut', 'hair'],
	['flip flops', 'footwear'], ['flip flop', 'footwear'],
	['suit jacket', 'outerwear'], ['rain jacket', 'outerwear'],
];

// Words that name something worn, by the slot it is worn in. A word is matched
// as typed or with one plural `s` removed, so list the singular unless the
// garment only exists as a plural ("jeans", "glasses", "shorts").
const SLOT_WORDS = {
	top: [
		'shirt', 'tee', 'blouse', 'sweater', 'jumper', 'hoodie', 'sweatshirt', 'polo',
		'camisole', 'cami', 'cardigan', 'tunic', 'jersey', 'top', 'turtleneck', 'henley',
		'kurta', 'tshirt', 'bodice', 'corset', 'halter',
	],
	outerwear: [
		'jacket', 'coat', 'parka', 'blazer', 'trench', 'peacoat', 'raincoat', 'slicker',
		'windbreaker', 'poncho', 'cape', 'cloak', 'gilet', 'bomber', 'anorak', 'overcoat',
		'vest', 'waistcoat', 'kimono', 'robe', 'shawl', 'puffer', 'fleece', 'duster',
	],
	bottom: [
		'pants', 'trousers', 'jeans', 'shorts', 'skirt', 'leggings', 'joggers',
		'sweatpants', 'chinos', 'slacks', 'culottes', 'cargos', 'kilt', 'sarong',
		'tights', 'bloomers', 'capris', 'trouser',
	],
	footwear: [
		'shoe', 'sneaker', 'boot', 'sandal', 'loafer', 'heel', 'slipper', 'trainer',
		'clog', 'moccasin', 'espadrille', 'mule', 'brogue', 'cleat', 'sock', 'stiletto',
		'footwear', 'wedges',
	],
	hair: [
		'hair', 'hairstyle', 'haircut', 'hairdo', 'bob', 'ponytail', 'braid', 'bun',
		'curls', 'afro', 'dreadlocks', 'locs', 'mohawk', 'pixie', 'mullet', 'bangs',
		'fringe', 'wig', 'updo', 'cornrows', 'pigtails', 'quiff', 'pompadour',
	],
	headwear: [
		'hat', 'cap', 'beanie', 'fedora', 'beret', 'helmet', 'crown', 'tiara', 'headband',
		'bandana', 'turban', 'hijab', 'visor', 'sombrero', 'bowler', 'balaclava',
		'earmuffs', 'durag', 'headscarf', 'circlet', 'headdress', 'hood', 'trilby',
		'stetson', 'beanies', 'headwear', 'headpiece', 'diadem', 'ears',
	],
	glasses: [
		'glasses', 'sunglasses', 'eyeglasses', 'spectacles', 'goggles', 'shades',
		'aviators', 'monocle', 'eyewear', 'specs', 'lenses',
	],
	accessory: [
		'necklace', 'scarf', 'bag', 'backpack', 'belt', 'watch', 'wristwatch', 'bracelet',
		'earring', 'ring', 'tie', 'pendant', 'choker', 'purse', 'handbag', 'tote',
		'satchel', 'messenger', 'glove', 'mitten', 'sash', 'brooch', 'chain', 'amulet',
		'holster', 'quiver', 'suspenders', 'bangle', 'cufflinks', 'lanyard', 'stole',
		'locket', 'medallion', 'anklet', 'bowtie', 'necktie', 'wings', 'collar', 'jewelry',
		'jewellery', 'accessory',
	],
};

// Worn, but not tied to one slot: a dress, an outfit, armour, a mask. These pass for
// any slot, and a prompt that also names a slot word follows that word.
const GENERIC_WORDS = [
	'garment', 'outfit', 'clothing', 'clothes', 'costume', 'uniform', 'dress', 'gown',
	'jumpsuit', 'overalls', 'romper', 'onesie', 'armor', 'armour', 'apron', 'wear',
	'worn', 'wearable', 'attire', 'apparel', 'suit', 'tracksuit', 'pajamas', 'pyjamas',
	'mask',
];

// Things that are plainly not worn. Kept to unambiguous nouns: anything that
// could plausibly be a costume piece or an accessory (a sword, a shield, a
// flower) is left out, because refusing a real request is worse than letting
// an odd one through to the worker.
const NOT_WORN_WORDS = [
	'car', 'truck', 'vehicle', 'bus', 'van', 'motorcycle', 'motorbike', 'bicycle',
	'train', 'airplane', 'aeroplane', 'plane', 'aircraft', 'jet', 'helicopter', 'boat',
	'ship', 'yacht', 'submarine', 'rocket', 'spaceship', 'spacecraft', 'tractor',
	'house', 'building', 'castle', 'skyscraper', 'bridge', 'church', 'temple',
	'tree', 'mountain', 'island', 'planet', 'city', 'landscape', 'room', 'kitchen',
	'table', 'chair', 'sofa', 'couch', 'bed', 'desk', 'lamp', 'cabinet', 'bookshelf',
	'fridge', 'refrigerator', 'oven', 'microwave', 'toilet', 'bathtub',
	'dog', 'puppy', 'cat', 'kitten', 'horse', 'cow', 'pig', 'sheep', 'dragon',
	'dinosaur', 'bird', 'fish', 'shark', 'whale', 'elephant', 'lion', 'tiger',
	'robot', 'computer', 'laptop', 'phone', 'smartphone', 'television', 'tv',
	'pizza', 'burger', 'hamburger', 'sandwich', 'cake', 'apple', 'banana', 'food',
	'statue', 'guitar', 'piano', 'drum', 'teapot', 'vase', 'mug', 'bottle',
];

const WORD_SLOT = new Map();
for (const [slot, words] of Object.entries(SLOT_WORDS)) {
	for (const w of words) WORD_SLOT.set(w, slot);
}
const GENERIC = new Set(GENERIC_WORDS);
const NOT_WORN = new Set(NOT_WORN_WORDS);

// Torso garments are routinely filed either way ("a hoodie" as outerwear, "a
// light jacket" as a top): both slots share one torso box shape, so neither is
// a mismatch for the other.
const COMPATIBLE = Object.freeze({ top: ['outerwear'], outerwear: ['top'] });

function lookup(word, table) {
	if (table.has(word)) return word;
	if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
		const singular = word.slice(0, -1);
		if (table.has(singular)) return singular;
	}
	return null;
}

/**
 * Read a garment description: which slots its words name, whether it names
 * something generically worn, and the first thing it names that is not worn.
 * @param {string} prompt
 * @returns {{ slots: Set<string>, generic: boolean, notWorn: string | null }}
 */
export function readGarmentWords(prompt) {
	let text = ` ${String(prompt || '').toLowerCase().replace(/t-shirt/g, 'tshirt').replace(/[^a-z]+/g, ' ')} `;
	const slots = new Set();
	for (const [phrase, slot] of PHRASES) {
		const needle = ` ${phrase} `;
		if (text.includes(needle)) {
			slots.add(slot);
			text = text.split(needle).join(' ');
		}
	}
	let generic = false;
	let notWorn = null;
	for (const word of text.split(' ').filter(Boolean)) {
		const slotWord = lookup(word, WORD_SLOT);
		if (slotWord) slots.add(WORD_SLOT.get(slotWord));
		else if (lookup(word, GENERIC)) generic = true;
		else if (!notWorn && lookup(word, NOT_WORN)) notWorn = lookup(word, NOT_WORN);
	}
	return { slots, generic, notWorn };
}

/**
 * Validate a garment request before any generation starts.
 * @param {unknown} body  the parsed JSON body, or null when it did not parse
 * @returns {{ ok: true, prompt: string, slot: string }
 *         | { ok: false, status: number, error: string, message: string, suggested_slot?: string }}
 */
export function checkGarmentRequest(body) {
	const prompt = typeof body?.prompt === 'string' ? body.prompt.trim().replace(/\s+/g, ' ') : '';
	const slot = typeof body?.slot === 'string' ? body.slot.trim().toLowerCase() : '';

	if (!GARMENT_SLOTS.includes(slot)) {
		return {
			ok: false,
			status: 400,
			error: 'invalid_slot',
			message: slot
				? `"${slot.slice(0, 40)}" is not a wardrobe slot. Pick one of: ${GARMENT_SLOTS.join(', ')}.`
				: `Pick a slot for the garment: ${GARMENT_SLOTS.join(', ')}.`,
		};
	}
	if (prompt.length < PROMPT_MIN || prompt.length > PROMPT_MAX) {
		return {
			ok: false,
			status: 400,
			error: 'invalid_prompt',
			message: prompt.length > PROMPT_MAX
				? `Keep the description under ${PROMPT_MAX} characters (yours is ${prompt.length}).`
				: `Describe the garment in a few words, for example "${SLOT_EXAMPLES[slot]}".`,
		};
	}

	const { slots, generic, notWorn } = readGarmentWords(prompt);
	const fits = slots.has(slot) || (COMPATIBLE[slot] || []).some((s) => slots.has(s));
	if (fits || generic) return { ok: true, prompt, slot };

	if (slots.size) {
		const suggested = GARMENT_SLOTS.find((s) => slots.has(s));
		return {
			ok: false,
			status: 422,
			error: 'slot_mismatch',
			suggested_slot: suggested,
			message:
				`That reads as ${SLOT_NAMES[suggested]}, not ${SLOT_NAMES[slot]}. ` +
				`Switch the slot to ${suggested}, or describe ${SLOT_NAMES[slot]} such as "${SLOT_EXAMPLES[slot]}".`,
		};
	}
	if (notWorn) {
		return {
			ok: false,
			status: 422,
			error: 'not_wearable',
			message:
				`A ${notWorn} is not something an avatar can wear in the ${slot} slot. ` +
				`Describe ${SLOT_NAMES[slot]}, for example "${SLOT_EXAMPLES[slot]}". ` +
				'To make the object itself, use Forge at /forge.',
		};
	}
	return { ok: true, prompt, slot };
}

/**
 * The worker records every failure as an opaque "internal error (ref …)" and
 * keeps the stage it died in. Turn that into what the person needs: which step
 * failed, whether their wording is the cause, and that nothing was published.
 * The worker's correlation ref is kept so a report can be joined to its log.
 * @param {{ stage?: string | null, error?: string | null }} job
 * @returns {{ code: string, message: string, ref: string | null }}
 */
export function describeGarmentFailure(job) {
	const raw = typeof job?.error === 'string' ? job.error : '';
	const ref = raw.match(/\bref ([0-9a-f]{6,32})\b/i)?.[1] || null;
	const refNote = ref ? ` (reference ${ref})` : '';
	const nothing = 'Nothing was published to the wardrobe.';

	// The one failure the worker words for the user on purpose: the image
	// model's safety classifier refused the description itself.
	if (/refused|safety classifier|blockReason|rephrase/i.test(raw)) {
		return {
			code: 'prompt_refused',
			message: `The image model refused this description. ${nothing} Rephrase the garment (plain colour, material and cut work best) and try again.`,
			ref,
		};
	}

	switch (job?.stage) {
		case 'queued':
		case 'image':
			return {
				code: 'image_unavailable',
				message:
					`The reference image step failed: the image provider behind the garment forge is not answering right now, so your description was never drawn. ${nothing} ` +
					`This is on our side, not your wording. Try again later${refNote}.`,
				ref,
			};
		case 'mesh':
			return {
				code: 'mesh_unavailable',
				message: `Every 3D model engine failed to turn the reference image into a mesh. ${nothing} Try again in a few minutes${refNote}.`,
				ref,
			};
		case 'compose':
		case 'extract':
		case 'validate':
			return {
				code: 'fit_check_failed',
				message:
					`The garment failed its fit check: the generated shape did not sit on the body at a believable size or would not move with the skeleton, so it was not published. ${nothing} ` +
					`Generating again often lands a better shape; a simpler cut helps${refNote}.`,
				ref,
			};
		case 'rig':
			return {
				code: 'rig_failed',
				message: `Fitting a skeleton to the garment failed. ${nothing} Try again in a few minutes${refNote}.`,
				ref,
			};
		case 'publish':
			return {
				code: 'publish_failed',
				message: `The garment was made but saving it to the wardrobe failed. ${nothing} Try again${refNote}.`,
				ref,
			};
		default:
			return {
				code: 'generation_failed',
				message: `Garment generation failed. ${nothing} Try again in a few minutes${refNote}.`,
				ref,
			};
	}
}
