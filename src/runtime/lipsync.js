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

/**
 * Drive jaw/mouth morph targets in sync with speech text via a phoneme heuristic.
 * Supports ARKit viseme_* targets (Ready Player Me avatars) and jawOpen/mouthOpen fallbacks.
 *
 * @param {string} text — the spoken text
 * @param {import('three').Object3D} root — avatar root (or scene) to traverse for morph targets
 * @returns {{ stop(): void }}
 */
export function startLipsync(text, root) {
	if (!text || !root) return { stop: () => {} };

	const result = _buildMorphMap(root);
	if (!result) return { stop: () => {} };

	const { mode, map } = result;
	const sequence = _tokenize(text);

	const startTime = performance.now();
	const weights = new Map();
	for (const name of map.keys()) weights.set(name, 0);

	let rafId;
	let stopped = false;

	const tick = () => {
		if (stopped) return;
		const elapsed = performance.now() - startTime;

		let targetViseme = null;
		for (const entry of sequence) {
			if (elapsed >= entry.startMs && elapsed < entry.endMs) {
				targetViseme = entry.viseme;
				break;
			}
		}

		if (mode === 'arkit') {
			for (const [name, targets] of map.entries()) {
				const goal = name === targetViseme ? 1 : 0;
				const cur = weights.get(name);
				const next = cur + (goal - cur) * LERP_FACTOR;
				weights.set(name, next);
				_setMorph(targets, next);
			}
		} else {
			const goal = targetViseme ? 0.7 : 0;
			for (const [name, targets] of map.entries()) {
				const cur = weights.get(name);
				const next = cur + (goal - cur) * LERP_FACTOR;
				weights.set(name, next);
				_setMorph(targets, next);
			}
		}

		rafId = requestAnimationFrame(tick);
	};

	rafId = requestAnimationFrame(tick);

	return {
		stop() {
			stopped = true;
			if (rafId !== undefined) cancelAnimationFrame(rafId);
			_resetMap(map);
		},
	};
}
