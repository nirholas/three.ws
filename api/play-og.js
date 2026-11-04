// api/play-og.js: the Open Graph share card for a /play coin world.
//
// GET /api/play-og?coin=<mint>[&name=&symbol=&image=] renders a 1200x630 PNG of
// the world a link opens: the coin's own artwork, its ticker and name, a line
// that sells walking in, and the biome that mint actually renders in. It is
// what X, Telegram and Discord show when someone pastes an invite link
// (server/play-head.mjs points og:image here), and the guaranteed <img>
// fallback for platforms that block scripts and iframes.
//
// Identity resolves in three layers, best first, field by field:
//   1. the live coin lookup (/api/pump/coin), for anything it knows;
//   2. the link's own name/symbol/image params, which every invite link carries
//      (src/game/invite-link.js), so a coin the lookup cannot describe still
//      gets a named card instead of "this coin";
//   3. HOME_TOWN for $THREE, the platform's own world, which is never generic.
//
// The artwork is fetched through our own SSRF-hardened /api/img proxy (IPFS
// gateway fallback included), never from the raw URL, and converted to a PNG
// data URI before satori sees it: satori cannot decode WebP (what /api/img
// serves) and a remote <img> that fails mid-render throws the whole card. When
// the art cannot be had, the card draws a monogram disc in the biome's colours,
// a designed state rather than a hole. `x-play-og-art: coin|monogram` says which.
//
// Rendered via the shared ImageResponse (api/_lib/og-image.js) on the Node runtime, bridged from the
// Web Response to the Node ServerResponse.
import { ImageResponse } from './_lib/og-image.js';
import { method } from './_lib/http.js';
import { selfOrigin } from './_lib/self-origin.js';
import { seedFromString, biomeForSeed, biomeById } from '../src/game/world-biomes.js';
import { HOME_TOWN, isHomeTown } from '../src/game/home-town.js';

const WIDTH = 1200;
const HEIGHT = 630;
const LOOKUP_TIMEOUT_MS = 2500;
const ART_TIMEOUT_MS = 3000;
const ART_PX = 256;
const NAME_MAX = 40;
const SYMBOL_MAX = 14;
const IMAGE_MAX = 600;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const GENERIC_BIOME = biomeForSeed(seedFromString('three-ws'));

function clean(value, max) {
	const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return s ? s.slice(0, max) : '';
}

function formatMarketCap(mc) {
	const n = Number(mc);
	if (!Number.isFinite(n) || n <= 0) return null;
	if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
	return `$${n.toFixed(0)}`;
}

/** The image a card may fetch: our own /api/img path, or an https URL routed through it. */
function safeImage(value) {
	const s = clean(value, IMAGE_MAX);
	if (!s) return null;
	if (s.startsWith('/api/img?')) return s;
	try {
		return new URL(s).protocol === 'https:' ? s : null;
	} catch {
		return null;
	}
}

/**
 * Everything the card says, as data. Pure: no network, no rendering.
 *
 * @param {{ mint?: string, params?: URLSearchParams, coin?: object|null }} input
 *   `coin` is the /api/pump/coin body (or null when the lookup failed).
 */
