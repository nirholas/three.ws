import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn() }));

const { GROK_MODELS } = await import('../api/_lib/chat-models.js');
const { buildXaiUsageRow, normalizeXaiUsage, recordXaiUsage, flushXaiUsage, isHostXaiKey } = await import('../api/_lib/xai-usage.js');
const { priceTableCostMicro } = await import('../api/_lib/xai-pricing.js');
const { sql } = await import('../api/_lib/db.js');

const model = GROK_MODELS[0].id;

describe('normalizeXaiUsage', () => {
	it('reads the chat completions shape', () => {
		expect(
			normalizeXaiUsage({
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 40 },
				completion_tokens_details: { reasoning_tokens: 7 },
			}),
		).toEqual({ inputTokens: 100, outputTokens: 20, cachedTokens: 40, reasoningTokens: 7, costMicro: null });
	});

	it('reads the Responses API shape and the reported cost ticks', () => {
		const u = normalizeXaiUsage({ input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 1 }, cost_in_usd_ticks: 123_456_789 });
		expect(u).toMatchObject({ inputTokens: 10, outputTokens: 5, cachedTokens: 2, reasoningTokens: 1 });
		expect(u.costMicro).toBe(12_346);
	});

	it('tolerates a missing usage object', () => {
		expect(normalizeXaiUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, costMicro: null });
	});
});

describe('buildXaiUsageRow cost', () => {
	it('uses the API cost when xAI reports one', () => {
		const row = buildXaiUsageRow({ lane: 'chat', model, response: { id: 'resp_1', usage: { prompt_tokens: 1000, completion_tokens: 100, cost_in_usd_ticks: 50_000_000 } } });
		expect(row.cost_source).toBe('api');
		expect(row.cost_usd_micro).toBe(5_000);
		expect(row.request_id).toBe('resp_1');
	});

	it('computes from the price table when no cost is reported', () => {
		const usage = { prompt_tokens: 2000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 500 } };
		const row = buildXaiUsageRow({ lane: 'chat', model, usage });
		expect(row.cost_source).toBe('price_table');
		expect(row.cost_usd_micro).toBe(priceTableCostMicro(model, { inputTokens: 2000, cachedTokens: 500, outputTokens: 300 }));
		expect(row.cost_usd_micro).toBeGreaterThan(0);
	});

	it('prices units for media lanes and folds an unknown lane into other', () => {
		const row = buildXaiUsageRow({ lane: 'bogus', model: 'grok-imagine-image', units: 2 });
		expect(row.lane).toBe('other');
		expect(row.cost_usd_micro).toBe(40_000);
	});

	it('keeps a uuid account id and moves anything else to meta so the insert never fails on the uuid column', () => {
		const uuid = '7d1b5d1e-3a5c-4a7e-9a39-2f5b1b0c9e11';
		expect(buildXaiUsageRow({ lane: 'chat', model, usage: {}, accountId: uuid }).account_id).toBe(uuid);
		const row = buildXaiUsageRow({ lane: 'chat', model, usage: {}, accountId: 'wallet:abc' });
		expect(row.account_id).toBeNull();
		expect(row.meta.account).toBe('wallet:abc');
	});

	it('records 0 for an unpriced model with no reported cost', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(buildXaiUsageRow({ lane: 'chat', model: 'unpriced-model', usage: { prompt_tokens: 5 } }).cost_usd_micro).toBe(0);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe('recordXaiUsage buffering', () => {
	it('queues off the critical path, then writes one insert per row on flush', async () => {
		sql.mockReset();
		sql.mockResolvedValue([]);
		recordXaiUsage({ lane: 'chat', model, usage: { prompt_tokens: 10, completion_tokens: 2 } });
		recordXaiUsage({ lane: 'eval', model, usage: { prompt_tokens: 20, completion_tokens: 4 } });
		expect(sql).not.toHaveBeenCalled();
		await flushXaiUsage();
		expect(sql).toHaveBeenCalledTimes(2);
	});

	it('logs and drops on a write failure instead of throwing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		sql.mockReset();
		sql.mockRejectedValue(Object.assign(new Error('boom'), { code: '42P01' }));
		recordXaiUsage({ lane: 'chat', model, usage: { prompt_tokens: 1 } });
		await expect(flushXaiUsage()).resolves.toBeUndefined();
		expect(warn.mock.calls.some((c) => String(c[0]).includes('dropped'))).toBe(true);
		warn.mockRestore();
	});

	it('never throws on a bad input', () => {
		expect(() => recordXaiUsage(undefined)).not.toThrow();
	});
});

describe('isHostXaiKey', () => {
	it('rejects an empty key and a caller key', () => {
		expect(isHostXaiKey('')).toBe(false);
		expect(isHostXaiKey('xai-someone-elses-key')).toBe(false);
	});
});
