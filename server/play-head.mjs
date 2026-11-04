// Per-coin <head> for the /play world shell.
//
// Every coin world (/play?coin=<mint>) is served from one static shell
// (pages/play.html) whose head describes the lobby: "Play · Coin Communities"
// and a generic page-og card. An invite link pasted into X, Telegram, Discord or
// iMessage unfurled as that same stock card whatever coin it opened, so the
// thing that makes someone click (whose world this is) never showed.
//
// This module rewrites the shell's head for one request: title, description,
// canonical, Open Graph and Twitter tags naming the coin, a summary_large_image
// card from /api/play-og (the coin's art, ticker and the biome its world really
// renders in), the oEmbed discovery links pointed at this world, and a WebPage
// JSON-LD node for it.
//
// Identity comes from the link itself (the coin/name/symbol/image params every
// invite link carries, src/game/invite-link.js), then HOME_TOWN for $THREE. No
// network: the head is ready synchronously, so the page is never held on a
// lookup. /api/play-og does its own live lookup when the card image is fetched,
// so a link without a name still unfurls with the coin's real ticker art.
//
// Like server/creation-head.mjs it runs for every User-Agent (a crawler sees
// exactly what a visitor sees) and never fails a page: anything it cannot use
// returns null and the caller serves the untouched shell.

import { scriptJson } from '../api/_lib/safe-text.js';
import { HOME_TOWN, isHomeTown } from '../src/game/home-town.js';

const ORIGIN = 'https://three.ws';
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME_MAX = 48;
const SYMBOL_MAX = 16;
const IMAGE_MAX = 600;

function clean(value, max) {
	const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return s ? s.slice(0, max) : '';
}

