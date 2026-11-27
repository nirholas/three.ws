// The Forge sign-in round trip loses nothing.
//
// Making a model or adding a photo needs a free account (api/forge.js and
// api/forge-upload.js answer 401 `sign_in_required`). A visitor who typed a
// prompt and picked options, then followed a sign-in link, used to come back to
// an empty composer. This module holds the pure parts of the fix:
//
//   - forgeReturnPath / forgeAuthHref: the address sign-in returns to, which is
//     the page the visitor left and can only ever be a path on this site
//     (safeNext, the same guard the login page applies to ?next=).
//   - saveSignInDraft / takeSignInDraft: the composer state (prompt, input mode,
//     tier, engine, aspect, the model on screen) written to localStorage when a
//     sign-in or registration link is followed, and read back once on return.
//     localStorage rather than sessionStorage so a registration finished from an
//     email link in a new tab still finds it. It expires after two hours and is
//     removed the moment it is read.
//   - Photos are never stored: a photo is the visitor's own image, and parking it
//     in browser storage on what may be a shared computer is not ours to do. The
//     photo sign-in prompt says so before they leave, and the restore note
//     reminds them to add it again.
//
// The page (src/forge.js) owns reading and applying the live controls.

import { safeNext } from './safe-next.js';

export const SIGN_IN_DRAFT_KEY = 'forge:sign-in-draft';
export const SIGN_IN_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

const PROMPT_MAX = 1000;
const MODES = ['text', 'image', 'sketch'];
const TIERS = ['draft', 'standard', 'high'];
const ASPECTS = ['1:1', '4:3', '3:4', '16:9'];
const AUTH_PATHS = ['/login', '/register'];
// Engine button ids and creation ids are short slugs or uuids.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Where sign-in sends the visitor back to: the Forge page they are on, with its
 * query and hash, or `/forge` when the current address is not a plain same-site
 * path (https://three.ws//evil.com has the pathname "//evil.com").
 * @param {{ pathname?: string, search?: string, hash?: string } | null | undefined} loc
 * @param {string} [fallback]
 */
export function forgeReturnPath(loc, fallback = '/forge') {
	if (!loc || typeof loc.pathname !== 'string') return fallback;
	return safeNext(`${loc.pathname}${loc.search || ''}${loc.hash || ''}`, fallback);
}

/**
 * Sign-in or registration link that returns here.
 * @param {'login' | 'register'} page
 * @param {{ pathname?: string, search?: string, hash?: string }} loc
 */
export function forgeAuthHref(page, loc) {
	const path = page === 'register' ? '/register' : '/login';
	return `${path}?next=${encodeURIComponent(forgeReturnPath(loc))}`;
}

/**
 * Validate a stored draft field by field. Anything unrecognised falls back to
 * the composer default, so stored text is never trusted into a selector or the
 * DOM.
 * @returns {null | { prompt: string, mode: string, tier: string, engineId: string | null, aspect: string, hadPhotos: boolean, creationId: string | null }}
 */
export function normalizeSignInDraft(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
	const id = (value) => (typeof value === 'string' && SAFE_ID.test(value) ? value : null);
	return {
		prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, PROMPT_MAX) : '',
		mode: pick(raw.mode, MODES, 'text'),
		tier: pick(raw.tier, TIERS, 'standard'),
		engineId: id(raw.engineId),
		aspect: pick(raw.aspect, ASPECTS, '1:1'),
		hadPhotos: raw.hadPhotos === true,
		creationId: id(raw.creationId),
	};
}

// A composer left exactly at its defaults has nothing to lose.
function worthKeeping(d) {
	return Boolean(
		d.prompt.trim() || d.mode !== 'text' || d.tier !== 'standard' || d.engineId || d.aspect !== '1:1' || d.hadPhotos || d.creationId,
	);
}

/** Remember the composer before the visitor leaves for sign-in. Never throws. */
export function saveSignInDraft(storage, draft, now = Date.now()) {
	const d = normalizeSignInDraft(draft);
	try {
		if (!d || !worthKeeping(d)) {
			storage?.removeItem(SIGN_IN_DRAFT_KEY);
			return;
		}
		storage?.setItem(SIGN_IN_DRAFT_KEY, JSON.stringify({ ...d, savedAt: now }));
	} catch {
		// Private mode or a full quota: the round trip still works, only the
		// restore is lost, which is what happened before this existed.
	}
}

/** Read the saved composer once and forget it. Null when absent, stale or unreadable. */
export function takeSignInDraft(storage, now = Date.now()) {
	let raw = null;
	try {
		raw = storage?.getItem(SIGN_IN_DRAFT_KEY) ?? null;
		if (raw !== null) storage.removeItem(SIGN_IN_DRAFT_KEY);
	} catch {
		return null;
	}
	if (!raw) return null;
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const savedAt = Number(parsed?.savedAt);
	if (!Number.isFinite(savedAt) || now - savedAt > SIGN_IN_DRAFT_TTL_MS || now < savedAt) return null;
	return normalizeSignInDraft(parsed);
}

/**
 * Whether a link leaves for this site's sign-in or registration page.
 * @param {Element | null} anchor
 * @param {string} origin
 */
export function isAuthLink(anchor, origin) {
	const href = anchor?.getAttribute?.('href');
	if (!href) return false;
	let url;
	try {
		url = new URL(href, origin);
	} catch {
		return false;
	}
	return url.origin === origin && AUTH_PATHS.includes(url.pathname.replace(/\/+$/, ''));
}

/** The line shown beside Generate after a draft came back. */
export function restoredDraftNote(draft) {
	const base = 'Welcome back. Your prompt and settings are back: press Generate when you are ready.';
	return draft?.hadPhotos ? `${base} Photos stay on your device, so add your photos again first.` : base;
}

/**
 * Save the composer whenever the visitor follows a sign-in or registration link
 * anywhere on the page (the generate and photo prompts, the account note, the
 * site nav, the session banner). Capture phase, so it runs before navigation.
 * @param {() => object} readDraft  the page's current composer state
 * @param {{ doc?: Document, storage?: Storage }} [opts]
 * @returns {() => void} uninstall
 */
export function installSignInDraftCapture(readDraft, { doc = document, storage = globalThis.localStorage } = {}) {
	const origin = doc.defaultView?.location?.origin || globalThis.location?.origin;
	const onClick = (e) => {
		const anchor = e.target?.closest?.('a[href]');
		if (!isAuthLink(anchor, origin)) return;
		saveSignInDraft(storage, readDraft());
	};
	doc.addEventListener('click', onClick, true);
	doc.addEventListener('auxclick', onClick, true);
	return () => {
		doc.removeEventListener('click', onClick, true);
		doc.removeEventListener('auxclick', onClick, true);
	};
}
