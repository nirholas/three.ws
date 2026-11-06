// Coin records for the /play lobby and worlds: the normalizer that turns a raw
// /api/pump/* coin into the compact shape the lobby and world consume, and the
// overlay that refreshes the pinned $THREE home town from its live record.
//
// Kept free of three.js and DOM imports so the lobby's data rules can be unit
// tested without booting the world.

import { proxiedImageURL } from '../ipfs.js';
import { HOME_TOWN } from './home-town.js';

// Delivered width for coin art fetched through the image proxy.
export const COIN_ART_WIDTH = 512;

// Normalize a raw pump.fun coin (trending feed or search results, both share
// the same upstream shape) into the compact record the lobby/world consume.
export function mapCoins(raw) {
	const list = Array.isArray(raw) ? raw : raw.data || raw.coins || raw.items || [];
	return list.map((c) => ({
		mint: c.mint || c.address,
		// Blank, never a stand-in like "Unnamed coin": every display site already
		// supplies its own fallback, and a stand-in is indistinguishable from a
		// real name to the merges below and to enter()'s identity backfill.
		name: (c.name || '').trim(),
		symbol: (c.symbol || '').trim(),
		// Coin art becomes a WebGL texture a few hundred pixels tall. 512 is
		// generous for that and keeps a creator's full-size upload out of both
		// the download and GPU memory.
		image: proxiedImageURL(c.image_uri || c.image || c.imageUri || c.logo || '', c.mint || c.address || '', { width: COIN_ART_WIDTH }),
		marketCap: c.usd_market_cap || c.market_cap_usd || c.marketCap || 0,
	})).filter((c) => c.mint);
}

// The pinned home-town card after a live refresh from /api/pump/coin. Only
// fields the live record actually carries replace the static identity: when
// pump.fun is down the endpoint answers from its on-chain tier with a market
// cap but a null name/symbol/image, and spreading those blanks over HOME_TOWN
// turned the flagship card into a nameless "U" monogram.
export function liveHomeTown(rawCoin) {
	const [coin] = mapCoins([rawCoin]);
	if (!coin?.mint) return null;
	return {
		...HOME_TOWN,
		mint: coin.mint,
		name: coin.name || HOME_TOWN.name,
		symbol: coin.symbol || HOME_TOWN.symbol,
		image: coin.image || HOME_TOWN.image,
		marketCap: coin.marketCap || 0,
		official: true,
	};
}
