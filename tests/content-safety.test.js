import { describe, it, expect, vi } from 'vitest';

// The public-listing safety screen must FAIL CLOSED: a model is `clear` only when
// every signal answered and came back clean. These pin the verdict combiner, the
// rubric parser (a vision reply that omits a key must not read as "clean"), and
// the end-to-end screenCreation with stubbed signals.

vi.mock('../api/_lib/vision.js', () => ({
	describeImage: vi.fn(),
	visionConfigured: () => true,
	parseJsonLoose: (t) => JSON.parse(String(t).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')),
}));
vi.mock('../api/_lib/publish-safety.js', () => ({
	classifyPublishSafety: vi.fn(),
	publishSafetyConfig: () => ({ enabled: true, key: 'k' }),
}));

const cs = await import('../api/_lib/content-safety.js');

const clean = { checked: true, flagged: false, categories: [] };
const CLEAN_RUBRIC = JSON.stringify({ sexual_explicit: false, sexual_minors: false, graphic_violence: false, hate_symbols: false, self_harm: false });

describe('parseImageRubric', () => {
	it('accepts a full boolean rubric', () => {
		expect(cs.parseImageRubric(CLEAN_RUBRIC).sexual_explicit).toBe(false);
	});
	it('accepts a fenced reply', () => {
		expect(cs.parseImageRubric('```json\n' + CLEAN_RUBRIC + '\n```').self_harm).toBe(false);
	});
	it('rejects a reply missing a key, so the lane fails instead of reading as clean', () => {
		const partial = JSON.stringify({ sexual_explicit: false });
		expect(() => cs.parseImageRubric(partial)).toThrow(/sexual_minors/);
	});
	it('rejects non-boolean values', () => {
		const bad = JSON.stringify({ sexual_explicit: 'no', sexual_minors: false, graphic_violence: false, hate_symbols: false, self_harm: false });
		expect(() => cs.parseImageRubric(bad)).toThrow(/sexual_explicit/);
	});
	it('rejects arrays and prose', () => {
		expect(() => cs.parseImageRubric('[]')).toThrow();
		expect(() => cs.parseImageRubric('looks fine to me')).toThrow();
	});
});

describe('combineSignals', () => {
	it('is clear only when every signal answered clean', () => {
		expect(cs.combineSignals({ text: clean, image: clean }).verdict).toBe('clear');
		expect(cs.combineSignals({ text: clean, image: null }).verdict).toBe('clear');
	});
	it('is undecided, never clear, when any signal could not answer', () => {
		const out = cs.combineSignals({ text: clean, image: { checked: false, flagged: false, categories: [], error: 'timeout' } });
		expect(out.verdict).toBe('undecided');
		expect(out.reasons).toEqual(['timeout']);
		expect(cs.combineSignals({ text: { checked: false, flagged: false, categories: [] }, image: clean }).verdict).toBe('undecided');
	});
	it('blocks on any flagged signal even when the other one is unanswered', () => {
		const out = cs.combineSignals({
			text: { checked: false, flagged: false, categories: [] },
			image: { checked: true, flagged: true, categories: ['graphic_violence'] },
		});
		expect(out.verdict).toBe('blocked');
		expect(out.categories).toEqual(['graphic_violence']);
		expect(out.csam).toBe(false);
	});
	it('marks a sexual_minors image verdict as csam', () => {
		const out = cs.combineSignals({ text: clean, image: { checked: true, flagged: true, categories: ['sexual_minors'] } });
		expect(out.verdict).toBe('blocked');
		expect(out.csam).toBe(true);
	});
	it('marks a NemoGuard minor category as csam', () => {
		const out = cs.combineSignals({ text: { checked: true, flagged: true, categories: ['Sexual (minor)'] }, image: null });
		expect(out.csam).toBe(true);
	});
});

describe('absolutePreviewUrl', () => {
	it('keeps https, resolves root-relative, refuses http and junk', () => {
		expect(cs.absolutePreviewUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
		expect(cs.absolutePreviewUrl('/cdn/x.png')).toBe('https://three.ws/cdn/x.png');
		expect(cs.absolutePreviewUrl('//cdn.example/a.png')).toBe('https://cdn.example/a.png');
		expect(cs.absolutePreviewUrl('http://cdn.example/a.png')).toBeNull();
		expect(cs.absolutePreviewUrl('')).toBeNull();
		expect(cs.absolutePreviewUrl(null)).toBeNull();
	});
});

describe('screenImage', () => {
	it('flags the rubric categories the model returned true', async () => {
		const describe = vi.fn(async ({ accept }) => ({ accepted: accept(JSON.stringify({ sexual_explicit: true, sexual_minors: false, graphic_violence: false, hate_symbols: false, self_harm: false })), model: 'm' }));
		const out = await cs.screenImage('https://x.test/a.png', { describe });
		expect(out).toMatchObject({ checked: true, flagged: true, categories: ['sexual_explicit'], model: 'm' });
	});
	it('reports unchecked, not clean, when the vision chain throws', async () => {
		const describe = vi.fn(async () => { throw new Error('all lanes down'); });
		const out = await cs.screenImage('https://x.test/a.png', { describe });
		expect(out).toMatchObject({ checked: false, flagged: false });
		expect(out.error).toMatch(/all lanes down/);
	});
	it('reports unchecked when vision is not configured', async () => {
		const out = await cs.screenImage('https://x.test/a.png', { describe: vi.fn(), configured: () => false });
		expect(out).toMatchObject({ checked: false, error: 'vision_unconfigured' });
	});
});

describe('screenText', () => {
	it('treats an empty prompt as no signal, not as unchecked', async () => {
		const out = await cs.screenText('   ', { classify: vi.fn() });
		expect(out).toMatchObject({ checked: true, flagged: false, skipped: true });
	});
	it('is unchecked when the classifier has no key', async () => {
		const out = await cs.screenText('a robot', { classify: vi.fn(), config: () => ({ enabled: false, key: null }) });
		expect(out).toMatchObject({ checked: false, error: 'text_classifier_unconfigured' });
	});
	it('passes the classifier verdict through', async () => {
		const classify = vi.fn(async () => ({ checked: true, flagged: true, categories: ['Violence'], model: 'ng' }));
		const out = await cs.screenText('x', { classify, config: () => ({ enabled: true, key: 'k' }) });
		expect(out).toMatchObject({ checked: true, flagged: true, categories: ['Violence'] });
	});
});

describe('screenCreation', () => {
	it('screens the image only when there is a preview, and clears a clean model', async () => {
		const imageFn = vi.fn(async () => ({ ...clean, model: 'v' }));
		const out = await cs.screenCreation({ prompt: 'a lamp', previewImageUrl: 'https://x.test/a.png' }, { screenTextFn: async () => ({ ...clean, model: 't' }), screenImageFn: imageFn });
		expect(out.verdict).toBe('clear');
		expect(out.models).toEqual(['t', 'v']);
		expect(imageFn).toHaveBeenCalledOnce();
	});
	it('skips the image signal with no preview and decides on text alone', async () => {
		const imageFn = vi.fn();
		const out = await cs.screenCreation({ prompt: 'a lamp', previewImageUrl: null }, { screenTextFn: async () => clean, screenImageFn: imageFn });
		expect(out.verdict).toBe('clear');
		expect(imageFn).not.toHaveBeenCalled();
	});
	it('is undecided when the image lane is down, however clean the text is', async () => {
		const out = await cs.screenCreation(
			{ prompt: 'a lamp', previewImageUrl: 'https://x.test/a.png' },
			{ screenTextFn: async () => clean, screenImageFn: async () => ({ checked: false, flagged: false, categories: [], error: 'vision_unconfigured' }) },
		);
		expect(out.verdict).toBe('undecided');
	});
});