export function cardModel({ mint = '', params = new URLSearchParams(), coin = null } = {}) {
	const validMint = MINT_RE.test(mint) ? mint : '';
	const home = validMint && isHomeTown(validMint);
	const name = clean(coin?.name, NAME_MAX) || clean(params.get('name'), NAME_MAX) || (home ? HOME_TOWN.name : '');
	const symbol = (clean(coin?.symbol, SYMBOL_MAX) || clean(params.get('symbol'), SYMBOL_MAX) || (home ? HOME_TOWN.symbol : ''))
		.replace(/^\$/, '');
	const image = safeImage(coin?.image_uri || coin?.image || coin?.imageUri)
		|| safeImage(params.get('image'))
		|| (home ? HOME_TOWN.image : null);
	const marketCap = formatMarketCap(
		coin?.usd_market_cap || coin?.market_cap_usd || coin?.market_cap || coin?.marketCap || 0,
	);
	// The biome the world really renders in: the home town pins its signature
	// look, every other coin draws it from the mint exactly as world-env.js does.
	const biome = !validMint
		? GENERIC_BIOME
		: (home && biomeById(HOME_TOWN.biome)) || biomeForSeed(seedFromString(validMint));
	const ticker = symbol ? '$' + symbol.toUpperCase() : '';
	const label = ticker || name;

	if (!validMint || !label) {
		return {
			mint: validMint,
			biome,
			heading: 'Walk into any coin',
			subline: 'Every coin is a live 3D world you can walk around with friends',
			image: null,
			monogram: '3',
			chips: [biome.label, 'Live 3D world'],
			official: false,
		};
	}
	return {
		mint: validMint,
		biome,
		heading: label,
		subline: ticker && name && name.toLowerCase() !== symbol.toLowerCase() ? name : '',
		sell: `Walk into ${label}'s live 3D world with your avatar. No download.`,
		image,
		monogram: (symbol || name).charAt(0).toUpperCase(),
		chips: [
			home ? 'Official town' : null,
			biome.label,
			marketCap ? `MCAP ${marketCap}` : null,
			'Live 3D world',
		].filter(Boolean),
		official: home,
	};
}

