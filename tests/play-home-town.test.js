// The /play lobby's pinned $THREE home town after its live refresh.
//
// Reproduces a production bug (2026-11-06): pump.fun's frontend API was down,
// so /api/pump/coin answered from its on-chain degrade tier with a market cap
// but name/symbol/image all null. The lobby spread that record over the static
// HOME_TOWN identity, so the flagship OFFICIAL card read "Unnamed coin" with a
// bare "U" monogram instead of three.ws and its art.

import { describe, it, expect } from 'vitest';
import { HOME_TOWN } from '../src/game/home-town.js';
import { liveHomeTown, mapCoins } from '../src/game/coin-records.js';

// The exact body production served for the $THREE mint during the outage.
const DEGRADED_BODY = {
	mint: HOME_TOWN.mint,
	name: null,
	symbol: null,
	image: null,
	image_uri: null,
	description: null,
	creator: null,
	complete: true,
	usd_market_cap: 743675.831040759,
	metadataSource: 'onchain',
	stale: true,
	as_of: '2026-11-06T02:32:42.807Z',
};

describe('liveHomeTown', () => {
	it('keeps the static three.ws identity when the live record has no name, symbol or art', () => {
		const card = liveHomeTown(DEGRADED_BODY);
		expect(card.name).toBe(HOME_TOWN.name);
		expect(card.symbol).toBe(HOME_TOWN.symbol);
		expect(card.image).toBe(HOME_TOWN.image);
		expect(card.official).toBe(true);
		expect(card.biome).toBe(HOME_TOWN.biome);
	});

	it('still takes the live market cap from a degraded record', () => {
		expect(liveHomeTown(DEGRADED_BODY).marketCap).toBeCloseTo(743675.83, 1);
	});

	it('takes live name, symbol and art when pump.fun supplies them', () => {
		const card = liveHomeTown({
			mint: HOME_TOWN.mint,
			name: 'three.ws',
			symbol: 'THREE',
			image_uri: 'https://ipfs.io/ipfs/bafy-live-art',
			usd_market_cap: 500000,
		});
		expect(card.symbol).toBe('THREE');
		expect(card.image).toContain('bafy-live-art');
		expect(card.marketCap).toBe(500000);
	});

	it('returns null for a record with no mint', () => {
		expect(liveHomeTown({ name: 'x' })).toBeNull();
	});
});

describe('mapCoins', () => {
	it('leaves a nameless coin blank so callers can tell it apart from a real name', () => {
		const [c] = mapCoins([{ mint: HOME_TOWN.mint, name: null }]);
		expect(c.name).toBe('');
	});
});
