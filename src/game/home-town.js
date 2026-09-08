// The flagship town — three.ws's own $THREE community.
//
// Every pump.fun coin gets a 3D world on demand, but the platform's home token
// deserves a permanent, curated home: a town that is always pinned to the top
// of the /play lobby (even when it isn't trending), badged as official, and
// dressed in a fixed signature biome instead of the seed-lottery one. This is
// the front door of the metaverse — the world a first-time visitor should land
// in. Keeping its identity in one module means the lobby card, the deep link,
// and the world dressing all agree on a single source of truth.
//
// `image` is a sensible static fallback (the token's IPFS art); the lobby
// refreshes name/symbol/art/market-cap live from /api/pump/coin so the pinned
// card is never stale. `biome` forces the world archetype — see world-env.js.

export const HOME_TOWN = {
	mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
	name: 'three.ws',
	symbol: 'three',
	// Served through the same-origin /api/img proxy (multi-gateway IPFS retry +
	// immutable edge cache) so the front-door art never depends on one gateway.
	//
	// `w=512` matters: the pinned original is a 567 KB PNG, and without a width
	// the proxy hands back every one of those bytes. mapCoins() asks for 512 for
	// exactly this reason (COIN_ART_WIDTH in coincommunities.js) but this literal
	// predates it, so the ONE world every first-time visitor lands in was the one
	// paying full price. Measured on a Pixel 5 over slow 4G against production on
	// 2026-09-08, that single image was 581 KB of /play's 5,470 KB, second only to
	// the HDRI. It becomes a texture a few hundred pixels tall on the totem and
	// the jumbotron, so 512 is already generous.
	image: '/api/img?url=' + encodeURIComponent('https://ipfs.io/ipfs/bafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q')
		+ '&seed=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&w=512',
	// The signature look for the home town: Dust Gulch, an old-west frontier town —
	// a packed-dirt square ringed by false-front storefronts (saloon, bank,
	// sheriff…) under a low golden-hour sun, with a water tower on the skyline and
	// tumbleweeds drifting the mesa. See the `frontier` biome in world-env.js.
	biome: 'frontier',
	official: true,
};

/** True when a mint is the flagship $THREE town. */
export const isHomeTown = (mint) => !!mint && mint === HOME_TOWN.mint;
