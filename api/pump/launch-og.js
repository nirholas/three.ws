/**
 * GET /api/pump/launch-og?mint=<mint>
 *
 * Dynamic OG image card for the /launches/<mint> coin detail page.
 * Returns an SVG-based social card (1200×630) that renders the coin's identity
 * and key signals from our DB + the pump.fun frontend API.
 *
 * Social crawlers (X, Telegram, Discord, Slack, iMessage, LinkedIn) accept
 * image/svg+xml for og:image, so we avoid pulling heavy canvas/imagemagick
 * deps into the serverless bundle. The card degrades gracefully: if a piece
 * of data is missing we simply omit it; we never fail with a 5xx over missing
 * enrichment.
 *
 * Card anatomy (1200×630, dark):
 *   top-left   — three.ws wordmark + "pump.fun launch"
 *   hero left  — coin image (120×120 circle, fetched and base64'd if available)
 *   hero right — name (large), symbol, mint short
 *   mid-left  : launch activity: unique buyers, buys and sells (raw counts)
 *   mid-right : market cap
 *   outcome   : "GRADUATED ✓" or "LIVE" pill (bottom-right)
 *
 * Neutral by design: the card never carries a score, grade, or engine label
 * such as "rugged". A shared card is a statement about someone's coin, and a
 * number on it reads as investment advice when high and as FUD when low.
 *   footer     — three.ws branding
 */

import { cors, method, wrap } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { fetchOgImage } from '../_lib/og-avatar.js';
import { pumpFetchJson } from '../_lib/pump-feed-fetch.js';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PUMP_FRONTEND_V3 = 'https://frontend-api-v3.pump.fun';
const CACHE = 'public, max-age=120, s-maxage=900, stale-while-revalidate=60';

