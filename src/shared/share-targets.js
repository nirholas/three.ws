/**
 * Share targets: X, Teams and LinkedIn.
 *
 * One helper used by every share menu (src/shared/share.js, the avatar and
 * agent page action bar, and every page that posts to X). It builds the
 * documented share URLs, opens them in a sized popup with a new-tab fallback,
 * and counts the action through the existing share funnel beacon.
 *
 *   X         https://x.com/intent/post?text=&url=&via=
 *   Teams     https://teams.microsoft.com/share?href=&msgText=&preview=true
 *   LinkedIn  https://www.linkedin.com/sharing/share-offsite/?url=
 *
 * X intents are built ONLY through xIntentUrl() below (enforced by
 * tests/x-intent.test.js and docs/share-to-x.md): it applies X's weighted
 * length rule so a long title or a CJK prompt is truncated before X rejects
 * the post, and it never truncates the URL.
 *
 * Neither network takes a pre-filled body for the other: LinkedIn ignores any
 * text parameter and unfurls the page's Open Graph tags, so the page head is
 * the source of truth (see docs/sharing.md and npm run audit:share-previews).
 */

import { beaconShareEvent } from './share-beacon.js';

const X_INTENT = 'https://x.com/intent/post';
const TEAMS_SHARE = 'https://teams.microsoft.com/share';
const LINKEDIN_SHARE = 'https://www.linkedin.com/sharing/share-offsite/';

// X weighted length, after twitter-text v3 (config/v3.json): every code point
// weighs 2 except four light ranges that weigh 1, every URL weighs 23 however
// long it is, every emoji sequence weighs 2, and the text is NFC-normalized
// first. The twitter-text package itself was last published in 2020, so this
// is the thin, tested reimplementation of only the counting rule we need.
export const X_MAX_WEIGHT = 280;
export const X_URL_WEIGHT = 23;
const ELLIPSIS = '\u2026';
const LIGHT_RANGES = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const TLDS = 'com|net|org|io|ws|ai|xyz|app|dev|co|me|gg|fun|so|sh|tv|us|uk|info|link|gov|edu|ly|to|fm|cc|de|fr|jp|cn|ca|au|in|br|ru|eu|nl|it|es';
const URL_RE = new RegExp(
	`https?:\\/\\/[^\\s<>"]+|(?<![@\\w./-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})\\b(?:\\/[^\\s<>"]*)?`,
	'giu',
);
const TRAILING_PUNCT_RE = /[.,!?;:'")\]]+$/u;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function graphemes(str) {
	return segmenter ? Array.from(segmenter.segment(str), (s) => s.segment) : Array.from(str);
}

function codePointWeight(cp) {
	return LIGHT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
}

function graphemeWeight(g) {
	const first = g.codePointAt(0);
	if (first > 0xff && EMOJI_RE.test(g)) return 2;
	let w = 0;
	for (const ch of g) w += codePointWeight(ch.codePointAt(0));
	return w;
}

/** Split text into weighted tokens: whole URLs (23 each) and single graphemes. */
function xTokens(text) {
	const src = String(text ?? '').normalize('NFC');
	const out = [];
	let last = 0;
	const pushGraphemes = (chunk) => {
		for (const g of graphemes(chunk)) out.push({ s: g, w: graphemeWeight(g) });
	};
	for (const m of src.matchAll(URL_RE)) {
		const url = m[0].replace(TRAILING_PUNCT_RE, '');
		if (!url) continue;
		pushGraphemes(src.slice(last, m.index));
		out.push({ s: url, w: X_URL_WEIGHT, url: true });
		last = m.index + url.length;
	}
	pushGraphemes(src.slice(last));
	return out;
}

/** The length X counts for a post body (280 is the limit). */
export function xWeightedLength(text) {
	return xTokens(text).reduce((n, t) => n + t.w, 0);
}

function viaHandle(via) {
	return String(via || '').trim().replace(/^@+/, '');
}

/** Weight left for the text once X appends " <url>" and " via @handle". */
export function xTextBudget({ url, via } = {}) {
	const handle = viaHandle(via);
	return X_MAX_WEIGHT - (url ? X_URL_WEIGHT + 1 : 0) - (handle ? xWeightedLength(` via @${handle}`) : 0);
}

/**
 * Fit text into `budget` weighted characters. Text that fits is returned
 * unchanged; longer text is cut on a grapheme (never inside an emoji, never
 * through a URL, which is dropped whole), backed off to a word boundary when
 * one is close, and closed with an ellipsis.
 */
