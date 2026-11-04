import { describe, expect, it } from 'vitest';
import {
	parseBenchDate,
	normalizeLocomo,
	normalizeLongMemEval,
	pickSubset,
	buildIndex,
	parseReconcile,
	applySupersession,
	factsAsOf,
	renderTemporalContext,
	renderBaselineContext,
	parseVerdict,
	summarize,
} from '../scripts/lib/memory-bench-core.mjs';

describe('parseBenchDate', () => {
	it('reads the LoCoMo and LongMemEval formats as UTC', () => {
		expect(parseBenchDate('1:56 pm on 8 May, 2023')).toBe(Date.UTC(2023, 4, 8, 13, 56));
		expect(parseBenchDate('12:05 am on 1 January, 2024')).toBe(Date.UTC(2024, 0, 1, 0, 5));
		expect(parseBenchDate('2023/05/20 (Sat) 02:21')).toBe(Date.UTC(2023, 4, 20, 2, 21));
	});
	it('returns null instead of guessing', () => {
		expect(parseBenchDate('sometime in spring')).toBeNull();
	});
});

describe('normalizers', () => {
	it('turns every LoCoMo turn into a dated memory and drops adversarial questions', () => {
		const raw = [{
			sample_id: 'conv-1',
			conversation: {
				speaker_a: 'A', speaker_b: 'B',
				session_1_date_time: '1:00 pm on 8 May, 2023',
				session_1: [{ speaker: 'A', dia_id: 'D1:1', text: 'I moved to Paris' }, { speaker: 'B', dia_id: 'D1:2', text: 'Nice', blip_caption: 'a tower' }],
				session_2_date_time: '2:00 pm on 9 June, 2023',
				session_2: [{ speaker: 'A', dia_id: 'D2:1', text: 'Now I live in Berlin' }],
			},
			qa: [
				{ question: 'Where does A live?', answer: 'Berlin', category: 4, evidence: ['D2:1'] },
				{ question: 'Trap?', category: 5, adversarial_answer: 'x' },
			],
		}];
		const cases = normalizeLocomo(raw);
		expect(cases).toHaveLength(1);
		expect(cases[0].type).toBe('single-hop');
		expect(cases[0].memories.map((m) => m.id)).toEqual(['D1:1', 'D1:2', 'D2:1']);
		expect(cases[0].memories[1].content).toContain('[shared a photo: a tower]');
		expect(cases[0].memories[0].validFrom).toBe(Date.UTC(2023, 4, 8, 13, 0));
		expect(cases[0].questionDate).toBe(Date.UTC(2023, 5, 9, 14, 0));
		expect(cases[0].memories[0].sourceRef).toBe('locomo:conv-1:D1:1');
	});

	it('pairs LongMemEval user turns with the assistant reply and flags abstention', () => {
		const cases = normalizeLongMemEval([{
			question_id: 'q1_abs', question_type: 'knowledge-update', question: 'Where?', answer: 'x', question_date: '2023/06/01 (Thu) 10:00',
			haystack_session_ids: ['s1'], haystack_dates: ['2023/05/20 (Sat) 02:21'],
			haystack_sessions: [[{ role: 'user', content: 'I live in Rome' }, { role: 'assistant', content: 'Great' }]],
		}]);
		expect(cases[0].abstention).toBe(true);
		expect(cases[0].memories).toHaveLength(1);
		expect(cases[0].memories[0].content).toBe('user: I live in Rome\nassistant: Great');
		expect(cases[0].memories[0].sourceRef).toBe('longmemeval:s1:turn:0');
	});
});

describe('pickSubset', () => {
	const cases = [...'aaaaaabbbbcc'].map((t, i) => ({ id: i, type: t }));
	it('is deterministic and covers every type before repeating one', () => {
		const a = pickSubset(cases, 3);
		expect(pickSubset(cases, 3)).toEqual(a);
		expect(new Set(a.map((c) => c.type))).toEqual(new Set(['a', 'b', 'c']));
	});
	it('returns everything when n is large', () => {
		expect(pickSubset(cases, 99)).toHaveLength(12);
	});
});

