// Lipsync driver — text-to-viseme heuristic. No audio analysis required.
// Returns { stop() } that resets all mouth morphs and cancels the animation loop.

const ARKIT_VISEMES = [
	'viseme_aa', 'viseme_CH', 'viseme_DD', 'viseme_E', 'viseme_FF',
	'viseme_I', 'viseme_kk', 'viseme_nn', 'viseme_O', 'viseme_PP',
	'viseme_RR', 'viseme_sil', 'viseme_SS', 'viseme_TH', 'viseme_U',
];

const JAW_FALLBACKS = ['jawOpen', 'mouthOpen'];

const CHAR_TO_VISEME = {
	a: 'viseme_aa', e: 'viseme_E', i: 'viseme_I', o: 'viseme_O', u: 'viseme_U',
	b: 'viseme_PP', m: 'viseme_PP', p: 'viseme_PP',
	f: 'viseme_FF', v: 'viseme_FF',
	d: 'viseme_DD', t: 'viseme_DD', n: 'viseme_DD', l: 'viseme_DD',
	k: 'viseme_kk', g: 'viseme_kk',
	s: 'viseme_SS', z: 'viseme_SS',
	r: 'viseme_RR',
};

const DIGRAPH_TO_VISEME = {
	th: 'viseme_TH',
	ch: 'viseme_CH',
	sh: 'viseme_CH',
};

const MS_PER_PHONEME = 80;
const WORD_GAP_MS = 120;
const PUNCT_GAP_MS = 200;
// Lerp factor per rAF step — reaches ~95% of target in ~5 frames at 60 fps
const LERP_FACTOR = 0.35;

function _buildMorphMap(root) {
	const arkit = new Map();
	const jaw = new Map();

	root.traverse?.((node) => {
		if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
		const dict = node.morphTargetDictionary;

		for (const name of ARKIT_VISEMES) {
			const idx = dict[name];
			if (idx === undefined) continue;
			if (!arkit.has(name)) arkit.set(name, []);
			arkit.get(name).push({ mesh: node, index: idx });
		}

		for (const name of JAW_FALLBACKS) {
			const idx = dict[name];
			if (idx === undefined) continue;
			if (!jaw.has(name)) jaw.set(name, []);
			jaw.get(name).push({ mesh: node, index: idx });
		}
	});

	if (arkit.size) return { mode: 'arkit', map: arkit };
	if (jaw.size) return { mode: 'jaw', map: jaw };
	return null;
}

function _tokenize(text) {
	const sequence = [];
	const lower = text.toLowerCase();
	let t = 0;
	let i = 0;

	while (i < lower.length) {
		const pair = i + 1 < lower.length ? lower[i] + lower[i + 1] : '';
		if (DIGRAPH_TO_VISEME[pair]) {
			sequence.push({ viseme: DIGRAPH_TO_VISEME[pair], startMs: t, endMs: t + MS_PER_PHONEME * 2 });
			t += MS_PER_PHONEME * 2;
			i += 2;
			continue;
		}

		const ch = lower[i];
		if (CHAR_TO_VISEME[ch]) {
			sequence.push({ viseme: CHAR_TO_VISEME[ch], startMs: t, endMs: t + MS_PER_PHONEME });
			t += MS_PER_PHONEME;
		} else if (ch === ' ' || ch === '\t' || ch === '\n') {
			t += WORD_GAP_MS;
		} else if (/[.,!?;:]/.test(ch)) {
			t += PUNCT_GAP_MS;
		}
		i++;
	}

	return sequence;
}

function _setMorph(targets, weight) {
	for (const { mesh, index } of targets) {
		mesh.morphTargetInfluences[index] = weight;
	}
}

function _resetMap(map) {
	for (const targets of map.values()) {
		_setMorph(targets, 0);
	}
}

// The viseme active at `elapsedMs` in a sorted [{viseme,startMs,endMs}] sequence,
// or null in the gaps. Linear scan — sequences are short (one utterance).
export function activeVisemeAt(sequence, elapsedMs) {
	for (const entry of sequence) {
		if (elapsedMs >= entry.startMs && elapsedMs < entry.endMs) return entry.viseme;
	}
	return null;
}

/**
 * Build a morph driver bound to an avatar's mouth/jaw blendshapes. Returns null
 * when the avatar has none. `step(targetViseme)` lerps one frame toward the given
 * viseme (or rest when null); `reset()` zeroes every morph. Shared by the text
 * heuristic ({@link startLipsync}) and the neural timestamp lane (neural-tts.js).
 *
 * @param {import('three').Object3D} root
 * @returns {{ mode:'arkit'|'jaw', step(target:string|null):void, reset():void }|null}
 */