async function fetchWithTimeout(url, ms, init = {}) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	try {
		return await fetch(url, { ...init, signal: ctrl.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function fetchCoin(origin, mint) {
	if (!mint) return null;
	try {
		const r = await fetchWithTimeout(
			`${origin}/api/pump/coin?mint=${encodeURIComponent(mint)}`,
			LOOKUP_TIMEOUT_MS,
			{ headers: { accept: 'application/json' } },
		);
		if (!r.ok) return null;
		return await r.json();
	} catch {
		return null;
	}
}

/** The /api/img URL for an image: our own proxy path as-is, anything else wrapped. */
export function artProxyUrl(origin, image) {
	const u = image.startsWith('/api/img?')
		? new URL(image, origin)
		: new URL(`/api/img?url=${encodeURIComponent(image)}`, origin);
	u.searchParams.set('w', String(ART_PX));
	// The card draws its own monogram; the proxy's generic placeholder would
	// read as real art.
	u.searchParams.set('fallback', 'none');
	return u.toString();
}

/**
 * Fetch the coin art through /api/img and return it as a square PNG data URI,
 * or null when there is no usable image (the card then draws its monogram).
 */
async function fetchArt(origin, image) {
	if (!image) return null;
	try {
		const r = await fetchWithTimeout(artProxyUrl(origin, image), ART_TIMEOUT_MS, { headers: { accept: 'image/*' } });
		if (r.status !== 200) return null;
		const type = r.headers.get('content-type') || '';
		if (!type.startsWith('image/')) return null;
		const bytes = Buffer.from(await r.arrayBuffer());
		if (!bytes.length) return null;
		const { default: sharp } = await import('sharp');
		const png = await sharp(bytes, { animated: false })
			.resize(ART_PX, ART_PX, { fit: 'cover' })
			.png()
			.toBuffer();
		return `data:image/png;base64,${png.toString('base64')}`;
	} catch {
		return null;
	}
}

function div(style, children) {
	return { type: 'div', props: { style: { display: 'flex', ...style }, children } };
}

function artNode(model, art) {
	const [top, mid, horizon] = model.biome.sky;
	const ring = { width: 248, height: 248, borderRadius: 248, border: '6px solid rgba(255,255,255,0.92)' };
	if (art) {
		return { type: 'img', props: { src: art, width: 248, height: 248, style: { ...ring, objectFit: 'cover' } } };
	}
	return div({
		...ring,
		alignItems: 'center',
		justifyContent: 'center',
		background: `linear-gradient(160deg, ${horizon} 0%, ${mid} 45%, ${top} 100%)`,
		fontSize: 132,
		fontWeight: 800,
		color: 'rgba(8,8,10,0.86)',
	}, model.monogram || '3');
}

function chipNode(label, strong) {
	return div({
		fontSize: 24,
		fontWeight: 700,
		padding: '10px 20px',
		borderRadius: 999,
		background: strong ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.38)',
		color: strong ? '#08080a' : '#ffffff',
		border: strong ? '1px solid rgba(255,255,255,0.92)' : '1px solid rgba(255,255,255,0.28)',
	}, label);
}

function card(model, art) {
	const [top, mid] = model.biome.sky;
	const headingSize = model.heading.length > 14 ? 72 : 96;
	return div({
		width: '100%',
		height: '100%',
		flexDirection: 'column',
		justifyContent: 'space-between',
		padding: '56px 68px',
		background: `linear-gradient(135deg, ${mid} 0%, ${top} 42%, #08080a 100%)`,
		color: '#ffffff',
		fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
	}, [
		div({ alignItems: 'center', justifyContent: 'space-between' }, [
			div({ fontSize: 30, fontWeight: 800, letterSpacing: -1 }, 'three.ws'),
			div({ fontSize: 22, fontWeight: 700, letterSpacing: 4, opacity: 0.85 }, 'PLAY'),
		]),
		div({ alignItems: 'center', gap: 52 }, [
			artNode(model, art),
			div({ flexDirection: 'column', flex: 1, minWidth: 0 }, [
				div({ fontSize: headingSize, fontWeight: 900, letterSpacing: -3, lineHeight: 1 }, model.heading),
				model.subline
					? div({ fontSize: 34, marginTop: 12, fontWeight: 600, opacity: 0.92 }, model.subline)
					: null,
				model.sell
					? div({ fontSize: 28, marginTop: 18, lineHeight: 1.3, opacity: 0.88 }, model.sell)
					: null,
			].filter(Boolean)),
		]),
		div({ gap: 14 }, model.chips.map((label, i) => chipNode(label, model.official && i === 0))),
	]);
}

function imageResponse(node) {
	return new ImageResponse(node, {
		width: WIDTH,
		height: HEIGHT,
		headers: { 'cache-control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400' },
	});
}

// Web Response (from ImageResponse) to Node ServerResponse. Headers first, then body.
async function sendImage(res, response, artKind) {
	for (const [key, value] of response.headers.entries()) res.setHeader(key, value);
	res.setHeader('x-play-og-art', artKind);
	const ab = await response.arrayBuffer();
	res.statusCode = response.status;
	res.end(Buffer.from(ab));
}

export default async function handler(req, res) {
	if (req.method === 'OPTIONS') {
		res.setHeader('access-control-allow-origin', '*');
		res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
		res.statusCode = 204;
		res.end();
		return;
	}
	// A share card is a GET surface: any other verb would drive a full satori
	// render on a route that never accepts writes.
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	// The lookup and the art fetch are self-calls on the configured origin
	// (api/_lib/self-origin.js), never a client-supplied host.
	const origin = selfOrigin(req);
	const mint = clean(url.searchParams.get('coin') || url.searchParams.get('mint'), 64);

	let model = cardModel({ mint, params: url.searchParams });
	try {
		const coin = model.mint ? await fetchCoin(origin, model.mint) : null;
		model = cardModel({ mint, params: url.searchParams, coin });
		const art = await fetchArt(origin, model.image);
		await sendImage(res, imageResponse(card(model, art)), art ? 'coin' : 'monogram');
	} catch (err) {
		// Never fail to a broken-image grey box: render the same identity with the
		// monogram, which needs nothing from the network.
		console.error('[play-og] render failed:', err?.message || err);
		res.statusCode = 200;
		await sendImage(res, imageResponse(card(model, null)), 'monogram');
	}
}
