// Prompt safety gate for text-to-3D generation.
//
// A studio you can drop on a public page will be typed into by the public. This
// classifier refuses the highest-harm categories before any GPU work starts, so
// a hosted demo stays appropriate for a general audience (including the 13+ bar
// app stores hold conversational 3D tools to). It is deliberately a whole-word
// keyword classifier, not a model call: zero latency, zero dependency, zero cost,
// and it runs in the browser as well as in the MCP server.
//
// This is a client-side courtesy, not the authority. The generation backend runs
// its own gate; this one exists so an obviously-disallowed prompt fails instantly
// with a useful message instead of after a round trip.
//
// Ported from the three.ws 3D Studio connector's gate (Apache-2.0).

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word match, so "assassin" never trips "ass" and Scunthorpe is safe.
function hasTerm(text, terms) {
	for (const t of terms) {
		const re = new RegExp(`(^|[^a-z0-9])${escapeRe(t)}([^a-z0-9]|$)`, 'i');
		if (re.test(text)) return t;
	}
	return null;
}

const SEXUAL_TERMS = [
	'nude', 'nudes', 'naked', 'nsfw', 'porn', 'porno', 'pornographic', 'xxx',
	'sex', 'sexual', 'sexy', 'erotic', 'erotica', 'hentai', 'rule34', 'r34',
	'fetish', 'bdsm', 'bondage', 'lingerie', 'topless', 'bottomless', 'nipple',
	'nipples', 'genital', 'genitalia', 'penis', 'vagina', 'vulva', 'breasts',
	'boobs', 'cleavage', 'buttocks', 'thong', 'fellatio', 'cunnilingus',
	'masturbation', 'orgasm', 'cum', 'creampie', 'milf', 'camgirl', 'stripper',
	'escort', 'onlyfans',
];

// Zero tolerance. Every term is unambiguous on purpose: this category refuses
// with a blunt message, and a false accusation is a worse failure than a missed
// abbreviation. The short term for it is deliberately absent because it fires on
// "a CP/M terminal".
const CSAM_TERMS = [
	'loli', 'lolicon', 'shota', 'shotacon', 'toddlercon', 'underage', 'preteen',
	'pre-teen', 'jailbait', 'child porn', 'childporn', 'child sex', 'child sexual',
	'minor sex', 'csam',
];

const GORE_TERMS = [
	'gore', 'gory', 'gruesome', 'dismembered', 'dismemberment', 'decapitated',
	'decapitation', 'beheading', 'mutilated', 'mutilation', 'disembowel',
	'disemboweled', 'eviscerated', 'bloodbath', 'massacre', 'torture',
	'tortured', 'snuff',
];

const HATE_TERMS = [
	'nazi', 'swastika', 'hitler', 'kkk', 'white power', 'heil', 'genocide',
	'ethnic cleansing', 'terrorist', 'isis', 'al qaeda', 'al-qaeda',
];

// Real, usable weapons and drugs only. Stylized fantasy props (sword, bow, wand)
// are creative work and stay allowed.
const WEAPON_DRUG_TERMS = [
	'ghost gun', 'ar-15', 'ar15', 'ak-47', 'ak47', 'assault rifle',
	'submachine gun', 'handgun', 'pistol', 'firearm', 'firearms', 'silencer',
	'suppressor', 'ammunition magazine', 'pipe bomb', 'ied', 'grenade',
	'landmine', 'c4 explosive', 'meth', 'methamphetamine', 'cocaine', 'heroin',
	'fentanyl', 'crack pipe', 'bong',
];

const CATEGORIES = [
	{ id: 'csam', terms: CSAM_TERMS, message: 'This prompt is not allowed.' },
	{
		id: 'sexual',
		terms: SEXUAL_TERMS,
		message: 'This studio cannot generate sexual or adult content. Describe a character, creature, or object without explicit themes.',
	},
	{
		id: 'gore',
		terms: GORE_TERMS,
		message: 'This studio cannot generate graphically violent or gory content. Describe your subject without graphic violence.',
	},
	{
		id: 'hate',
		terms: HATE_TERMS,
		message: 'This studio cannot generate hateful or extremist content or iconography.',
	},
	{
		id: 'weapon_drug',
		terms: WEAPON_DRUG_TERMS,
		message: 'This studio cannot generate real firearms, explosives, or drug paraphernalia. Stylized fantasy props (a sword, a wand) are fine.',
	},
];

/**
 * Classify a generation prompt.
 *
 * @param {string} prompt
 * @returns {{allowed: boolean, category?: string, message?: string, matched?: string}}
 */
export function checkPromptSafety(prompt) {
	const text = String(prompt || '').toLowerCase();
	if (!text.trim()) return { allowed: true };
	for (const cat of CATEGORIES) {
		const matched = hasTerm(text, cat.terms);
		if (matched) return { allowed: false, category: cat.id, message: cat.message, matched };
	}
	return { allowed: true };
}

/** Is this prompt long enough to be a real subject? */
export function validatePrompt(raw) {
	const text = String(raw ?? '').trim();
	if (text.length < 3) {
		return { ok: false, reason: 'Describe a concrete object: at least a few characters.' };
	}
	const safety = checkPromptSafety(text);
	if (!safety.allowed) return { ok: false, reason: safety.message, category: safety.category };
	return { ok: true, prompt: text };
}
