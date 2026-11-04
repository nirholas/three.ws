// The sniper experiment's LLM judge records what each verdict cost, so net
// profit can subtract inference spend. Provider usage fields (OpenRouter
// returns usage.prompt_tokens, completion_tokens and, with usage accounting
// on, usage.cost in USD) land in sniper_llm_verdicts next to the verdict.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inserts = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		if (String(strings[0]).includes('insert into sniper_llm_verdicts')) inserts.push({ text: strings.join('?'), values });
		return [];
	}),
}));
vi.mock('../workers/agent-sniper/judge-knowledge.js', () => ({
	buildKnowledgePack: vi.fn(async () => ({ tier: 'standard', depth: 'base', block: '' })),
}));
vi.mock('../api/_lib/sentiment-scout.js', () => ({ scoutJudgeBlock: vi.fn(async () => '') }));
vi.mock('../api/_lib/market-realness.js', () => ({ assessMarketRealness: vi.fn(() => null) }));

const { judgeLaunch, usageFromBody, _resetLlmJudge } = await import('../workers/agent-sniper/llm-judge.js');

const replyBody = {
	id: 'gen-1',
	model: 'x-ai/grok-4-fast',
	choices: [{ message: { content: '{"buy":true,"confidence":0.72,"thesis":"organic holder growth"}' } }],
	usage: { prompt_tokens: 812, completion_tokens: 41, total_tokens: 853, cost: 0.000231 },
};

describe('usageFromBody', () => {
	it('reads tokens and the provider-reported USD cost', () => {
		expect(usageFromBody(replyBody)).toEqual({ inputTokens: 812, outputTokens: 41, costUsd: 0.000231 });
	});
	it('keeps unknown fields null instead of inventing a price', () => {
		expect(usageFromBody({ usage: { prompt_tokens: 10, completion_tokens: 2 } })).toEqual({
			inputTokens: 10,
			outputTokens: 2,
			costUsd: null,
		});
		expect(usageFromBody({})).toEqual({ inputTokens: null, outputTokens: null, costUsd: null });
	});
});

describe('judgeLaunch records the cost of the verdict', () => {
	beforeEach(() => {
		inserts.length = 0;
		_resetLlmJudge();
		process.env.OPENROUTER_API_KEY = 'test-key';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url, init) => {
				expect(JSON.parse(init.body).usage).toEqual({ include: true });
				return new Response(JSON.stringify(replyBody), { status: 200 });
			}),
		);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('stores input tokens, output tokens and cost with the verdict row', async () => {
		const verdict = await judgeLaunch({ mint: 'THREEsynthetic1111111111111111111111111111' }, { id: 's1', llm_model: 'x-ai/grok-4-fast', network: 'mainnet' });
		expect(verdict.buy).toBe(true);
		expect(verdict.inputTokens).toBe(812);
		await new Promise((r) => setTimeout(r, 0));
		expect(inserts).toHaveLength(1);
		expect(inserts[0].text).toContain('input_tokens');
		expect(inserts[0].text).toContain('output_tokens');
		expect(inserts[0].text).toContain('cost_usd');
		expect(inserts[0].values).toEqual(expect.arrayContaining([812, 41, 0.000231]));
	});
});