// XML-escape all user-supplied text before embedding in SVG.
function x(s) {
	return String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function trunc(s, n) {
	s = String(s || '');
	return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function shortMint(m) {
	return `${m.slice(0, 6)}…${m.slice(-4)}`;
}

function fmtNum(v) {
	if (v == null) return '';
	const n = Number(v);
	if (!Number.isFinite(n)) return '';
	if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
	if (n < 0.001) return `$${n.toExponential(2)}`;
	return `$${n.toFixed(4)}`;
}

// Fetch the coin's logo from pump.fun as base64 — if it times out or fails,
// we just omit the image; the card still renders fine without it.
async function fetchLogoBase64(imageUri) {
	if (!imageUri) return null;
	const url = imageUri.startsWith('ipfs://')
		? `https://ipfs.io/ipfs/${imageUri.slice(7)}`
		: imageUri;
	// The logo URI is chosen by whoever launched the coin. fetchOgImage refuses
	// private and metadata addresses on every redirect hop, caps the bytes, and
	// only accepts a bare image media type, so neither internal responses nor a
	// quote-breaking content-type can end up inside this same-origin SVG.
	const img = await fetchOgImage(url, { timeoutMs: 3000 });
	return img ? `data:${img.ct};base64,${img.b64}` : null;
}

async function buildCardData(mint) {
	// DB: registry + intel + outcome in parallel.
	const [regRows, intelRows, outcomeRows] = await Promise.all([
		sql`
			SELECT pam.name, pam.symbol, pam.buyback_bps
			FROM pump_agent_mints pam
			WHERE pam.mint = ${mint}
			LIMIT 1
		`,
		sql`
			SELECT name, symbol, image_uri, category, description,
			       buy_count, sell_count, unique_buyers, creator
			FROM pump_coin_intel
			WHERE mint = ${mint}
			LIMIT 1
		`,
		sql`
			SELECT outcome, graduated, rugged, ath_multiple, ath_market_cap_usd, last_market_cap_usd
			FROM pump_coin_outcomes
			WHERE mint = ${mint}
			LIMIT 1
		`,
	]);

	const reg = regRows[0] || null;
	const intel = intelRows[0] || null;
	const outcome = outcomeRows[0] || null;

	const name = intel?.name || reg?.name || '';
	const symbol = intel?.symbol || reg?.symbol || '';
	const imageUri = intel?.image_uri || null;
	const category = intel?.category || '';
	const isThreeWsLaunch = !!reg;

	// Live USD market cap from pump.fun, but only while the coin is still active:
	// a graduated or rugged coin reads its number off the recorded outcome instead.
	// The field is `usd_market_cap` (with `market_cap_usd` as the v2 alias); the
	// card previously asked for a `market_cap_in_usd` key pump.fun does not emit,
	// so MKT CAP silently never rendered for a live coin.
	const wantsLiveMcap = !outcome?.graduated && !outcome?.rugged;

	// Genuinely concurrent: the logo fetch and the market-cap lookup are two
	// independent 3s-bounded round-trips, so the card costs one of them, not both.
	const [logoBase64, liveMcap] = await Promise.all([
		fetchLogoBase64(imageUri),
		wantsLiveMcap ? fetchLiveMarketCap(mint) : Promise.resolve(null),
	]);

	return { name, symbol, imageUri, logoBase64, category, isThreeWsLaunch, intel, outcome, liveMcap };
}

// Live USD market cap for a coin still on the curve. Any failure returns null and
// the card falls back to the recorded outcome numbers, or omits the block.
async function fetchLiveMarketCap(mint) {
	try {
		// An OG card is rendered by a crawler that will not come back, so a 429
		// here permanently ships a card with no market cap on it. One retry costs
		// a few hundred milliseconds and saves the card.
		const r = await pumpFetchJson(`${PUMP_FRONTEND_V3}/coins-v2/${mint}`, { timeoutMs: 3000 });
		if (!r.ok) return null;
		const d = r.body;
		const mcap = Number(d?.usd_market_cap ?? d?.market_cap_usd);
		return Number.isFinite(mcap) && mcap > 0 ? mcap : null;
	} catch {
		return null;
	}
}

export function renderCard(mint, d) {
	const { name, symbol, logoBase64, category, isThreeWsLaunch, intel, outcome, liveMcap } = d;
	const displayName = trunc(name || 'Unknown coin', 36);
	const displaySym = symbol ? `$${symbol.toUpperCase()}` : '';
	const mc = liveMcap ?? outcome?.ath_market_cap_usd ?? outcome?.last_market_cap_usd ?? null;
	const mcText = mc ? fmtNum(mc) : '';

	const accent = '#818cf8';

	let outcomePill = '';
	if (outcome?.graduated) {
		outcomePill = `<rect x="870" y="510" width="260" height="68" rx="10" fill="#16a34a22"/>
			<text x="890" y="553" fill="#22c55e" font-size="22" font-weight="600">GRADUATED ✓</text>`;
	} else {
		outcomePill = `<circle cx="891" cy="545" r="7" fill="#22c55e">
			<animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite"/>
		</circle>
		<text x="908" y="552" fill="#22c55e" font-size="20" font-weight="500">LIVE</text>`;
	}

	// Horizontal divider y-position.
	const imgBlock = logoBase64
		? `<image href="${logoBase64}" x="80" y="150" width="120" height="120" clip-path="url(#imgCircle)"/>`
		: `<rect x="80" y="150" width="120" height="120" rx="60" fill="#1e2030"/>
		   <text x="140" y="230" text-anchor="middle" fill="#6b7280" font-size="48">${x((displaySym || displayName)[0] || '?')}</text>`;

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="1200" height="630" viewBox="0 0 1200 630" role="img"
     aria-label="${x(displayName)} OG card">
	<defs>
		<clipPath id="imgCircle"><circle cx="140" cy="210" r="60"/></clipPath>
		<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#0a0b0f"/>
			<stop offset="100%" stop-color="#0f1119"/>
		</linearGradient>
	</defs>

	<!-- Background -->
	<rect width="1200" height="630" fill="url(#bg)"/>
	<!-- Subtle top border -->
	<rect x="0" y="0" width="1200" height="3" fill="${accent}" opacity="0.7"/>

	<!-- Header row -->
	<text x="80" y="92" fill="rgba(229,229,229,0.9)"
	      font-family="Inter,-apple-system,system-ui,sans-serif"
	      font-size="26" font-weight="600" letter-spacing="1">three.ws</text>
	${isThreeWsLaunch ? `<rect x="185" y="72" width="150" height="30" rx="6" fill="rgba(99,102,241,0.2)"/>
	<text x="200" y="93" fill="#818cf8" font-size="14" font-weight="500">three.ws launch</text>` : ''}
	<text x="1140" y="92" text-anchor="end" fill="rgba(229,229,229,0.3)"
	      font-family="Inter,-apple-system,system-ui,sans-serif"
	      font-size="20" font-weight="400">${x(shortMint(mint))}</text>

	<!-- Coin image (or fallback letter) -->
	${imgBlock}

	<!-- Coin identity -->
	<text x="228" y="200" fill="#e5e5e5"
	      font-family="Inter,-apple-system,system-ui,sans-serif"
	      font-size="56" font-weight="300" letter-spacing="-1">${x(displayName)}</text>
	<text x="228" y="248" fill="rgba(229,229,229,0.5)"
	      font-family="Inter,-apple-system,system-ui,sans-serif"
	      font-size="32" font-weight="400" letter-spacing="1">${x(displaySym)}</text>
	${category ? `<rect x="228" y="262" width="${category.length * 10 + 28}" height="30" rx="6" fill="rgba(255,255,255,0.06)"/>
	<text x="242" y="283" fill="rgba(229,229,229,0.45)" font-size="15" font-weight="400">${x(category)}</text>` : ''}

	<!-- Divider -->
	<line x1="80" y1="316" x2="1120" y2="316" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>

	<!-- Launch activity: raw counts only -->
	${intel?.unique_buyers ? `
	<text x="80" y="375" fill="rgba(229,229,229,0.4)" font-size="14" letter-spacing="2">UNIQUE BUYERS</text>
	<text x="80" y="440" fill="rgba(229,229,229,0.85)"
	      font-size="44" font-weight="300">${x(String(intel.unique_buyers))}</text>
	` : ''}
	${intel?.buy_count != null && intel?.sell_count != null ? `
	<text x="400" y="375" fill="rgba(229,229,229,0.4)" font-size="14" letter-spacing="2">BUYS / SELLS AT LAUNCH</text>
	<text x="400" y="440" fill="rgba(229,229,229,0.85)"
	      font-size="44" font-weight="300">${x(`${intel.buy_count} / ${intel.sell_count}`)}</text>
	` : ''}

	<!-- Market cap -->
	${mcText ? `
	<text x="1140" y="375" text-anchor="end" fill="rgba(229,229,229,0.4)" font-size="14" letter-spacing="2">MKT CAP</text>
	<text x="1140" y="445" text-anchor="end" fill="#e5e5e5"
	      font-family="Inter,-apple-system,system-ui,sans-serif"
	      font-size="52" font-weight="300" letter-spacing="-1">${x(mcText)}</text>
	` : ''}

	<!-- Outcome pill -->
	${outcomePill}

	<!-- Footer -->
	<text x="80" y="592" fill="rgba(229,229,229,0.2)"
	      font-family="Inter,-apple-system,system-ui,sans-serif"
	      font-size="18" letter-spacing="5">THREE.WS</text>
</svg>`;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	// Crawlers fetch og:image with GET, and several (Slack, iMessage) HEAD it
	// first; nothing else should be able to spend a DB read plus two upstream
	// round-trips on this route.
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const mint = (url.searchParams.get('mint') || '').trim();

	if (!MINT_RE.test(mint)) {
		res.statusCode = 400;
		res.setHeader('content-type', 'text/plain');
		res.end('bad mint');
		return;
	}

	let data;
	try {
		data = await buildCardData(mint);
	} catch (err) {
		// Hard DB failure: serve a branded fallback card rather than 500. Log it,
		// because swallowing it silently made a real outage indistinguishable from
		// a coin we simply have no data on: both render the same blank card.
		console.warn('[launch-og] card data failed for %s: %s', mint, err?.message || err);
		data = { name: '', symbol: '', logoBase64: null, category: '', isThreeWsLaunch: false, intel: null, outcome: null, liveMcap: null };
	}

	const svg = renderCard(mint, data);
	res.statusCode = 200;
	res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
	res.setHeader('cache-control', CACHE);
	res.end(svg);
});
