import { describe, it, expect } from 'vitest';
import {
	shareKindOf,
	grokAskState,
	grokAskQuestion,
	grokAskText,
	GROK_ASK_TEMPLATES,
} from '../src/shared/grok-ask.js';
import { xWeightedLength, xTextBudget, withShareUtm } from '../src/shared/share-targets.js';

const MODEL = { kind: 'forge', id: '0001e5f4-adff-464d-859e-95867eae2f2c', title: 'a red vintage motorcycle', prompt: 'a red vintage motorcycle' };
const AVATAR = { kind: 'avatar', id: '000027c6-127e-4de8-bea2-a4f44efa7b47', title: 'Captain Nova', description: 'space explorer' };
const ANATOMY = { kind: 'anatomy', id: 'dfebfc22-f9d8-4928-8216-c97d074113ec', title: 'Honda CD70 carburetor' };

describe('shareKindOf', () => {
	it('maps the share panel kinds to the three askable kinds', () => {
		expect(shareKindOf({ kind: 'forge' })).toBe('model');
		expect(shareKindOf({ kind: 'model' })).toBe('model');
		expect(shareKindOf({ kind: 'avatar' })).toBe('avatar');
		expect(shareKindOf({ kind: 'anatomy' })).toBe('anatomy');
		expect(shareKindOf({ kind: 'agent' })).toBeNull();
		expect(shareKindOf({ kind: 'scan' })).toBeNull();
	});
});

describe('grokAskState', () => {
	it('is ready once the entity has an id and real metadata', () => {
		expect(grokAskState(MODEL)).toEqual({ ready: true, reason: '' });
		expect(grokAskState(ANATOMY).ready).toBe(true);
	});
	it('is disabled with a reason while the entity is still generating', () => {
		const s = grokAskState({ kind: 'forge', id: '', title: '' });
		expect(s.ready).toBe(false);
		expect(s.reason).toMatch(/still generating/i);
		expect(grokAskState({ kind: 'anatomy', id: '', title: 'Turbofan' }).ready).toBe(false);
		expect(grokAskState({ kind: 'avatar', id: 'x', title: '' }).ready).toBe(false);
		expect(grokAskState({ kind: 'forge', id: 'abc', title: 'Forged creation', prompt: '' }).ready).toBe(false);
	});
	it('is not offered for kinds outside model, avatar and anatomy', () => {
		expect(grokAskState({ kind: 'agent', id: '1', title: 'Bot' })).toEqual({ ready: false, reason: '' });
	});
});

describe('templates', () => {
	const all = Object.values(GROK_ASK_TEMPLATES).flatMap((byKey) => Object.values(byKey).flat());
	it('every template ends with @grok', () => {
		for (const t of all) expect(t.trim().endsWith('@grok')).toBe(true);
	});
	it('contains no dashes and no token or market mentions', () => {
		for (const t of all) {
			expect(t).not.toMatch(/[\u2012-\u2015-]/);
			expect(t).not.toMatch(/\$|\b(coin|token|price|trade|trading|wallet|crypto|pump)\b/i);
		}
	});
});

describe('grokAskQuestion', () => {
	it('picks the vehicle set for a vehicle prompt', () => {
		expect(GROK_ASK_TEMPLATES.model.vehicle).toContain(grokAskQuestion(MODEL));
	});
	it('prefers an explicit model category over the prompt classifier', () => {
		expect(GROK_ASK_TEMPLATES.model.creature).toContain(grokAskQuestion({ ...MODEL, category: 'creature' }));
	});
	it('names the machine for anatomy designs', () => {
		const q = grokAskQuestion(ANATOMY);
		expect(q).toContain('Honda CD70 carburetor');
		expect(q.endsWith('@grok')).toBe(true);
	});
	it('is deterministic per entity', () => {
		expect(grokAskQuestion(AVATAR)).toBe(grokAskQuestion({ ...AVATAR }));
	});
});

describe('grokAskText', () => {
	it('is a short entity description then the question ending with @grok', () => {
		const url = withShareUtm('https://three.ws/anatomy/' + ANATOMY.id, 'grok-ask');
		const text = grokAskText(ANATOMY, { url });
		const [desc, question] = text.split('\n\n');
		expect(desc).toMatch(/Honda CD70 carburetor/);
		expect(desc).toMatch(/three\.ws/);
		expect(question.endsWith('@grok')).toBe(true);
	});
	it('fits the X budget by shortening the description, never the question', () => {
		const url = 'https://three.ws/forge/share/x';
		const long = { ...MODEL, title: 'motorcycle '.repeat(60), prompt: 'motorcycle '.repeat(60) };
		const text = grokAskText(long, { url });
		expect(xWeightedLength(text)).toBeLessThanOrEqual(xTextBudget({ url }));
		expect(text.endsWith('@grok')).toBe(true);
		expect(text).toContain('…');
	});
	it('strips cashtags a user typed into a prompt', () => {
		const text = grokAskText({ ...MODEL, title: 'a $ABC rocket', prompt: 'a $ABC rocket' }, { url: 'https://three.ws/a' });
		expect(text).not.toMatch(/\$ABC/);
	});
});

describe('withShareUtm', () => {
	it('adds the x share attribution and keeps existing params', () => {
		const u = new URL(withShareUtm('https://three.ws/m/abc?ref=1', 'grok-share'));
		expect(u.searchParams.get('ref')).toBe('1');
		expect(u.searchParams.get('utm_source')).toBe('x');
		expect(u.searchParams.get('utm_medium')).toBe('share');
		expect(u.searchParams.get('utm_campaign')).toBe('grok-share');
	});
	it('leaves an empty or unparseable url alone', () => {
		expect(withShareUtm('', 'grok-ask')).toBe('');
		expect(withShareUtm('not a url', 'grok-ask')).toBe('not a url');
	});
});
