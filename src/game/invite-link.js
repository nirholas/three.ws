// Pure helpers behind the /play invite sheet (src/game/invite-sheet.js).
//
// Two links leave the sheet, on purpose:
//   - inviteUrl(): the link a player copies or shares. It carries the coin's whole
//     identity (coin, name, symbol, image) so the person who opens it lands in a
//     named, illustrated world even when the coin lookup is slow, and so the
//     server can stamp a coin-specific social card for the unfurl
//     (server/play-head.mjs).
//   - qrUrl(): the link the QR code encodes. It is the bare canonical
//     coinWorldUrl() made absolute. A projector QR has to scan from the back of a
//     room, and every extra character adds modules; the world re-resolves the
//     identity from the mint on arrival (HOME_TOWN for $THREE, the coin lookup
//     for everything else), so nothing is lost by keeping it short.
//
// Neither link ever carries anything but the identity params. Session state
// (tier, ui, director tokens, auth codes, referral or tracking params) is never
// copied from the current URL, because the person receiving an invite is not
// the person sending it.
//
// DOM-free so it runs under vitest in node (tests/play-invite.test.js).

import { coinWorldUrl } from '../fits-lib.js';
import { clockString, eventState } from '../shared/event-config.js';

const NAME_MAX = 48;
const SYMBOL_MAX = 16;
const IMAGE_MAX = 600;

// An event is announced on the invite sheet from this long before its start: close
// enough that "starts in" is a reason to send the link now, far enough ahead to
// cover the week of promotion before a meetup.
export const EVENT_LEAD_MS = 7 * 24 * 3600 * 1000;

function clamp(value, max) {
	const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return s ? s.slice(0, max) : '';
}

/**
 * The image param is only kept when it is our own /api/img proxy path or an
 * https URL: a `javascript:`/`data:` value or a relative path to anything else
 * has no business riding along on a link someone else will open.
 */
function safeImage(image) {
	const s = clamp(image, IMAGE_MAX);
	if (!s) return '';
	if (s.startsWith('/api/img?')) return s;
	try {
		const u = new URL(s);
		return u.protocol === 'https:' ? s : '';
	} catch {
		return '';
	}
}

function absolute(path, origin) {
	return new URL(path, origin).toString();
}

/**
 * The shareable invite link for a coin world.
 * @param {{ mint: string, name?: string, symbol?: string, image?: string }} coin
 * @param {string} origin e.g. location.origin
 * @returns {string|null} absolute URL, or null when the coin has no mint
 */
export function inviteUrl(coin, origin) {
	const base = coinWorldUrl(coin?.mint);
	if (!base) return null;
	const u = new URL(base, origin);
	const name = clamp(coin.name, NAME_MAX);
	const symbol = clamp(coin.symbol, SYMBOL_MAX).replace(/^\$/, '');
	const image = safeImage(coin.image);
	if (name) u.searchParams.set('name', name);
	if (symbol) u.searchParams.set('symbol', symbol);
	if (image) u.searchParams.set('image', image);
	return u.toString();
}

/** The short absolute link the QR encodes: exactly coinWorldUrl(), made absolute. */
export function qrUrl(coin, origin) {
	const base = coinWorldUrl(coin?.mint);
	return base ? absolute(base, origin) : null;
}

/** The coin's display label: `$SYMBOL`, else its name, else a neutral noun. */
export function coinLabel(coin) {
	const symbol = clamp(coin?.symbol, SYMBOL_MAX).replace(/^\$/, '');
	if (symbol) return '$' + symbol.toUpperCase();
	return clamp(coin?.name, NAME_MAX) || 'this world';
}

function eventCoin(cfg, origin) {
	if (!cfg?.link) return null;
	try {
		return new URL(cfg.link, origin).searchParams.get('coin');
	} catch {
		return null;
	}
}

/**
 * Everything the invite sheet renders, as data.
 *
 * Inside the event window (from EVENT_LEAD_MS before the start until the end) and
 * only for the world the event takes place in, the sheet leads with the event:
 * its name, and a countdown to the start or to the end while it is live. Any
 * other world, or the same world outside the window, gets the plain invite.
 *
 * @param {{ coin: object, origin: string, event?: object|null, now?: number }} input
 *   `event` is the parsed config from src/shared/event-config.js parseEventConfig().
 */
export function inviteSheetModel({ coin, origin, event = null, now = Date.now() }) {
	const label = coinLabel(coin);
	const model = {
		link: inviteUrl(coin, origin),
		qr: qrUrl(coin, origin),
		label,
		heading: `Invite a friend to ${label}`,
		shareText: `Come walk around ${label} with me in 3D on three.ws`,
		event: null,
	};
	if (!event || !coin?.mint || eventCoin(event, origin) !== coin.mint) return model;
	const state = eventState(event, now);
	if (state === 'over') return model;
	if (state === 'upcoming' && event.startsAt - now > EVENT_LEAD_MS) return model;
	// remainingMs lets a live sheet re-render the clock through the i18n layer
	// every second; countdown is the same thing as ready-made English.
	const remainingMs = state === 'live' ? event.endsAt - now : event.startsAt - now;
	const clock = clockString(remainingMs);
	const countdown = state === 'live' ? `Live now, ends in ${clock}` : `Starts in ${clock}`;
	model.event = { name: event.name, state, countdown, clock, remainingMs };
	model.heading = `Invite a friend to ${event.name}`;
	model.shareText = state === 'live'
		? `${event.name} is live right now in ${label}. Come join me on three.ws`
		: `Join me at ${event.name} in ${label} on three.ws`;
	return model;
}
