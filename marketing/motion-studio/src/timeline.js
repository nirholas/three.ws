// The one timeline. The composition reads it for picture, audio.mjs reads it
// for sound, and render.mjs reads it for duration, so a cue can never drift
// from the frame it belongs to. Times are seconds.

export const FPS = 30;
export const DURATION = 17;

export const TYPED = { text: 'Your AI has a brain.', start: 0.2, perChar: 0.05 };

export const BEATS = {
	noBody: 1.55,
	reveal: 2.4,
	forgeIn: 4.8,
	forgeSettle: 6.0,
	forgeOut: 8.1,
	aliveIn: 8.4,
	chips: [9.6, 10.2, 10.8],
	aliveOut: 11.7,
	marketIn: 12.0,
	marketSettle: 13.0,
	marketOut: 14.2,
	close: 14.4,
	finalHit: 14.9,
};

// Time each typed character lands, shared with the audio ticks.
export function typedTimes() {
	return [...TYPED.text].map((_, i) => TYPED.start + i * TYPED.perChar);
}
