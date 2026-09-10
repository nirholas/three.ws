// A 200 is not an answer: a lane whose reply is not parseable JSON must fail
// THAT LANE, not the request.
//
// describeImageJson used to run parseJsonLoose outside the failover loop, so
// describeImage returned the first HTTP-200 reply and the parse happened after a
// winner had already been picked. One chatty model therefore cost the request
// every healthy provider behind it. Measured on production 2026-09-10: the forge
// quality gate returned 0 verdicts in 10 with "vision reply was not valid JSON",
// while a rung that answers clean JSON sat untried in the same chain.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const VERDICT = { score: 71, realism: 60, completeness: 80, defects: [], reason: 'ok' };

let describeImageJson;
const fetchSpy = vi.fn();
const realFetch = globalThis.fetch;
const PNG_1PX =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Two free lanes on one host, so the chain has a rung to fall through to.
beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	process.env.NVIDIA_API_KEY = 'test-nvidia-key';
	process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
	delete process.env.OPENAI_API_KEY;
	delete process.env.GOOGLE_CLOUD_PROJECT;
	globalThis.fetch = fetchSpy;
	({ describeImageJson } = await import('../api/_lib/vision.js'));
});

afterAll(() => {
	globalThis.fetch = realFetch;
	delete process.env.NVIDIA_API_KEY;
	delete process.env.OPENROUTER_API_KEY;
});

beforeEach(() => {
	fetchSpy.mockReset();
});

function reply(content) {
	return {
		ok: true,
		status: 200,
		json: async () => ({
			choices: [{ message: { content } }],
			usage: { prompt_tokens: 10, completion_tokens: 10 },
		}),
	};
}

function call() {
	return describeImageJson({
		prompt: 'score this',
		imageBase64: PNG_1PX,
		mimeType: 'image/png',
		timeoutMs: 5000,
		deadlineMs: 9000,
	});
}

describe('describeImageJson lane acceptance', () => {
	it('parses a fenced JSON reply', async () => {
		fetchSpy.mockResolvedValueOnce(reply('```json\n' + JSON.stringify(VERDICT) + '\n```'));
		const out = await call();
		expect(out.json).toEqual(VERDICT);
	});

	it('falls through to the next rung when a lane narrates instead of answering', async () => {
		// A reasoning model narrating around braces: the outermost-span fallback
		// grabs from the first brace in the thinking block and cannot parse. This
		// is the regression that took the forge quality gate to 0/10 in prod.
		const chatty = '<think>{the user wants a score} I will now decide</think> the score is high';
		fetchSpy
			.mockResolvedValueOnce(reply(chatty))
			.mockResolvedValueOnce(reply(JSON.stringify(VERDICT)));

		const out = await call();

		// The chatty lane lost, the next rung answered, and the caller got JSON.
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(out.json).toEqual(VERDICT);
	});

	it('falls through an empty reply, which is how a reasoning model fails in production', async () => {
		// Observed live on 2026-09-10 against /api/vision: the winning lane was
		// openrouter nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free and it
		// returned text: ''. The model spends its budget on reasoning tokens and
		// leaves message.content empty, which extractText faithfully reports as an
		// empty string. An empty reply is a failed lane, not an answer.
		fetchSpy
			.mockResolvedValueOnce(reply(''))
			.mockResolvedValueOnce(reply(JSON.stringify(VERDICT)));

		const out = await call();

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(out.json).toEqual(VERDICT);
	});

	it('throws only once every rung has failed the shape test', async () => {
		fetchSpy.mockResolvedValue(reply('not json at all'));

		await expect(call()).rejects.toThrow();

		// Every lane in the chain was tried, not just the first.
		expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
	});
});
