import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import {
	buildForgeQuote,
	buildForgeQuoteTable,
	payToKeepEnabled,
	keepActionForTier,
} from '../../api/_lib/forge-quote.js';
import { TIERS, priceUsdcForTier, priceUsdcForOutput, BACKENDS } from '../../api/_lib/forge-tiers.js';
import { priceForAction } from '../../api/_lib/pricing/catalog.js';
import { describeQuote } from '../../src/forge-keep.js';

const OFF = {};
const ON = { FORGE_PAY_TO_KEEP: 'on' };

// A lane the router treats as platform-keyed (not BYOK) and one that is BYOK.
const platformLane = Object.values(BACKENDS).find((b) => b.byok === false && b.paths.includes('image'));
const byokLane = Object.values(BACKENDS).find((b) => b.byok && !b.houseKeyEnv && b.paths.includes('image'));

describe('forge cost preview', () => {
	it('prices High from the same catalog the gate charges', () => {
		const q = buildForgeQuote({ tier: 'high', backend: platformLane.id, env: OFF });
		expect(q.generation.model).toBe('hold_or_pay');
		expect(q.generation.usd).toBe(Number(priceForAction('forge.high').usd));
		expect(q.generation.usd).toBe(Number(priceUsdcForTier(TIERS.high)));
		expect(q.generation.gate.holder_tier).toBeTruthy();
		expect(q.total_usd).toBe(q.generation.usd);
	});

	it('reports draft and standard as free on a platform lane', () => {
		for (const tier of ['draft', 'standard']) {
			const q = buildForgeQuote({ tier, backend: platformLane.id, env: OFF });
			expect(q.generation.model).toBe('free');
			expect(q.generation.usd).toBe(0);
			expect(q.total_usd).toBe(0);
		}
	});

	it('never charges on a BYOK lane and surfaces the vendor credit estimate', () => {
		const q = buildForgeQuote({ tier: 'high', backend: byokLane.id, env: OFF });
		expect(q.generation.model).toBe('byok');
		expect(q.generation.usd).toBe(0);
		expect(q.keep.applies).toBe(false);
	});

	it('adds the Game-Ready export price only when asked', () => {
		const without = buildForgeQuote({ tier: 'standard', backend: platformLane.id, env: OFF });
		const withGr = buildForgeQuote({ tier: 'standard', backend: platformLane.id, gameready: true, env: OFF });
		expect(without.gameready).toBeNull();
		expect(withGr.gameready.usd).toBe(Number(priceUsdcForOutput('gameready')));
		expect(withGr.total_usd).toBe(withGr.gameready.usd);
	});

	it('defaults pay-to-keep off and leaves totals untouched', () => {
		expect(payToKeepEnabled({})).toBe(false);
		expect(payToKeepEnabled({ FORGE_PAY_TO_KEEP: 'off' })).toBe(false);
		const q = buildForgeQuote({ tier: 'standard', backend: platformLane.id, env: OFF });
		expect(q.keep).toEqual({ enabled: false, applies: false, action: null, usd: null });
	});

	it('prices keep at the tier price when enabled, never for High', () => {
		expect(payToKeepEnabled(ON)).toBe(true);
		const std = buildForgeQuote({ tier: 'standard', backend: platformLane.id, env: ON });
		expect(std.keep.action).toBe('forge.keep.standard');
		expect(std.keep.usd).toBe(Number(priceUsdcForTier(TIERS.standard)));
		expect(std.total_usd).toBe(std.keep.usd);
		const draft = buildForgeQuote({ tier: 'draft', backend: platformLane.id, env: ON });
		expect(draft.keep.usd).toBe(Number(priceUsdcForTier(TIERS.draft)));
		const high = buildForgeQuote({ tier: 'high', backend: platformLane.id, env: ON });
		expect(high.keep.applies).toBe(false);
		expect(keepActionForTier('high')).toBeNull();
	});

	it('quotes every tier in a table', () => {
		const t = buildForgeQuoteTable({ backend: platformLane.id, env: OFF });
		expect(t.map((q) => q.tier.id)).toEqual(['draft', 'standard', 'high']);
	});

	it('falls back to defaults for unknown path and tier', () => {
		const q = buildForgeQuote({ path: 'nope', tier: 'nope', env: OFF });
		expect(q.path).toBe('image');
		expect(q.tier.id).toBe('standard');
	});

	it('describes the quote in plain words', () => {
		const high = describeQuote(buildForgeQuote({ tier: 'high', backend: platformLane.id, env: OFF }));
		expect(high).toMatch(/\$0\.50 in \$THREE per generation/);
		const free = describeQuote(buildForgeQuote({ tier: 'draft', backend: platformLane.id, env: OFF }));
		expect(free).toBe('Free to generate');
		const keep = describeQuote(buildForgeQuote({ tier: 'standard', backend: platformLane.id, env: ON }));
		expect(keep).toMatch(/keep the original file for \$0\.15/);
	});
});

describe('GET /api/forge-quote', () => {
	async function call(url) {
		const { default: handler } = await import('../../api/forge-quote.js');
		const stream = Readable.from([]);
		stream.method = 'GET';
		stream.url = url;
		stream.headers = { 'x-forwarded-for': '203.0.113.50' };
		const res = {
			statusCode: 200,
			headers: {},
			body: null,
			setHeader(n, v) {
				this.headers[String(n).toLowerCase()] = v;
			},
			end(b) {
				this.body = b ?? null;
			},
		};
		await handler(stream, res);
		return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, headers: res.headers };
	}

	it('returns a quote and the full table', async () => {
		const one = await call('/api/forge-quote?tier=high');
		expect(one.status).toBe(200);
		expect(one.json.tier.id).toBe('high');
		expect(one.headers['cache-control']).toMatch(/^private/);
		const table = await call('/api/forge-quote?table=1');
		expect(table.json.quotes).toHaveLength(3);
	});

	it('rejects bad input at the boundary', async () => {
		expect((await call('/api/forge-quote?tier=ultra')).json.error).toBe('invalid_tier');
		expect((await call('/api/forge-quote?path=zzz')).json.error).toBe('invalid_path');
		expect((await call('/api/forge-quote?backend=nope')).json.error).toBe('invalid_backend');
	});
});
