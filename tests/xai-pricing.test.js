import { describe, it, expect } from 'vitest';
import { GROK_MODELS, XAI_MEDIA_MODELS } from '../api/_lib/chat-models.js';
import { xaiPrice, priceTableCostMicro, pricedModelIds, LONG_CONTEXT_TOKENS } from '../api/_lib/xai-pricing.js';

describe('xai-pricing coverage', () => {
	it('prices every model in GROK_MODELS', () => {
		const missing = GROK_MODELS.filter((m) => !xaiPrice(m.id)).map((m) => m.id);
		expect(missing, `unpriced Grok models: ${missing.join(', ')}`).toEqual([]);
	});

	it('prices every image, video and voice model', () => {
		const missing = XAI_MEDIA_MODELS.filter((m) => !xaiPrice(m.id)).map((m) => m.id);
		expect(missing, `unpriced media models: ${missing.join(', ')}`).toEqual([]);
		expect(pricedModelIds().length).toBeGreaterThanOrEqual(GROK_MODELS.length + XAI_MEDIA_MODELS.length);
	});

	it('gives every text model a cached input price at or below its input price', () => {
		for (const m of GROK_MODELS) {
			expect(m.cachedInputPrice, m.id).toBeGreaterThan(0);
			expect(m.cachedInputPrice, m.id).toBeLessThanOrEqual(m.price[0]);
		}
	});
});

describe('priceTableCostMicro', () => {
	const flagship = GROK_MODELS[0];

	it('prices uncached, cached and output tokens at their own rates', () => {
		const micro = priceTableCostMicro(flagship.id, { inputTokens: 100_000, cachedTokens: 40_000, outputTokens: 10_000 });
		const expected = 60_000 * flagship.price[0] + 40_000 * flagship.cachedInputPrice + 10_000 * flagship.price[1];
		expect(micro).toBe(Math.round(expected));
	});

	it('bills reasoning tokens as output', () => {
		const base = priceTableCostMicro(flagship.id, { inputTokens: 1000, outputTokens: 500 });
		const withReasoning = priceTableCostMicro(flagship.id, { inputTokens: 1000, outputTokens: 500, reasoningTokens: 500 });
		expect(withReasoning - base).toBe(Math.round(500 * flagship.price[1]));
	});

	it('doubles every token of a request whose prompt reaches the long-context threshold', () => {
		const short = priceTableCostMicro(flagship.id, { inputTokens: LONG_CONTEXT_TOKENS - 1, outputTokens: 0 });
		const long = priceTableCostMicro(flagship.id, { inputTokens: LONG_CONTEXT_TOKENS, outputTokens: 0 });
		expect(long).toBe(Math.round(LONG_CONTEXT_TOKENS * flagship.price[0] * 2));
		expect(long).toBeGreaterThan(short * 1.9);
	});

	it('prices media by unit', () => {
		const image = XAI_MEDIA_MODELS.find((m) => m.kind === 'image');
		const video = XAI_MEDIA_MODELS.find((m) => m.kind === 'video');
		expect(priceTableCostMicro(image.id, { units: 3 })).toBe(Math.round(3 * image.price * 1e6));
		expect(priceTableCostMicro(video.id, { units: 10 })).toBe(Math.round(10 * video.price * 1e6));
	});

	it('returns null for an unpriced model', () => {
		expect(priceTableCostMicro('not-a-real-model', { inputTokens: 10 })).toBeNull();
	});
});
