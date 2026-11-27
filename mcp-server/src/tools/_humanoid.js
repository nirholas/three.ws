// Humanoid prompt classifier — the money-safety gate for auto-rigging.
//
// `forge_avatar` bundles a paid generation with a paid rig pass. Rigging (and
// the three.ws canonical animation library) assumes a HUMANOID skeleton: a
// biped with a head, spine, two arms and two legs. Running the humanoid rigger
// on furniture, a vehicle, or a quadruped wastes the paid rig op and produces a
// useless skeleton. This classifier inspects a generation prompt and decides
// whether auto-rigging will actually deliver an animation-ready avatar.
//
// It is intentionally dependency-free and synchronous: a keyword/heuristic
// classifier, not an LLM call. The gate only HARD-BLOCKS on a confident
// non-humanoid verdict (clear objects + quadrupeds), so a borderline character
// prompt is never wrongly refused — the caller opted into an avatar tool, and
// ambiguity resolves in favour of proceeding.
//
// Mirrors the intent of AnimationManager.supportsCanonicalClips() (which gates
// the same humanoid assumption at playback time) at the generation boundary.

// Tokens that strongly imply a humanoid/biped character. Matched as whole words
// so "manifold" doesn't trip on "man" and "carapace" doesn't trip on "car".
const HUMANOID_TERMS = [
	// People
	'human',
	'person',
	'man',
	'woman',
	'men',
	'women',
	'boy',
	'girl',
	'guy',
	'lady',
	'male',
	'female',
	'child',
	'kid',
	'baby',
	'adult',
	'teenager',
	'teen',
	'figure',
	'body',
	'fullbody',
	'full-body',
	'humanoid',
	'biped',
	'bipedal',
	'portrait',
	'bust',
	// Avatar / character vocabulary
	'avatar',
	'character',
	'protagonist',
	'hero',
	'heroine',
	'villain',
	'npc',
	'mascot',
	'figurine',
	'action figure',
	// Archetypes / classes (all bipedal humanoids)
	'knight',
	'warrior',
	'soldier',
	'fighter',
	'samurai',
	'ninja',
	'assassin',
	'rogue',
	'wizard',
	'mage',
	'sorcerer',
	'witch',
	'warlock',
	'priest',
	'paladin',
	'archer',
	'ranger',
	'barbarian',
	'viking',
	'gladiator',
	'pirate',
	'cowboy',
	'astronaut',
	'cosmonaut',
	'spaceman',
	'pilot',
	'nurse',
	'doctor',
	'chef',
	'farmer',
	'miner',
	'sailor',
	'guard',
	'king',
	'queen',
	'prince',
	'princess',
	'emperor',
	'empress',
	'knightess',
	'monk',
	'ronin',
	'mercenary',
	'bandit',
	'detective',
	'spy',
	'agent',
	'scientist',
	'engineer',
	'explorer',
	'adventurer',
	'dancer',
	'athlete',
	'boxer',
	'wrestler',
	'superhero',
	'superheroine',
	// Fantasy / sci-fi humanoid species (biped-shaped)
	'elf',
	'dwarf',
	'orc',
	'goblin',
	'troll',
	'ogre',
	'gnome',
	'halfling',
	'fairy',
	'angel',
	'demon',
	'devil',
	'vampire',
	'werewolf',
	'zombie',
	'skeleton',
	'ghost',
	'ghoul',
	'mummy',
	'cyborg',
	'android',
	'humanoid robot',
	'mech pilot',
	'alien',
	'titan',
	'giant',
	'golem',
	'wraith',
	'lich',
	// Style words that, in practice, describe humanoid characters
	'anime girl',
	'anime boy',
	'anime character',
	'chibi',
	'waifu',
	'vtuber',
	'vroid',
	'cartoon character',
];

