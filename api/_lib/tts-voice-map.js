// @ts-check
// Legacy voice-id compatibility. Earlier versions of the platform stored
// Microsoft-style voice ids ("en-US-AriaNeural") on agents, widgets and
// avatars. That lane is gone; a stored id of that shape must never error, so it
// is mapped here to the closest-sounding Google Gemini prebuilt voice. Gemini
// voices are multilingual and detect language from the text, so locale needs
// no mapping.

import { GEMINI_DEFAULT_VOICE } from './tts-gemini.js';

const LEGACY_VOICE_RE = /^[a-zA-Z]{2,8}-[a-zA-Z]{2,8}-[a-zA-Z0-9]{5,50}$/;

const FEMALE_GEMINI = [
	'Kore', 'Zephyr', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Despina',
	'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat',
];
const MALE_GEMINI = [
	'Charon', 'Puck', 'Fenrir', 'Orus', 'Iapetus', 'Algieba', 'Rasalgethi',
	'Alnilam', 'Schedar', 'Achird', 'Enceladus', 'Umbriel', 'Algenib', 'Sadaltager',
];

const MALE_NAMES = new Set([
	'guy', 'ryan', 'andrew', 'brian', 'christopher', 'eric', 'roger', 'steffan',
	'davis', 'jason', 'tony', 'conrad', 'henri', 'diego', 'antonio', 'dmitry',
	'madhur', 'maarten', 'marek', 'antonin', 'hamed', 'ahmet', 'ardi', 'mattias',
	'ostap', 'emil', 'keita', 'injoon', 'alvaro', 'yunxi', 'yunjhe', 'yunyang',
	'yunjian', 'yunhao', 'yunze', 'thomas', 'william', 'liam', 'alex', 'prabhat',
	'mark', 'jacob', 'ethan', 'rehaan', 'sam', 'daniel', 'fabrice', 'killian',
	'jonas', 'gerard', 'adri', 'borislav', 'finn', 'jenny', 'noah', 'ravi',
	'hillary', 'luca', 'valluvar', 'surya', 'bruno', 'fabio', 'duarte', 'jorge',
	'raul', 'tomas', 'arnau', 'sebastien', 'claude', 'jean', 'kasper', 'nilo',
	'rafal', 'taras', 'zariyah',
]);
// Names above that are actually female are removed again here so the set can
// stay a flat list: jenny, hillary, zariyah.
for (const n of ['jenny', 'hillary', 'zariyah']) MALE_NAMES.delete(n);

/** True when `id` has the shape of a retired Microsoft-style voice id. */
export function isLegacyEdgeVoiceId(id) {
	return typeof id === 'string' && LEGACY_VOICE_RE.test(id.trim()) && /Neural$/i.test(id.trim());
}

function hash(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * Map a retired voice id to a Gemini prebuilt voice. Deterministic: the same
 * stored id always lands on the same replacement, and the same given name picks
 * the same voice in every locale. Anything unrecognized gets the lane default.
 * @param {string|null|undefined} id
 * @returns {string}
 */
export function mapLegacyEdgeVoice(id) {
	if (!isLegacyEdgeVoiceId(String(id || ''))) return GEMINI_DEFAULT_VOICE;
	const parts = String(id).trim().split('-');
	const name = parts.slice(2).join('-').replace(/(Multilingual)?Neural$/i, '');
	const male = MALE_NAMES.has(name.toLowerCase());
	const pool = male ? MALE_GEMINI : FEMALE_GEMINI;
	return pool[hash(name.toLowerCase()) % pool.length];
}
