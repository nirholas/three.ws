// Tests for alignmentToSequence(): turns ElevenLabs' /with-timestamps
// character-level alignment into the {viseme,startMs,endMs} shape
// playVisemeSequence() expects. Pure function, no AudioContext/DOM needed.

import { describe, it, expect } from 'vitest';
import { alignmentToSequence, activeVisemeAt } from '../src/runtime/lipsync.js';

function alignment(chars, startSec, durationSec = 0.08) {
	const starts = [];
	const ends = [];
	let t = startSec;
	for (let i = 0; i < chars.length; i++) {
		starts.push(t);
		ends.push(t + durationSec);
		t += durationSec;
	}
	return { characters: chars.split(''), character_start_times_seconds: starts, character_end_times_seconds: ends };
}

describe('alignmentToSequence', () => {
	it('maps known Latin letters to their viseme with real millisecond timing', () => {
		const seq = alignmentToSequence(alignment('ba', 0, 0.1));
		expect(seq).toEqual([
			{ viseme: 'viseme_PP', startMs: 0, endMs: 100 },
			{ viseme: 'viseme_aa', startMs: 100, endMs: 200 },
		]);
	});

	it('skips whitespace and punctuation as true silence, not a viseme', () => {
		const seq = alignmentToSequence(alignment('a, b.', 0, 0.1));
		const visemes = seq.map((s) => s.viseme);
		expect(visemes).toEqual(['viseme_aa', 'viseme_PP']);
	});

	it('falls back to a generic open-mouth viseme for non-Latin scripts', () => {
		// CJK/Cyrillic/Arabic characters have no entry in CHAR_TO_VISEME, but still
		// carry a real per-character timestamp from ElevenLabs, so the timing must
		// not be dropped just because the exact mouth shape is unknown.
		const seq = alignmentToSequence(alignment('日本', 0, 0.12));
		expect(seq).toEqual([
			{ viseme: 'viseme_aa', startMs: 0, endMs: 120 },
			{ viseme: 'viseme_aa', startMs: 120, endMs: 240 },
		]);
	});

	it('floors zero-length entries to a visible minimum duration', () => {
		// Two characters sharing one timestamp (end == start) would never satisfy
		// activeVisemeAt()'s half-open interval check if left at 0 width.
		const alignmentData = {
			characters: ['a', 'b'],
			character_start_times_seconds: [0, 0.05],
			character_end_times_seconds: [0.05, 0.05],
		};
		const seq = alignmentToSequence(alignmentData);
		expect(seq[1].endMs).toBeGreaterThan(seq[1].startMs);
		expect(seq[1].endMs - seq[1].startMs).toBeGreaterThanOrEqual(20);
	});

	it('produces a sequence activeVisemeAt() can actually scan', () => {
		const seq = alignmentToSequence(alignment('hi', 0, 0.1));
		expect(activeVisemeAt(seq, 50)).toBe(seq[0].viseme);
		expect(activeVisemeAt(seq, 150)).toBe(seq[1].viseme);
		expect(activeVisemeAt(seq, 1000)).toBeNull();
	});

	it('returns an empty array when alignment data is missing or malformed', () => {
		expect(alignmentToSequence(undefined)).toEqual([]);
		expect(alignmentToSequence({})).toEqual([]);
		expect(alignmentToSequence({ characters: ['a'] })).toEqual([]);
	});
});
