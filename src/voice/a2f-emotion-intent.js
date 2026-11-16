/**
 * Intent half of the Audio2Face-3D emotion layer: no three.js, so the server
 * route (api/a2f.js) and the browser share one vocabulary. The face, head and
 * rig half lives in ./a2f-emotion.js, which re-exports everything here.
 */

/** The ten emotion channels Audio2Face-3D accepts and reports. */
export const A2F_EMOTIONS = Object.freeze([
	'amazement',
	'anger',
	'cheekiness',
	'disgust',
	'fear',
	'grief',
	'joy',
	'outofbreath',
	'pain',
	'sadness',
]);
const A2F_SET = new Set(A2F_EMOTIONS);

/**
 * Intent vocabulary → A2F emotion input at full intensity. Covers the agent
 * runtime's six emotions (src/embodiment/emotion.js EMOTIONS) and the
 * agent-avatar transient blend (celebration, concern, curiosity, empathy,
 * patience). "thinking" and "patience" are deliberately neutral input: A2F has
 * no contemplative channel, and Audio2Emotion still reads the voice itself.
 */
export const INTENT_TO_A2F = Object.freeze({
	neutral: {},
	joy: { joy: 0.85, cheekiness: 0.15 },
	happy: { joy: 0.85, cheekiness: 0.15 },
	sad: { sadness: 0.75, grief: 0.2 },
	angry: { anger: 0.8, disgust: 0.15 },
	surprised: { amazement: 0.85 },
	thinking: {},
	celebration: { joy: 1, amazement: 0.25 },
	concern: { sadness: 0.45, fear: 0.35 },
	curiosity: { amazement: 0.5, cheekiness: 0.1 },
	empathy: { sadness: 0.5, grief: 0.1 },
	patience: {},
});

/** Intent labels the API advertises (one canonical spelling each). */
export const INTENT_LABELS = Object.freeze(Object.keys(INTENT_TO_A2F).filter((k) => k !== 'happy'));

/** Default overall strength of the emotion layer (0..1). */
export const DEFAULT_EMOTION_STRENGTH = 0.6;

const OFF_WORDS = new Set(['off', 'none', 'false', '0', 'disabled']);

/**
 * Resolve an intended feeling into A2F emotion input.
 *
 * @param {string|Record<string,number>|null|undefined} input
 *   a label ("joy", "concern", "anger"), "off", or a channel map
 *   ({ joy: 0.7, amazement: 0.2 }). Unknown labels and channels are ignored.
 * @param {number} [intensity=1] scales a label's preset (0..1)
 * @returns {{ off:boolean, label:string|null, emotion:Record<string,number> }}
 *   `off` true means the caller asked for no emotion at all.
 */
export function intentToA2fEmotion(input, intensity = 1) {
	const k = clamp01(Number.isFinite(Number(intensity)) ? Number(intensity) : 1);
	if (input == null || input === '') return { off: false, label: null, emotion: {} };
	if (typeof input === 'string') {
		const s = input.trim().toLowerCase();
		if (OFF_WORDS.has(s)) return { off: true, label: 'off', emotion: {} };
		if (INTENT_TO_A2F[s]) return { off: false, label: s === 'happy' ? 'joy' : s, emotion: scaleMap(INTENT_TO_A2F[s], k) };
		if (A2F_SET.has(s)) return { off: false, label: s, emotion: { [s]: round3(0.85 * k) } };
		return { off: false, label: null, emotion: {} };
	}
	if (typeof input === 'object') {
		const out = {};
		for (const [name, v] of Object.entries(input)) {
			const key = String(name).toLowerCase();
			const n = Number(v);
			if (A2F_SET.has(key) && Number.isFinite(n) && n > 0) out[key] = round3(clamp01(n) * k);
		}
		return { off: false, label: dominantEmotion(out), emotion: out };
	}
	return { off: false, label: null, emotion: {} };
}

/** Highest channel in an emotion map, or null when every channel is ~0. */
export function dominantEmotion(map) {
	let best = null;
	let bestV = 0.05;
	for (const [k, v] of Object.entries(map || {})) {
		if (v > bestV) {
			best = k;
			bestV = v;
		}
	}
	return best;
}

function scaleMap(map, k) {
	const out = {};
	for (const [n, v] of Object.entries(map)) out[n] = round3(v * k);
	return out;
}

function round3(n) {
	return Math.round(n * 1000) / 1000;
}

function clamp01(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return v < 0 ? 0 : v > 1 ? 1 : v;
}
