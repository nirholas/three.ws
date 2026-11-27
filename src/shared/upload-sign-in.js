// Making or uploading anything needs an account: /api/forge and
// /api/forge-upload answer 401 `sign_in_required` to anonymous callers
// (api/_lib/creator-account.js). The Forge pages stay browsable and ask at the
// moment a visitor acts: when they add a photo (before the on-device photo check
// spends their time on a file that could not be uploaded) and when they press
// Generate (before the generating panel promises work that cannot start).

import './upload-sign-in.css';
import { forgeReturnPath } from '../forge-sign-in-return.js';

// These pages show their own sign-in prompt in context for generating and
// photo uploads, so the site-wide banner in public/nav.js stands aside for those
// two endpoints (and still covers every other call the page makes).
export const IN_PAGE_SIGN_IN_PATHS = Object.freeze(['/api/forge', '/api/forge-upload']);
if (typeof document !== 'undefined') document.documentElement.dataset.signInPrompt = IN_PAGE_SIGN_IN_PATHS.join(' ');

let check = null;

/**
 * Whether this visitor has a session: 'in', 'out', or 'unknown' when the auth
 * service could not answer (offline, erroring). Asked once per page load:
 * signing in navigates away and back, which starts a fresh check.
 * /api/auth/me answers 200 for everyone and carries the answer in the body
 * (`{ user: null }` when signed out), so this reads the body, not the status.
 * @returns {Promise<'in' | 'out' | 'unknown'>}
 */
export function accountState() {
	check ??= fetch('/api/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
		.then(async (res) => {
			if (res.status === 401) return 'out';
			if (!res.ok) return 'unknown';
			const body = await res.json();
			return body?.user ? 'in' : 'out';
		})
		.catch(() => 'unknown');
	return check;
}

/**
 * Whether this visitor can upload and generate. When the answer is unknowable
 * this resolves true and lets the endpoint decide, so a flaky probe never
 * blocks a signed-in visitor.
 * @returns {Promise<boolean>}
 */
export function signedInForUploads() {
	return accountState().then((state) => state !== 'out');
}

/** True when an upload endpoint refused the caller for not being signed in. */
export function isSignInRequired(status, body) {
	return status === 401 && body?.error === 'sign_in_required';
}

/**
 * Sign-in link that returns the visitor to this page afterwards. The return
 * address is validated to a same-site path (forgeReturnPath), so an address
 * like https://three.ws//evil.com can never become ?next=//evil.com.
 */
export function uploadSignInUrl() {
	return `/login?next=${encodeURIComponent(forgeReturnPath({ pathname: location.pathname, search: location.search }))}`;
}

export const UPLOAD_SIGN_IN_SHORT = 'Sign in to add photos.';
export const CREATE_SIGN_IN_SHORT = 'Sign in to make a 3D model.';

function renderSignIn(el, lead, tail, linkText = 'Sign in') {
	const strong = document.createElement('strong');
	strong.textContent = lead;
	const a = document.createElement('a');
	a.href = uploadSignInUrl();
	a.textContent = linkText;
	el.classList.add('upload-sign-in');
	el.replaceChildren(strong, ' ', a, tail);
	return a;
}

const PHOTO_STAYS = ' Your photo stays on this device and is not carried over, so add it again when you are back.';

/**
 * Fill `el` with the photo sign-in prompt: why, the link back here, and that
 * the photo itself is not kept across the round trip.
 * @param {HTMLElement} el
 * @param {{ sessionEnded?: boolean }} [opts] the visitor was signed in when the page loaded
 * @returns {HTMLAnchorElement} the sign-in link, so a caller can focus it
 */
export function renderUploadSignIn(el, { sessionEnded = false } = {}) {
	if (sessionEnded) return renderSignIn(el, 'Your session ended.', ` to add photos again.${PHOTO_STAYS}`, 'Sign in again');
	return renderSignIn(el, 'Photos need a free account.', ` to add photos. You come straight back here.${PHOTO_STAYS}`);
}

/**
 * Fill `el` with the generate sign-in prompt: why, and the link back here.
 * Every model has an owner who can find, publish or delete it later, so making
 * one needs an account. A visitor whose session ended mid-visit is told that
 * instead of being told they need an account they already have.
 * @param {HTMLElement} el
 * @param {{ sessionEnded?: boolean }} [opts]
 * @returns {HTMLAnchorElement} the sign-in link, so a caller can focus it
 */
export function renderCreateSignIn(el, { sessionEnded = false } = {}) {
	el.classList.add('upload-sign-in--panel');
	if (sessionEnded) {
		return renderSignIn(el, 'Your session ended, so this model did not start.', ' and you come straight back here with your prompt and settings kept.', 'Sign in again');
	}
	return renderSignIn(el, 'Making a 3D model needs a free account.', ' and your model is saved to it, unlisted until you choose to publish it. You come straight back here with your prompt and settings kept.');
}