// Tokens that name a thing with no body to move: furniture, vehicles, props,
// places and food. Split from the animals below so the rig preflight
// (classifyRigSubject) can refuse an object outright while still sending a
// creature to the non-human rigger. NON_HUMANOID_TERMS is the two lists
// joined, so classifyHumanoidPrompt reads exactly what it always read.
const OBJECT_TERMS = [
	// Furniture / household objects
	'chair',
	'armchair',
	'sofa',
	'couch',
	'stool',
	'bench',
	'table',
	'desk',
	'shelf',
	'cabinet',
	'wardrobe',
	'dresser',
	'bed',
	'lamp',
	'chandelier',
	'mirror',
	'vase',
	'teapot',
	'kettle',
	'mug',
	'cup',
	'bottle',
	'jar',
	'bowl',
	'plate',
	'cutlery',
	'pan',
	'pot',
	'clock',
	'rug',
	'curtain',
	// Vehicles / machines
	'car',
	'truck',
	'van',
	'bus',
	'motorcycle',
	'bicycle',
	'bike',
	'scooter',
	'tank',
	'plane',
	'airplane',
	'aircraft',
	'jet',
	// Disambiguate "fighter jet" / "jet fighter": "fighter" is a humanoid class
	// word (boxer/warrior), but paired with jet the subject is the aircraft. The
	// multi-word hits outweigh the lone "fighter" so the gate never rigs a jet.
	'fighter jet',
	'jet fighter',
	'helicopter',
	'drone',
	'boat',
	'ship',
	'submarine',
	'rocket',
	'spaceship',
	'spacecraft',
	'train',
	'tractor',
	'engine',
	'turbine',
	'manifold',
	'gearbox',
	'machine',
	'machinery',
	'appliance',
	// Tools / weapons / gear (props, not characters)
	'sword',
	'blade',
	'dagger',
	'knife',
	'axe',
	'hammer',
	'mace',
	'spear',
	'lance',
	'shield',
	'bow',
	'crossbow',
	'gun',
	'rifle',
	'pistol',
	'cannon',
	'wrench',
	'screwdriver',
	'helmet',
	'gauntlet',
	'boot',
	'glove',
	'backpack',
	'amulet',
	'ring',
	'crown',
	'staff',
	'wand',
	'torch',
	'lantern',
	'chest',
	'barrel',
	'crate',
	// Buildings / environment / nature
	'building',
	'house',
	'cabin',
	'hut',
	'cottage',
	'castle',
	'tower',
	'bridge',
	'tree',
	'plant',
	'flower',
	'bush',
	'rock',
	'stone',
	'boulder',
	'mountain',
	'island',
	'terrain',
	'landscape',
	'planet',
	'asteroid',
	'crystal',
	'gem',
	'gemstone',
	'coin',
	// Food
	'apple',
	'banana',
	'orange',
	'fruit',
	'burger',
	'pizza',
	'cake',
	'donut',
	'bread',
	'sandwich',
	'sushi',
	'cookie',
	'food',
	// Added for the rig preflight: common Forge props that name no body.
	'katana',
	'saber',
	'sabre',
	'scimitar',
	'sheath',
	'guitar',
	'violin',
	'piano',
	'skateboard',
	'surfboard',
	'lamppost',
	'streetlight',
	'go-kart',
	'moped',
	'snowmobile',
];

// Animals and other non-biped bodies. They can move, just not on a humanoid
// skeleton, so the rig preflight routes them to the non-human rigger.
const CREATURE_TERMS = [
	'horse',
	'pony',
	'donkey',
	'cow',
	'bull',
	'pig',
	'sheep',
	'goat',
	'deer',
	'dog',
	'puppy',
	'cat',
	'kitten',
	'lion',
	'tiger',
	'leopard',
	'cheetah',
	'wolf',
	'fox',
	'bear',
	'elephant',
	'rhino',
	'hippo',
	'giraffe',
	'zebra',
	'camel',
	'kangaroo',
	'rabbit',
	'mouse',
	'rat',
	'squirrel',
	'lizard',
	'crocodile',
	'alligator',
	'turtle',
	'snake',
	'frog',
	'fish',
	'shark',
	'whale',
	'dolphin',
	'octopus',
	'crab',
	'lobster',
	'shrimp',
	'spider',
	'scorpion',
	'ant',
	'bee',
	'butterfly',
	'beetle',
	'bird',
	'eagle',
	'owl',
	'duck',
	'chicken',
	'penguin',
	'dragon',
	'dinosaur',
	'serpent',
	'hydra',
	'griffin',
	'phoenix',
	// Added for the rig preflight.
	'hound',
	'quadruped',
	'beast',
	'unicorn',
	'pegasus',
	'wyvern',
	'raptor',
	'insect',
	'horseback',
];

// Tokens that strongly imply a NON-humanoid subject. A confident hit here is
// what blocks the paid rig.
const NON_HUMANOID_TERMS = [...OBJECT_TERMS, ...CREATURE_TERMS];

// Word-boundary match for a single term against the already-lowercased prompt.
// Multi-word terms (e.g. "anime girl") match as a substring on boundaries.
function hasTerm(text, term) {
	if (term.includes(' ') || term.includes('-')) {
		return text.includes(term);
	}
	const re = new RegExp(`\\b${term}\\b`);
	return re.test(text);
}

// "two chairs", "boots", "a pack of wolves": the plural of a single-word term.
// Only the rig preflight reads plurals; classifyHumanoidPrompt keeps its exact
// matching so its verdicts do not move.
function hasPlural(text, term) {
	if (term.includes(' ') || term.includes('-')) return false;
	const forms = [`${term}s`, `${term}es`];
	if (term.endsWith('f')) forms.push(`${term.slice(0, -1)}ves`);
	if (term.endsWith('y')) forms.push(`${term.slice(0, -1)}ies`);
	return forms.some((f) => new RegExp(`\\b${f}\\b`).test(text));
}

