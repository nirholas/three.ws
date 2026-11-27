// A director rewrite that comes back empty, far too long, off-topic, or as a
// refusal must be discarded so the user's own prompt drives the reference
// image. Before 2026-11-26 a refusal ("I cannot help with that request.") was a
// finished sentence longer than a short prompt, so it passed every check and
// would have been painted as the brief; an off-topic reply did the same.
//
// The chain is stubbed at the llmComplete boundary; the guards, the director
// tail and directForReference are the real code.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ chain: vi.fn() }));

vi.mock('../../api/_lib/watsonx.js', () => ({
	watsonxConfig: () => ({ configured: false }),
	watsonxChatComplete: vi.fn(),
}));
vi.mock('../../api/_lib/llm.js', () => ({
	llmComplete: (...args) => state.chain(...args),
}));

const { directPrompt, directorRewriteProblem } = await import('../../api/_mcp-studio/forge-client.js');
const gpt = await import('../../api/_mcp-studio/gpt-forge-client.js');
const { directForReference } = await import('../../api/_lib/forge-direction.js');
const { isRefusal, isOffTopic } = await import('../../api/_lib/prompt-rewrite-guards.js');

const RAW = 'a red fox';
const GOOD =
	'A red fox standing alert, dense russet fur with a white chest and black-tipped ears, centered on a seamless light-grey sweep, soft even studio light, one subject only.';

const BAD = {
	empty: '   ',
	too_long: `A red fox ${'with richly detailed russet fur '.repeat(40)}on a plain background.`,
	refusal: "I'm sorry, but I can't help with creating that image. Please try a different request.",
	refusal_mid: 'Here is my answer to your idea: I cannot help with that request, as it violates our content policy.',
	off_topic:
		'A weathered oak rocking chair with brass-capped runners, centered on a seamless light-grey sweep, soft even studio light, one subject only.',
};

beforeEach(() => {
	state.chain.mockReset();
});

describe('each bad director reply falls back to the user prompt', () => {
	for (const [name, reply] of Object.entries(BAD)) {
		it(`${name}: the user's prompt goes forward`, async () => {
			state.chain.mockResolvedValue({ text: reply, provider: 'groq', model: 'x' });
			const reasons = [];
			const out = await directPrompt('system', RAW, { onFallback: (f) => reasons.push(f.reason) });
			expect(out).toBeNull();
			const expected = name === 'refusal_mid' ? 'refusal' : name;
			expect(reasons).toEqual([expected]);

			const run = await directForReference(RAW, { direct: directPrompt });
			expect(run.prompt).toBe(RAW);
			expect(run.direction).toMatchObject({ status: 'skipped', reason: expected });
		});
	}

	it('the ChatGPT clone discards a refusal too', async () => {
		state.chain.mockResolvedValue({ text: BAD.refusal, provider: 'groq', model: 'x' });
		expect(await gpt.directPrompt('system', RAW)).toBeNull();
	});

	it('a good rewrite is still used and reported as directed', async () => {
		state.chain.mockResolvedValue({ text: GOOD, provider: 'groq', model: 'x' });
		const run = await directForReference(RAW, { direct: directPrompt });
		expect(run.prompt).toBe(GOOD);
		expect(run.direction.status).toBe('directed');
	});

	it('direction off never calls the chain and says so', async () => {
		const run = await directForReference(RAW, { enabled: false, direct: directPrompt });
		expect(run).toEqual({ prompt: RAW, direction: { status: 'off' } });
		expect(state.chain).not.toHaveBeenCalled();
	});
});

describe('directorRewriteProblem names the new cases', () => {
	it('refusal and off_topic', () => {
		expect(directorRewriteProblem(BAD.refusal, RAW)).toBe('refusal');
		expect(directorRewriteProblem(BAD.off_topic, RAW)).toBe('off_topic');
		expect(directorRewriteProblem(GOOD, RAW)).toBeNull();
	});
});

describe('guards', () => {
	it('isRefusal catches openings and buried refusals, not briefs that say "cannot"', () => {
		for (const t of [
			'I cannot create that.',
			'I can’t help with this.',
			'Sorry, I am unable to do that.',
			'As an AI language model, I do not generate images.',
			'"I won\'t make that."',
			'Unfortunately, that is not something I can draw.',
		]) {
			expect(isRefusal(t), t).toBe(true);
		}
		expect(isRefusal(GOOD)).toBe(false);
		expect(isRefusal('A sealed steel safe whose interior cannot be seen, centered, soft light.')).toBe(false);
	});

	it('isOffTopic keeps synonyms of plurals and suffixes, skips prompts it cannot judge', () => {
		expect(isOffTopic('Three fluffy puppy figurines... a puppy sitting.', 'cute puppies')).toBe(false);
		expect(isOffTopic('A hand-carved walnut bowl.', 'carving of a bowl')).toBe(false);
		expect(isOffTopic(GOOD, 'a big one')).toBe(false);
		expect(isOffTopic('A black cat sitting, centered.', 'un chat noir élégant')).toBe(false);
		expect(isOffTopic(BAD.off_topic, RAW)).toBe(true);
	});
});
