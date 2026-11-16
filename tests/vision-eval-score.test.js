// Scoring rules for the vision eval. Each rule mirrors how the production
// consumer acts on a reply, so a wrong rule would crown the wrong first rung.
import { describe, it, expect } from 'vitest';
import { SCORERS, scoreDiorama, mentions, percentile, summarize, parseReplyFor, QUALITY_GATE_PASS_SCORE } from '../scripts/lib/vision-eval-score.mjs';

const MOODS = ['dawn', 'day', 'dusk', 'night'];
const GROUNDS = ['grass', 'sand', 'stone'];

describe('parseReplyFor reads a reply the way its consumer does', () => {
	// A real super-vl seed-judge reply from the 2026-11-16 run: every score
	// present, the free-text critique left unquoted. seed-quality.js repairs
	// that shape and acts on the verdict, so the eval must too.
	const BARE_CRITIQUE = '{"photorealism": 4, "geometryIntegrity": 6, "textureFidelity": 3, "promptAdherence": 8, "critique": The binoculars are recognizable but the black body has a flat, featureless plastic look.}';

	it('repairs an unquoted seed-judge critique like seed-quality.js', () => {
		expect(parseReplyFor('seed_judge', BARE_CRITIQUE)).toMatchObject({ photorealism: 4, promptAdherence: 8 });
	});

	it('does not grant that repair to consumers that parse strictly', () => {
		expect(() => parseReplyFor('quality_gate', BARE_CRITIQUE.replace('critique', 'reason'))).toThrow();
	});

	it('parses a clean reply for every JSON task', () => {
		expect(parseReplyFor('forge_precheck', '{"usable":true}')).toEqual({ usable: true });
	});
});

describe('mentions', () => {
	it('matches at a word start, case-insensitive', () => {
		expect(mentions('A Mint Green alarm clock', 'clock')).toBe(true);
		expect(mentions('clockwork toy', 'clock')).toBe(true);
		expect(mentions('a peacock', 'cock')).toBe(false);
	});
});

describe('caption', () => {
	const exp = { mention: [['clock'], ['green', 'mint', 'teal']] };
	it('passes a short caption naming every group', () => {
		expect(SCORERS.caption(exp, { text: 'A mint green twin bell alarm clock.' })).toMatchObject({ schemaOk: true, correct: true });
	});
	it('fails empty and missing groups, and notes (but keeps) an over-long caption like production does', () => {
		expect(SCORERS.caption(exp, { text: '' }).schemaOk).toBe(false);
		expect(SCORERS.caption(exp, { text: 'green clock '.repeat(11) })).toMatchObject({ correct: true, detail: '22 words' });
		expect(SCORERS.caption(exp, { text: 'A red clock' })).toMatchObject({ schemaOk: true, correct: false, detail: 'missing green' });
	});
});

describe('describe', () => {
	it('requires exact transcription, whitespace and case aside', () => {
		const exp = { mention: [['sign']], transcribe: ['NO PARKING'] };
		expect(SCORERS.describe(exp, { text: 'A sign reading "No  parking".' }).correct).toBe(true);
		expect(SCORERS.describe(exp, { text: 'A sign about parking.' }).correct).toBe(false);
	});
});

describe('forge_precheck', () => {
	it('scores usable, the issue enum and the expected rejection reason', () => {
		expect(SCORERS.forge_precheck({ usable: true }, { json: { usable: true, issue: 'none' } }).correct).toBe(true);
		expect(SCORERS.forge_precheck({ usable: true }, { json: { usable: 'yes' } }).schemaOk).toBe(false);
		expect(SCORERS.forge_precheck({ usable: false, issue: ['text_screenshot'] }, { json: { usable: false, issue: 'made_up' } }).schemaOk).toBe(false);
		expect(SCORERS.forge_precheck({ usable: false, issue: ['text_screenshot'] }, { json: { usable: false, issue: 'multiple_subjects' } }).correct).toBe(false);
		expect(SCORERS.forge_precheck({ usable: false, issue: ['text_screenshot'] }, { json: { usable: true, issue: 'none' } }).detail).toBe('accepted');
	});
});

describe('review bots', () => {
	it('branch on safe before usable, like the bots do', () => {
		expect(SCORERS.image3d_review({ verdict: 'unsafe' }, { json: { safe: false, usable: true } }).correct).toBe(true);
		expect(SCORERS.avatar_review({ verdict: 'unusable' }, { json: { safe: true, usable: false } }).correct).toBe(true);
		expect(SCORERS.avatar_review({ verdict: 'ok' }, { json: { safe: 'true', usable: true } }).schemaOk).toBe(false);
	});
});

describe('quality_gate', () => {
	it('uses the production pass score', () => {
		const pass = { expect: 'pass' };
		expect(SCORERS.quality_gate(pass, { json: { score: QUALITY_GATE_PASS_SCORE } }).correct).toBe(true);
		expect(SCORERS.quality_gate(pass, { json: { score: QUALITY_GATE_PASS_SCORE - 1 } }).correct).toBe(false);
		expect(SCORERS.quality_gate({ expect: 'reject' }, { json: { score: 20 } }).correct).toBe(true);
		expect(SCORERS.quality_gate(pass, { json: { verdict: 'good' } }).schemaOk).toBe(false);
	});
});

