// Last-resort voice for the digital human: the visitor's own browser speaks
// (speechSynthesis) and the mouth follows a viseme timeline built from the text.
//
// Used only when both server voices are down (Magpie streaming and the
// /api/tts/speak lanes). speechSynthesis audio never passes through Web Audio,
// so there is no analyser to drive amplitude lipsync; instead the text is
// mapped to mouth shapes (open / wide / round) on an estimated clock, and every
// `boundary` event the engine fires re-anchors that clock to the word actually
// being spoken, so a slow or fast system voice stays in sync.

// Mouth shapes per letter class. Values are AvatarMouthTarget channels in [0,1].
const SHAPES = {
	a: { open: 0.75, wide: 0.25, round: 0 },
	e: { open: 0.45, wide: 0.7, round: 0 },
	i: { open: 0.3, wide: 0.85, round: 0 },
	o: { open: 0.6, wide: 0, round: 0.8 },
	u: { open: 0.3, wide: 0, round: 0.95 },
	closed: { open: 0, wide: 0.1, round: 0 }, // m b p
	teeth: { open: 0.12, wide: 0.45, round: 0 }, // f v
	consonant: { open: 0.22, wide: 0.3, round: 0.05 },
	rest: { open: 0, wide: 0, round: 0 },
};

const CLASS_OF = (ch) => {
	if ('a'.includes(ch)) return 'a';
	if ('e'.includes(ch)) return 'e';
	if ('iy'.includes(ch)) return 'i';
	if ('o'.includes(ch)) return 'o';
	if ('uw'.includes(ch)) return 'u';
	if ('mbp'.includes(ch)) return 'closed';
	if ('fv'.includes(ch)) return 'teeth';
	if (/[a-z0-9]/.test(ch)) return 'consonant';
	return null;
};

// A default system voice at rate 1 speaks roughly 14 characters per second.
const CHARS_PER_SEC = 14;

/**
 * Build the viseme timeline for `text`.
 * @returns {{ keys: Array<{ t:number, c:number, open:number, wide:number, round:number }>, duration:number }}
 *          `c` is the character index each key belongs to (for boundary resync).
 */
export function textToVisemes(text, { rate = 1 } = {}) {
	const s = String(text || '').toLowerCase();
	const step = 1 / (CHARS_PER_SEC * Math.max(0.25, rate));
	const keys = [];
	let t = 0;
	let prev = null;
	for (let c = 0; c < s.length; c++) {
		const ch = s[c];
		const cls = CLASS_OF(ch);
		if (cls) {
			// Doubled letters hold the shape instead of re-keying it.
			if (cls !== prev) keys.push({ t, c, ...SHAPES[cls] });
			prev = cls;
			t += step;
		} else {
			// Spaces close the mouth briefly; punctuation pauses longer.
			const pause = /[.!?]/.test(ch) ? step * 4 : /[,;:]/.test(ch) ? step * 2 : step * 0.6;
			if (prev !== 'rest') keys.push({ t, c, ...SHAPES.rest });
			prev = 'rest';
			t += pause;
		}
	}
	keys.push({ t, c: s.length, ...SHAPES.rest });
	return { keys, duration: t };
}

/** Interpolated mouth shape at time `t` (seconds) on a timeline. */
export function sampleVisemes(timeline, t) {
	const { keys } = timeline;
	if (!keys.length || t <= 0) return { ...SHAPES.rest };
	let i = 0;
	while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
	const a = keys[i];
	const b = keys[i + 1];
	if (!b) return { open: a.open, wide: a.wide, round: a.round };
	// Ease into the next shape over the last 60% of each key.
	const span = b.t - a.t;
	const k = span > 0 ? Math.min(1, Math.max(0, ((t - a.t) / span - 0.4) / 0.6)) : 1;
	return {
		open: a.open + (b.open - a.open) * k,
		wide: a.wide + (b.wide - a.wide) * k,
		round: a.round + (b.round - a.round) * k,
	};
}

/** Timeline time of character index `charIndex` (for boundary resync). */
export function timeAtChar(timeline, charIndex) {
	let best = 0;
	for (const k of timeline.keys) {
		if (k.c > charIndex) break;
		best = k.t;
	}
	return best;
}

export function browserVoiceSupported() {
	return (
		typeof window !== 'undefined' &&
		'speechSynthesis' in window &&
		typeof SpeechSynthesisUtterance === 'function'
	);
}

/**
 * Speak `text` with the browser's own voice while driving `target.setMouthShape`.
 * Resolves when the utterance ends. Rejects with code 'browser_voice_unavailable'
 * when the engine never starts (no voices installed, autoplay policy), so the
 * caller can fall through to captions.
 */
export function speakWithVisemes(
	text,
	{ target, lang = 'en-US', rate = 1, startTimeoutMs = 4000, signal } = {},
) {
	return new Promise((resolve, reject) => {
		if (!browserVoiceSupported()) {
			reject(
				Object.assign(new Error('This browser has no speech synthesis'), {
					code: 'browser_voice_unavailable',
				}),
			);
			return;
		}
		const synth = window.speechSynthesis;
		const u = new SpeechSynthesisUtterance(text);
		u.lang = lang;
		u.rate = rate;
		const voices = synth.getVoices();
		const match =
			voices.find((v) => v.lang === lang) ||
			voices.find((v) => v.lang?.startsWith(lang.slice(0, 2)));
		if (match) u.voice = match;

		const timeline = textToVisemes(text, { rate });
		let startedAt = 0;
		let offset = 0;
		let raf = 0;
		let settled = false;
		const clock = () =>
			(typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
		const frame = () => {
			const s = sampleVisemes(timeline, clock() - startedAt + offset);
			try {
				target?.setMouthShape(s);
			} catch {}
			raf = requestAnimationFrame(frame);
		};
		const finish = (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(startTimer);
			cancelAnimationFrame(raf);
			try {
				target?.setMouthShape(SHAPES.rest);
			} catch {}
			signal?.removeEventListener('abort', onAbort);
			if (err) reject(err);
			else resolve({ duration: clock() - startedAt });
		};
		const onAbort = () => {
			synth.cancel();
			finish(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'aborted' }));
		};
		const startTimer = setTimeout(() => {
			synth.cancel();
			finish(
				Object.assign(new Error('The browser voice did not start'), {
					code: 'browser_voice_unavailable',
				}),
			);
		}, startTimeoutMs);

		u.onstart = () => {
			clearTimeout(startTimer);
			startedAt = clock();
			raf = requestAnimationFrame(frame);
		};
		u.onboundary = (e) => {
			if (!startedAt || typeof e.charIndex !== 'number') return;
			offset = timeAtChar(timeline, e.charIndex) - (clock() - startedAt);
		};
		u.onend = () => finish();
		u.onerror = (e) => {
			const code =
				e?.error === 'interrupted' || e?.error === 'canceled'
					? 'aborted'
					: 'browser_voice_unavailable';
			finish(
				Object.assign(new Error(`Browser voice error: ${e?.error || 'unknown'}`), { code }),
			);
		};
		signal?.addEventListener('abort', onAbort, { once: true });
		synth.speak(u);
	});
}