export function createVisemeDriver(root) {
	const result = _buildMorphMap(root);
	if (!result) return null;
	const { mode, map } = result;
	const weights = new Map();
	for (const name of map.keys()) weights.set(name, 0);
	return {
		mode,
		step(targetViseme) {
			// 'arkit' rigs hit the exact viseme morph; 'jaw'-only rigs open the jaw
			// for any active viseme (a single morph can't shape phonemes).
			for (const [name, targets] of map.entries()) {
				const goal = mode === 'arkit' ? (name === targetViseme ? 1 : 0) : targetViseme ? 0.7 : 0;
				const cur = weights.get(name);
				const next = cur + (goal - cur) * LERP_FACTOR;
				weights.set(name, next);
				_setMorph(targets, next);
			}
		},
		reset() {
			for (const name of weights.keys()) weights.set(name, 0);
			_resetMap(map);
		},
	};
}

/**
 * Drive mouth morphs from a timed viseme sequence against a caller-supplied clock.
 * The clock decouples timing from wall-time: the text heuristic ticks on
 * `performance.now`, while the neural lane ticks on `audio.currentTime` so visemes
 * stay locked to playback even if the audio starts late or stalls.
 *
 * @param {import('three').Object3D} root
 * @param {Array<{viseme:string,startMs:number,endMs:number}>} sequence
 * @param {() => number} elapsedMs — current elapsed time, in ms
 * @returns {{ stop(): void }}
 */
export function playVisemeSequence(root, sequence, elapsedMs = () => 0) {
	const driver = createVisemeDriver(root);
	if (!driver || !sequence?.length) return { stop: () => {} };

	let rafId;
	let stopped = false;
	const tick = () => {
		if (stopped) return;
		driver.step(activeVisemeAt(sequence, elapsedMs()));
		rafId = requestAnimationFrame(tick);
	};
	rafId = requestAnimationFrame(tick);

	return {
		stop() {
			stopped = true;
			if (rafId !== undefined) cancelAnimationFrame(rafId);
			driver.reset();
		},
	};
}

// Characters that carry no viseme of their own: true silence in the sequence,
// not just "unmapped". Mirrors the word/punctuation gaps _tokenize() inserts.
const SILENT_CHARS = new Set([' ', '\t', '\n', '.', ',', '!', '?', ';', ':', '"', "'", '-', '　']);

// Any letter CHAR_TO_VISEME doesn't cover (most non-Latin scripts: CJK, Cyrillic,
// Arabic, Devanagari…) still gets a real per-character timestamp from ElevenLabs;
// it just can't pick a specific phoneme shape from a single codepoint. A generic
// open-mouth viseme keeps the timing real rather than falling silent on every
// language the heuristic alphabet-based lookup wasn't written for.
const DEFAULT_LETTER_VISEME = 'viseme_aa';

/**
 * Build a timed viseme sequence from ElevenLabs' character-level alignment
 * (`/with-timestamps`): `{ characters, character_start_times_seconds,
 * character_end_times_seconds }`. Real per-character timing in whatever
 * language the text was written in, unlike {@link startLipsync}'s English-letter
 * duration estimate. Used by the ElevenLabs TTS lane (runtime/speech.js) with
 * the energy-based {@link LipSyncAnalyser} path as its fallback.
 *
 * @param {{characters?: string[], character_start_times_seconds?: number[], character_end_times_seconds?: number[]}} alignment
 * @returns {Array<{viseme:string,startMs:number,endMs:number}>}
 */
export function alignmentToSequence(alignment) {
	const chars = alignment?.characters;
	const starts = alignment?.character_start_times_seconds;
	const ends = alignment?.character_end_times_seconds;
	if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return [];

	const sequence = [];
	for (let i = 0; i < chars.length; i++) {
		const raw = chars[i];
		if (!raw) continue;
		const ch = raw.toLowerCase();
		if (SILENT_CHARS.has(ch)) continue;

		const viseme = CHAR_TO_VISEME[ch] || (/\S/.test(ch) ? DEFAULT_LETTER_VISEME : null);
		if (!viseme) continue;

		const startMs = (starts[i] ?? 0) * 1000;
		const endRaw = ends[i] ?? starts[i + 1] ?? starts[i] ?? 0;
		// A zero-length entry (two characters sharing one timestamp) would never
		// activate in activeVisemeAt()'s half-open interval check, so floor it to
		// a visible minimum instead of letting the viseme silently vanish.
		const endMs = Math.max(startMs + 20, endRaw * 1000);
		sequence.push({ viseme, startMs, endMs });
	}
	return sequence;
}

/**
 * Drive jaw/mouth morph targets in sync with speech text via a phoneme heuristic.
 * Supports the ARKit viseme_* morph targets that three.ws avatars ship with (and
 * the same names exported by Mixamo / VRM), plus jawOpen / mouthOpen fallbacks.
 * Used when the TTS lane gives no real timing (browser SpeechSynthesis); the
 * neural lane uses {@link playVisemeSequence} with actual phoneme timestamps.
 *
 * @param {string} text — the spoken text
 * @param {import('three').Object3D} root — avatar root (or scene) to traverse for morph targets
 * @returns {{ stop(): void }}
 */
export function startLipsync(text, root) {
	if (!text || !root) return { stop: () => {} };
	const sequence = _tokenize(text);
	const t0 = performance.now();
	return playVisemeSequence(root, sequence, () => performance.now() - t0);
}