describe('seed_judge', () => {
	const axes = { photorealism: 7, geometryIntegrity: 7, textureFidelity: 7 };
	it('needs every axis and reads promptAdherence', () => {
		expect(SCORERS.seed_judge({ expect: 'match' }, { json: { ...axes, promptAdherence: 8 } }).correct).toBe(true);
		expect(SCORERS.seed_judge({ expect: 'mismatch' }, { json: { ...axes, promptAdherence: 5 } }).correct).toBe(false);
		expect(SCORERS.seed_judge({ expect: 'match' }, { json: { promptAdherence: 9 } }).schemaOk).toBe(false);
	});
});

describe('object_detect', () => {
	const exp = { labels: [['chair'], ['table', 'desk']] };
	const objs = [{ label: 'wooden chair', box_2d: [100, 100, 500, 400] }, { label: 'desk', box_2d: [500, 0, 900, 1000] }];
	it('requires a usable 0-1000 box and label recall', () => {
		expect(SCORERS.object_detect(exp, { json: { objects: objs } }).correct).toBe(true);
		expect(SCORERS.object_detect(exp, { json: { objects: [{ label: 'chair', box_2d: [500, 0, 100, 10] }] } }).schemaOk).toBe(false);
		expect(SCORERS.object_detect(exp, { json: { objects: [{ label: 'lamp', box_2d: [0, 0, 300, 300] }] } }).correct).toBe(false);
	});
	it('drops a bad box and scores the boxes production keeps', () => {
		const out = SCORERS.object_detect(exp, { json: { objects: [...objs, { label: 'chair', box_2d: [500, 0, 100, 10] }] } });
		expect(out).toMatchObject({ schemaOk: true, correct: true });
	});
	it('does not credit a label whose box production drops', () => {
		const out = SCORERS.object_detect(exp, { json: { objects: [objs[0], { label: 'desk', box_2d: [900, 0, 100, 1000] }] } });
		expect(out.correct).toBe(false);
	});
});

describe('diorama', () => {
	const exp = { labels: [['tree'], ['house', 'cabin']] };
	const box = { left: 0, top: 0, right: 500, bottom: 500 };
	const opts = { moods: MOODS, grounds: GROUNDS };
	const good = { mood: 'dusk', ground: 'grass', objects: [{ label: 'pine', prompt: 'a tall pine tree', box }, { label: 'cabin', box: { left: 500, top: 0, right: 1000, bottom: 500 } }] };

	it('scores named-edge boxes and label recall', () => {
		expect(scoreDiorama(exp, { json: good }, opts).correct).toBe(true);
		expect(scoreDiorama(exp, { json: { ...good, objects: [{ label: 'tree', box: { left: 9, top: 0, right: 1, bottom: 5 } }] } }, opts).schemaOk).toBe(false);
	});

	it('accepts the Gemini-order array box production also reads', () => {
		const arr = { ...good, objects: [{ label: 'pine', box: [0, 0, 500, 500] }, { label: 'cabin', box: [0, 500, 500, 1000] }] };
		expect(scoreDiorama(exp, { json: arr }, opts)).toMatchObject({ schemaOk: true, correct: true });
	});

	it('drops one bad box and keeps the plan, like production', () => {
		const one = { ...good, objects: [...good.objects, { label: 'rock', box: { left: 9, top: 0, right: 1, bottom: 5 } }] };
		expect(scoreDiorama(exp, { json: one }, opts)).toMatchObject({ schemaOk: true, correct: true });
	});

	it('notes an off-schema mood or ground, which production replaces with its default', () => {
		const out = scoreDiorama(exp, { json: { ...good, mood: 'sunset' } }, opts);
		expect(out).toMatchObject({ schemaOk: true, correct: true });
		expect(out.detail).toMatch(/mood "sunset"/);
	});
});

describe('percentile and summarize', () => {
	it('uses nearest rank and ignores non-numbers', () => {
		expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
		expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
		expect(percentile([NaN], 50)).toBe(null);
	});
	it('counts errors against accuracy and the budget against in-budget', () => {
		const s = summarize([
			{ ok: true, correct: true, schemaOk: true, latencyMs: 1000, budgetMs: 5000 },
			{ ok: true, correct: true, schemaOk: true, latencyMs: 9000, budgetMs: 5000 },
			{ ok: true, correct: false, schemaOk: true, latencyMs: 2000, budgetMs: 5000 },
			{ ok: false, correct: false, schemaOk: false, latencyMs: 90000, budgetMs: 5000 },
		]);
		expect(s).toMatchObject({ n: 4, accuracy: 0.5, schema: 0.75, errorRate: 0.25, inBudget: 0.25, p50: 2000, p95: 9000 });
	});
});