export function fitXText(text, budget) {
	const str = String(text ?? '');
	const tokens = xTokens(str);
	if (tokens.reduce((n, t) => n + t.w, 0) <= budget) return str;
	const room = budget - xWeightedLength(ELLIPSIS);
	if (room <= 0) return '';
	const kept = [];
	let used = 0;
	for (const t of tokens) {
		if (used + t.w > room) break;
		kept.push(t);
		used += t.w;
	}
	const next = tokens[kept.length];
	if (next && !/\s/u.test(next.s)) {
		const lastSpace = kept.map((t) => t.s).lastIndexOf(' ');
		if (lastSpace > 0 && kept.length - lastSpace <= 16) kept.length = lastSpace;
	}
	return kept.map((t) => t.s).join('').trimEnd() + ELLIPSIS;
}

/**
 * X compose intent. The text is fitted to what is left of 280 after the url
 * and via suffix X appends; the url is passed through untouched. Empty params
 * are omitted. Nothing posts: the intent opens X's composer for the user to
 * edit and send.
 */
export function xIntentUrl({ text = '', url = '', via = '' } = {}) {
	const handle = viaHandle(via);
	const body = fitXText(text, xTextBudget({ url, via: handle }));
	const params = [];
	if (body) params.push(`text=${encodeURIComponent(body)}`);
	if (url) params.push(`url=${encodeURIComponent(url)}`);
	if (handle) params.push(`via=${encodeURIComponent(handle)}`);
	return params.length ? `${X_INTENT}?${params.join('&')}` : X_INTENT;
}

/**
 * Tag a shared link so a visit from X is attributable:
 * utm_source=x&utm_medium=share&utm_campaign=<campaign> (grok-share for the
 * plain X action, grok-ask for "Ask @grok about it"). Existing params are kept;
 * an empty or relative-unparseable value is returned unchanged.
 */
export function withShareUtm(url, campaign) {
	if (!url) return url;
	let u;
	try {
		u = new URL(url);
	} catch {
		return url;
	}
	u.searchParams.set('utm_source', 'x');
	u.searchParams.set('utm_medium', 'share');
	u.searchParams.set('utm_campaign', campaign);
	return u.toString();
}

/** Teams share launcher URL. `text` is the optional message that precedes the link preview. */
export function teamsShareUrl(url, text = '') {
	const q = new URLSearchParams({ href: url });
	if (text) q.set('msgText', text);
	q.set('preview', 'true');
	return `${TEAMS_SHARE}?${q}`;
}

/** LinkedIn share-offsite URL. */
export function linkedinShareUrl(url) {
	return `${LINKEDIN_SHARE}?${new URLSearchParams({ url })}`;
}

const POPUP_SIZES = {
	x: { width: 600, height: 640 },
	teams: { width: 700, height: 600 },
	linkedin: { width: 620, height: 640 },
};

/**
 * Open a share URL in a centred popup. Returns true when a window opened.
 * A blocked popup returns false so the caller lets the anchor's own
 * target=_blank navigation run as the new-tab fallback.
 */
export function openSharePopup(href, target) {
	const { width, height } = POPUP_SIZES[target] || POPUP_SIZES.linkedin;
	const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || width) - width) / 2));
	const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || height) - height) / 2));
	const win = window.open(
		href,
		`tws-share-${target}`,
		`popup=yes,noopener,noreferrer,width=${width},height=${height},left=${left},top=${top}`,
	);
	return !!win;
}

/**
 * Wire an anchor (already carrying the share href and target=_blank) so a
 * plain click opens the sized popup and records the action. Modified clicks
 * (ctrl/cmd/shift/middle) keep the browser's native new-tab behaviour, as does
 * a blocked popup. Keyboard activation fires click, so it is covered. An
 * anchor marked aria-disabled="true" does nothing and counts nothing; its
 * href is read at click time, so a caller may update it after wiring.
 * `surface` is the share funnel surface the click is counted under.
 */
export function wireShareAnchor(anchor, target, surface = 'creation_page') {
	anchor.addEventListener('click', (e) => {
		if (anchor.getAttribute('aria-disabled') === 'true' || !anchor.href) {
			e.preventDefault();
			return;
		}
		beaconShareEvent(surface, 'action');
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		if (openSharePopup(anchor.href, target)) e.preventDefault();
	});
}