function countMatches(text, terms, { plural = false } = {}) {
	let n = 0;
	const hits = [];
	for (const term of terms) {
		if (hasTerm(text, term) || (plural && hasPlural(text, term))) {
			n += 1;
			hits.push(term);
		}
	}
	return { n, hits };
}

/**
 * Classify whether a generation prompt describes a riggable humanoid character.
 *
 * @param {string} prompt
 * @returns {{ humanoid: boolean, confidence: 'high'|'medium'|'low', reason: string, signals: { humanoid: string[], nonHumanoid: string[] } }}
 *   `humanoid:false` is the only verdict `forge_avatar` blocks on. A `low`
 *   confidence `humanoid:true` is the ambiguous default — proceed, because the
 *   caller opted into an avatar tool.
 */
export function classifyHumanoidPrompt(prompt) {
	const text = String(prompt || '')
		.toLowerCase()
		.trim();

	if (text.length < 3) {
		return {
			humanoid: false,
			confidence: 'low',
			reason: 'prompt is empty or too short to describe a character',
			signals: { humanoid: [], nonHumanoid: [] },
		};
	}

	// Pure punctuation/digits ("!!!", "12345") name no subject at all, so the
	// "proceed on ambiguity" default below must not apply — there is nothing to rig.
	if (!/[a-z]/.test(text)) {
		return {
			humanoid: false,
			confidence: 'low',
			reason: 'prompt has no descriptive words to identify a character',
			signals: { humanoid: [], nonHumanoid: [] },
		};
	}

	const pos = countMatches(text, HUMANOID_TERMS);
	const neg = countMatches(text, NON_HUMANOID_TERMS);
	const signals = { humanoid: pos.hits, nonHumanoid: neg.hits };

	// Both kinds of signal present — e.g. "a knight holding a sword". The subject
	// (humanoid) wins over the held prop (non-humanoid) when humanoid signals are
	// at least as strong.
	if (pos.n > 0 && neg.n > 0) {
		if (pos.n >= neg.n) {
			return {
				humanoid: true,
				confidence: 'medium',
				reason: `humanoid subject (${pos.hits.join(', ')}) with incidental props (${neg.hits.join(', ')})`,
				signals,
			};
		}
		return {
			humanoid: false,
			confidence: 'medium',
			reason: `dominant non-humanoid subject (${neg.hits.join(', ')})`,
			signals,
		};
	}

	if (pos.n > 0) {
		return {
			humanoid: true,
			confidence: 'high',
			reason: `humanoid character signals: ${pos.hits.join(', ')}`,
			signals,
		};
	}

	if (neg.n > 0) {
		return {
			humanoid: false,
			confidence: 'high',
			reason: `non-humanoid subject: ${neg.hits.join(', ')}`,
			signals,
		};
	}

	// No signal either way. The caller invoked an avatar tool, so default to
	// proceeding — but flag it low-confidence so the result can say so honestly.
	return {
		humanoid: true,
		confidence: 'low',
		reason: 'no decisive signal; proceeding because an avatar was explicitly requested',
		signals,
	};
}

/**
 * What kind of body a prompt describes, for the rig preflight
 * (api/_lib/rig-preflight.js). Unlike classifyHumanoidPrompt it has no
 * "an avatar was requested" default: a prompt that names nothing decisive is
 * `unknown`, and the preflight falls back to the mesh's own shape.
 *
 * - `humanoid`: a person or biped character, props allowed ("a knight with a sword").
 * - `creature`: an animal or other non-biped body ("a robotic hound").
 * - `object`: a thing with no body to move ("a katana with sheath", "two chairs").
 * - `figure`: both a humanoid and a creature ("a knight on horseback"); it can
 *   move, but no single rigger is the obvious one, so no hint is sent.
 * - `unknown`: nothing decisive.
 *
 * @param {string} prompt
 * @returns {{ subject: 'humanoid'|'creature'|'object'|'figure'|'unknown', hits: { humanoid: string[], creature: string[], object: string[] } }}
 */
export function classifyRigSubject(prompt) {
	const text = String(prompt || '').toLowerCase().trim();
	const empty = { humanoid: [], creature: [], object: [] };
	if (text.length < 3 || !/[a-z]/.test(text)) return { subject: 'unknown', hits: empty };
	const h = countMatches(text, HUMANOID_TERMS, { plural: true });
	const c = countMatches(text, CREATURE_TERMS, { plural: true });
	const o = countMatches(text, OBJECT_TERMS, { plural: true });
	const hits = { humanoid: h.hits, creature: c.hits, object: o.hits };
	const bodies = h.n + c.n;
	// A body word wins over the props it holds or wears, unless the props
	// outnumber it ("fighter jet" hits fighter, jet and "fighter jet").
	if (o.n > bodies) return { subject: 'object', hits };
	if (bodies === 0) return { subject: 'unknown', hits };
	if (h.n > 0 && c.n > 0) return { subject: 'figure', hits };
	return { subject: h.n > 0 ? 'humanoid' : 'creature', hits };
}
