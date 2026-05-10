/**
 * Pronounceable hex wordlist + leet-speak conversion.
 *
 * Hex chars only contain `0-9 a-f`, but enough English maps to that set
 * that you can spell things in raw hex. Useful for vanity prefixes and
 * suffixes that are immediately readable.
 *
 * Curated for: real words, no profanity, ≤5 chars (so they fit
 * comfortably under our MAX_PATTERN_LENGTH of 10).
 */

/** @type {Array<{ word: string, length: number }>} */
export const HEX_WORDS = [
	// Classic 4-char
	{ word: 'beef', length: 4 }, { word: 'cafe', length: 4 }, { word: 'dead', length: 4 },
	{ word: 'face', length: 4 }, { word: 'fade', length: 4 }, { word: 'feed', length: 4 },
	{ word: 'fade', length: 4 }, { word: 'babe', length: 4 }, { word: 'b00b', length: 4 },
	{ word: 'bead', length: 4 }, { word: 'cab',  length: 3 }, { word: 'bed',  length: 3 },
	{ word: 'fed',  length: 3 }, { word: 'ace',  length: 3 }, { word: 'add',  length: 3 },
	{ word: 'aid',  length: 3 }, { word: 'bad',  length: 3 }, { word: 'fee',  length: 3 },
	{ word: 'dad',  length: 3 }, { word: 'eed',  length: 3 },

	// 5-char
	{ word: 'decaf', length: 5 }, { word: 'faced', length: 5 }, { word: 'faded', length: 5 },
	{ word: 'fded',  length: 4 }, { word: 'beefd', length: 5 },
	// Crypto-cultural
	{ word: 'b00ba', length: 5 }, { word: 'bafff', length: 5 }, { word: '0xdeed', length: 6 },
];

/**
 * Curated short presets — used as quick-pick chips in the UI.
 * Sorted by difficulty (length then letterCount).
 */
export const PRESET_CHIPS = [
	'ace',  'bad',  'bed',  'cab',  'dad',  'fed',
	'beef', 'cafe', 'dead', 'face', 'fade', 'feed', 'babe', 'bead',
	'decaf', 'faced',
	// Pure leading-zeros — gas-saving classic.
	'0000', '00000',
];

/**
 * Convert ASCII text into hex by leet-speak substitution. Uppercase letters
 * preserve case in the output (so EIP-55 case-sensitive grinding kicks in).
 *
 *   l/L → 1 (digit; safe to keep lowercase)
 *   i/I → 1
 *   o   → 0     (digit)
 *   o   → 0
 *   s   → 5
 *   t/T → 7
 *   z/Z → 2
 *   g/G → 9
 *   q/Q → 9
 *   y   → 1
 *
 * Letters already in hex (a-f / A-F) and digits 0-9 pass through unchanged.
 * Returns null if any char can't be mapped.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function leetToHex(text) {
	if (!text) return null;
	const map = {
		l: '1', L: '1', i: '1', I: '1', o: '0', O: '0',
		s: '5', S: '5', t: '7', T: '7', z: '2', Z: '2',
		g: '9', G: '9', q: '9', Q: '9', y: '1', Y: '1',
	};
	let out = '';
	for (const ch of text.replace(/[^a-zA-Z0-9]/g, '')) {
		if (/[0-9]/.test(ch)) out += ch;
		else if (/[a-fA-F]/.test(ch)) out += ch;
		else if (map[ch]) out += map[ch];
		else return null;
	}
	return out || null;
}

/**
 * Suggest a vanity prefix derived from an agent's display name. Returns
 * the leet-converted name truncated to 5 chars, or null if nothing useful
 * can be derived.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function suggestPrefixFromName(name) {
	if (!name || typeof name !== 'string') return null;
	const candidate = leetToHex(name);
	if (!candidate) return null;
	const trimmed = candidate.slice(0, 5);
	return trimmed.length >= 3 ? trimmed : null;
}