describe('BM25 index', () => {
	it('ranks the memory that shares rare terms first', () => {
		const idx = buildIndex([
			{ id: 'a', content: 'the weather is nice today' },
			{ id: 'b', content: 'Caroline attended the LGBTQ support group' },
			{ id: 'c', content: 'we talked about lunch' },
		]);
		expect(idx.search('When did Caroline go to the LGBTQ support group?', 2).map((m) => m.id)[0]).toBe('b');
	});
});

describe('supersession', () => {
	const day = (d) => Date.UTC(2023, 0, d);
	const hits = [
		{ id: 'p', content: 'I live in Paris', validFrom: day(1), validTo: null, sourceRef: 'r1' },
		{ id: 'b', content: 'I moved to Berlin', validFrom: day(20), validTo: null, sourceRef: 'r2' },
	];
	it('parses only well-formed pairs over known ids', () => {
		const text = 'sure {"supersedes":[{"old":"p","new":"b"},{"old":"zz","new":"b"},{"old":"b","new":"b"}]}';
		expect(parseReconcile(text, hits)).toEqual([{ old: 'p', new: 'b' }]);
		expect(parseReconcile('no json here', hits)).toEqual([]);
		expect(parseReconcile('{"supersedes":"nope"}', hits)).toEqual([]);
	});
	it('closes the older memory at the newer memory date and links them', () => {
		const out = applySupersession(hits, [{ old: 'p', new: 'b' }]);
		const p = out.find((f) => f.id === 'p');
		expect(p.validTo).toBe(day(20));
		expect(p.supersededBy).toBe('b');
		expect(out.find((f) => f.id === 'b').validTo).toBeNull();
	});
	it('ignores a pair that names the older memory as the replacement', () => {
		const out = applySupersession(hits, [{ old: 'b', new: 'p' }]);
		expect(out.every((f) => f.validTo == null)).toBe(true);
	});
	it('hides memories from after the question date and reopens intervals that end later', () => {
		const closed = applySupersession(hits, [{ old: 'p', new: 'b' }]);
		const early = factsAsOf(closed, day(10));
		expect(early.map((f) => f.id)).toEqual(['p']);
		expect(early[0].validTo).toBeNull();
	});
	it('renders the temporal context oldest first with intervals and sources', () => {
		const text = renderTemporalContext(applySupersession(hits, [{ old: 'p', new: 'b' }]));
		expect(text.indexOf('Paris')).toBeLessThan(text.indexOf('Berlin'));
		expect(text).toContain('superseded 2023-01-20');
		expect(text).toContain('-> current');
		expect(text).toContain('(source r2)');
		expect(renderBaselineContext(hits)).not.toContain('2023');
	});
});

describe('grading and summary', () => {
	it('reads the verdict word and refuses to guess', () => {
		expect(parseVerdict('CORRECT')).toBe(true);
		expect(parseVerdict('WRONG')).toBe(false);
		expect(parseVerdict('INCORRECT')).toBe(false);
		expect(parseVerdict('maybe')).toBeNull();
	});
	it('excludes ungraded questions from accuracy instead of scoring them wrong', () => {
		const results = [
			{ type: 'x', modes: { baseline: { correct: true }, temporal: { correct: true } } },
			{ type: 'x', modes: { baseline: { correct: false }, temporal: { correct: null } } },
			{ type: 'y', modes: { baseline: { correct: false }, temporal: { correct: true } } },
		];
		const s = summarize(results, ['baseline', 'temporal']);
		expect(s.baseline.accuracy).toBeCloseTo(1 / 3);
		expect(s.temporal).toMatchObject({ correct: 2, graded: 2, ungraded: 1, accuracy: 1 });
		expect(s.temporal.byType.x).toMatchObject({ correct: 1, graded: 1 });
	});
});
