// Tests for @three-ws/hood-portfolios-sdk.
//
// The transport is injected, so these exercise the client's own behaviour (URL
// construction, argument validation, error surfacing) without a network. The one
// test that matters most compares this package's canonicaliser against the
// server's actual implementation: they must agree byte for byte, because the
// hash of those bytes is what a portfolio is published under, and a divergence
// would only ever show up as an on-chain commitment that does not match the
// document it came from.

import { describe, it, expect } from 'vitest';
import { canonicalise as serverCanonicalise } from '../../../api/_lib/hood-portfolios.js';
import {
	ASSET_CLASSES,
	CHAIN_ID,
	HoodPortfolios,
	HoodPortfoliosError,
	canonicalise,
} from '../src/index.js';

/** A fetch stand-in that records calls and replays a scripted response. */
function stubFetch(response = { data: { ok: true } }, status = 200) {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, init });
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => response,
		};
	};
	return { fetch, calls };
}

describe('canonicalise', () => {
	it('matches the server implementation exactly', () => {
		const cases = [
			{ z: 1, a: 2 },
			{ nested: { b: [3, { d: 4, c: 5 }], a: 'x' } },
			{ n: null, t: true, s: 'with "quotes" and \\ backslash', f: 1.5 },
			{ empty: {}, list: [] },
			{ unicode: 'naïve café 日本語' },
		];
		for (const c of cases) {
			expect(canonicalise(c)).toBe(serverCanonicalise(c));
		}
	});

	it('is stable under key reordering', () => {
		expect(canonicalise({ a: 1, b: 2 })).toBe(canonicalise({ b: 2, a: 1 }));
	});

	it('distinguishes values JSON.stringify would render alike', () => {
		expect(canonicalise({ a: '1' })).not.toBe(canonicalise({ a: 1 }));
	});
});

describe('constants', () => {
	it('targets Robinhood Chain', () => {
		expect(CHAIN_ID).toBe(4663);
		expect(ASSET_CLASSES).toContain('rwa-equity');
		expect(ASSET_CLASSES).toContain('crypto-native');
	});
});

describe('HoodPortfolios', () => {
	it('builds the universe query from its options', async () => {
		const { fetch, calls } = stubFetch({ data: { tokens: [] } });
		const hood = new HoodPortfolios({ fetch });
		await hood.universe({ assetClass: ['rwa-equity', 'stablecoin'], limit: 5, selectableOnly: true });

		const url = new URL(calls[0].url);
		expect(url.pathname).toBe('/api/v1/hood-portfolios/universe');
		expect(url.searchParams.get('class')).toBe('rwa-equity,stablecoin');
		expect(url.searchParams.get('limit')).toBe('5');
		expect(url.searchParams.get('selectable')).toBe('1');
	});

	it('omits query params that were not supplied', async () => {
		const { fetch, calls } = stubFetch({ data: {} });
		await new HoodPortfolios({ fetch }).universe();
		expect(new URL(calls[0].url).search).toBe('');
	});

	it('unwraps the data envelope', async () => {
		const { fetch } = stubFetch({ data: { chainOk: true, head: 42 } });
		const out = await new HoodPortfolios({ fetch }).health();
		expect(out).toEqual({ chainOk: true, head: 42 });
	});

	it('surfaces the API error code rather than a bare status', async () => {
		const { fetch } = stubFetch({ error: 'screen_failed', error_description: 'not enough usable constituents' }, 422);
		const hood = new HoodPortfolios({ fetch });
		await expect(hood.generate('anything')).rejects.toMatchObject({
			name: 'HoodPortfoliosError',
			status: 422,
			code: 'screen_failed',
			message: 'not enough usable constituents',
		});
	});

	it('refuses an empty prompt before making a request', async () => {
		const { fetch, calls } = stubFetch();
		await expect(new HoodPortfolios({ fetch }).generate('   ')).rejects.toBeInstanceOf(HoodPortfoliosError);
		expect(calls).toHaveLength(0);
	});

	it('refuses a one-legged backtest before making a request', async () => {
		const { fetch, calls } = stubFetch();
		const hood = new HoodPortfolios({ fetch });
		await expect(hood.backtest({ constituents: [{ address: '0x1', weightBps: 10_000 }] })).rejects.toBeInstanceOf(
			HoodPortfoliosError,
		);
		expect(calls).toHaveLength(0);
	});

	it('defaults the backtest schedule and window', async () => {
		const { fetch, calls } = stubFetch({ data: { ok: true } });
		await new HoodPortfolios({ fetch }).backtest({
			constituents: [
				{ address: '0xa', weightBps: 5000 },
				{ address: '0xb', weightBps: 5000 },
			],
		});
		expect(JSON.parse(calls[0].init.body)).toMatchObject({ rebalanceDays: 30, days: 90 });
	});

	it('honours a custom base URL without doubling slashes', async () => {
		const { fetch, calls } = stubFetch({ data: {} });
		await new HoodPortfolios({ fetch, baseUrl: 'http://localhost:3000/' }).health();
		expect(calls[0].url).toBe('http://localhost:3000/api/v1/hood-portfolios/health');
	});

	it('falls back to the global fetch when none is supplied', () => {
		// `null` means "not provided", so it must fall through rather than fail:
		// the common case is a browser or a modern Node with fetch built in.
		expect(() => new HoodPortfolios({ fetch: null })).not.toThrow();
		expect(() => new HoodPortfolios()).not.toThrow();
	});

	it('refuses a transport that is not callable', () => {
		expect(() => new HoodPortfolios({ fetch: 'not a function' })).toThrow(HoodPortfoliosError);
	});
});
