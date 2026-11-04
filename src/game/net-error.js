// One voice for network failures across /play.
//
// A dropped connection reaches page code as the browser's own words, and every
// engine spells it differently: Chromium "Failed to fetch", Safari "Load
// failed", Firefox "NetworkError when attempting to fetch resource." Internal
// throws add their own jargon ("http 502", "request failed", "thread 404").
// None of that tells a player what happened or what to do, so every boundary
// that shows an error routes it through netErrorMessage(): a dropped
// connection and a struggling server each get one translated, actionable line,
// a real explanation from the server (an `error_description` such as "You are
// already friends.") is kept, and anything else becomes the caller's fallback.

import { t } from './i18n-play.js';

export const NET_UNREACHABLE = 'Could not reach three.ws. Check your connection and try again.';
export const NET_SERVER = 'three.ws is having trouble right now. Try again in a moment.';

const BROWSER_NETWORK = /failed to fetch|load failed|networkerror|network error|network request failed|err_internet|err_network/i;
const RAW_STATUS = /^\s*http[\s_]?(\d{3})\b/i;
const JARGON = /^(request failed|could not send|stream error|upstream error|thread \d{3}|poll failed)\b/i;
// A server explanation written for people: a capitalised sentence with a space
// and closing punctuation, naming no HTTP status. Codes ("rate_limited") and
// status text ("Not Found") do not qualify.
const SENTENCE = /^[A-Z][^\n]*\s[^\n]*[.!?]$/;
const NAMES_HTTP = /\bhttp\b/i;

/** Did this error come from the connection itself rather than from the server? */
export function isNetworkFailure(err) {
	if (!err) return false;
	if (err.code === 'network' || err.name === 'TimeoutError') return true;
	return BROWSER_NETWORK.test(String(err.message || ''));
}

function statusOf(err) {
	if (Number.isFinite(err?.status)) return err.status;
	const m = RAW_STATUS.exec(String(err?.message || ''));
	return m ? Number(m[1]) : 0;
}

/**
 * The line to show a player for a failed request.
 * @param {unknown} err the caught error (or null)
 * @param {string} fallback what to say when the error carries nothing a player can use
 * @returns {string}
 */
export function netErrorMessage(err, fallback) {
	if (isNetworkFailure(err)) return t('play.net_unreachable', NET_UNREACHABLE);
	const status = statusOf(err);
	if (status >= 500) return t('play.net_server', NET_SERVER);
	const msg = String(err?.message || '').trim();
	if (!msg || JARGON.test(msg)) return fallback;
	if (status && (!SENTENCE.test(msg) || NAMES_HTTP.test(msg))) return fallback;
	return msg;
}