function htmlEscape(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Same rule as invite-link.js: only our own proxy path or an https URL may ride
// along into the card URL.
function safeImage(value) {
	const s = clean(value, IMAGE_MAX);
	if (!s) return '';
	if (s.startsWith('/api/img?')) return s;
	try {
		return new URL(s).protocol === 'https:' ? s : '';
	} catch {
		return '';
	}
}

/** True when a request path is the /play world shell (/play or /play/). */
export function isPlayPath(pathname) {
	return pathname === '/play' || pathname === '/play/';
}

/**
 * Everything the head says about one coin world, from the request's query.
 * Returns null when the link names no valid mint (the lobby keeps its own head).
 *
 * @param {URLSearchParams} params
 * @param {string} [origin]
 */
export function playMeta(params, origin = ORIGIN) {
	const mint = clean(params.get('coin') || params.get('mint'), 64);
	if (!MINT_RE.test(mint)) return null;
	const home = isHomeTown(mint);
	const name = clean(params.get('name'), NAME_MAX) || (home ? HOME_TOWN.name : '');
	const symbol = (clean(params.get('symbol'), SYMBOL_MAX) || (home ? HOME_TOWN.symbol : '')).replace(/^\$/, '');
	const image = safeImage(params.get('image')) || (home ? HOME_TOWN.image : '');
	const ticker = symbol ? '$' + symbol.toUpperCase() : '';
	const label = ticker || name;

	const pageUrl = `${origin}/play?coin=${encodeURIComponent(mint)}`;
	const card = new URL('/api/play-og', origin);
	card.searchParams.set('coin', mint);
	if (name) card.searchParams.set('name', name);
	if (symbol) card.searchParams.set('symbol', symbol);
	if (image) card.searchParams.set('image', image);

	const title = label ? `${label}, a live 3D world · three.ws` : 'A live 3D coin world · three.ws';
	const named = label && name && ticker && name.toLowerCase() !== symbol.toLowerCase() ? `${ticker} (${name})` : label;
	const description = label
		? `Walk into ${named}'s live 3D world on three.ws with your avatar. Meet holders, chat, and explore together in the browser. No download.`
		: 'Walk into this coin\'s live 3D world on three.ws with your avatar. Meet holders, chat, and explore together in the browser. No download.';
	const alt = label ? `${label}'s 3D world on three.ws` : 'A coin\'s 3D world on three.ws';
	return { mint, home, label, pageUrl, image: card.toString(), title, description, alt };
}

function setTag(head, re, tag, missing) {
	if (re.test(head)) return head.replace(re, () => tag);
	missing.push(tag);
	return head;
}

const metaRe = (attr, key) => new RegExp(`<meta\\b[^>]*\\b${attr}=["']${key}["'][^>]*>`, 'i');
const oembedRe = (type) => new RegExp(`<link\\b[^>]*type=["']${type.replace('+', '\\+')}["'][^>]*>`, 'i');

/**
 * Rewrite the /play shell's head for the coin a request names. Pure.
 *
 * @param {string} html     pages/play.html (raw or dev-transformed)
 * @param {URLSearchParams} params  the request's query
 * @param {string} [origin]
 * @returns {string|null}   null when there is no coin or no <head>
 */
export function rewritePlayHead(html, params, origin = ORIGIN) {
	try {
		const m = playMeta(params, origin);
		if (!m) return null;
		const headMatch = /<head[^>]*>[\s\S]*?<\/head>/i.exec(html);
		if (!headMatch) return null;
		const t = htmlEscape(m.title);
		const d = htmlEscape(m.description);
		const img = htmlEscape(m.image);
		const url = htmlEscape(m.pageUrl);
		const alt = htmlEscape(m.alt);
		const missing = [];
		let head = headMatch[0];

		head = setTag(head, /<title[^>]*>[\s\S]*?<\/title>/i, `<title>${t}</title>`, missing);
		head = setTag(head, metaRe('name', 'description'), `<meta name="description" content="${d}" />`, missing);
		head = setTag(head, /<link\b[^>]*rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${url}" />`, missing);
		head = setTag(head, metaRe('property', 'og:url'), `<meta property="og:url" content="${url}" />`, missing);
		head = setTag(head, metaRe('property', 'og:title'), `<meta property="og:title" content="${t}" />`, missing);
		head = setTag(head, metaRe('property', 'og:description'), `<meta property="og:description" content="${d}" />`, missing);
		head = setTag(head, metaRe('property', 'og:image'), `<meta property="og:image" content="${img}" />`, missing);
		head = setTag(head, metaRe('property', 'og:image:width'), '<meta property="og:image:width" content="1200" />', missing);
		head = setTag(head, metaRe('property', 'og:image:height'), '<meta property="og:image:height" content="630" />', missing);
		head = setTag(head, metaRe('property', 'og:image:alt'), `<meta property="og:image:alt" content="${alt}" />`, missing);
		head = setTag(head, metaRe('name', 'twitter:card'), '<meta name="twitter:card" content="summary_large_image" />', missing);
		head = setTag(head, metaRe('name', 'twitter:title'), `<meta name="twitter:title" content="${t}" />`, missing);
		head = setTag(head, metaRe('name', 'twitter:description'), `<meta name="twitter:description" content="${d}" />`, missing);
		head = setTag(head, metaRe('name', 'twitter:image'), `<meta name="twitter:image" content="${img}" />`, missing);
		head = setTag(head, metaRe('name', 'twitter:image:alt'), `<meta name="twitter:image:alt" content="${alt}" />`, missing);

		// oEmbed discovery for this world, so an editor that embeds the link
		// embeds this coin rather than the lobby.
		const title = htmlEscape(m.label ? `${m.label} on three.ws` : 'three.ws Coin Communities');
		for (const [type, format] of [['application/json+oembed', 'json'], ['text/xml+oembed', 'xml']]) {
			const href = htmlEscape(`${origin}/api/play-oembed?url=${encodeURIComponent(m.pageUrl)}&format=${format}`);
			head = setTag(head, oembedRe(type), `<link rel="alternate" type="${type}" href="${href}" title="${title}">`, missing);
		}

		// One WebPage node for this world, replacing the lobby's.
		head = head.replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>\s*/gi, '');
		missing.push(
			`<script type="application/ld+json">${scriptJson({
				'@context': 'https://schema.org',
				'@graph': [{
					'@type': 'WebPage',
					name: m.title,
					description: m.description,
					url: m.pageUrl,
					isPartOf: { '@type': 'WebSite', name: 'three.ws', url: origin },
					primaryImageOfPage: m.image,
				}],
			})}</script>`,
		);
		head = head.replace(/<\/head>/i, () => `\t${missing.join('\n\t')}\n</head>`);
		return html.slice(0, headMatch.index) + head + html.slice(headMatch.index + headMatch[0].length);
	} catch (err) {
		console.error('[play-head] fell back to the static shell:', err?.message);
		return null;
	}
}
